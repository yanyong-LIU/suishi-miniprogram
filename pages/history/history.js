/* ============================================================
   全部完成记录
   ------------------------------------------------------------
   与清单页「已完成」分段的职责划分（PRD 修订建议 §8.3）：
     分段   = 近 7 天，用于快速撤销
     本页   = 按天分组的完整历史
   两边读的是同一批数据（status === 'done'），只是时间窗口不同。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const L = require('../../utils/lunar.js');
const F = require('../../utils/fmt.js');

Page({
  data: {
    fontCls: 'fs-md',
    groups: [],
    empty: null
  },

  onShow() {
    const S = store.state;
    const f = (S.settings && S.settings.fontScale) || 1;
    const all = store.doneTasks().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const groups = [];
    all.forEach(t => {
      const k = store.ymdKey(new Date(t.completedAt || t.dueAt));
      let g = groups.find(x => x.k === k);
      if (!g) { g = { k, title: '', count: 0, tasks: [] }; groups.push(g); }
      g.tasks.push(t);
    });
    groups.forEach(g => {
      const d = new Date(g.k.replace(/-/g, '/'));
      g.title = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + L.WD[d.getDay()];
      g.count = g.tasks.length;
    });

    this.setData({
      fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl',
      groups,
      empty: all.length ? null : { title: '还没有完成过一件碎事。', sub: '做完一件，回来打个勾', btn: '' }
    });
  },

  onBack() { wx.navigateBack(); },
  onEmptyBtn() { wx.switchTab({ url: '/pages/list/list' }); },

  onRowOpen(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.detail.id }); },
  onRowUndo(e) {
    store.undoTask(e.detail.id);
    this.onShow();
    wx.showToast({ title: '已取消完成', icon: 'none' });
  },
  /* 编辑器是半屏弹层（PRD §5.1.3），不跳页；关掉后就地重算分组 ——
     改过时间的记录可能换一天，删掉的要消失。 */
  onRowEdit(e) {
    this.selectComponent('#editor').open({ id: e.detail.id }).then(saved => {
      if (saved) this.onShow();
    });
  },
  onRowDel(e) {
    store.delTask(e.detail.id);
    this.onShow();
  }
});
