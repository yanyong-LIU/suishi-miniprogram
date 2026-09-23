/* 自定义 TabBar：需要红点角标（额度告警）与设计指定的配色，故用 custom */
'use strict';
const store = require('../utils/store.js');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    selected: 0,
    badge: false,
    hidden: false,
    dim: false,
    safeBottom: 0,
    tabs: [
      { key: 'list', label: '清单', icon: 'list', path: '/pages/list/list' },
      { key: 'calendar', label: '日历', icon: 'calendar', path: '/pages/calendar/calendar' },
      { key: 'mine', label: '我的', icon: 'user', path: '/pages/mine/mine' }
    ]
  },
  lifetimes: {
    attached() {
      try {
        const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const safeBottom = (w.safeArea && (w.screenHeight - w.safeArea.bottom)) || 0;
        this.setData({ safeBottom });
      } catch (e) { /* 取不到就用 0 */ }
      this.refresh();
    }
  },
  methods: {
    /* 红点规则与 UI 方案一致：额度为 0，或未授权但存在待提醒任务
       ------------------------------------------------------------
       hidden 也在这里算：TabBar 是框架层渲染的，层级高于页面里的
       隐私门（gate 的 z-index 再高也压不住它），所以「未同意前无法
       进入任何页」只能靠把 TabBar 摘掉来实现。放在这里而不是各页
       各写一遍，三个 Tab 页就自动都拦住了。 */
    refresh() {
      const S = store.state;
      const hasRemind = store.pending().some(t => t.remind && t.remind.enabled);
      const badge = S.quota <= 0 || (!S.subAuthorized && hasRemind);
      const hidden = !S.privacy;
      if (badge !== this.data.badge || hidden !== this.data.hidden) {
        this.setData({ badge, hidden });
      }
    },
    /* 弹层开合的统一入口，由 utils/platform.js#overlayTab 调用。
       ------------------------------------------------------------
       'hide' 贴底弹层：它要用底部那 100rpx，整条摘掉；
       'dim'  居中确认框：不占地方，留在原位压一层暗罩（视觉同原型：
              TabBar 在弹层遮罩之下被罩暗，但没有消失）；
       'none' 恢复：hidden 交回 refresh() 按隐私门算，别直接写 false。 */
    setOverlay(mode) {
      if (mode === 'hide') { this.setData({ hidden: true, dim: false }); return; }
      if (mode === 'dim') { this.setData({ dim: true }); this.refresh(); return; }
      this.setData({ dim: false });
      this.refresh();
    },
    onTap(e) {
      /* 兜底：隐私门未通过、或弹层正把它压暗时，都不吃点击 —— 避免任何路径下切走 */
      if (!store.state.privacy || this.data.dim) return;
      const i = e.currentTarget.dataset.i;
      const tab = this.data.tabs[i];
      if (i === this.data.selected) return;
      wx.switchTab({ url: tab.path });
    },
    /* 暗罩吃掉点击（catchtap），不回传任何行为 */
    noop() { }
  }
});
