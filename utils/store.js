/* ============================================================
   碎事清单 · 数据层
   ------------------------------------------------------------
   职责：
     1. 状态单例（小程序模块缓存天然是单例，跨页面共享同一份 S）
     2. 本地持久化（wx.setStorageSync，替代原型的 localStorage）
     3. 业务动作（完成 / 撤销 / 删除三档 / 恢复 / 改期 / 保存 / 结算）
     4. 变更订阅（页面 onShow / 订阅回调时拉取最新状态）

   ⚠️ 提醒额度的真实扣减发生在云函数侧（见 cloudfunctions/remind-tick）。
      本文件的 tick() 只做「状态维护」与「离线演示」，用于在没有部署云
      函数的情况下让界面行为与线上一致。distinguish 见 tick() 注释。
   ============================================================ */
'use strict';

const L = require('./lunar.js');
const R = require('./repeat.js');
const M = require('./model.js');
const CFG = require('./config.js');

const LS_KEY = 'suishi-qingdan-v1';
const { QUOTA_CAP, QUOTA_LOW, QUOTA_REFILL, RETRY_MS, TRASH_DAYS } = M;

/* ── 加载 / 保存 ───────────────────────────────────────── */
function load() {
  let raw = null;
  try { raw = wx.getStorageSync(LS_KEY); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') return M.defaults();
  const d = M.defaults();
  const S = Object.assign(d, raw);
  /* 分层合并，避免旧版本缺字段导致白屏 */
  S.settings = Object.assign(M.defaults().settings, raw.settings || {});
  S.user = Object.assign(M.defaults().user, raw.user || {});
  S.tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  S.logs = Array.isArray(raw.logs) ? raw.logs : [];
  S.dismiss = raw.dismiss || {};
  return S;
}

let S = load();

function save() {
  try { wx.setStorageSync(LS_KEY, S); } catch (e) { /* 存储写满时静默降级 */ }
}

/* ── 变更订阅 ──────────────────────────────────────────── */
const listeners = new Set();
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(S); } catch (e) { } }); }

/* ── 选择器透传（页面直接调 store.pending() 等） ─────────── */
const api = {
  get state() { return S; },
  subscribe, save, emit,

  pending: () => M.pending(S),
  doneTasks: () => M.doneTasks(S),
  deletedTasks: () => M.deletedTasks(S),
  taskById: id => M.taskById(S, id),
  tasksOnDay: d => M.tasksOnDay(S, d),
  overdueList: () => M.overdueList(S),
  todayList: () => M.todayList(S),
  appStats: () => M.appStats(S),
  ymdKey: M.ymdKey,

  /* 额度相关的三个界面读数必须来自同一个字段，禁止各自格式化 */
  quota() { return S.quota; },
  quotaCap: QUOTA_CAP,
  quotaLow: QUOTA_LOW
};

/* ============================================================
   业务动作
   ============================================================ */

/* 完成。重复任务：原位推进到下一次 + 落一条历史记录（不跳列表位置） */
function completeTask(id) {
  const t = M.taskById(S, id);
  if (!t || t.status !== 'pending') return null;
  const now = Date.now();
  let rec = null;
  if (t.repeat && t.repeat.type !== 'none') {
    const prevDue = t.dueAt;
    rec = M.mkTask(S, {
      title: t.title, note: t.note, dueAt: prevDue, repeat: { type: 'none', params: {} },
      remind: { enabled: false }, syncCalendar: false, status: 'done', completedAt: now,
      seriesId: t.seriesId, instanceOf: t.id, createdAt: t.createdAt
    });
    const nxt = R.nextOccurrenceFrom(t, now);
    t.seriesCount = (t.seriesCount || 0) + 1;
    t.lastCompletedAt = now;
    t.lastCompletedDue = prevDue;
    if (nxt) { t.dueAt = nxt; }
    else { t.status = 'done'; t.completedAt = now; }
    t.firedFor = null; t.missed = false; t.skippedNoQuota = false; t.updatedAt = now;
    rec.seriesCount = t.seriesCount;
    S.tasks.push(rec);
    M.addLog(S, t, 'completed', { dueAt: prevDue });
  } else {
    t.status = 'done'; t.completedAt = now; t.updatedAt = now;
    M.addLog(S, t, 'completed');
  }
  save(); emit();
  return { repeat: t.repeat && t.repeat.type !== 'none', instanceId: rec ? rec.id : null };
}

