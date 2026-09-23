/* ============================================================
   详情页
   ------------------------------------------------------------
   表面上是个信息页，实际是整个产品的信任页。用户不敢用小程序
   的提醒，根源是「我不知道它到底会不会响」。所以这里固定三行：
     微信提醒还剩几次 / 日历写没写进去 / 下次到底几点
   这三行里的额度必须和首页提示条、我的页读数同源（S.quota）。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const F = require('../../utils/fmt.js');
const L = require('../../utils/lunar.js');
const R = require('../../utils/repeat.js');
const PF = require('../../utils/platform.js');
const ICS = require('../../utils/ics.js');
const CFG = require('../../utils/config.js');
const M = require('../../utils/model.js');

Page({
  data: {
    fontCls: 'fs-md',

    id: '',
    title: '',
    dateLabel: '',
    timeLabel: '',
    allDay: false,
    lunar: '',
    tags: [],

    remindText: '',
    remindCls: '',
    showTopup: false,

    syncCalText: '',
    syncCalCls: '',

    nextText: '',
    missed: false,

    note: '',
    hasNote: false,

    showIcs: false,
    icsLabel: '',

    isDone: false,
    isGone: false,

    devMode: false
  },

  onLoad(q) {
    this.setData({ id: q.id || '', devMode: !CFG.CLOUD_ENV });
  },

  onShow() { this.refresh(); },

  refresh() {
    const t = store.taskById(this.data.id);
    const S = store.state;
    const f = (S.settings && S.settings.fontScale) || 1;

    if (!t) { this.setData({ isGone: true, fontCls: this.f(f) }); return; }

    const d = new Date(t.dueAt);
    const isDone = t.status === 'done';
    const rep = (t.repeat && t.repeat.type) || 'none';
    const q = store.quota();

    /* 标签：重复规则用朱砂（差异点），其余用靛墨 */
    const tags = [];
    if (rep !== 'none') tags.push({ text: R.repeatSummary(t), cn: rep === 'lunarYearly' });
    if (rep !== 'none' && (t.seriesCount || 0) > 0) tags.push({ text: '已坚持 ' + t.seriesCount + ' 次', cn: false });
    if (t.allDay) tags.push({ text: '全天', cn: false });

    /* 提醒状态三行的第一行。四态与首页提示条阈值严格对应 */
    let remindText, remindCls;
    if (!t.remind || !t.remind.enabled) { remindText = '未开启'; remindCls = 'cd'; }
    else if (q <= 0) { remindText = '已用尽'; remindCls = 'cd'; }
    else if (q < M.QUOTA_LOW) { remindText = '已开启 · 剩 ' + q + ' 次'; remindCls = 'cw'; }
    else { remindText = '已开启 · 剩 ' + q + ' 次'; remindCls = 'cs'; }

    this.setData({
      fontCls: this.f(f),
      isGone: false,

      title: t.title,
      dateLabel: (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + L.WD[d.getDay()],
      timeLabel: t.allDay ? '' : L.fmtClock(t.dueAt, false),
      allDay: !!t.allDay,
      lunar: L.lunarFull(d),
      tags,

      remindText,
      remindCls,
      showTopup: !!t.remind && t.remind.enabled && q < 10,

      syncCalText: t.syncCalendar ? '已写入' : '未开启',
      syncCalCls: t.syncCalendar ? 'cs' : 'c3',

      nextText: isDone ? '已结束'
        : (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + L.fmtClock(t.dueAt, t.allDay),
      missed: !!t.missed,

      note: t.note || '',
      hasNote: !!t.note,

      showIcs: !!t.syncCalendar,
      icsLabel: rep === 'lunarYearly' ? '导出日历文件（按最近一次写入）' : '导出 .ics 文件',

      isDone
    });
  },

  f(v) { return v === 1 ? 'fs-md' : v < 1.2 ? 'fs-lg' : 'fs-xl'; },

  /* ── 导航 ───────────────────────────────────────────── */
  onBack() { wx.navigateBack(); },
  /* 编辑器是半屏弹层（PRD §5.1.3），不跳页；关掉后就地刷新本页三行状态。
     若在弹层里把这件事删了，refresh() 会落到 isGone 分支给出「已删除」态。 */
  onEdit() {
    this.selectComponent('#editor').open({ id: this.data.id }).then(saved => {
      if (saved) this.refresh();
    });
  },

  /* ── 完成 / 撤销 ────────────────────────────────────── */
  onComplete() {
    const res = store.completeTask(this.data.id);
    if (!res) return;
    if (res.repeat) {
      /* 重复任务：原位推进，本页留在原地并显示新的下次时间 */
      this.refresh();
      const t = store.taskById(this.data.id);
      const d = new Date(t.dueAt);
      wx.showToast({ title: '已完成，下次 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日', icon: 'none' });
    } else {
      wx.navigateBack();
    }
  },

  onUndo() {
    store.undoTask(this.data.id);
    this.refresh();
  },

  /* ── 删除 ───────────────────────────────────────────── */
  onDelete() {
    const t = store.taskById(this.data.id);
    if (!t) return;
    const rep = t.repeat && t.repeat.type !== 'none';
    if (!rep) { this.doDelete(null); return; }

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
      this.doDelete(['one', 'future', 'all'][i]);
    });
  },

  doDelete(scope) {
    const r = store.delTask(this.data.id, scope);
    /* 「仅删除这一次」是跳到下一次，本页继续显示新的下次时间 */
    if (r && r.mode === 'skip') {
      this.refresh();
      wx.showToast({ title: '已跳过这一次', icon: 'none' });
      return;
    }
    this.setData({ isGone: true });
  },

  /* 已删除后的撤销（非重复任务才有意义） */
  onRestore() {
    store.restore(this.data.id);
    this.refresh();
  },

  /* ── 额度补充 ───────────────────────────────────────── */
  onTopup() {
    this.selectComponent('#guide').open({ kind: 'auth', topup: true, quota: store.quota() }).then(v => {
      if (v !== 'primary') return;
      PF.requestSubscribe(CFG.SUBSCRIBE_TMPL_IDS).then(r => {
        if (!r.ok) {
          wx.showToast({
            title: r.reason === 'no_template' ? '订阅消息模板未配置' : '授权未完成',
            icon: 'none'
          });
          return;
        }
        store.topupQuota(0, true);
        this.refresh();
        wx.showToast({ title: '额度已补充', icon: 'none' });
      });
    });
  },

  /* ── 兜底通道：导出 .ics ──────────────────────────────
     先尝试写成文件并唤起「转发给朋友 / 用其他应用打开」；失败则退回
     剪贴板——用户粘进备忘录或邮件同样能导入日历。 */
  onIcs() {
    const t = store.taskById(this.data.id);
    if (!t) return;
    ICS.exportIcsFile(t).then(r => {
      if (r && r.ok) return;   /* 系统转发面板已弹出 */
      PF.copyText(ICS.buildIcs(t)).then(ok => {
        wx.showToast({
          title: ok ? '日历内容已复制，可粘贴导入' : '导出失败，请稍后重试',
          icon: 'none'
        });
      });
    });
  },

  /* ── 自测：模拟到点 ─────────────────────────────────
     仅在未部署云函数时出现。没有云函数时本地 tick 是唯一可验的
     提醒路径，留一个入口总比让用户盲猜「它到底会不会响」好。 */
  onSimulate() {
    const r = store.simulateFire(this.data.id);
    const n = (r.fired && r.fired.length) || 0;
    const bad = (r.failed && r.failed.length) || 0;
    this.refresh();
    wx.showToast({
      title: n ? '已发出一条提醒（额度 -1）' : bad ? '额度不足，提醒未发出' : '这条不发送提醒',
      icon: 'none'
    });
  }
});
