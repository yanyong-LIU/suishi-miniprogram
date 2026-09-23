/* ============================================================
   碎事清单 · 农历引擎（纯函数，无平台依赖）
   ------------------------------------------------------------
   本模块由原型的 ==CORE-START== 段逐字迁移，逻辑未作任何改动。

   lunarInfo 表说明：1900–2100 年，每项低 4 位为闰月月份（0 表示无
   闰月）；0x10000 位标记闰月大小；其余 12 位自高位起依次标记正月起
   各月大小。本表由 5 个独立实现（lunardate / zhdate / lunarcalendar /
   cnlunar / borax）的逐日多数票重建，已修正流传版本中 1933、1996、
   2060 三年的错误。校验：1900-01-31 ~ 2100-12-31 共 73384 天，
   与多数票零分歧；农历→公历→农历往返 73058 组零失败。

   唯一推不出的是农历 2100 年腊月长度（数据源均止于 2100 年末），
   按 29 天记；该位仅影响 2101 年之后的日期，超出产品支持范围。
   ============================================================ */
'use strict';

const DAY = 86400000;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const LUNAR_M = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_D = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
const GAN = '甲乙丙丁戊己庚辛壬癸';
const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

const lunarInfo = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06aa0, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
];
/* 24 节气分钟偏移（1900 基准） */
const sTermInfo = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
  263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];

function pad(n, w) { n = String(n); w = w || 2; return n.length < w ? '0'.repeat(w - n.length) + n : n; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
function atTime(day, h, m) { const x = new Date(day); x.setHours(h, m || 0, 0, 0); return x; }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }   /* m: 1-12 */
function fmtClock(ts, allDay) { if (allDay) return '全天'; const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

/* ── 农历基础 ─────────────────────────────────────────── */
function leapMonth(y) { return lunarInfo[y - 1900] & 0xf; }
function leapDays(y) { return leapMonth(y) ? ((lunarInfo[y - 1900] & 0x10000) ? 30 : 29) : 0; }
function monthDays(y, m) { return (lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
function lYearDays(y) { let s = 348; for (let i = 0x8000; i > 0x8; i >>= 1) { if (lunarInfo[y - 1900] & i) s++; } return s + leapDays(y); }

function solar2lunar(y, m, d) {
  if (y < 1900 || y > 2100) return null;
  let offset = (Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / DAY;
  let i, temp = 0;
  for (i = 1900; i < 2101 && offset > 0; i++) { temp = lYearDays(i); offset -= temp; }
  if (offset < 0) { offset += temp; i--; }
  const lunarYear = i;
  const leap = leapMonth(i); let isLeap = false;
  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = leapDays(lunarYear); }
    else { temp = monthDays(lunarYear, i); }
    if (isLeap && i === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && i === leap + 1) { if (isLeap) { isLeap = false; } else { isLeap = true; --i; } }
  if (offset < 0) { offset += temp; --i; }
  return { lunarYear, lunarMonth: i, lunarDay: offset + 1, isLeap };
}

function lunar2solar(y, m, d, isLeap) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const leap = leapMonth(y);
  if (isLeap && leap !== m) return null;
  const dim = isLeap ? leapDays(y) : monthDays(y, m);
  if (d > dim) return null;
  let offset = 0;
  for (let i = 1900; i < y; i++) offset += lYearDays(i);
  for (let i = 1; i < m; i++) { offset += monthDays(y, i); if (leap > 0 && i === leap) offset += leapDays(y); }
  if (isLeap) offset += monthDays(y, m);
  offset += d - 1;
  const dt = new Date(Date.UTC(1900, 0, 31) + offset * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/* 节气：返回该年第 n 个节气所在日（n: 0-23，小寒起） */
function termDay(y, n) {
  const t = new Date((31556925974.7 * (y - 1900) + sTermInfo[n] * 60000) + Date.UTC(1900, 0, 6, 2, 5));
  return t.getUTCDate();
}
function termOfDate(y, m, d) {
  const i1 = (m - 1) * 2, i2 = i1 + 1;
  if (termDay(y, i1) === d) return TERMS[i1];
  if (termDay(y, i2) === d) return TERMS[i2];
  return null;
}
function ganzhiYear(ly) { return GAN[(ly - 4) % 10] + ZHI[(ly - 4) % 12]; }

/* 主要传统节日（按农历日判定；除夕需判断该月天数） */
function festivalOfLunar(l) {
  if (l.isLeap) return null;
  const key = l.lunarMonth + '-' + l.lunarDay;
  const map = {
    '1-1': '春节', '1-15': '元宵', '5-5': '端午', '7-7': '七夕', '7-15': '中元',
    '8-15': '中秋', '9-9': '重阳', '12-8': '腊八'
  };
  if (map[key]) return map[key];
  if (l.lunarMonth === 12 && l.lunarDay === monthDays(l.lunarYear, 12)) return '除夕';
  return null;
}
function lunarOfDt(dt) { return solar2lunar(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }

/* 日期格/列表用短标签：节日 > 节气 > 初一显示月名 > 农历日 */
function lunarCellLabel(dt) {
  const l = lunarOfDt(dt); if (!l) return { text: '', accent: false };
  const f = festivalOfLunar(l); if (f) return { text: f, accent: true };
  const t = termOfDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  if (t) return { text: t, accent: true };
  if (l.lunarDay === 1) return { text: (l.isLeap ? '闰' : '') + LUNAR_M[l.lunarMonth] + '月', accent: false };
  return { text: LUNAR_D[l.lunarDay], accent: false };
}
function lunarShort(dt) {
  const l = lunarOfDt(dt); if (!l) return '';
  return (l.isLeap ? '闰' : '') + LUNAR_M[l.lunarMonth] + '月' + (l.lunarDay === 1 ? '' : LUNAR_D[l.lunarDay]);
}
function lunarFull(dt) {
  const l = lunarOfDt(dt); if (!l) return '超出农历可支持范围';
  return '农历' + ganzhiYear(l.lunarYear) + '年 ' + (l.isLeap ? '闰' : '') + LUNAR_M[l.lunarMonth] + '月' + LUNAR_D[l.lunarDay];
}

/* ── 农历日 → 公历日（含闰月退化 / 小月退化） ─────────────
   闰月退化：目标农历年无该闰月 → 退为常月同日
   小月退化：目标月无该日（腊月三十遇小月） → 退为该月最后一天 */
function lunarToSolarClamped(ly, lm, ld, isLeap) {
  const useLeap = !!isLeap && leapMonth(ly) === lm;
  const dim = useLeap ? leapDays(ly) : monthDays(ly, lm);
  const d = Math.min(ld, dim);
  const r = lunar2solar(ly, lm, d, useLeap);
  if (r) return { solar: r, degraded: (useLeap !== !!isLeap) || (d !== ld) };
  const d2 = Math.min(ld, monthDays(ly, lm));
  const r2 = lunar2solar(ly, lm, d2, false);
  return r2 ? { solar: r2, degraded: true } : null;
}

module.exports = {
  DAY, WD, LUNAR_M, LUNAR_D, TERMS,
  pad, startOfDay, addDays, addMonths, atTime, isSameDay, daysInMonth, fmtClock,
  leapMonth, leapDays, monthDays, lYearDays,
  solar2lunar, lunar2solar, termDay, termOfDate, ganzhiYear, festivalOfLunar,
  lunarOfDt, lunarCellLabel, lunarShort, lunarFull, lunarToSolarClamped
};
