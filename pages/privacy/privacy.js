/* ============================================================
   隐私政策（静态页）
   ------------------------------------------------------------
   这是产品「信任」的一部分，所以写的是事实，不是免责声明：
   本地存储 → 没有账号 → 没有「你的数据在别人那里」这回事。
   ============================================================ */
'use strict';

Page({
  data: {
    fontCls: 'fs-md',
    updated: '2026 年 9 月'
  },

  onLoad() {
    const S = require('../../utils/store.js').state;
    const f = (S.settings && S.settings.fontScale) || 1;
    this.setData({ fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl' });
  },

  onBack() { wx.navigateBack(); }
});
