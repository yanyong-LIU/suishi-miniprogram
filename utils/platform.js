/* ============================================================
   碎事清单 · 平台能力封装
   ------------------------------------------------------------
   把小程序两个「真正能把提醒送出去」的能力包成 Promise：

   ① 订阅消息授权（主通道）
      微信规则：一次性订阅消息「授权 1 次 = 只能发 1 条」。用户若勾选
      「总是保持以上选择」，后续 requestSubscribeMessage 会静默通过并
      继续累积额度。所以我们把授权累积成额度池，界面上的「提醒额度」
      就是池子余量。

   ② 系统日历（兜底通道）
      不依赖微信是否打开、不依赖网络。注意 wx.addPhoneRepeatCalendar
      只支持按公历重复，农历重复写不进去 —— 这种情况按「最近一次的
      公历时间」写入单次事件，并在界面上明确告知（与 UI 方案一致）。
   ============================================================ */
'use strict';

const CFG = require('./config.js');

/* ── 订阅消息 ───────────────────────────────────────────── */

/* 返回 { ok, accepted, cleanable }；用户拒绝时 ok=false 而不是抛错 */
function requestSubscribe(tmplIds) {
  const ids = tmplIds || CFG.SUBSCRIBE_TMPL_IDS || [];
  if (!ids.length) {
    return Promise.resolve({ ok: false, reason: 'no_template', accepted: 0 });
  }
  return new Promise(resolve => {
    if (!wx.requestSubscribeMessage) {
      resolve({ ok: false, reason: 'unsupported', accepted: 0 });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success(res) {
        const accepted = ids.filter(id => res[id] === 'accept').length;
        const rejected = ids.filter(id => res[id] === 'reject').length;
        resolve({
          ok: accepted > 0,
          reason: accepted > 0 ? '' : (rejected > 0 ? 'rejected' : 'banned'),
          accepted
        });
      },
      fail(err) {
        resolve({ ok: false, reason: (err && err.errMsg) || 'fail', accepted: 0 });
      }
    });
  });
}

/* ── 系统日历 ───────────────────────────────────────────── */

/* 微信 addPhoneRepeatCalendar 只认 day / week / month / year 四种周期。
   每季（3 个月）与农历每年都没有对应值，写进去会被当成「每月」，反而错得更远，
   所以这两类只写最近一次，由界面告知用户（见 editor 的保存提示）。 */
const REPEAT_CAL = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year'
};
const CAL_SINGLE_ONLY = { lunarYearly: 1, quarterly: 1 };

/*
 * 写入系统日历
 * @param {Object} t 任务对象
 * @param {number} [occurrenceTs] 写哪一次；缺省用 t.dueAt
 * @returns Promise<{ ok, calId, mode, reason }>
 *   mode: 'repeat'  按公历规律重复写入
 *         'single'  只能写单次（农历重复 / 需要在界面告知）
 */
function addToCalendar(t, occurrenceTs) {
  const start = Math.round((occurrenceTs != null ? occurrenceTs : t.dueAt) / 1000);
  const end = start + 3600;
  const rep = (t.repeat && t.repeat.type) || 'none';
  const allDay = !!t.allDay;

  const base = {
    title: t.title || '碎事',
    description: t.note || '',
    startTime: start,
    endTime: end
  };
  /* 全天事件需按微信要求传 allDay，且开始/结束为该日 0 点 */
  if (allDay) { base.allDay = true; base.endTime = start + 86400; }

  return new Promise(resolve => {
    const canRepeat = rep !== 'none' && !CAL_SINGLE_ONLY[rep] && wx.addPhoneRepeatCalendar;
    if (canRepeat) {
      const payload = Object.assign({}, base, {
        repeatInterval: REPEAT_CAL[rep] || 'day',
        /* 微信的默认值：每周 xx / 每月 xx 号 */
        repeatEndTime: 0
      });
      wx.addPhoneRepeatCalendar({
        ...payload,
        success(res) { resolve({ ok: true, mode: 'repeat', calId: res.errMsg || '' }); },
        fail(err) {
          /* 重复写入失败时降级为单次，而不是直接放弃 */
          addSingle(base, t, resolve);
        }
      });
      return;
    }
    addSingle(base, t, resolve);
  });
}

function addSingle(base, t, resolve) {
  if (!wx.addPhoneCalendar) { resolve({ ok: false, reason: 'unsupported' }); return; }
  wx.addPhoneCalendar({
    ...base,
    alarm: true,
    alarmOffset: 0,
    success() { resolve({ ok: true, mode: 'single', calId: 'cal_' + t.id }); },
    fail(err) {
      const msg = (err && err.errMsg) || '';
      let reason = 'fail';
      if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0) reason = 'denied';
      else if (msg.indexOf('cancel') >= 0) reason = 'cancel';
      resolve({ ok: false, reason });
    }
  });
}

/* 打开系统日历权限设置 */
function openCalendarSetting() {
  return new Promise(resolve => {
    wx.openSetting({
      success(res) { resolve(res.authSetting || {}); },
      fail() { resolve({}); }
    });
  });
}

/* ── 剪贴板（.ics 兜底导出，无系统日历时使用） ──────────── */
function copyText(text) {
  return new Promise(resolve => {
    wx.setClipboardData({
      data: text,
      success() { resolve(true); },
      fail() { resolve(false); }
    });
  });
}

