/* ============================================================
   碎事清单 · 提醒下发（云函数 + 定时触发器）
   ------------------------------------------------------------
   为什么必须放在云端：
     微信小程序没有后台常驻能力，客户端拿不到「到点」这个事件。
     唯一可行的路径是服务端定时扫描 + 下发订阅消息。

   隐私边界（与《隐私政策》的承诺一致）：
     本函数读到的只有「什么时间需要提醒」和一台设备的随机 deviceId。
     任务的标题、备注、完成记录都不在云端，所以订阅消息文案只能是
     通用句。这是刻意的取舍，不要为了文案好看去加内容字段。

   部署步骤：
     1. 云开发控制台 → 数据库 → 新建集合 suishi_reminders、suishi_users
        权限设为「仅创建者可读写」（客户端只会写自己那份票据）
     2. 订阅消息 → 公共模板库，选一个「待办提醒」类模板，把模板 ID 填到 TMPL_ID，
        再按模板详情页的关键词改下面的 FIELDS，否则发送会因字段名不匹配失败（47003）
        全流程见《碎事清单-订阅消息接入指南.md》
     3. 本目录右键 → 上传并部署（云端安装依赖）
     4. 上传后确认 config.json 里的定时触发器已生效（每整分钟触发一次）
     5. 小程序端把云环境 ID 填进 utils/config.js 的 CLOUD_ENV
   ============================================================ */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/* 订阅消息模板 ID。留空则函数只做清理，不会发送任何消息。
   取自 公众平台 → 功能 → 订阅消息 → 我的模板 → 复制模板 ID。 */
const TMPL_ID = '';

/* ============================================================
   模板字段映射 —— 换模板时**只改这一处**
   ------------------------------------------------------------
   公众平台模板详情页里会列出关键词，形如 {{thing1.DATA}} {{time2.DATA}}。
   下方三个键名必须与之**一字不差**（含数字序号），键名写错会直接
   返回 47003 argument invalid，而且报错不会告诉你是哪个字段写错了。
   举例：模板关键词是 {{thing1.DATA}} / {{time2.DATA}} / {{thing3.DATA}}，
   则这里保持原样；若模板是 {{thing3.DATA}} / {{time4.DATA}} / {{thing5.DATA}}，
   就把三个值依次改成 thing3 / time4 / thing5。

   tip 可以设为 null —— 模板只有两个关键词时用得上（自定义模板被审核
   要求精简字段是常事）。buildPayload 里按 `if (FIELDS.tip)` 判断，
   所以 null、空串、或直接删掉这一项都能正确省略该字段。
   真正的坑在反方向：模板没这个字段，却留着 tip: 'thing3'，
   就会多传一个模板里不存在的键 → 47003，而报错不会指出是哪个字段。
   ============================================================ */
const FIELDS = {
  subject: 'thing1',   /* 事物：消息第一行 */
  when: 'time2',       /* 时间：到点时刻 */
  tip: 'thing3'        /* 事物：引导语；模板无此字段时改为 null */
};

/* 各字段类型上限（单位：字符）。超长会被微信侧直接拒掉（47003），
   这里先本地截断，宁可少两个字也不要整条发不出去。 */
const LIMIT = { thing: 20, time: 32, phrase: 5 };

/* 小程序页面路径：点开提醒后落到清单页，而不是首页 */
const PAGE = 'pages/list/list';

/* 正式版用 formal；开发期改 developer 或 trial */
const MINIPROGRAM_STATE = 'formal';

/* 单次执行最多处理多少条，避免一次触发超时 */
const BATCH = 100;

/* 票据保留多久后强制清理（超过 7 天还没发出去的就不发了） */
const EXPIRE_MS = 7 * 24 * 3600 * 1000;

