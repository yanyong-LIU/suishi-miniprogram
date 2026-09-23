/* ============================================================
   法定节假日 / 调休（日历格「休」「班」角标 + 选中日标题后缀）
   ------------------------------------------------------------
   事实性数据，只能来自国务院办公厅逐年公告，逐条录入、不凭印象。
   2026 年批次来源：《国务院办公厅关于2026年部分节假日安排的通知》
   （中国政府网 gov.cn，2025-11-04 发布），原文逐条：
     元旦：1月1日至3日放假调休，共3天。1月4日（周日）上班。
     春节：2月15日（周日）至23日（周一）放假调休，共9天。2月14日（周六）、28日（周六）上班。
     清明节：4月4日（周六）至6日（周一）放假，共3天。
     劳动节：5月1日（周五）至5日（周二）放假调休，共5天。5月9日（周六）上班。
     端午节：6月19日（周五）至21日（周日）放假，共3天。
     中秋节：9月25日（周五）至27日（周日）放假，共3天。
     国庆节：10月1日（周四）至7日（周三）放假调休，共7天。9月20日（周日）、10月10日（周六）上班。
   公告未发布的年份不标休/班（传统节日名仍由 lunar.js 实算显示）。
   三副本同步：原型 ==CORE== 段、checks/core.mjs、本文件——改任一处要三处同步，
   checks/mp-crosscheck.mjs 的 [节假日] 节负责逐日对拍。
   ============================================================ */
'use strict';

const L = require('./lunar.js');

const ARRANGEMENTS = {
  2026: {
    /* 放假区间 [起月, 起日, 止月, 止日, 名称] —— 官方通知逐条照抄 */
    rest: [
      [1, 1, 1, 3, '元旦'],
      [2, 15, 2, 23, '春节'],
      [4, 4, 4, 6, '清明节'],
      [5, 1, 5, 5, '劳动节'],
      [6, 19, 6, 21, '端午节'],
      [9, 25, 9, 27, '中秋节'],
      [10, 1, 10, 7, '国庆节']
    ],
    /* 调休上班日 [月, 日, 所补节假日名] */
    work: [
      [1, 4, '元旦'], [2, 14, '春节'], [2, 28, '春节'],
      [5, 9, '劳动节'], [9, 20, '国庆节'], [10, 10, '国庆节']
    ]
  }
};

const cache = {};
function tableOf(year) {
  if (cache[year] !== undefined) return cache[year];
  const a = ARRANGEMENTS[year];
  if (!a) { cache[year] = null; return null; }
  const rest = {}, work = {};
  a.rest.forEach(r => {
    let t = new Date(year, r[0] - 1, r[1]).getTime();
    const end = new Date(year, r[2] - 1, r[3]).getTime();
    for (; t <= end; t += 86400000) {
      const d = new Date(t);
      rest[L.pad(d.getMonth() + 1) + '-' + L.pad(d.getDate())] = r[4];
    }
  });
  a.work.forEach(w => { work[L.pad(w[0]) + '-' + L.pad(w[1])] = w[2]; });
  cache[year] = { rest, work };
  return cache[year];
}

/* 当天是否法定假日：{ type:'rest'|'work', name } 或 null（无公告年份/普通日） */
function holidayOf(dt) {
  const t = tableOf(dt.getFullYear());
  if (!t) return null;
  const key = L.pad(dt.getMonth() + 1) + '-' + L.pad(dt.getDate());
  if (t.rest[key]) return { type: 'rest', name: t.rest[key] };
  if (t.work[key]) return { type: 'work', name: t.work[key] };
  return null;
}

module.exports = { holidayOf, ARRANGEMENTS };
