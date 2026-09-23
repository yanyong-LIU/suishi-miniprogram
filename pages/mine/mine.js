/* ============================================================
   我的页（Tab 3）
   ------------------------------------------------------------
   ① 提醒额度做成进度条而不是静态数字：进度条会「减少」，用户能感知
      消耗；一个数字不会引起注意。剩 2/15 时那根几乎空掉的琥珀色条，
      本身就是去点「补充授权」的最强动机。
   ② 三处额度读数（首页提示条 / 详情页 / 本页）读的都是 S.quota，
      禁止各自格式化——这是最容易同时踩的三个坑。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const F = require('../../utils/fmt.js');
const L = require('../../utils/lunar.js');
const PF = require('../../utils/platform.js');
const CFG = require('../../utils/config.js');
const M = require('../../utils/model.js');

Page({
  data: {
    fontCls: 'fs-md',

    name: '微信用户',
    initial: '',
    hasName: false,
    streak: 0,

    created: 0,
    completed: 0,

    quota: 0,
    quotaCap: M.QUOTA_CAP,
    quotaPct: 0,
    quotaTextCls: 'ci',
    quotaBg: 'var(--ink)',
    quotaTip: '',

    defaultRemindTime: '20:00',
    weekStartLabel: '周一',
    syncCalendar: false,
    fontScaleLabel: '标准',
    trashCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
      this.getTabBar().refresh();
    }
    this.refresh();
  },

  refresh() {
    const S = store.state;
    const st = store.appStats();
    const q = store.quota();
    const pct = Math.max(0, Math.min(100, Math.round(q / M.QUOTA_CAP * 100)));
    const f = (S.settings && S.settings.fontScale) || 1;

    this.setData({
      fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl',

      name: S.user.name || '微信用户',
      initial: S.user.name ? S.user.name.slice(0, 1) : '',
      hasName: !!S.user.name,
      streak: st.streak,

      created: st.created,
      completed: st.completed,

      quota: q,
      quotaCap: M.QUOTA_CAP,
      quotaPct: pct,
      quotaTextCls: q <= 0 ? 'cd' : q < M.QUOTA_LOW ? 'cw' : 'ci',
      quotaBg: this.qVar(q),
      quotaTip: q <= 0 ? '额度用完就不会再发提醒了'
        : q < M.QUOTA_LOW ? '额度不多了，用完就不再发提醒'
          : '每次提醒消耗 1 次授权',

      defaultRemindTime: S.settings.defaultRemindTime,
      weekStartLabel: S.settings.weekStart === 1 ? '周一' : '周日',
      syncCalendar: !!S.settings.syncCalendar,
      fontScaleLabel: f === 1 ? '标准' : f < 1.2 ? '大' : '特大',
      trashCount: store.deletedTasks().length
    });
  },

  /* 额度配色：0 → danger，<3 → warning，其余 ink。
     进度条与数字必须同色，逻辑只在这里算一次。 */
  qVar(q) {
    return q <= 0 ? 'var(--danger)' : q < M.QUOTA_LOW ? 'var(--warning)' : 'var(--ink)';
  },

  /* ── 用户 ───────────────────────────────────────────── */
  onRename() {
    const S = store.state;
    wx.showModal({
      title: '怎么称呼你',
      editable: true,
      placeholderText: '留空则显示「微信用户」',
      content: S.user.name || '',
      success: r => {
        if (!r.confirm) return;
        store.setUserName(r.content || '');
        this.refresh();
      }
    });
  },

  /* ── 提醒额度 ───────────────────────────────────────── */
  onTopup() {
    const sheet = this.selectComponent('#guide');
    sheet.open({ kind: 'auth', topup: true, quota: store.quota() }).then(v => {
      if (v !== 'primary') {
        const S = store.state;
        S.guideShown = true; store.save();
        return;
      }
      PF.requestSubscribe(CFG.SUBSCRIBE_TMPL_IDS).then(r => {
        if (!r.ok) {
          wx.showToast({
            title: r.reason === 'no_template' ? '订阅消息模板未配置'
              : r.reason === 'rejected' ? '你拒绝了授权' : '授权未完成',
            icon: 'none'
          });
          return;
        }
        const q = store.topupQuota(0, true);
        this.refresh();
        if (this.getTabBar()) this.getTabBar().refresh();
        wx.showToast({ title: '额度已补到 ' + q + ' 次', icon: 'none' });
      });
    });
  },

  /* ── 设置 ───────────────────────────────────────────── */
  onPickTime() {
    const cur = store.state.settings.defaultRemindTime.split(':');
    const base = L.atTime(new Date(), parseInt(cur[0], 10) || 20, parseInt(cur[1], 10) || 0).getTime();
    this.selectComponent('#picker').open({ mode: 'time', dueAt: base, allDay: false }).then(v => {
      if (!v) return;
      const d = new Date(v.ts);
      const hh = L.pad(d.getHours()), mm = L.pad(d.getMinutes());
      store.setSetting('defaultRemindTime', hh + ':' + mm);
      this.refresh();
      wx.showToast({ title: '默认提醒时间 ' + hh + ':' + mm, icon: 'none' });
    });
  },

  onPickWeek() {
    this.selectComponent('#sheet').open({
      title: '一周从哪天开始',
      desc: '只影响日历页的表头排列，不影响任何提醒时间。',
      items: [{ label: '周一' }, { label: '周日' }]
    }).then(i => {
      if (i < 0) return;
      store.setSetting('weekStart', i === 0 ? 1 : 0);
      this.refresh();
    });
  },

  onPickFont() {
    this.selectComponent('#sheet').open({
      title: '字号',
      desc: '整页等比放大，辅助文字的下限仍是 12px。',
      items: [{ label: '标准' }, { label: '大' }, { label: '特大' }]
    }).then(i => {
      if (i < 0) return;
      store.setSetting('fontScale', [1, 1.12, 1.25][i]);
      this.refresh();
    });
  },

  onToggleCal() {
    const v = !store.state.settings.syncCalendar;
    if (v) {
      this.selectComponent('#guide').open({ kind: 'cal' }).then(r => {
        if (r !== 'primary') return;
        store.setSetting('syncCalendar', true);
        this.refresh();
        wx.showToast({ title: '新任务将默认写入日历', icon: 'none' });
      });
    } else {
      store.setSetting('syncCalendar', false);
      this.refresh();
    }
  },

  /* ── 二级页 ─────────────────────────────────────────── */
  onTrash() { wx.navigateTo({ url: '/pages/trash/trash' }); },
  onPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  onAbout() { wx.navigateTo({ url: '/pages/about/about' }); },

  onReset() {
    this.selectComponent('#dialog').open({
      title: '清除本地缓存？',
      desc: '会清掉全部碎事、完成记录和提醒额度，回到刚打开的样子。这个操作不能撤销。',
      actions: ['取消', '清除'],
      danger: true
    }).then(r => {
      if (r.index !== 1) return;
      store.resetCache();
      this.refresh();
      /* 清缓存只清任务数据、保留隐私同意，所以 tabBar 不会消失；
         这里顺手刷新它，让红点/可用性跟随新状态。 */
      if (this.getTabBar()) this.getTabBar().refresh();
      wx.showToast({ title: '已清除', icon: 'none' });
    });
  },

  onWipe() {
    this.selectComponent('#dialog').open({
      title: '注销并删除全部数据？',
      desc: '碎事只存在你这台手机上，删掉之后就真的没有了。',
      actions: ['再想想', '删除全部'],
      danger: true
    }).then(r => {
      if (r.index !== 1) return;
      store.wipe();
      wx.reLaunch({ url: '/pages/list/list' });
    });
  }
});
