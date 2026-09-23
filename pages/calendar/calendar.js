/* ============================================================
   日历页（Tab 2）
   ------------------------------------------------------------
   ① 农历标注是这个产品的差异点，标错就失去说服力，所以全部来自
      utils/lunar.js 的实算结果，不凭印象写。
   ② 「今天」与「选中的日期」是两个独立标记，必须能同时出现在同一格：
      今天用靛墨实心圆，选中日往外描一圈，互不冲突。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const L = require('../../utils/lunar.js');
const F = require('../../utils/fmt.js');
const PF = require('../../utils/platform.js');
const HL = require('../../utils/holiday.js');

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,
    fontCls: 'fs-md',

    y: 0, m: 0,
    monthLabel: '',
    sameMonth: true,
    weekDays: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],

    dayTitle: '',
    dayTasks: [],
    selKey: ''
  },

  onLoad() {
    const app = getApp();
    const sys = (app && app.globalData.sys) || PF.sysInfo();
    this.setData({ statusBarHeight: sys.statusBarHeight, safeBottom: sys.safeBottom });
    const t = new Date();
    this.y = t.getFullYear();
    this.m = t.getMonth() + 1;
    this.sel = store.ymdKey(t);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
      this.getTabBar().refresh();
    }
    const f = (store.state.settings && store.state.settings.fontScale) || 1;
    this.setData({ fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl' });
    store.tick({ silent: true });
    this.refresh();
  },

  refresh() {
    const ws = (store.state.settings && store.state.settings.weekStart) || 0;
    const today = new Date();
    const first = new Date(this.y, this.m - 1, 1);
    const offset = (first.getDay() - ws + 7) % 7;
    const start = L.addDays(first, -offset);

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = L.addDays(start, i);
      const out = d.getMonth() + 1 !== this.m;
      const lab = L.lunarCellLabel(d) || { text: '', accent: false };
      const hol = HL.holidayOf(d);   /* 法定休/班角标：仅限国务院已公告的年份 */
      const list = store.tasksOnDay(d);
      const late = list.some(t => t.dueAt < Date.now());
      const dots = [];
      const show = Math.min(list.length, 3);
      for (let k = 0; k < show; k++) dots.push({ od: late });
      cells.push({
        key: store.ymdKey(d),
        n: d.getDate(),
        out,
        today: L.isSameDay(d, today),
        sel: store.ymdKey(d) === this.sel,
        lt: lab.text,
        la: lab.accent,
        hb: hol ? (hol.type === 'work' ? '班' : '休') : '',
        dots,
        more: list.length > 3 ? list.length - 3 : 0
      });
    }

    const selD = new Date(this.sel.replace(/-/g, '/'));
    const dayTasks = store.state.tasks
      .filter(t => L.isSameDay(new Date(t.dueAt), selD) && t.status !== 'deleted' && t.status !== 'purged')
      .sort((a, b) => ((a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)) || (a.dueAt - b.dueAt));

    /* 周起始日为周日时，表头也要跟着换 */
    const wk = ws === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'];

    const selHol = HL.holidayOf(selD);
    this.setData({
      y: this.y, m: this.m,
      monthLabel: this.y + ' 年 ' + this.m + ' 月',
      sameMonth: this.y === today.getFullYear() && this.m === today.getMonth() + 1,
      weekDays: wk,
      cells,
      selKey: this.sel,
      dayTitle: (selD.getMonth() + 1) + ' 月 ' + selD.getDate() + ' 日 · 农历' + L.lunarShort(selD)
        + (selHol ? (selHol.type === 'work' ? ' · 调休上班' : ' · ' + selHol.name) : ''),
      dayTasks
    });
  },

  onPrev() {
    if (--this.m < 1) { this.m = 12; this.y--; }
    this.refresh();
  },
  onNext() {
    if (++this.m > 12) { this.m = 1; this.y++; }
    this.refresh();
  },
  onToday() {
    const t = new Date();
    this.y = t.getFullYear();
    this.m = t.getMonth() + 1;
    this.sel = store.ymdKey(t);
    this.refresh();
  },
  onPickDay(e) {
    this.sel = e.currentTarget.dataset.key;
    const d = new Date(this.sel.replace(/-/g, '/'));
    /* 点到上/下月的日期格时自动翻月 */
    if (d.getMonth() + 1 !== this.m) { this.y = d.getFullYear(); this.m = d.getMonth() + 1; }
    this.refresh();
  },
  onAddCal() {
    const d = new Date(this.sel.replace(/-/g, '/'));
    this.openEditor({ date: store.ymdKey(d) });
  },

  onRowOpen(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.detail.id }); },
  onRowToggle(e) {
    const id = e.detail.id;
    const res = store.completeTask(id);
    if (res) {
      const row = this.selectComponent('#row-' + id);
      if (row && res.repeat) row.flash();
      setTimeout(() => this.refresh(), row && res.repeat ? 240 : 0);
    }
  },
  onRowEdit(e) { this.openEditor({ id: e.detail.id }); },
  onRowDel(e) {
    const t = store.taskById(e.detail.id);
    if (!t) return;
    const rep = t.repeat && t.repeat.type !== 'none';
    if (!rep) {
      store.delTask(e.detail.id);
      this.refresh();
      return;
    }
    this.selectComponent('#sheet').open({
      title: '这是一件重复的碎事',
      desc: '这件事已重复 ' + (t.seriesCount || 0) + ' 次，你要删多少？',
      items: [
        { label: '仅删除这一次', sub: '按规则生成下一次' },
        { label: '删除此次及以后', sub: '结束这个重复，历史记录保留' },
        { label: '删除全部', sub: '含历史记录，7 天内可恢复', danger: true }
      ]
    }).then(i => {
      if (i < 0) return;
      store.delTask(e.detail.id, ['one', 'future', 'all'][i]);
      this.refresh();
    });
  },
  onRowResched(e) {
    const t = store.taskById(e.detail.id);
    if (!t) return;
    this.selectComponent('#picker').open({ dueAt: t.dueAt, allDay: t.allDay }).then(v => {
      if (!v) return;
      store.resched(t.id, v.ts, v.allDay);
      this.refresh();
    });
  },
  onRowUndo(e) { store.undoTask(e.detail.id); this.refresh(); },

  /* ── 编辑器（半屏弹层，不跳页） ─────────────────────── */
  /* PRD §5.1.3：编辑器是自下而上的半屏弹层，为的是「不打断输入」。
     所以它是个组件而不是页面，关掉之后就地刷新日历与 TabBar 角标。 */
  openEditor(opt) {
    this.selectComponent('#editor').open(opt).then(saved => {
      if (!saved) return;
      this.refresh();
      if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().refresh();
    });
  }
});
