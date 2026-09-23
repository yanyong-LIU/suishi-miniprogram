/* ============================================================
   编辑器（新建 / 编辑）· 半屏弹层
   ------------------------------------------------------------
   需求文档 §5.1.2/§5.1.3 与可体验原型一致：编辑器是**半屏弹层**，
   不做整页跳转，理由写在 PRD 第 180 行 ——「不打断输入」。
   做成弹层以后还有两个实际好处：
     · 用户看得见底下那条任务在清单里的位置，知道自己在改哪一件
     · 重复规则可以叠在编辑器之上，而不是替换掉它

   字段分成两组，语义分组比按字段类型分组更重要：
     上一组回答「这件事是什么」：日期时间 / 重复 / 备注
     下一组回答「怎么叫我」：到时提醒 / 写入手机日历
   两个必须做对的地方：
     ① 关闭提醒时立刻出现「关闭后不会收到任何提醒」——这个后果
        用户看不见，就会以为默认还会响。
     ② 保存后若尚未授权订阅消息，主动引导一次授权，而不是等用户
        某天发现提醒没响。

   时间与规则的对齐只在本组件做一次（改完日期、改完规则、保存前），
   重复规则弹层只负责回传规则本身 —— 两处都对齐迟早会不一致。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const F = require('../../utils/fmt.js');
const L = require('../../utils/lunar.js');
const R = require('../../utils/repeat.js');
const PF = require('../../utils/platform.js');
const CFG = require('../../utils/config.js');

Component({
  options: { styleIsolation: 'apply-shared' },

  data: {
    show: false,
    isEdit: false,
    id: '',

    title: '',
    note: '',
    noteShort: '',
    noteOpen: false,
    focusNote: false,
    autoFocus: false,
    titleCount: '',
    titleCountCls: 'c3',
    canSave: false,

    allDay: false,
    dueAt: 0,
    dueLabel: '',

    repeat: { type: 'none', params: {} },
    repeatLabel: '不重复',

    remind: true,
    syncCalendar: false,

    /* 时间已过 + 不重复：提示改成重复，否则用户会以为它还会响 */
    pastWarn: false,

    /* 键盘抬起的高度（px）。弹层据此整体上移，见 onKb 的注释 */
    kbH: 0,
    /* 上移后的内联样式；键盘收起时为空串，交回 .essheet 的 max-height:88% */
    sheetStyle: ''
  },

  methods: {
    /* open({ id }) 编辑既有任务；open({ date }) 在指定日期新建；
       open() 直接新建。返回 Promise<boolean>：true = 存过盘，
       调用方据此决定要不要刷新列表。 */
    open(opt) {
      opt = opt || {};
      let autoFocus = false;

      if (opt.id) {
        const t = store.taskById(opt.id);
        if (!t) return Promise.resolve(false);
        this.draft = {
          id: t.id,
          title: t.title,
          note: t.note || '',
          allDay: !!t.allDay,
          dueAt: t.dueAt,
          repeat: JSON.parse(JSON.stringify(t.repeat || { type: 'none', params: {} })),
          remind: !!(t.remind && t.remind.enabled),
          syncCalendar: !!t.syncCalendar
        };
        this.setData({ isEdit: true, id: t.id, noteOpen: !!t.note, autoFocus: false });
      } else {
        this.draft = this.mkDraft(opt.date);
        this.setData({ isEdit: false, id: '', noteOpen: false, focusNote: false, autoFocus: false });
        autoFocus = true;
      }

      /* overlayTab 按嵌套深度计数：已在显示时重入 open（快速连点 FAB、
         或编辑器之上再开编辑器）不能再 +1，否则取消一次回不到 0，
         TabBar 会被永久摘掉。只在「从隐藏到显示」这一跳才 +1。 */
      if (!this.data.show) PF.overlayTab(true);
      return new Promise(resolve => {
        this._resolve = resolve;
        this.setData({ show: true, kbH: 0, sheetStyle: '' });
        this.paint();
        /* 新建时自动聚焦标题：键盘已经在等，少一次点击。
           必须先置 false 再置 true，否则第二次打开不会重新聚焦。 */
        if (autoFocus) setTimeout(() => this.setData({ autoFocus: true }), 320);
      });
    },

    close(saved) {
      if (!this.data.show) return;
      this.setData({ show: false, autoFocus: false, kbH: 0, sheetStyle: '' });
      PF.overlayTab(false);
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(!!saved), 240);
    },

    /* ── 键盘 ───────────────────────────────────────────────
       弹层是「贴底 + 内容撑高」的。键盘一抬起来，它不会自己让位：
       下半截（重复 / 提醒 / 保存）被键盘整个盖住，而 sbody 这个
       scroll-view 又没有确定高度、滚不动 —— 用户既看不到、也够不着，
       标题输入框就贴着上沿被挤在键盘与标题栏之间。
       做法：把弹层按键盘真实高度整体上移，并把「屏幕高 − 键盘高」
       算成内联的 max-height。这样 sbody 有了确定高度，成为真正可滚的
       容器，输入框始终落在键盘上方。
       高度不猜：用 keyboardheightchange 给的真实像素值。              */
    getWinH() {
      if (this._winH) return this._winH;
      let h = 0;
      try {
        h = ((wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight) || 0;
      } catch (e) { h = 0; }
      this._winH = h;   /* 窗口尺寸在会话内不变，取一次即可 */
      return h;
    },

    sheetStyleFor(kbH) {
      if (!kbH || kbH <= 0) return '';
      const winH = this.getWinH();
      /* 上沿留 24px：既不贴死屏幕顶，也给标题栏一点呼吸 */
      const maxH = winH ? Math.max(240, winH - kbH - 24) : 0;
      return 'bottom:' + kbH + 'px' + (maxH ? ';max-height:' + maxH + 'px' : '');
    },

    onKb(e) {
      const h = (e && e.detail && typeof e.detail.height === 'number') ? e.detail.height : 0;
      if (h === this.data.kbH) return;
      this.setData({ kbH: h, sheetStyle: this.sheetStyleFor(h) });
    },

    /* 新建时的默认时间：
       白天 → 今天 + 默认提醒时间；夜里 → 明天 09:00（避免默认设出一个
       已经过去的时刻）。日历页带 date 进来时按那天算。 */
    mkDraft(dateStr) {
      const S = store.state;
      const parts = (S.settings.defaultRemindTime || '20:00').split(':');
      const dh = parseInt(parts[0], 10) || 20;
      const dm = parseInt(parts[1], 10) || 0;
      const now = new Date();
      let day, hh, mm;

      if (dateStr) {
        day = new Date(String(dateStr).replace(/-/g, '/'));
        hh = dh; mm = dm;
      } else if (now.getHours() >= 5 && now.getHours() < 17) {
        day = now; hh = dh; mm = dm;
      } else {
        day = L.addDays(now, 1); hh = 9; mm = 0;
      }

      return {
        id: '',
        title: '',
        note: '',
        allDay: false,
        dueAt: L.atTime(day, hh, mm).getTime(),
        repeat: { type: 'none', params: {} },
        remind: true,
        syncCalendar: !!S.settings.syncCalendar
      };
    },

    /* ── 渲染 ───────────────────────────────────────────── */
    paint() {
      const d = this.draft;
      const dd = new Date(d.dueAt);
      const today = new Date();
      const rep = (d.repeat && d.repeat.type) || 'none';

      const label = (L.isSameDay(dd, today) ? '今天' : F.relDayLabel(dd)) + ' · 周' + L.WD[dd.getDay()] +
        (d.allDay ? ' 全天' : ' ' + L.pad(dd.getHours()) + ':' + L.pad(dd.getMinutes()));

      const n = (d.title || '').length;

      this.setData({
        title: d.title,
        note: d.note,
        noteShort: this.shortNote(d.note),
        allDay: !!d.allDay,
        dueAt: d.dueAt,
        dueLabel: label,
        repeat: d.repeat,
        repeatLabel: R.repeatSummary(d),
        remind: !!d.remind,
        syncCalendar: !!d.syncCalendar,

        titleCount: n > 40 ? n + '/50' : '',
        titleCountCls: n >= 50 ? 'cd' : n >= 45 ? 'cw' : 'c3',
        canSave: !!d.title.trim(),

        pastWarn: d.dueAt < Date.now() && rep === 'none'
      });
    },

    /* ── 标题 / 备注 ────────────────────────────────────── */
    onTitle(e) {
      this.draft.title = e.detail.value;
      /* 只更新计数器与保存按钮，不整页重绘（否则输入框会跳光标） */
      const n = e.detail.value.length;
      this.setData({
        titleCount: n > 40 ? n + '/50' : '',
        titleCountCls: n >= 50 ? 'cd' : n >= 45 ? 'cw' : 'c3',
        canSave: !!e.detail.value.trim()
      });
    },

    onToggleNote() {
      const open = !this.data.noteOpen;
      this.setData({ noteOpen: open });
      if (open) setTimeout(() => this.setData({ focusNote: true }), 80);
    },

    onNote(e) {
      this.draft.note = e.detail.value;
      this.setData({ note: e.detail.value, noteShort: this.shortNote(e.detail.value) });
    },

    /* WXML 不支持方法调用，截断必须在 JS 里算好 */
    shortNote(s) {
      s = s || '';
      return s.length > 16 ? s.slice(0, 16) + '…' : s;
    },

    /* ── 日期时间 ───────────────────────────────────────── */
    onPickDate() {
      this.selectComponent('#epicker').open({
        mode: 'datetime', dueAt: this.draft.dueAt, allDay: this.draft.allDay
      }).then(v => {
        if (!v) return;
        this.draft.dueAt = v.ts;
        this.draft.allDay = !!v.allDay;
        /* 已有重复规则时把时间重新锚定到下一次触发：否则会出现
           「规则说每月 5 日、时间却停在 20 日」这种自相矛盾的状态 */
        if (this.draft.repeat.type !== 'none') {
          this.draft.dueAt = R.reanchor(this.draft.dueAt, this.draft.repeat, this.draft.allDay);
        }
        this.paint();
      });
    },

    /* ── 重复：叠在编辑器之上的一层弹层 ─────────────────── */
    onPickRepeat() {
      this.selectComponent('#erepeat').open({
        dueAt: this.draft.dueAt,
        allDay: this.draft.allDay,
        repeat: this.draft.repeat
      }).then(r => {
        if (!r) return;
        this.draft.repeat = r;
        this.draft.dueAt = R.reanchor(this.draft.dueAt, r, this.draft.allDay);
        this.paint();
      });
    },

    /* 过去时间的快捷修正：一键改成每天 */
    onMakeDaily() {
      const d = this.draft;
      d.repeat = { type: 'daily', params: {} };
      d.dueAt = R.reanchor(d.dueAt, d.repeat, d.allDay);
      this.paint();
      wx.showToast({ title: '已改成每天', icon: 'none' });
    },

    /* ── 提醒开关 ───────────────────────────────────────── */
    onToggleRemind() {
      this.draft.remind = !this.draft.remind;
      this.paint();
    },

    onToggleCal() {
      if (this.draft.syncCalendar) {
        this.draft.syncCalendar = false;
        this.paint();
        return;
      }
      if (store.state.settings.syncCalendar) {
        this.draft.syncCalendar = true;
        this.paint();
        return;
      }
      /* 第一次开启：把这条通道的代价讲清楚再写 */
      this.selectComponent('#eguide').open({ kind: 'cal' }).then(r => {
        if (r !== 'primary') return;
        store.setSetting('syncCalendar', true);
        this.draft.syncCalendar = true;
        this.paint();
        wx.showToast({ title: '已写入手机日历', icon: 'none' });
      });
    },

    /* ── 保存 / 取消 / 删除 ─────────────────────────────── */
    onSave() {
      const d = this.draft;
      if (!d.title.trim()) {
        wx.showToast({ title: '给这件事起个名字吧', icon: 'none' });
        return;
      }
      const res = store.saveEdit({
        id: d.id || null,
        title: d.title,
        note: d.note,
        allDay: d.allDay,
        dueAt: d.dueAt,
        repeat: d.repeat,
        remind: d.remind,
        syncCalendar: d.syncCalendar
      });

      if (!res.ok) {
        wx.showToast({ title: res.reason === 'empty' ? '给这件事起个名字吧' : '保存失败', icon: 'none' });
        return;
      }

      /* 写入手机日历（兜底通道），失败不阻塞保存 */
      if (res.task.syncCalendar) {
        PF.addToCalendar(res.task).then(r => {
          if (!r || !r.ok) return;
          /* 每季 / 农历每年在系统日历里没有对应的重复周期，只能写最近一次。
             不说明白，用户会以为整条规律都写进去了。 */
          if (r.mode === 'single' && PF.CAL_SINGLE_ONLY[res.task.repeat.type]) {
            wx.showToast({ title: '已保存 · 日历只写入了最近一次', icon: 'none' });
            return;
          }
          wx.showToast({ title: res.isEdit ? '已保存' : '已加进清单', icon: 'none' });
        });
      }

      /* 第一次开提醒且还没授权过：先把授权做掉再收弹层，否则用户会以为
         「提醒已开」，实际一条也发不出去。 */
      if (res.needAuthGuide) {
        this.selectComponent('#eguide').open({ kind: 'auth', topup: false, quota: store.quota() }).then(v => {
          if (v !== 'primary') {
            const S = store.state;
            S.guideShown = true; store.save();
            this.close(true);
            return;
          }
          PF.requestSubscribe(CFG.SUBSCRIBE_TMPL_IDS).then(r => {
            if (r.ok) {
              const q = store.topupQuota(0, true);
              wx.showToast({ title: '提醒已开启 · 额度 ' + q + ' 次', icon: 'none' });
            } else if (r.reason === 'no_template') {
              wx.showToast({ title: '订阅消息模板未配置', icon: 'none' });
            }
            this.close(true);
          });
        });
        return;
      }

      wx.showToast({ title: res.isEdit ? '已保存' : '已加进清单', icon: 'none' });
      this.close(true);
    },

    /* 取消：与原型一致，直接收弹层。
       改动都在 draft 里，没写过盘，丢掉的是这一次编辑。 */
    onCancel() { this.close(false); },

    onDelete() {
      const id = this.draft.id;
      if (!id) return;
      const t = store.taskById(id);
      if (!t) return;
      const rep = t.repeat && t.repeat.type !== 'none';

      if (!rep) {
        store.delTask(id);
        this.close(true);
        return;
      }
      this.selectComponent('#esheet').open({
        title: '这是一件重复的碎事',
        desc: '这件事已重复 ' + (t.seriesCount || 0) + ' 次，你要删多少？',
        items: [
          { label: '仅删除这一次', sub: '按规则生成下一次' },
          { label: '删除此次及以后', sub: '结束这个重复，历史记录保留' },
          { label: '删除全部', sub: '含历史记录，7 天内可在「最近删除」恢复', danger: true }
        ]
      }).then(i => {
        if (i < 0) return;
        store.delTask(id, ['one', 'future', 'all'][i]);
        this.close(true);
      });
    },

    /* 面板内点击不冒泡到遮罩 */
    noop() { }
  }
});