/* ── 网络状态 ───────────────────────────────────────────── */
function networkOnline() {
  return new Promise(resolve => {
    wx.getNetworkType({
      success(res) { resolve(res.networkType !== 'none'); },
      fail() { resolve(true); }
    });
  });
}

/* ── 状态栏高度（自定义导航用） ─────────────────────────── */
function sysInfo() {
  try {
    const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return {
      statusBarHeight: w.statusBarHeight || 20,
      safeBottom: (w.safeArea && (w.screenHeight - w.safeArea.bottom)) || 0,
      windowWidth: w.windowWidth || 375,
      windowHeight: w.windowHeight || 667
    };
  } catch (e) {
    return { statusBarHeight: 20, safeBottom: 0, windowWidth: 375, windowHeight: 667 };
  }
}

/* ── 底部弹层 × 原生 TabBar ─────────────────────────────── */
/* ============================================================
   为什么弹层打开前必须先处理 TabBar
   ------------------------------------------------------------
   tabBar 是**原生组件**，层级高于页面里的一切：页面里 z-index 给到
   9900 也压不住它。这不是能靠调样式绕过去的问题 —— 微信官方社区确认
   过「客户端原生的就是遮不住」，自定义 tabBar 同样是原生渲染，
   而且 wx.hideTabBar / wx.showTabBar 对自定义 tabBar 无效，
   只能改组件自己的 data 去动它。

   于是有两种需要，对应本函数的两个 mode：

   ── mode 'hide'（默认）：贴底弹层，整条摘掉 ───────────────
   多选 / 引导 / 日期滚轮 / 编辑器这些弹层贴底，底部约 100rpx 正好是
   「确定」「去开启提醒」这类主按钮的位置，被 TabBar 盖住就是视觉少一截、
   交互点不到。压暗挡不住原生层级，只能摘。

   ── mode 'dim'：居中确认框，留在原位并压暗 ────────────────
   居中的确认框不贴底、不占 TabBar 那 100rpx，摘掉它反而会**凭空少掉
   一条**（用户看到底部空一块，会当成故障）。原型就是这么处理的：
   .tabbar 在 #dlgLayer 之下，被遮罩罩住但没消失（原型第 480 行 tabbar 与
   第 485 行 dlgLayer 是兄弟，z-index 10 < 70）。小程序侧盖不住原生 TabBar，
   就反过来让 TabBar 自己在顶上压一层与遮罩同色的暗罩（custom-tab-bar
   的 .tbdim），并吃掉这一层上的点击 —— 视觉与原型一致，
   「遮罩期间点到 TabBar 把页面切走」也一并堵住。

   所以：贴底弹层用 'hide'，居中确认框用 'dim'。
   不放在页面里做，是因为页面有十几个打开弹层的入口，漏一个就复现。

   ── 为什么要引用计数 ─────────────────────────────────────
   弹层可以叠：编辑器弹层之上还能开日期滚轮、授权引导、重复规则。
   若 close 时直接 refresh()，里层滚轮一关就会把 TabBar 放出来，而
   下面编辑器还开着 —— 于是编辑器底部的「保存」又被 TabBar 盖住，
   正好是本函数要解决的问题本身。所以按嵌套深度计数，回到 0 才恢复。
   ============================================================ */
let overlayHide = 0;   /* 贴底弹层数：需要 TabBar 那 100rpx，整条摘掉 */
let overlayDim = 0;    /* 居中确认框数：留在原位，压暗 + 吃掉点击 */

function overlayTab(on, mode) {
  const m = mode === 'dim' ? 'dim' : 'hide';
  if (m === 'dim') overlayDim = Math.max(0, overlayDim + (on ? 1 : -1));
  else overlayHide = Math.max(0, overlayHide + (on ? 1 : -1));
  try {
    const ps = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = ps[ps.length - 1];
    const tb = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
    if (!tb) return;
    /* 贴底弹层优先：它要的是那块地方，压暗挡不住原生层级 */
    const want = overlayHide > 0 ? 'hide' : overlayDim > 0 ? 'dim' : 'none';
    if (typeof tb.setOverlay === 'function') {
      tb.setOverlay(want);
      return;
    }
    /* 兜底（TabBar 没有 setOverlay 时）：只有摘掉是安全的老行为，
       恢复交给 TabBar 自己的 refresh() —— hidden 还要看隐私门是否通过，
       直接写 false 会在隐私门未通过时把 TabBar 放出来 */
    if (want === 'hide') tb.setData({ hidden: true });
    else if (want === 'none' && typeof tb.refresh === 'function') tb.refresh();
  } catch (e) { /* 非 tab 页 / 基础库不支持：静默降级，不影响弹层本身 */ }
}

/* 仅给校验脚本用：断言「弹层开合后引用计数归零」；两者相加才是总层数 */
function overlayTabDepth() { return overlayHide + overlayDim; }

/* 仅给校验脚本用：分开看两种模式各自的层数，验证 'hide' 优先于 'dim' */
function overlayTabModes() { return { hide: overlayHide, dim: overlayDim }; }

module.exports = {
  requestSubscribe, addToCalendar, openCalendarSetting,
  copyText, networkOnline, sysInfo, overlayTab, overlayTabDepth, overlayTabModes,
  REPEAT_CAL, CAL_SINGLE_ONLY
};