/* 取消完成 */
function undoTask(id) {
  const t = M.taskById(S, id);
  if (!t) return;
  if (t.instanceOf) {
    const p = M.taskById(S, t.instanceOf);
    if (p && p.lastCompletedAt === t.completedAt) {
      p.dueAt = t.dueAt; p.lastCompletedAt = null; p.lastCompletedDue = null;
      p.seriesCount = Math.max(0, (p.seriesCount || 1) - 1); p.updatedAt = Date.now();
    }
    t.status = 'deleted'; t.deletedAt = Date.now();
  } else {
    t.status = 'pending'; t.completedAt = null; t.updatedAt = Date.now();
  }
  save(); emit();
}

/* 删除。scope：one=仅这一次 / future=此次及以后 / all=全部（含历史） */
function delTask(id, scope) {
  const t = M.taskById(S, id);
  if (!t) return null;
  const now = Date.now();
  const rep = t.repeat && t.repeat.type !== 'none';

  if (!rep || !scope || scope === 'one') {
    if (rep && scope === 'one') {
      /* 重复任务「仅删除这一次」= 跳到下一次，不删除实体 */
      const nxt = R.nextOccurrenceFrom(t, now - 60000);
      if (nxt) { t.dueAt = nxt; t.firedFor = null; t.missed = false; t.skippedNoQuota = false; t.updatedAt = now; }
      else { t.status = 'deleted'; t.deletedAt = now; }
      M.addLog(S, t, 'skipped');
      save(); emit();
      return { mode: 'skip' };
    }
    t.status = 'deleted'; t.deletedAt = now; M.addLog(S, t, 'deleted');
    save(); emit();
    return { mode: 'deleted', id: t.id, title: t.title };
  }

  t.status = 'deleted'; t.deletedAt = now; M.addLog(S, t, 'deleted');
  if (scope === 'all') {
    S.tasks.forEach(x => {
      if (x.instanceOf === t.id) { x.status = 'deleted'; x.deletedAt = now; }
    });
  }
  save(); emit();
  return { mode: 'deleted', id: t.id, title: t.title };
}

/* 从最近删除恢复 */
function restore(id) {
  const t = M.taskById(S, id);
  if (!t) return;
  t.status = 'pending'; t.deletedAt = null; t.updatedAt = Date.now();
  save(); emit();
}

/* 保存编辑器草稿（新建或编辑） */
function saveEdit(draft) {
  const title = (draft.title || '').trim();
  if (!title) return { ok: false, reason: 'empty' };
  const now = Date.now();
  const repeat = JSON.parse(JSON.stringify(draft.repeat || { type: 'none', params: {} }));

  if (draft.id) {
    const t = M.taskById(S, draft.id);
    if (!t) return { ok: false, reason: 'missing' };
    const changed = (t.dueAt !== draft.dueAt || t.title !== title || JSON.stringify(t.repeat) !== JSON.stringify(repeat));
    t.title = title;
    t.note = draft.note || '';
    t.allDay = !!draft.allDay;
    t.dueAt = R.reanchor(draft.dueAt, repeat, draft.allDay);
    t.repeat = repeat;
    t.remind = { enabled: !!draft.remind };
    t.syncCalendar = !!draft.syncCalendar;
    t.updatedAt = now;
    if (t.dueAt > now) t.missed = false;
    t.firedFor = null;
    M.addLog(S, t, changed ? 'updated' : 'noop');
    save(); emit();
    return { ok: true, id: t.id, isEdit: true, needAuthGuide: false, task: t };
  }

  const t = M.mkTask(S, {
    title, note: draft.note || '', allDay: !!draft.allDay,
    dueAt: R.reanchor(draft.dueAt, repeat, draft.allDay),
    repeat, remind: { enabled: !!draft.remind }, syncCalendar: !!draft.syncCalendar
  });
  S.tasks.push(t);
  M.addLog(S, t, 'created');
  /* 已开启「总是保持以上选择」时，微信会静默累积授权，本地同步记账 */
  if (t.remind.enabled && S.autoGrant) S.quota = Math.min(QUOTA_CAP, S.quota + 1);
  const needAuthGuide = t.remind.enabled && !S.subAuthorized && !S.guideShown;
  save(); emit();
  return { ok: true, id: t.id, isEdit: false, needAuthGuide, task: t };
}

