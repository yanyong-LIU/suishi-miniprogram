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
    paramRow: null,
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

      /* 各规则的参数改为滚轮选择（v1.0.8，与日期时间同形态，原型 rpBody
         同步改为字段行）：行上只展示当前值，点开才是滚轮 —— 31 个胶囊
         横着排在手机上既看不全也点不准，滚轮一屏放下、居中高亮。 */
      let paramRow = null;
      if (rp.type === 'weekly') {
        const wd = rp.params.weekday != null ? rp.params.weekday : d.getDay();
        paramRow = { label: '在哪天', value: '每周' + WD[wd] };
      } else if (rp.type === 'monthly') {
        paramRow = { label: '每月几号', value: (rp.params.day || d.getDate()) + ' 日' };
      } else if (rp.type === 'quarterly') {
        paramRow = { label: '每季几号', value: (rp.params.day || d.getDate()) + ' 日' };
      } else if (rp.type === 'yearly') {
        paramRow = { label: '哪个月哪一天', value: (rp.params.month || d.getMonth() + 1) + ' 月 ' + (rp.params.day || d.getDate()) + ' 日' };
      } else if (rp.type === 'lunarYearly') {
        paramRow = { label: '农历月日', value: '农历 ' + (rp.params.isLeapMonth ? '闰' : '') + (LUNAR_M[rp.params.lunarMonth] || '') + '月' + (LUNAR_D[rp.params.lunarDay] || '') };
      }

      this.setData({
        opts,
        paramRow,
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

    /* 参数滚轮：列定义按规则给，确认后写回 params 并重绘。
       滚轮是编辑器同款组件（#rpwheel，custom 模式），弹层嵌套：
       编辑器('hide') → 重复规则('hide') → 滚轮('hide')，
       overlayTab 引用计数各层开关一一对应。 */
    onPickParam() {
      const rp = this.ctx.repeat;
      const d = new Date(this.ctx.dueAt);
      let title = '', columns = [];

      if (rp.type === 'weekly') {
        title = '在哪天';
        columns = [{
          key: 'weekday',
          value: rp.params.weekday != null ? rp.params.weekday : d.getDay(),
          items: [0, 1, 2, 3, 4, 5, 6].map(i => ({ v: i, label: '周' + WD[i] }))
        }];
      } else if (rp.type === 'monthly' || rp.type === 'quarterly') {
        title = rp.type === 'monthly' ? '每月几号' : '每季几号';
        columns = [{ key: 'day', value: rp.params.day || d.getDate(), items: numItems(31, ' 日') }];
      } else if (rp.type === 'yearly') {
        title = '哪个月哪一天';
        columns = [
          { key: 'month', value: rp.params.month || d.getMonth() + 1, items: numItems(12, ' 月') },
          { key: 'day', value: rp.params.day || d.getDate(), items: numItems(31, ' 日') }
        ];
      } else if (rp.type === 'lunarYearly') {
        title = '农历月日';
        columns = [
          { key: 'lunarMonth', value: rp.params.lunarMonth, items: numItems(12, '月').map(x => ({ v: x.v, label: LUNAR_M[x.v] + '月' })) },
          { key: 'lunarDay', value: rp.params.lunarDay, items: numItems(30, '').map(x => ({ v: x.v, label: LUNAR_D[x.v] })) }
        ];
      }
      if (!columns.length) return;

      this.selectComponent('#rpwheel').open({ mode: 'custom', title, columns }).then(v => {
        if (!v || !v.values) return;
        const p = this.ctx.repeat.params;
        const val = v.values;
        /* 只写回本次滚轮里真正出现的字段：两种规则共用 day 键，
           没出现的键保持原值，切规则不丢已选参数（同 onType 的原则） */
        if (val.weekday != null) p.weekday = val.weekday;
        if (val.day != null) p.day = val.day;
        if (val.month != null) p.month = val.month;
        if (val.lunarMonth != null) p.lunarMonth = val.lunarMonth;
        if (val.lunarDay != null) p.lunarDay = val.lunarDay;
        this.paint();
      });
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

function numItems(n, unit) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ v: i, label: i + unit });
  return out;
}
