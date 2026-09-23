/* ============================================================
   任务行
   ------------------------------------------------------------
   承担四件事：
     1. 左滑露出「编辑 / 删除」（同一时刻只允许一行处于滑开状态）
     2. 勾选完成（双击区域独立，不触发左滑）
     3. 副行拼装：时间 · 重复标签 · 提醒未发出 · 备注
     4. 重复任务完成后「原位推进」——行不跳位，只换时间与计数
   mode: normal | undo(已完成·可撤销) | resched(过期·可改期)
   ============================================================ */
'use strict';

const L = require('../../utils/lunar.js');
const F = require('../../utils/fmt.js');
const R = require('../../utils/repeat.js');
const M = require('../../utils/model.js');

/* 模块级：任意时刻至多一行滑开 */
let openedRow = null;
/* 防止左滑后误触进入详情 */
let lastSwipeAt = 0;

const SWIPE_W = 136 * 2;   /* 两个操作按钮总宽（rpx），与 wxss 保持一致 */

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    task: { type: Object, value: null },
    mode: { type: String, value: 'normal' },
    showDate: { type: Boolean, value: false }
  },
  data: {
    view: null,      /* 预计算好的展示模型，避免 WXML 里写逻辑 */
    shift: 0,
    dragging: false
  },
  observers: {
    'task, mode, showDate': function () { this.build(); }
  },
  lifetimes: {
    detached() {
      if (openedRow === this) openedRow = null;
    }
  },
  methods: {
    build() {
      const t = this.data.task;
      if (!t) { this.setData({ view: null }); return; }

      const now = Date.now();
      const t0 = L.startOfDay(new Date());
      const isDone = t.status === 'done';
      const late = !isDone && L.startOfDay(new Date(t.dueAt)).getTime() < t0.getTime();
      const past = !isDone && t.dueAt < now;
      const d = new Date(t.dueAt);
      const rep = (t.repeat && t.repeat.type) || 'none';

      const sub = [];
      if (isDone) {
        sub.push({ k: 'c', text: F.completedLabel(t.completedAt || t.dueAt) });
      } else {
        const timeText = (this.data.showDate ? F.relDayLabel(d) + ' ' : '') +
          (t.allDay ? '全天' : L.fmtClock(t.dueAt, t.allDay));
        sub.push({ k: 't', text: timeText, cls: past ? 'odtime' : '' });
        /* 分隔点必须带 .sep —— 原型是 `.rsub .sep{color:var(--tdis)}`，
           不带类名时它跟正文同色（--t2），整行层次就塌了 */
        const sep = () => sub.push({ k: 's', text: '·', cls: 'sep' });
        if (rep !== 'none') {
          sep();
          sub.push({ k: 'r', text: R.repeatSummary(t), tag: rep === 'lunarYearly' ? 'cn' : 'ink' });
        }
        if (t.missed) { sep(); sub.push({ k: 'm', text: '提醒未发出' }); }
        if (t.note) { sep(); sub.push({ k: 'n', text: t.note, cls: 'note' }); }
      }

      this.setData({
        view: {
          id: t.id,
          title: t.title,
          isDone,
          late: late || past,
          /* 删除线常驻，由父级 .done 驱动宽度做动画。
             用 wx:if 让它「完成时才出现」的话，它是瞬间铺满的 —— 少了那 0.24s */
          strike: true,
          sub,
          /* 原型只有「无 action」的行才显示兜底通道图标；改期行不显示 */
          showCal: !isDone && this.data.mode === 'normal' && !!t.syncCalendar,
          action: this.data.mode
        }
      });
    },

    /* ── 左滑 ───────────────────────────────────────── */
    onTouchStart(e) {
      const p = e.touches[0];
      this._sw = {
        x: p.clientX, y: p.clientY, moved: false, decided: false,
        base: this.data.shift ? -SWIPE_W : 0
      };
    },
    onTouchMove(e) {
      const s = this._sw;
      if (!s) return;
      const p = e.touches[0];
      const dx = p.clientX - s.x, dy = p.clientY - s.y;
      if (!s.decided) {
        if (Math.abs(dx) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { this._sw = null; return; }  /* 判定为纵向滚动 */
        s.decided = true;
        s.moved = true;
        if (openedRow && openedRow !== this) openedRow.closeShift();
        if (!this.data.dragging) this.setData({ dragging: true });
      }
      let v = s.base + dx;
      v = Math.max(-SWIPE_W, Math.min(0, v));
      this._t = v;
      this.setData({ shift: v });
    },
    onTouchEnd() {
      const s = this._sw;
      this._sw = null;
      if (!s) return;
      if (!s.moved) return;
      const open = (this._t != null ? this._t : 0) < -60;
      this.setData({ shift: open ? -SWIPE_W : 0, dragging: false });
      openedRow = open ? this : (openedRow === this ? null : openedRow);
      lastSwipeAt = Date.now();
    },
    closeShift() {
      this.setData({ shift: 0, dragging: false });
      if (openedRow === this) openedRow = null;
    },

    /* ── 交互 ───────────────────────────────────────── */
    onToggle() { this.triggerEvent('toggle', { id: this.data.task.id }); },
    onOpen() {
      /* 滑开状态下点击先收起；刚滑完 350ms 内不进入详情 */
      if (this.data.shift !== 0) { this.closeShift(); return; }
      if (Date.now() - lastSwipeAt < 350) return;
      this.triggerEvent('open', { id: this.data.task.id });
    },
    onEdit() { this.closeShift(); this.triggerEvent('edit', { id: this.data.task.id }); },
    onDel() { this.closeShift(); this.triggerEvent('del', { id: this.data.task.id }); },
    onUndo() { this.triggerEvent('undo', { id: this.data.task.id }); },
    onResched() { this.triggerEvent('resched', { id: this.data.task.id }); },

    /* 供页面在「撤销完成」后播一次成功闪烁 */
    flash() {
      this.setData({ flashing: true });
      setTimeout(() => this.setData({ flashing: false }), 240);
    }
  }
});
