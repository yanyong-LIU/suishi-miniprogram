/* ============================================================
   日期 / 时间滚轮
   ------------------------------------------------------------
   用原生 picker-view 实现（比自绘滚动更稳，且自动带惯性吸附）。
   日期列带农历副行——农历是本产品的差异点，选择时就该看得见。
   对外：open({ mode, dueAt, allDay }) → Promise<{ts, allDay} | null>
   ============================================================ */
'use strict';

const L = require('../../utils/lunar.js');
const PF = require('../../utils/platform.js');
const { WD, startOfDay, addDays, atTime } = L;

const PAD_DAYS = 14;     /* 允许往前选 14 天 */
const DATE_SPAN = 420;   /* 覆盖约 14 个月 */

function dateList() {
  const t0 = startOfDay(new Date());
  const out = [];
  for (let i = 0; i < DATE_SPAN; i++) {
    const d = addDays(t0, i - PAD_DAYS);
    const lab = L.lunarCellLabel(d) || { text: '', accent: false };
    const isToday = L.isSameDay(d, new Date());
    out.push({
      key: L.pad(d.getFullYear()) + L.pad(d.getMonth() + 1) + L.pad(d.getDate()),
      label: (d.getMonth() + 1) + '月' + d.getDate() + '日',
      sub: (isToday ? '今天' : '周' + WD[d.getDay()]) + ' · ' + lab.text,
      accent: lab.accent
    });
  }
  return out;
}

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    show: false,
    mode: 'datetime',
    allDay: false,
    dates: [],
    hours: [],
    mins: [],
    value: [0, 0, 0],
    hint: '',
    chipToday: true,
    chipTomorrow: false,
    chipAfter: false,
    /* 冒号覆盖层：picker-view 的列是等宽 flex，
       time 模式 2 列 → 中点 50%；datetime 模式 3 列 → 第 2、3 列之间 4/6 */
    showColon: false,
    colonLeft: '50%'
  },
  lifetimes: {
    attached() {
      const hours = [], mins = [];
      for (let i = 0; i < 24; i++) hours.push({ v: i, label: L.pad(i) });
      for (let i = 0; i < 60; i++) mins.push({ v: i, label: L.pad(i) });
      this.setData({ dates: dateList(), hours, mins });
    }
  },
  methods: {
    open(opt) {
      opt = opt || {};
      const mode = opt.mode || 'datetime';
      const base = new Date(opt.dueAt != null ? opt.dueAt : Date.now());
      const t0 = startOfDay(new Date());
      const di = Math.round((startOfDay(base) - t0) / 86400000) + PAD_DAYS;

      /* 滚轮贴底，底部「完成」按钮正好落在 TabBar 盖住的那 100rpx 里，
         所以整条摘掉（'hide'，默认）：面板要从屏幕最底滑出、占满底部，
         用户不要「压暗+垫高」的形态（2026-09-23 定稿后又撤回）。
         open() 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数。 */
      if (!this.data.show) PF.overlayTab(true);

      return new Promise(resolve => {
        this._resolve = resolve;
        this._hh = base.getHours();
        this._mm = base.getMinutes();
        this._di = Math.max(0, Math.min(DATE_SPAN - 1, di));
        this.setData({
          show: true,
          mode,
          allDay: mode === 'time' ? false : !!opt.allDay
        }, () => {
          this.syncValue();
          this.refreshHint();
        });
      });
    },

    syncValue() {
      const a = this.data.allDay;
      const isTime = this.data.mode === 'time';
      this.setData({
        value: isTime
          ? [this._hh, this._mm]
          : (a ? [this._di] : [this._di, this._hh, this._mm]),
        showColon: !a,
        /* 列宽 1.5 : 1 : 1，时列与分列的分界在 2.5/3.5 处 */
        colonLeft: isTime ? '50%' : '71.43%'
      });
    },

    onChange(e) {
      const v = e.detail.value;
      /* allDay 时列数变成 [日期, 全天]，索引含义随之变化：
         value[0] 仍是日期，末位是「全天」占位列，要忽略掉 */
      if (this.data.mode === 'time') {
        this._hh = v[0]; this._mm = v[1];
      } else if (this.data.allDay) {
        this._di = v[0];
      } else {
        this._di = v[0]; this._hh = v[1]; this._mm = v[2];
      }
      this.refreshHint();
      this.refreshChips();
    },

    refreshHint() {
      const c = this.current();
      this.setData({
        hint: L.pad(c.date.getFullYear()) + ' 年 ' + (c.date.getMonth() + 1) + ' 月 ' + c.date.getDate() + ' 日 周' +
          WD[c.date.getDay()] + ' · ' + L.lunarFull(c.date)
      });
    },

    refreshChips() {
      const k = this.data.dates[this._di] && this.data.dates[this._di].key;
      const t0 = startOfDay(new Date());
      const key = o => {
        const d = addDays(t0, o);
        return L.pad(d.getFullYear()) + L.pad(d.getMonth() + 1) + L.pad(d.getDate());
      };
      this.setData({
        chipToday: k === key(0),
        chipTomorrow: k === key(1),
        chipAfter: k === key(2)
      });
    },

    current() {
      const date = this.data.dates[this._di] ? this.dateOf(this._di) : new Date();
      return {
        date,
        hh: this.data.allDay ? 0 : this._hh,
        mm: this.data.allDay ? 0 : this._mm,
        allDay: this.data.allDay
      };
    },
    dateOf(i) {
      const t0 = startOfDay(new Date());
      return addDays(t0, i - PAD_DAYS);
    },

    onQuick(e) {
      const o = +e.currentTarget.dataset.o;
      this._di = PAD_DAYS + o;
      this.setData({ allDay: false }, () => { this.syncValue(); this.refreshHint(); this.refreshChips(); });
    },
    onAllDay() {
      const a = !this.data.allDay;
      this.setData({ allDay: a }, () => { this.syncValue(); this.refreshHint(); this.refreshChips(); });
    },

    onOk() {
      const c = this.current();
      const ts = atTime(c.date, c.allDay ? 0 : c.hh, c.allDay ? 0 : c.mm).getTime();
      this.close({ ts, allDay: c.allDay });
    },
    onCancel() { this.close(null); },

    close(v) {
      /* 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数。 */
      if (!this.data.show) return;
      this.setData({ show: false });
      PF.overlayTab(false);
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(v), 240);
    },
    noop() { }
  }
});
