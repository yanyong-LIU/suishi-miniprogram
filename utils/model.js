/* ============================================================
   碎事清单 · 数据模型（纯函数，无平台依赖）
   ------------------------------------------------------------
   任务字段字典（对应 PRD §4.2）：
     id            任务 id，同一重复序列的「当前实例」始终复用本体 id
     title         标题，1–50 字
     note          备注，0–200 字
     allDay        是否全天（全天任务不显示具体时刻，提醒时间即当天 0 点）
     dueAt         下次触发时间戳（重复任务即「下一次」的时间）
     repeat        { type, params }，见 utils/repeat.js
     remind        { enabled }，是否发微信订阅消息提醒
     syncCalendar  是否写入手机系统日历（兜底通道）
     status        pending | done | deleted
     firedFor      已提醒过的那个 dueAt，防止同一时刻重复扣额度
     missed        该次提醒未发出（额度用尽 / 超时未发）
     seriesId      同一重复序列的 id（含所有历史实例）
     seriesCount   该序列已完成的次数
     instanceOf    若是完成重复任务时落下的历史记录，指向本体 id
     completedAt / createdAt / updatedAt / deletedAt
     calId         写入系统日历后拿到的 id，用于删除
   ============================================================ */
'use strict';

const L = require('./lunar.js');
const { DAY, startOfDay, addDays, atTime, isSameDay, solar2lunar, lunarToSolarClamped } = L;
const R = require('./repeat.js');

const QUOTA_CAP = 15;      /* 提醒额度池上限（UI 方案 3.12 的「剩 N / 15」） */
const QUOTA_LOW = 3;       /* 低于此值出现首页提示条 */
const QUOTA_REFILL = 5;    /* 一次补充授权累加值 */
const RETRY_MS = 3600000;  /* 超过 1 小时未发出 → 标记「提醒未发出」，不再补发 */
const TRASH_DAYS = 7;      /* 最近删除保留天数 */

function uid(S) { return 't' + (S.seq++); }
function ymdKey(d) { return d.getFullYear() + '-' + L.pad(d.getMonth() + 1) + '-' + L.pad(d.getDate()); }

function defaults() {
  return {
    ver: 1,
    /* 本机标识：云函数侧的文档 _id 前缀。随机生成、不含任何个人信息，
       卸载重装即失效，作用只是把同一台设备的多条提醒票据归到一起。 */
    deviceId: 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    privacy: false,          /* 是否已过隐私门 */
    seeded: false,           /* 是否已灌入演示数据 */
    guideShown: false,       /* 是否已展示过首次授权引导 */
    subAuthorized: true,     /* 订阅消息是否处于已授权状态 */
    autoGrant: false,        /* 用户是否勾选了「总是保持以上选择」 */
    quota: 2,                /* 剩余提醒额度 */
    seq: 1,
    tasks: [], logs: [], dismiss: {},
    user: { name: '', createdAt: 0 },
    settings: {
      defaultRemindTime: '20:00',
      weekStart: 1,          /* 1=周一 0=周日 */
      fontScale: 1,          /* 1 / 1.12 / 1.25 */
      syncCalendar: false
    }
  };
}

function mkTask(S, o) {
  const now = Date.now();
  const t = Object.assign({
    id: null, title: '', note: '', allDay: false, dueAt: now,
    repeat: { type: 'none', params: {} }, remind: { enabled: true }, syncCalendar: false,
    status: 'pending', firedFor: null, missed: false, skippedNoQuota: false,
    completedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
    seriesId: null, seriesCount: 0, instanceOf: null, calId: null
  }, o);
  if (!t.id) t.id = uid(S);
  if (!t.seriesId) t.seriesId = t.id;
  return t;
}

function addLog(S, t, action, extra) {
  S.logs.push(Object.assign({
    id: 'l' + (S.seq++), taskId: t.id, seriesId: t.seriesId,
    title: t.title, action, at: Date.now()
  }, extra || {}));
  if (S.logs.length > 4000) S.logs = S.logs.slice(-4000);
}

/* ── 选择器 ─────────────────────────────────────────────── */
const pending = S => S.tasks.filter(t => t.status === 'pending');
const doneTasks = S => S.tasks.filter(t => t.status === 'done');
const deletedTasks = S => S.tasks.filter(t => t.status === 'deleted');
const taskById = (S, id) => S.tasks.find(t => t.id === id);
const tasksOnDay = (S, d) => pending(S).filter(t => isSameDay(new Date(t.dueAt), d));

function overdueList(S) {
  const t0 = startOfDay(new Date());
  return pending(S).filter(t => startOfDay(new Date(t.dueAt)).getTime() < t0.getTime());
}
function todayList(S) {
  const t0 = startOfDay(new Date());
  return pending(S).filter(t => isSameDay(new Date(t.dueAt), t0));
}

