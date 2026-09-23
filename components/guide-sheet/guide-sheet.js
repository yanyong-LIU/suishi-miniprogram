/* ============================================================
   引导面板（授权 / 系统日历）
   ------------------------------------------------------------
   这两个面板是产品的「信任页」：用户不敢用小程序的提醒，根源是
   「我不知道它到底会不会响」。所以文案必须是陈述事实，不能是营销话术。

   kind = 'auth' → 订阅消息授权（主通道）
   kind = 'cal'  → 写进手机日历（兜底通道），带三条优劣说明
   ============================================================ */
'use strict';
const PF = require('../../utils/platform.js');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    show: false, kind: 'auth', topup: false, quota: 0,
    calRows: [
      { col: 'success', text: '不依赖微信是否打开' },
      { col: 'success', text: '不依赖网络' },
      { col: 'warning', text: '农历重复写不进去，会按最近一次时间写入' }
    ]
  },
  methods: {
    open(opt) {
      opt = opt || {};
      /* 本面板贴底，「去开启提醒」按钮正好落在 TabBar 盖住的那 100rpx 里，
         所以整条摘掉（'hide'，默认）：面板从屏幕最底滑出、占满底部，
         用户不要「压暗+垫高」的形态（2026-09-23 定稿后又撤回）。
         open() 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数。 */
      if (!this.data.show) PF.overlayTab(true);
      return new Promise(resolve => {
        this._resolve = resolve;
        this.setData({
          show: true,
          kind: opt.kind || 'auth',
          topup: !!opt.topup,
          quota: opt.quota || 0
        });
      });
    },
    close(v) {
      /* 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数。 */
      if (!this.data.show) return;
      this.setData({ show: false });
      PF.overlayTab(false);
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(v), 240);
    },
    onPrimary() { this.close('primary'); },
    onDismiss() { this.close('dismiss'); },
    noop() { }
  }
});
