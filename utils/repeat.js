/* ============================================================
   碎事清单 · 重复规则引擎（纯函数，无平台依赖）
   ------------------------------------------------------------
   由原型的 ==CORE-START== 段逐字迁移。

   边界约定（PRD 附录 A 已明确，界面必须灰字提示，不得静默改期）：
     · 每月 31 日 → 2 月落到该月最后一天（28 / 29 日）
     · 每季按 3 个月推，锚在起始月，日同每月 → 短月同样落到该月最后一天
     · 每年 2 月 29 日 → 平年落到 2 月 28 日
     · 农历每年遇闰月不存在 → 退化为该常月同日
     · 腊月三十遇小月 → 取廿九
   ============================================================ */
'use strict';

const L = require('./lunar.js');
const {
  DAY, WD, LUNAR_M, LUNAR_D, pad, startOfDay, addDays, addMonths, atTime,
  daysInMonth, solar2lunar, leapMonth, ganzhiYear, lunarToSolarClamped
} = L;

/* ── 重复规则中文摘要 ───────────────────────────────────── */
function repeatSummary(t) {
  const r = (t && t.repeat) || { type: 'none' }, d = new Date(t.dueAt);
  switch (r.type) {
    case 'none': return '不重复';
    case 'daily': return '每天';
    case 'weekly': return '每周' + WD[r.params.weekday != null ? r.params.weekday : d.getDay()];
    case 'monthly': return '每月 ' + (r.params.day || d.getDate()) + ' 日';
    case 'quarterly': return '每季 ' + (r.params.day || d.getDate()) + ' 日';
    case 'yearly': return '每年 ' + (r.params.month || d.getMonth() + 1) + ' 月 ' + (r.params.day || d.getDate()) + ' 日';
    case 'lunarYearly': {
      const p = r.params || {};
      return '农历每年 ' + (p.isLeapMonth ? '闰' : '') + LUNAR_M[p.lunarMonth] + '月' + LUNAR_D[p.lunarDay];
    }
    default: return '不重复';
  }
}

/* 计算严格晚于 fromMs 的下一次触发；无后续则返回 null */
function nextOccurrenceFrom(t, fromMs) {
  const r = (t && t.repeat) || { type: 'none' }, from = new Date(fromMs);
  const hh = t.allDay ? 0 : new Date(t.dueAt).getHours();
  const mm = t.allDay ? 0 : new Date(t.dueAt).getMinutes();
  const P = r.params || {};
  switch (r.type) {
    case 'none': return null;

    case 'daily': {
      let c = atTime(from, hh, mm);
      if (c.getTime() <= fromMs) c = atTime(addDays(from, 1), hh, mm);
      return c.getTime();
    }
    case 'weekly': {
      const wd = (P.weekday != null) ? P.weekday : new Date(t.dueAt).getDay();
      for (let i = 0; i <= 7; i++) {
        const c = atTime(addDays(from, i), hh, mm);
        if (c.getTime() > fromMs && c.getDay() === wd) return c.getTime();
      }
      return null;
    }
    case 'monthly': {
      const day = (P.day != null) ? P.day : new Date(t.dueAt).getDate();
      for (let i = 0; i < 60; i++) {
        const b = addMonths(from, i), y = b.getFullYear(), m = b.getMonth() + 1;
        const c = atTime(new Date(y, m - 1, Math.min(day, daysInMonth(y, m))), hh, mm);
        if (c.getTime() > fromMs) return c.getTime();
      }
      return null;
    }
    /* 每季 = 每 3 个月的同一天，锚在起始月：5 月 12 日 → 8/12 → 11/12 → 2/12 …
       与 monthly 同构，只是步长为 3；短月（2 / 4 / 6 / 9 / 11 月）同样落到月末。 */
    case 'quarterly': {
      const day = (P.day != null) ? P.day : new Date(t.dueAt).getDate();
      for (let i = 0; i < 40; i++) {
        const b = addMonths(from, i * 3), y = b.getFullYear(), m = b.getMonth() + 1;
        const c = atTime(new Date(y, m - 1, Math.min(day, daysInMonth(y, m))), hh, mm);
        if (c.getTime() > fromMs) return c.getTime();
      }
      return null;
    }
    case 'yearly': {
      const mo = (P.month != null) ? P.month : new Date(t.dueAt).getMonth() + 1;
      const day = (P.day != null) ? P.day : new Date(t.dueAt).getDate();
      for (let i = 0; i < 12; i++) {
        const y = from.getFullYear() + i;
        const c = atTime(new Date(y, mo - 1, Math.min(day, daysInMonth(y, mo))), hh, mm);
        if (c.getTime() > fromMs) return c.getTime();
      }
      return null;
    }
    case 'lunarYearly': {
      const cur = solar2lunar(from.getFullYear(), from.getMonth() + 1, from.getDate());
      if (!cur) return null;
      for (let i = 0; i < 13; i++) {
        const ly = cur.lunarYear + i; if (ly > 2100) return null;
        const res = lunarToSolarClamped(ly, P.lunarMonth, P.lunarDay, P.isLeapMonth);
        if (!res) continue;
        const c = atTime(new Date(res.solar.y, res.solar.m - 1, res.solar.d), hh, mm);
        if (c.getTime() > fromMs) return c.getTime();
      }
      return null;
    }
    default: return null;
  }
}

