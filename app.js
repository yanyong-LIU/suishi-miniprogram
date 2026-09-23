/* ============================================================
   碎事清单 · App
   ------------------------------------------------------------
   小程序没有后台常驻能力，所以「到点提醒」的实际送达只能靠：
     ① 云函数定时触发器 → 订阅消息（主通道，见 cloudfunctions/remind-tick）
     ② 手机系统日历自带闹钟（兜底通道，不依赖微信是否打开）
   本文件负责：
     · 冷启动 / 前后台切换时做一次到点结算（状态维护）
     · 可选的云开发初始化
     · 全局字号倍率、状态栏高度缓存
   ============================================================ */
'use strict';

const store = require('./utils/store.js');
const CFG = require('./utils/config.js');
const PF = require('./utils/platform.js');
const cloud = require('./utils/cloud.js');

App({
  globalData: {
    sys: null,          /* { statusBarHeight, safeBottom, windowWidth, windowHeight } */
    booted: false,
    lastTickAt: 0,
    cloudReady: false
  },

  onLaunch() {
    this.globalData.sys = PF.sysInfo();

    /* 可选：部署了云函数才开启，否则保持纯本地模式 */
    if (CFG.CLOUD_ENV && wx.cloud) {
      try {
        wx.cloud.init({ env: CFG.CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
      } catch (e) {
        this.globalData.cloudReady = false;
      }
    }

    store.bootstrap();
    cloud.init(this.globalData.cloudReady);
    if (this.globalData.cloudReady) cloud.pullQuota();
    this.globalData.booted = true;
  },

  /* 每次回到前台都结算一次：把已经过了时间点的任务标记好状态，
     让「额度 / 未发出 / 下次提醒」三处读数保持一致 */
  onShow() {
    const now = Date.now();
    /* 节流：1 分钟内重复触发不重复结算，避免频繁写存储 */
    if (now - this.globalData.lastTickAt < 60000) return;
    this.globalData.lastTickAt = now;
    try {
      store.tick({ silent: true });
      store.sweepTrash();
    } catch (e) { /* 结算失败不应阻塞启动 */ }
    cloud.syncAll();
  },

  onHide() {
    store.save();
  }
});
