/* ============================================================
   清单页（Tab 1）
   ------------------------------------------------------------
   四段：今天 / 全部 / 已完成 / 已过期。
   两个只在界面上才暴露的设计判断：
     ① 「今天」分段里「已过期」单独成组且置顶 —— 昨天没做完的事不能
        沉到底下，否则用户永远看不到它。
     ② 重复任务完成后行内「原位推进」：先闪一下完成绿，再换成下一次
        的时间。用户看到的是「这一件又排上了」，而不是「它消失了」。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const F = require('../../utils/fmt.js');
const L = require('../../utils/lunar.js');
const PF = require('../../utils/platform.js');
const M = require('../../utils/model.js');
const R = require('../../utils/repeat.js');

const SEGS = [
  { key: 'today', label: '今天' },
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' },
  { key: 'overdue', label: '已过期' }
];

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,
    fontCls: 'fs-md',

    gate: false,
    booting: true,

    seg: 'today',
    segs: SEGS,
    headTitle: '今天',
    headSub: { text: '', lunar: '' },

    notice: { show: false, kind: 'info', text: '', action: '', code: '' },

    sections: [],
    empty: null,
    showHistory: false,
    historyCount: 0
  },

  onLoad() {
    const app = getApp();
    const sys = (app && app.globalData.sys) || PF.sysInfo();
    this.setData({
      statusBarHeight: sys.statusBarHeight,
      safeBottom: sys.safeBottom,
      fontCls: this.fontClass()
    });
  },

  onShow() {
    /* 自定义 TabBar 需要各页自己点亮当前项 */
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
      this.getTabBar().refresh();
    }
    this.setData({ fontCls: this.fontClass() });

    const st = store.state;
    if (!st.privacy) { this.setData({ gate: true, booting: false }); return; }
    this.setData({ gate: false });

    /* 骨架屏只在冷启动露一次，避免每次切回都闪 */
    if (!this._booted) {
      this.setData({ booting: true });
      this._booted = true;
      store.tick({ silent: true });
      setTimeout(() => this.refresh(), 380);
    } else {
      store.tick({ silent: true });
      this.refresh();
    }
  },

  onPullDownRefresh() {
    store.tick({});
    this.refresh();
    wx.stopPullDownRefresh();
  },

  fontClass() {
    const f = (store.state.settings && store.state.settings.fontScale) || 1;
    return f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl';
  },

  /* ── 渲染 ───────────────────────────────────────────── */
  refresh() {
    const S = store.state;
    const seg = this.data.seg;
    /* 「查看全部 N 条」的显示条件必须与 buildSections 里那批 list 同源：
       原型是 `all.length > list.length`，即「归档里还有这一屏没列出的」。
       早前写成固定 `> 20`，与「近 7 天为空则退回全量前 20 条」这条规则打架 ——
       25 条且全在近 7 天内时，明明没漏，却会多出一个入口。 */
    const doneAll = store.doneTasks().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    const doneRecent = doneAll.filter(t => (t.completedAt || 0) >= Date.now() - 7 * 86400000);
    const doneShown = doneRecent.length ? doneRecent.length : Math.min(doneAll.length, 20);
    this.setData({
      seg,
      /* 骨架屏必须在这里关掉：onShow 里只有「开启骨架」没有「关掉」，
         原型是 boot() 的 380ms 回调把 UI.booting 置回 false 的。
         漏掉它，清单页会永远停在骨架屏。 */
      booting: false,
      headTitle: (SEGS.find(s => s.key === seg) || SEGS[0]).label,
      headSub: this.buildHeadSub(seg),
      sections: this.buildSections(seg),
      empty: this.buildEmpty(seg),
      notice: this.buildNotice(),
      showHistory: seg === 'done' && doneAll.length > doneShown,
      historyCount: doneAll.length
    });
  },

  buildHeadSub(seg) {
    const d = new Date();
    const base = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + L.WD[d.getDay()];
    if (seg === 'today') return { text: base + ' · ', lunar: L.lunarShort(d) };
    const o = store.overdueList().length;
    const n = seg === 'all' ? store.pending().length + ' 件未完成'
      : seg === 'done' ? store.doneTasks().length + ' 件已完成'
        : o + ' 件已过期';
    return { text: base + ' · ' + n, lunar: '' };
  },

  buildSections(seg) {
    const t0 = L.startOfDay(new Date());
    if (seg === 'today') {
      const late = store.overdueList().sort(byTime);
      const today = store.todayList().sort(byTime);
      const out = [];
      if (late.length) out.push({ key: 'late', title: '已过期', count: late.length, danger: true, mode: 'normal', showDate: false, tasks: late });
      if (today.length) out.push({ key: 'today', title: '今天', count: today.length, danger: false, mode: 'normal', showDate: false, tasks: today });
      return out;
    }

    if (seg === 'all') {
      const p = store.pending();
      const late = p.filter(t => L.startOfDay(new Date(t.dueAt)).getTime() < t0.getTime()).sort(byTime);
      const rest = p.filter(t => L.startOfDay(new Date(t.dueAt)).getTime() >= t0.getTime()).sort(byTime);
      const out = [];
      if (late.length) out.push({ key: 'late', title: '已过期', count: late.length, danger: true, mode: 'normal', showDate: true, tasks: late });
      const groups = [];
      rest.forEach(t => {
        const k = store.ymdKey(L.startOfDay(new Date(t.dueAt)));
        let g = groups.find(x => x.k === k);
        if (!g) { g = { k, tasks: [] }; groups.push(g); }
        g.tasks.push(t);
      });
      const t0k = t0.getTime();
      groups.forEach(g => {
        const d = new Date(g.k.replace(/-/g, '/'));
        const off = Math.round((L.startOfDay(d).getTime() - t0k) / 86400000);
        const title = off === 0 ? '今天' : off === 1 ? '明天' : F.mdwdLabel(d);
        out.push({ key: g.k, title, count: g.tasks.length, danger: false, mode: 'normal', showDate: false, tasks: g.tasks });
      });
      return out;
    }

    if (seg === 'done') {
      const cut = Date.now() - 7 * 86400000;
      const all = store.doneTasks().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      const recent = all.filter(t => (t.completedAt || 0) >= cut);
      const list = recent.length ? recent : all.slice(0, 20);
      if (!list.length) return [];
      return [{ key: 'done', title: '近 7 天', count: list.length, danger: false, mode: 'undo', showDate: false, tasks: list }];
    }

    /* overdue */
    const late = store.overdueList().sort(byTime);
    if (!late.length) return [];
    return [{ key: 'late', title: '已过期', count: late.length, danger: true, mode: 'resched', showDate: true, tasks: late }];
  },

  buildEmpty(seg) {
    const n = { today: store.todayList().length, all: store.pending().length, done: store.doneTasks().length, overdue: store.overdueList().length }[seg];
    if (seg === 'today' && !n && !store.overdueList().length)
      return { title: '今天没有碎事，清爽。', sub: '要不要先记一件？', btn: '加一件' };
    if (seg === 'all' && !n)
      return { title: '还没有任何碎事。', sub: '点右下角的加号记一件', btn: '加一件' };
    if (seg === 'done' && !n)
      return { title: '还没有完成过一件碎事。', sub: '做完一件，回来打个勾', btn: '' };
    if (seg === 'overdue' && !n)
      return { title: '没有过期未完成的碎事。', sub: '挺好，继续保持', btn: '' };
    return null;
  },

  /* 提示条优先级与阈值必须和「我的」页额度读数同源，
     三处（首页提示条 / 详情页 / 我的页）读的都是 S.quota */
  buildNotice() {
    const S = store.state;
    const has = store.pending().some(t => t.remind && t.remind.enabled);
    let code = null, text = '', kind = 'info', action = '';
    if (S.quota <= 0 && has) { code = 'q0'; kind = 'danger'; text = '提醒额度用完了，这段时间的碎事不会响'; action = '补充'; }
    else if (S.quota < M.QUOTA_LOW && has) { code = 'q1'; kind = 'warning'; text = '提醒额度快用完了，点这里补一下'; action = '补充'; }
    else if (!S.subAuthorized && has) { code = 'na'; kind = 'warning'; text = '还没开启提醒，到点我们叫不了你'; action = '开启'; }
    else if (this._offline) { code = 'off'; kind = 'normal'; text = '当前无网络，改动会在联网后自动同步'; action = '重试'; }

    if (!code) return { show: false, kind, text: '', action: '', code: '' };
    const dis = S.dismiss[code];
    if (dis && Date.now() - dis < 24 * 3600000) return { show: false, kind, text: '', action: '', code: '' };
    return { show: true, kind, text, action, code };
  },

  /* ── 事件 ───────────────────────────────────────────── */
  onSegChange(e) {
    this.setData({ seg: e.detail.value }, () => this.refresh());
  },

  onNoticeAct(e) {
    const code = e.detail.code;
    if (code === 'off') {
      PF.networkOnline().then(on => { this._offline = !on; this.refresh(); });
      return;
    }
    this.openAuth(code === 'na' ? 'first' : 'topup');
  },
  onNoticeClose(e) {
    store.dismissNotice(e.detail.code);
    this.refresh();
  },

  /* 任务行 */
  onRowToggle(e) {
    const id = e.detail.id;
    const res = store.completeTask(id);
    if (!res) return;
    const row = this.selectComponent('#row-' + id);
    const after = () => {
      this.refresh();
      if (this.getTabBar()) this.getTabBar().refresh();
    };
    if (row && res.repeat) { row.flash(); setTimeout(after, 240); } else { after(); }
    this.toast('已完成', '撤销', () => { store.undoTask(id); this.refresh(); });
  },
  onRowOpen(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.detail.id });
  },
  onRowEdit(e) { this.openEditor({ id: e.detail.id }); },
  onRowDel(e) { this.confirmDelete(e.detail.id); },
  onRowUndo(e) {
    store.undoTask(e.detail.id);
    this.refresh();
    this.toast('已取消完成');
  },
  onRowResched(e) { this.openResched(e.detail.id); },

  onEmptyBtn() { this.onAdd(); },
  onAdd() { this.openEditor({}); },
  onHistory() { wx.navigateTo({ url: '/pages/history/history' }); },

  /* ── 编辑器（半屏弹层，不跳页） ─────────────────────── */
  /* PRD §5.1.3：编辑器是自下而上的半屏弹层，为的是「不打断输入」。
     所以它是个组件而不是页面，关掉之后就地刷新列表与 TabBar 角标
     （保存可能顺带补了提醒额度）。 */
  openEditor(opt) {
    this.selectComponent('#editor').open(opt).then(saved => {
      if (!saved) return;
      this.refresh();
      if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().refresh();
    });
  },

  /* ── 复用逻辑 ───────────────────────────────────────── */
  openResched(id) {
    const t = store.taskById(id);
    if (!t) return;
    const picker = this.selectComponent('#picker');
    picker.open({ dueAt: t.dueAt, allDay: t.allDay }).then(v => {
      if (!v) return;
      const at = store.resched(id, v.ts, v.allDay);
      this.refresh();
      this.toast('时间已改到 ' + F.relDayLabel(new Date(at)) + ' ' + L.fmtClock(at, v.allDay));
    });
  },

  /* 删除：重复任务必须问清范围，非重复直接删并给撤销 */
  confirmDelete(id) {
    const t = store.taskById(id);
    if (!t) return;
    const rep = t.repeat && t.repeat.type !== 'none';
    if (!rep) {
      const r = store.delTask(id);
      this.refresh();
      if (this.getTabBar()) this.getTabBar().refresh();
      this.toast('已删除', '撤销', () => { store.restore(id); this.refresh(); });
      return;
    }
    this.selectComponent('#sheet').open({
      title: '这是一件重复的碎事',
      desc: '这件事已重复 ' + (t.seriesCount || 0) + ' 次，你要删多少？',
      items: [
        { label: '仅删除这一次', sub: '按规则生成下一次', icon: 'trash' },
        { label: '删除此次及以后', sub: '结束这个重复，历史记录保留', icon: 'trash' },
        { label: '删除全部', sub: '含历史记录，7 天内可在「最近删除」恢复', icon: 'trash', danger: true }
      ]
    }).then(i => {
      if (i < 0) return;
      const scope = ['one', 'future', 'all'][i];
      const r = store.delTask(id, scope);
      this.refresh();
      if (this.getTabBar()) this.getTabBar().refresh();
      if (r && r.mode === 'deleted') this.toast('已删除', '撤销', () => { store.restore(id); this.refresh(); });
      else if (r && r.mode === 'skip') this.toast('已跳过这一次');
    });
  },

  openAuth(kind) {
    const sheet = this.selectComponent('#guide');
    sheet.open({ kind: 'auth', topup: kind === 'topup', quota: store.quota() }).then(v => {
      if (v !== 'primary') {
        const S = store.state;
        S.guideShown = true; store.save();
        this.refresh();
        return;
      }
      const CFG = require('../../utils/config.js');
      PF.requestSubscribe(CFG.SUBSCRIBE_TMPL_IDS).then(r => {
        if (!r.ok) {
          this.toast(r.reason === 'no_template' ? '订阅消息模板未配置，请在 utils/config.js 填入' :
            r.reason === 'rejected' ? '你拒绝了授权，可以稍后在「我的」页重试' : '授权未完成');
          return;
        }
        const q = store.topupQuota(0, true);
        this.refresh();
        if (this.getTabBar()) this.getTabBar().refresh();
        this.toast('提醒已开启 · 额度 ' + q + ' 次');
      });
    });
  },

  onGateAgree() {
    store.agreePrivacy();
    this.setData({ gate: false, booting: true });
    /* 隐私已同意，让 TabBar 重新出现（它的 hidden 由 store.state.privacy 决定） */
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
      this.getTabBar().refresh();
    }
    setTimeout(() => this.refresh(), 380);
  },
  onGatePrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  toast(msg, actionLabel, onAction) {
    const t = this.selectComponent('#toast');
    if (t) t.showToast({ msg, actionLabel, onAction });
  }
});

function byTime(a, b) {
  const aa = a.allDay ? 0 : 1, bb = b.allDay ? 0 : 1;
  if (aa !== bb) return aa - bb;
  return a.dueAt - b.dueAt;
}