/* 改期 */
function resched(id, ts, allDay) {
  const t = M.taskById(S, id);
  if (!t) return;
  const rep = t.repeat || { type: 'none', params: {} };
  t.dueAt = rep.type === 'none' ? ts : R.reanchor(ts, rep, !!allDay);
  t.allDay = !!allDay;
  t.firedFor = null; t.missed = false; t.skippedNoQuota = false;
  t.updatedAt = Date.now();
  save(); emit();
  return t.dueAt;
}

/* 设置项 */
function setSetting(k, v) { S.settings[k] = v; save(); emit(); }
function setUserName(n) { S.user.name = String(n || '').trim(); save(); emit(); }
function dismissNotice(code) { S.dismiss[code] = Date.now(); save(); emit(); }

/* 补充授权额度 */
function topupQuota(amount, always) {
  const add = always ? QUOTA_REFILL : 1;
  S.quota = Math.min(QUOTA_CAP, S.quota + (amount || add));
  S.subAuthorized = true;
  S.guideShown = true;
  if (always != null) S.autoGrant = !!always;
  save(); emit();
  return S.quota;
}

/* 云端为准地写回额度。部署了云函数时，真实扣减发生在服务端，
   本函数用于「客户端补充授权」与「从云端拉取余量」两条路径。 */
function setQuota(n) {
  n = parseInt(n, 10);
  if (isNaN(n)) return S.quota;
  S.quota = Math.max(0, Math.min(QUOTA_CAP, n));
  save(); emit();
  return S.quota;
}

/* 清空全部数据（注销用）：隐私同意也一并回到初始，由 list 页的隐私门重新拦截 */
function wipe() {
  try { wx.removeStorageSync(LS_KEY); } catch (e) { }
  S = M.defaults();
  save(); emit();
}

/* 清除本地缓存（mine 页「清除本地缓存」）：只清任务数据，不动隐私同意 / 设置 /
   订阅授权。清除缓存 ≠ 撤回隐私同意——若把 privacy 也清成 false，custom-tab-bar
   会因 hidden = !S.privacy 把三个 tab 摘掉，而隐私门只在 list 页，用户在 mine 页
   会卡死（看不见 tab、也点不动）。详见 custom-tab-bar/index.js 与 pages/list/list.js。
   清掉的：任务 / 完成记录 / 提醒额度 / 序号；保留的：设备标识、同意状态、已灌数据标记、
   首次引导标记、订阅授权、用户名与全部设置。 */
function resetCache() {
  const keep = {
    deviceId: S.deviceId,
    privacy: S.privacy,
    seeded: S.seeded,
    guideShown: S.guideShown,
    subAuthorized: S.subAuthorized,
    autoGrant: S.autoGrant,
    user: S.user,
    settings: S.settings
  };
  S = M.defaults();
  Object.assign(S, keep);
  S.tasks = [];
  S.logs = [];
  S.dismiss = {};
  S.seq = 1;
  save(); emit();
}