/* 该重复类型需要用户在编辑时看到的边界提醒（无则 null） */
function repeatEdgeWarning(t) {
  const r = (t && t.repeat) || { type: 'none' }, d = new Date(t.dueAt), P = r.params || {};
  if (r.type === 'monthly') {
    const day = P.day || d.getDate();
    if (day >= 29) return day + ' 日不是每个月都有，2 月等月份会提前到最后一天提醒。';
  }
  if (r.type === 'quarterly') {
    const day = P.day || d.getDate();
    if (day >= 29) return '每季按 3 个月推算，' + day + ' 日在没有这一天的月份会提前到当月最后一天提醒。';
  }
  if (r.type === 'yearly') {
    const mo = P.month || d.getMonth() + 1, day = P.day || d.getDate();
    if (mo === 2 && day === 29) return '平年没有 2 月 29 日，那些年份会提前到 2 月 28 日提醒。';
  }
  if (r.type === 'lunarYearly') {
    const cur = solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const nextY = (cur ? cur.lunarYear : d.getFullYear()) + 1;
    if (P.isLeapMonth && leapMonth(nextY) !== P.lunarMonth)
      return ganzhiYear(nextY) + '年无闰' + LUNAR_M[P.lunarMonth] + '月，将按' + LUNAR_M[P.lunarMonth] + '月同日提醒';
    if (P.lunarMonth === 12 && P.lunarDay === 30)
      return '腊月只有 29 天的年份，会提前到腊月廿九提醒';
  }
  return null;
}

/* 切换重复规则 / 改时间后，把时间重新锚定到下一次触发，避免规则与时间脱节 */
function reanchor(dueAt, repeat, allDay) {
  if (!repeat || repeat.type === 'none') return dueAt;
  return nextOccurrenceFrom({ dueAt, allDay: !!allDay, repeat }, Date.now() - 60000) || dueAt;
}

/* 编辑重复规则时补齐缺省参数（沿用当前任务的时间） */
function ensureParams(repeat, dueAt) {
  const d = new Date(dueAt);
  const P = repeat.params || (repeat.params = {});
  if (repeat.type === 'weekly' && P.weekday == null) P.weekday = d.getDay();
  if (repeat.type === 'monthly' && P.day == null) P.day = d.getDate();
  if (repeat.type === 'quarterly' && P.day == null) P.day = d.getDate();
  if (repeat.type === 'yearly') {
    if (P.month == null) P.month = d.getMonth() + 1;
    if (P.day == null) P.day = d.getDate();
  }
  if (repeat.type === 'lunarYearly' && P.lunarMonth == null) {
    const l = solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (l) { P.lunarMonth = l.lunarMonth; P.lunarDay = l.lunarDay; P.isLeapMonth = !!l.isLeap; }
  }
  return repeat;
}

module.exports = {
  REPEAT_OPTS: [
    ['none', '不重复'], ['daily', '每天'], ['weekly', '每周'],
    ['monthly', '每月'], ['quarterly', '每季'], ['yearly', '每年'], ['lunarYearly', '农历每年']
  ],
  repeatSummary, nextOccurrenceFrom, repeatEdgeWarning, reanchor, ensureParams
};
