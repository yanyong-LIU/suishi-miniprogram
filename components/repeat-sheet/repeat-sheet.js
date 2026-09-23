/* ============================================================
   重复规则（编辑器弹层里的第二层弹层）
   ------------------------------------------------------------
   农历每年不是「多一个选项」就完事：闰月退化、腊月三十遇小月，
   必须在用户选择的那一刻就告诉他，而不是等他某年发现提醒早了一天。
   所以选中后立刻展开公历 ↔ 农历换算卡，并给出推算提示。

   提示用 warning 色而不是 danger：这是正常行为，不是错误。

   版式顺序严格照原型 rpBody()：选项 → 推算提示 → 换算卡 →
   参数胶囊 → 闰月开关 + 说明。推算提示排在换算卡之前，
   是为了让用户还没选参数就先看到边界，选完才看到就晚了。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const L = require('../../utils/lunar.js');
const R = require('../../utils/repeat.js');
const PF = require('../../utils/platform.js');

const { LUNAR_M, LUNAR_D, WD } = L;

Component({
  options: { styleIsolation: 'apply-shared' },

  data: {
    show: false,
    opts: [],
    warn: '',
    conv: null,
    chipGroups: [],
    leapOn: false,
    lunarMonthName: ''
  },

  methods: {
    /* 打开：ctx 决定各规则的默认参数（沿用当前时间）
       返回 Promise，resolve 的是「确定后的规则」或 null（取消） */
    open(opt) {
      opt = opt || {};
      this.ctx = {
        dueAt: opt.dueAt || (Date.now() + 3600000),
        allDay: !!opt.allDay,
        repeat: JSON.parse(JSON.stringify(opt.repeat || { type: 'none', params: {} }))
      };
      R.ensureParams(this.ctx.repeat, this.ctx.dueAt);

      /* 贴底弹层（被编辑器叠着，底部「保存」也在 TabBar 盖住的那 100rpx 里）。
         open() 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数。 */
      if (!this.data.show) PF.overlayTab(true);
      return new Promise(resolve => {
        this._resolve = resolve;
        this.setData({ show: true });
        this.paint();
      });
    },

    close(v) {
      if (!this.data.show) return;
      this.setData({ show: false });
      PF.overlayTab(false);
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(v), 240);
    },

    /* ── 渲染 ───────────────────────────────────────────── */
    paint() {
      const rp = this.ctx.repeat;
      const d = new Date(this.ctx.dueAt);

      /* 七个选项，副行给出「选了之后具体是哪天」——比只写规则名清楚 */
      const opts = R.REPEAT_OPTS.map(([k, m]) => {
        let sub = '';
        if (k === 'weekly') sub = '每周' + WD[rp.type === 'weekly' && rp.params.weekday != null ? rp.params.weekday : d.getDay()];
        else if (k === 'monthly') sub = '每月 ' + ((rp.type === 'monthly' && rp.params.day) || d.getDate()) + ' 日';
        /* 「每季」按 3 个月推，副行写成「每 3 个月 x 日」，
           免得「每季 15 日」被读成「这个季度的第 15 天」 */
        else if (k === 'quarterly') sub = '每 3 个月 ' + ((rp.type === 'quarterly' && rp.params.day) || d.getDate()) + ' 日';
        else if (k === 'yearly') sub = '每年 ' + ((rp.type === 'yearly' && rp.params.month) || d.getMonth() + 1) + ' 月 ' +
          ((rp.type === 'yearly' && rp.params.day) || d.getDate()) + ' 日';
        else if (k === 'lunarYearly') {
          const p = rp.params;
          sub = (rp.type === 'lunarYearly' && p.lunarMonth)
            ? '农历 ' + (p.isLeapMonth ? '闰' : '') + LUNAR_M[p.lunarMonth] + '月' + LUNAR_D[p.lunarDay]
            : '按农历日期推算，公历每年都变';
        }
        return { key: k, label: m, sub, on: rp.type === k };
      });

      const groups = [];
      if (rp.type === 'weekly') {
        groups.push({
          title: '在哪天', key: 'wd',
          /* 只写「日 / 一 / 二」，不写「周日 / 周一」：
             标题已经说明是「在哪天」，重复一遍「周」会让 7 个胶囊撑出屏 */
          items: [0, 1, 2, 3, 4, 5, 6].map(i => ({ v: i, label: WD[i], on: (rp.params.weekday != null ? rp.params.weekday : d.getDay()) === i }))
        });
      } else if (rp.type === 'monthly') {
        groups.push({ title: '每月几号', key: 'md', items: mkNum(31, ' 日', rp.params.day || d.getDate()) });
      } else if (rp.type === 'quarterly') {
        groups.push({ title: '每季几号', key: 'qd', items: mkNum(31, ' 日', rp.params.day || d.getDate()) });
      } else if (rp.type === 'yearly') {
        groups.push({ title: '月', key: 'mo', items: mkNum(12, ' 月', rp.params.month || d.getMonth() + 1) });
        groups.push({ title: '日', key: 'md2', items: mkNum(31, ' 日', rp.params.day || d.getDate()) });
      } else if (rp.type === 'lunarYearly') {
        groups.push({
          title: '农历月', key: 'lm',
          items: mkNum(12, '月', rp.params.lunarMonth).map(x => ({ v: x.v, label: LUNAR_M[x.v] + '月', on: x.on }))
        });
        groups.push({
          title: '农历日', key: 'ld',
          items: mkNum(30, '', rp.params.lunarDay).map(x => ({ v: x.v, label: LUNAR_D[x.v], on: x.on }))
        });
      }

      this.setData({
        opts,
        chipGroups: groups,
        leapOn: !!rp.params.isLeapMonth,
        lunarMonthName: LUNAR_M[rp.params.lunarMonth] || '',
        warn: R.repeatEdgeWarning(this.ctx) || '',
        conv: rp.type === 'lunarYearly' ? this.buildConv(rp) : null
      });
    },

    /* 公历 ↔ 农历 双向可见。用户选的是农历，但需要知道它落在公历哪天。
       取的是**下一次触发**而不是任务当前时间 —— 农历每年本来就要看「下一次落哪」，
       写成当前时间等于告诉用户一件他已经知道的事。
       降级（闰月不存在 / 腊月三十遇小月）由 repeatEdgeWarning 单独用警示条说明，
       这里不重复。 */
    buildConv(rp) {
      const ctx = this.ctx;
      const at = R.nextOccurrenceFrom({ dueAt: ctx.dueAt, allDay: ctx.allDay, repeat: rp }, Date.now() - 86400000) || ctx.dueAt;
      const sd = new Date(at);
      const next2 = R.nextOccurrenceFrom({ dueAt: at, allDay: ctx.allDay, repeat: rp }, at + 86400000);
      const sd2 = next2 ? new Date(next2) : null;

      return {
        solar: sd.getFullYear() + ' 年 ' + (sd.getMonth() + 1) + ' 月 ' + sd.getDate() + ' 日',
        lunar: L.lunarFull(sd),
        dsc: '农历这一天对应的公历日期每年都会变。' +
          (sd2 ? '下一次会落在 ' + (sd2.getMonth() + 1) + ' 月 ' + sd2.getDate() + ' 日。' : '')
      };
    },

    /* ── 事件 ───────────────────────────────────────────── */
    onType(e) {
      const k = e.currentTarget.dataset.v;
      const rp = this.ctx.repeat;
      if (rp.type === k) return;
      /* 只换类型，参数保留并补齐缺省：用户来回切规则时不该丢掉已选的
         周几 / 几号，那是最容易被骂的一种「自作聪明」。 */
      rp.type = k;
      R.ensureParams(rp, this.ctx.dueAt);
      this.paint();
    },

    onChip(e) {
      const k = e.currentTarget.dataset.k;
      const v = +e.currentTarget.dataset.v;
      const p = this.ctx.repeat.params;
      if (k === 'wd') p.weekday = v;
      else if (k === 'md') p.day = v;
      else if (k === 'qd') p.day = v;
      else if (k === 'mo') p.month = v;
      else if (k === 'md2') p.day = v;
      else if (k === 'lm') p.lunarMonth = v;
      else if (k === 'ld') p.lunarDay = v;
      this.paint();
    },

    onLeap() {
      const p = this.ctx.repeat.params;
      p.isLeapMonth = !p.isLeapMonth;
      this.paint();
    },

    /* 「完成」只回传规则，由编辑器负责把时间重新锚定 ——
       规则与时间必须在一处对齐，两处都做迟早会不一致 */
    onOk() {
      this.close(JSON.parse(JSON.stringify(this.ctx.repeat)));
    },

    onCancel() { this.close(null); },

    /* 面板内点击不冒泡到遮罩 */
    noop() { }
  }
});

function mkNum(n, unit, cur) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ v: i, label: i + unit, on: cur === i });
  return out;
}