/* 清理超过 7 天的删除项 */
function sweepTrash() {
  const cut = Date.now() - TRASH_DAYS * 86400000;
  let dirty = false;
  S.tasks.forEach(t => {
    if (t.status === 'deleted' && t.deletedAt && t.deletedAt < cut) { t.status = 'purged'; dirty = true; }
  });
  if (dirty) { S.tasks = S.tasks.filter(t => t.status !== 'purged'); save(); }
  return dirty;
}

/* ============================================================
   到点结算
   ------------------------------------------------------------
   小程序的正确分工：
     · 真正「把提醒送到用户手机」的是云函数（订阅消息）或系统日历
     · 本函数负责的是「状态维护」：把已过时间点的任务标记为已发出 /
       未发出 / 额度耗尽，让界面上的三处读数永远一致

   参数 opts.silent = true 时只改状态不提示（冷启动时使用，
   避免一次涌入大量弹窗）。
   ============================================================ */
function tick(opts) {
  opts = opts || {};
  const now = Date.now();
  /* 额度归属：部署了云函数（CLOUD_ENV 已填）时，真实扣减发生在服务端，
     本地只维护状态、不重复记账——否则一次提醒会被扣两次。
     原型里「云函数定时触发器」是内建的一环，没有用户开关，这里同样
     按部署事实判断，不给用户多一个开关。 */
  const cloudOwns = !!CFG.CLOUD_ENV;
  const fired = [], failed = [];
  M.pending(S).forEach(t => {
    if (t.dueAt > now) return;
    if (t.firedFor === t.dueAt) return;

    if (now - t.dueAt > RETRY_MS) {
      /* 超过 1 小时：标记未发出，不补发（与 PRD §5.2.4 一致） */
      if (!t.missed) { t.missed = true; M.addLog(S, t, 'remind_failed'); }
      return;
    }
    if (!t.remind.enabled) { t.firedFor = t.dueAt; return; }

    if (cloudOwns) {
      /* 交给云函数下发；本地仅推进状态，等 pullQuota 拉回真实余量 */
      t.firedFor = t.dueAt; t.missed = false;
      return;
    }

    if (S.quota > 0 && S.subAuthorized) {
      /* 纯本地演示扣减。接入云函数后以云端值为准，此处不再执行 */
      S.quota = Math.max(0, S.quota - 1);
      t.firedFor = t.dueAt; t.missed = false;
      M.addLog(S, t, 'reminded');
      fired.push(t);
    } else {
      t.missed = true;
      M.addLog(S, t, 'remind_failed');
      failed.push(t);
    }
  });
  if (fired.length || failed.length) { save(); emit(); }
  return { fired, failed };
}

/* 演示用：把某任务的时间改成「刚刚」，触发一次到点结算 */
function simulateFire(id) {
  const t = M.taskById(S, id);
  if (!t) return;
  t.dueAt = Date.now() - 1000; t.firedFor = null; t.missed = false;
  save(); emit();
  return tick({});
}

/* ── 初始化 ────────────────────────────────────────────── */
/* 上线版首启不种任何演示数据（列表/日历从空开始）；seedDemo 只保留在
   utils/model.js 里，供渲染对拍（checks/mp-render.mjs）两侧造同样本用。 */
function bootstrap() {
  if (!S.privacy) return { gate: true };
  if (!S.seeded) { S.seeded = true; save(); }
  sweepTrash();
  tick({ silent: true });
  return { gate: false };
}
function agreePrivacy() {
  S.privacy = true; save();
  if (!S.seeded) { S.seeded = true; save(); }
  tick({ silent: true });
  emit();
}

Object.assign(api, {
  completeTask, undoTask, delTask, restore, saveEdit, resched,
  setSetting, setUserName, dismissNotice, topupQuota, setQuota, wipe, resetCache,
  sweepTrash, tick, simulateFire, bootstrap, agreePrivacy
});

module.exports = api;
