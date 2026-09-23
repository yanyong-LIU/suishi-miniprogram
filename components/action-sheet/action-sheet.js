/* ============================================================
   底部选择面板
   ------------------------------------------------------------
   用于「删多少 / 一周从哪天开始 / 字号」这类无害的多选一。
   若选项需要更重的解释（比如删除三档的副文案），用 items[].sub。
   对外：open(opts) → Promise<index>，index=-1 表示取消。
   ============================================================ */
'use strict';
const PF = require('../../utils/platform.js');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    show: false, title: '', desc: '', items: [], cancelText: '取消'
  },
  methods: {
    open(opt) {
      opt = opt || {};
      /* 底部选择面板贴底，「取消」正好落在 TabBar 盖住的那 100rpx 里，
         所以整条摘掉（'hide'，默认）：面板从屏幕最底滑出、占满底部，
         用户不要「压暗+垫高」的形态（2026-09-23 定稿后又撤回）。
         open() 必须幂等：overlayTab 按嵌套深度计数，已在显示时重入 open
         （重复触发行 / 连点）会把深度推到 2，关一次就回不到 0，
         TabBar 永远回不来。 */
      if (!this.data.show) PF.overlayTab(true);
      return new Promise(resolve => {
        this._resolve = resolve;
        this.setData({
          show: true,
          title: opt.title || '',
          desc: opt.desc || '',
          items: opt.items || [],
          cancelText: opt.cancelText || '取消'
        });
      });
    },
    close(index) {
      /* 幂等：遮罩点击与取消按钮可能先后各触发一次。
         overlayTab 是引用计数，重复 close 会把计数压过头，
         结果是在弹层还开着的时候把 TabBar 放出来。 */
      if (!this.data.show) return;
      this.setData({ show: false });
      PF.overlayTab(false);
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(index), 240);
    },
    onPick(e) { this.close(e.currentTarget.dataset.i); },
    onCancel() { this.close(-1); },
    noop() { }
  }
});
