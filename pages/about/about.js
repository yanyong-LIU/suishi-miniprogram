/* ============================================================
   关于（静态页）
   ------------------------------------------------------------
   三件事值得在这页说清楚：
     ① 为什么做这个产品
     ② 提醒为什么需要两条通道（小程序没有后台常驻能力）
     ③ 农历数据的来源与已修正的三年
   ============================================================ */
'use strict';

const CFG = require('../../utils/config.js');

Page({
  data: {
    fontCls: 'fs-md',
    version: CFG.VERSION
  },

  onLoad() {
    const S = require('../../utils/store.js').state;
    const f = (S.settings && S.settings.fontScale) || 1;
    this.setData({ fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl' });
  },

  onBack() { wx.navigateBack(); }
});