exports.main = async () => {
  const now = Date.now();

  /* 顺手清掉过期票据：任务删掉 / 提醒关掉之后可能留下孤儿文档 */
  await db.collection('suishi_reminders')
    .where({ dueAt: _.lt(now - EXPIRE_MS) })
    .remove()
    .catch(() => null);

  const due = await db.collection('suishi_reminders')
    .where({ dueAt: _.lte(now), sent: _.neq(true) })
    .orderBy('dueAt', 'asc')
    .limit(BATCH)
    .get()
    .catch(() => ({ data: [] }));

  const list = due.data || [];
  if (!list.length) return { ok: true, scanned: 0, sent: 0, failed: 0, skipped: 0 };

  if (!TMPL_ID) {
    /* 没有配置模板：不装作发过了，直接把票据标记出来，让问题可见 */
    await Promise.all(list.map(d =>
      db.collection('suishi_reminders').doc(d._id)
        .update({ data: { sent: true, lastErr: 'template_not_configured', sentAt: now } })
        .catch(() => null)
    ));
    return { ok: false, reason: 'template_not_configured', scanned: list.length };
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const d of list) {
    const touser = d._openid;
    if (!touser) { skipped++; continue; }

    try {
      const r = await cloud.openapi.subscribeMessage.send({
        touser,
        templateId: TMPL_ID,
        page: PAGE,
        miniprogramState: MINIPROGRAM_STATE,
        lang: 'zh_CN',
        data: buildPayload(d)
      });

      if (r && r.errCode === 0) {
        sent++;
        /* 一次性订阅消息「授权 1 次只能发 1 条」，发完即作废，删票据 */
        await db.collection('suishi_reminders').doc(d._id).remove().catch(() => null);
        /* 同步扣减额度镜像，让客户端三处读数一致 */
        await decQuota(d.deviceId);
      } else {
        failed++;
        await markFailed(d._id, (r && r.errMsg) || 'unknown');
      }
    } catch (e) {
      failed++;
      await markFailed(d._id, (e && e.errMsg) || (e && e.message) || 'throw');
    }
  }

  return { ok: true, scanned: list.length, sent, failed, skipped };
};

/* ============================================================
   模板数据
   ------------------------------------------------------------
   ⚠️ 键名来自上面的 FIELDS，必须与你在公众平台选的模板一致。
      这里全部填通用文案，不带任何任务内容——原因见文件头。
   ⚠️ time 类型官方示例是「2019年10月1日 15:01」这种**带年份**的全格式。
      只写「10月1日 15:01」在部分模板上会被判为格式非法，所以这里补全年份。
   ============================================================ */
function buildPayload(d) {
  const t = new Date(d.dueAt);
  const hh = pad(t.getHours()) + ':' + pad(t.getMinutes());
  const when = t.getFullYear() + '年' + (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + hh;

  const data = {};
  data[FIELDS.subject] = { value: fit('你有碎事到点了', LIMIT.thing) };
  data[FIELDS.when] = { value: when };
  /* tip 为 null 时不拼这个字段：拼了会造出一个模板里不存在的键，
     微信侧直接判 47003，且不告诉你错在哪个字段。 */
  if (FIELDS.tip) data[FIELDS.tip] = { value: fit('打开小程序看看是哪一件', LIMIT.thing) };
  return data;
}

/* 按字段类型上限截断，尾部用省略号，避免超长导致整条消息 47003 */
function fit(v, n) {
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
}

/* 发送失败：不再重试（订阅授权已失效或已被消耗），只记录原因 */
async function markFailed(id, err) {
  await db.collection('suishi_reminders').doc(id)
    .update({ data: { sent: true, lastErr: String(err).slice(0, 200), sentAt: Date.now() } })
    .catch(() => null);
}

async function decQuota(deviceId) {
  if (!deviceId) return;
  try {
    const doc = await db.collection('suishi_users').doc(deviceId).get();
    const q = (doc.data && doc.data.quota) || 0;
    await db.collection('suishi_users').doc(deviceId)
      .update({ data: { quota: Math.max(0, q - 1), updatedAt: Date.now() } });
  } catch (e) { /* 用户文档不存在时忽略：额度镜像只是展示用 */ }
}

function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