/* 累计创建 / 已完成 / 连续使用天数 */
function appStats(S) {
  const created = S.tasks.filter(t => !t.instanceOf).length;
  const completed = S.logs.filter(l => l.action === 'completed').length;
  const days = new Set(S.logs.map(l => ymdKey(new Date(l.at))));
  let d = startOfDay(new Date());
  if (!days.has(ymdKey(d))) d = addDays(d, -1);
  let streak = 0;
  while (days.has(ymdKey(d)) && streak < 999) { streak++; d = addDays(d, -1); }
  return { created, completed, streak };
}

/* ── 演示数据：让首次打开就有东西可看 ───────────────────── */
function seedDemo(S) {
  const now = new Date(), t0 = startOfDay(now);
  const push = o => S.tasks.push(mkTask(S, o));
  const rp = (type, params) => ({ type, params: params || {} });

  /* 一件逾期未完成的每天任务 */
  push({
    title: '给妈妈打电话', note: '', dueAt: atTime(addDays(t0, -1), 20, 0).getTime(),
    repeat: rp('daily'), remind: { enabled: true }, syncCalendar: false, missed: true
  });

  /* 今天 */
  push({
    title: '交社保材料', note: '社保局 3 号窗口，带身份证原件', dueAt: atTime(t0, 9, 30).getTime(),
    repeat: rp('weekly', { weekday: t0.getDay() }), remind: { enabled: true }, syncCalendar: true, seriesCount: 7
  });
  push({
    title: '取快递', note: '', dueAt: atTime(t0, 18, 0).getTime(),
    repeat: rp('none'), remind: { enabled: true }, syncCalendar: true
  });
  push({
    title: '给爷爷扫墓', note: '带爷爷爱吃的绿豆糕，记得提前去市场买。',
    dueAt: atTime(t0, 20, 0).getTime(),
    repeat: rp('lunarYearly', { lunarMonth: 8, lunarDay: 12, isLeapMonth: false }),
    remind: { enabled: true }, syncCalendar: false, seriesCount: 12
  });
  push({
    title: '还信用卡', note: '', dueAt: atTime(t0, 21, 0).getTime(),
    repeat: rp('monthly', { day: t0.getDate() }), remind: { enabled: true }, syncCalendar: false
  });

  /* 未来：农历生日（冬月初八） */
  const lz = solar2lunar(t0.getFullYear(), t0.getMonth() + 1, t0.getDate());
  const bs = lunarToSolarClamped(lz.lunarYear, 11, 8, false);
  let bAt = atTime(new Date(bs.solar.y, bs.solar.m - 1, bs.solar.d), 9, 0).getTime();
  if (bAt <= Date.now())
    bAt = R.nextOccurrenceFrom({ dueAt: bAt, allDay: false, repeat: rp('lunarYearly', { lunarMonth: 11, lunarDay: 8, isLeapMonth: false }) }, Date.now());
  push({
    title: '爷爷生日', note: '记得订蛋糕，农历冬月初八', dueAt: bAt,
    repeat: rp('lunarYearly', { lunarMonth: 11, lunarDay: 8, isLeapMonth: false }),
    remind: { enabled: true }, syncCalendar: false, seriesCount: 3
  });

  const yb = atTime(addDays(t0, 16), 10, 0).getTime();
  push({
    title: '提交年度体检报告', note: '', dueAt: yb,
    repeat: rp('yearly', { month: new Date(yb).getMonth() + 1, day: new Date(yb).getDate() }),
    remind: { enabled: true }, syncCalendar: false
  });

  /* 历史完成记录（供「已完成」与统计） */
  const hist = [
    ['倒垃圾', 'daily', 0, 8], ['晨会', 'daily', 0, 9], ['给花浇水', 'daily', 1, 18], ['交电费', 'monthly', 2, 10],
    ['取干洗', 'none', 3, 17], ['大扫除', 'weekly', 4, 15], ['还书', 'monthly', 5, 20], ['买菜', 'daily', 6, 18],
    ['给妈妈打电话', 'daily', 6, 20]
  ];
  hist.forEach(([title, type, ago, h], i) => {
    const day = addDays(t0, -ago);
    const at = atTime(day, h, 0).getTime();
    const t = mkTask(S, {
      title, note: '', dueAt: at,
      repeat: rp(type, type === 'daily' ? {} : type === 'weekly' ? { weekday: day.getDay() } : { day: day.getDate() }),
      remind: { enabled: false }, status: 'done', completedAt: at + (i % 3) * 60000,
      createdAt: addDays(day, -2).getTime(), seriesCount: i + 1
    });
    S.tasks.push(t);
    S.logs.push({ id: 'l' + (S.seq++), taskId: t.id, seriesId: t.seriesId, title, action: 'completed', at: t.completedAt });
  });
  S.logs.push({ id: 'l' + (S.seq++), taskId: 'x', seriesId: 'x', title: '', action: 'created', at: addDays(t0, -6).getTime() });
  S.seeded = true;
}

module.exports = {
  QUOTA_CAP, QUOTA_LOW, QUOTA_REFILL, RETRY_MS, TRASH_DAYS,
  uid, ymdKey, defaults, mkTask, addLog,
  pending, doneTasks, deletedTasks, taskById, tasksOnDay, overdueList, todayList,
  appStats, seedDemo
};
