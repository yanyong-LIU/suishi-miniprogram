/* ============================================================
   碎事清单 · 云端提醒通道（可选）
   ------------------------------------------------------------
   小程序没有后台常驻能力，所以「到点提醒」只能由服务端定时触发。
   这一层把「什么时候需要提醒」交给云函数，由它下发订阅消息。

   ⚠️ 隐私边界（与《隐私政策》的承诺一致，不能改）：
      上传的只有「时间 + 一个本机随机 deviceId」。
      任务的标题、备注、完成记录**不上传**，永远留在手机上。
      因此订阅消息的文案只能是通用句，不能带任务内容——这是刻意的
      取舍：宁可提醒文案朴素，也不把用户的碎事搬到服务器。

   未配置 CLOUD_ENV 时，本模块所有方法都会直接返回，界面不受影响。
   ============================================================ */
'use strict';

const CFG = require('./config.js');
const store = require('./store.js');

const COL_REM = 'suishi_reminders';   /* 提醒票据：{_id, deviceId, dueAt, sent, tries} */
const COL_USR = 'suishi_users';       /* 额度镜像：{_id, quota, updatedAt} */

let db = null;
let inited = false;
let appReady = false;      /* 由 app.js 在 wx.cloud.init 成功后置位 */
let syncTimer = null;

function ready() {
  return !!(CFG.CLOUD_ENV && wx.cloud && appReady);
}

/*
 * @param {boolean} cloudReady app.js 里 wx.cloud.init 是否成功
 * 注意不要在 App.onLaunch 里依赖 getApp()，某些基础库下此时还拿不到实例，
 * 所以云开发是否可用由调用方显式告知。
 */
function init(cloudReady) {
  appReady = !!cloudReady;
  if (inited) return;
  inited = true;
  if (!ready()) return;
  db = wx.cloud.database();
  /* 任何本地写入后 2.5 秒同步一次，避免连续操作触发大量写请求 */
  store.subscribe(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncAll(); }, 2500);
  });
}

/* ============================================================
   提醒票据同步
   ============================================================ */
function desiredTickets() {
  const S = store.state;
  const now = Date.now();
  return store.pending()
    .filter(t => t.remind && t.remind.enabled && t.dueAt > now)
    .map(t => ({
      _id: S.deviceId + '_' + t.id,
      deviceId: S.deviceId,
      taskId: t.id,
      dueAt: t.dueAt
    }));
}

/* 同步签名：内容没变就不发请求，省掉绝大多数无谓写入 */
function signature(list) {
  return list.map(x => x._id + ':' + x.dueAt).sort().join('|');
}

let lastSig = null;

function syncReminders(force) {
  if (!ready()) return Promise.resolve(false);
  const want = desiredTickets();
  const sig = signature(want);
  if (!force && sig === lastSig) return Promise.resolve(false);
  lastSig = sig;

  const col = db.collection(COL_REM);
  const now = Date.now();

  return col.where({ deviceId: store.state.deviceId }).limit(100).get()
    .then(res => {
      const have = (res.data || []).map(d => d._id);
      const wantIds = want.map(w => w._id);

      /* 删除「已经完成 / 关掉提醒 / 已发出」的票据 */
      const toDel = have.filter(id => wantIds.indexOf(id) < 0);
      /* 写入或更新仍然有效的票据 */
      const ops = [];
      want.forEach(w => {
        ops.push(col.doc(w._id).set({
          data: { deviceId: w.deviceId, taskId: w.taskId, dueAt: w.dueAt, sent: false, updatedAt: now }
        }));
      });
      toDel.forEach(id => ops.push(col.doc(id).remove()));

      return Promise.all(ops.map(p => p.catch(() => null)));
    })
    .then(() => true)
    .catch(() => false);
}

/* ============================================================
   额度：部署云函数后，真实扣减在服务端，本地只做展示
   ============================================================ */
function pushQuota() {
  if (!ready()) return Promise.resolve(false);
  const S = store.state;
  return db.collection(COL_USR).doc(S.deviceId).set({
    data: { quota: S.quota, updatedAt: Date.now() }
  }).then(() => true).catch(() => false);
}

function pullQuota() {
  if (!ready()) return Promise.resolve(false);
  const S = store.state;
  return db.collection(COL_USR).doc(S.deviceId).get()
    .then(res => {
      if (res && res.data && typeof res.data.quota === 'number') {
        store.setQuota(res.data.quota);
        return true;
      }
      /* 云端还没有这条记录：以本地为准登记一次 */
      return pushQuota();
    })
    .catch(() => false);
}

/* ============================================================
   对外
   ============================================================ */
function syncAll() {
  if (!ready()) return;
  pullQuota()
    .then(() => syncReminders(false))
    .catch(() => { });
}

module.exports = {
  init, ready, syncAll, syncReminders, pushQuota, pullQuota,
  COL_REM, COL_USR
};
