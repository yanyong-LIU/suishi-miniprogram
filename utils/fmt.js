/* ============================================================
   碎事清单 · 文案格式化（纯函数）
   ============================================================ */
'use strict';
const L = require('./lunar.js');
const { DAY, WD, pad, startOfDay, lunarShort } = L;

/* 相对日期：今天 / 明天 / 后天 / 昨天 / 周X / M 月 D 日 */
function relDayLabel(d) {
  const t0 = startOfDay(new Date()), dd = startOfDay(d);
  const off = Math.round((dd - t0) / DAY);
  if (off === 0) return '今天';
  if (off === 1) return '明天';
  if (off === 2) return '后天';
  if (off === -1) return '昨天';
  if (off < 0) return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  if (off < 7) return '周' + WD[d.getDay()];
  if (d.getFullYear() !== t0.getFullYear()) return (d.getFullYear() % 100) + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function mdLabel(d) { return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; }
function mdwdLabel(d) { return mdLabel(d) + ' 周' + WD[d.getDay()]; }
function ymdChinese(d) { return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; }
function clockOf(ts, allDay) { return L.fmtClock(ts, allDay); }

/* 清单页标题下方那行：日期 + 农历（今天分段）/ 计数（其他分段） */
function headSub(seg, counts) {
  const d = new Date();
  const base = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + WD[d.getDay()];
  if (seg === 'today') return { text: base + ' · ', lunar: lunarShort(d) };
  const map = {
    all: counts.pending + ' 件未完成',
    done: counts.done + ' 件已完成',
    overdue: counts.overdue + ' 件已过期'
  };
  return { text: base + ' · ' + (map[seg] || ''), lunar: '' };
}

/* 完成时刻：08-31 20:15 */
function completedLabel(ts) {
  const d = new Date(ts || Date.now());
  return '完成于 ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = { relDayLabel, mdLabel, mdwdLabel, ymdChinese, clockOf, headSub, completedLabel };
