/* ============================================================
   碎事清单 · .ics 生成
   ------------------------------------------------------------
   浏览器原型里是直接 Blob 下载；小程序没有文件下载能力，改为
   生成文本后写入剪贴板，用户粘进邮件 / 备忘录即可导入日历。
   同时留出 writeFile + shareFileMessage 的路径（见 exportIcsFile）。
   ============================================================ */
'use strict';
const L = require('./lunar.js');
const { pad } = L;

function icsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function stamp(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
}

/* 农历重复无法用 RRULE 表达，只能写单次 —— 界面上必须明确告知。
   每季可用 MONTHLY + INTERVAL=3 表达，锚在 DTSTART 所在月，与引擎一致。 */
const RR = {
  daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY',
  quarterly: 'FREQ=MONTHLY;INTERVAL=3', yearly: 'FREQ=YEARLY'
};

function buildIcs(t, occurrenceTs) {
  const start = new Date(occurrenceTs != null ? occurrenceTs : t.dueAt);
  const end = new Date(start.getTime() + 3600000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//suishi-qingdan//CN//CN',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:' + t.id + '@suishi-qingdan',
    'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(start),
    'DTEND:' + stamp(end),
    'SUMMARY:' + icsEsc(t.title)
  ];
  if (t.note) lines.push('DESCRIPTION:' + icsEsc(t.note));
  const rep = (t.repeat && t.repeat.type) || 'none';
  if (RR[rep]) lines.push('RRULE:' + RR[rep]);
  lines.push(
    'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY',
    'DESCRIPTION:' + icsEsc(t.title), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  );
  return lines.join('\r\n');
}

/* 写成 .ics 文件并唤起转发（需要 FileSystemManager，可用性视基础库而定） */
function exportIcsFile(t, occurrenceTs) {
  return new Promise(resolve => {
    let fs;
    try { fs = wx.getFileSystemManager(); } catch (e) { resolve({ ok: false, reason: 'unsupported' }); return; }
    const safe = String(t.title || '碎事').replace(/[\\/:*?"<>|]/g, '');
    const path = wx.env.USER_DATA_PATH + '/' + safe + '.ics';
    fs.writeFile({
      filePath: path,
      data: buildIcs(t, occurrenceTs),
      encoding: 'utf8',
      success() {
        if (!wx.shareFileMessage) { resolve({ ok: true, path }); return; }
        wx.shareFileMessage({
          filePath: path,
          fileName: safe + '.ics',
          success() { resolve({ ok: true, path }); },
          fail(err) { resolve({ ok: false, reason: (err && err.errMsg) || 'share fail', path }); }
        });
      },
      fail(err) { resolve({ ok: false, reason: (err && err.errMsg) || 'write fail' }); }
    });
  });
}

module.exports = { buildIcs, icsEsc, exportIcsFile, RR };
