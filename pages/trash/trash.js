/* ============================================================
   最近删除
   ------------------------------------------------------------
   删除只是把状态标成 deleted，数据始终留在本机；7 天后由
   store.sweepTrash() 清理。这一点必须在页面上说明，否则用户会以为
   「删除 = 马上没了」，从而不敢删任何东西。
   ============================================================ */
'use strict';

const store = require('../../utils/store.js');
const L = require('../../utils/lunar.js');
const M = require('../../utils/model.js');

Page({
  data: {
    fontCls: 'fs-md',
    items: [],
    keepDays: M.TRASH_DAYS,
    empty: null
  },

  onShow() {
    const S = store.state;
    const f = (S.settings && S.settings.fontScale) || 1;
    const all = store.deletedTasks().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

    const items = all.map(t => {
      const d = new Date(t.deletedAt || t.dueAt);
      return {
        id: t.id,
        title: t.title,
        seriesCount: t.seriesCount || 0,
        time: (d.getMonth() + 1) + '-' + L.pad(d.getDate()) + ' ' + L.pad(d.getHours()) + ':' + L.pad(d.getMinutes()) + ' 删除'
      };
    });

    this.setData({
      fontCls: f === 1 ? 'fs-md' : f < 1.2 ? 'fs-lg' : 'fs-xl',
      items,
      empty: items.length ? null : { title: '最近删除是空的。', sub: '删掉的东西会在这里留 7 天', btn: '' }
    });
  },

  onBack() { wx.navigateBack(); },
  onEmptyBtn() { wx.switchTab({ url: '/pages/list/list' }); },

  onRestore(e) {
    const id = e.currentTarget.dataset.id;
    store.restore(id);
    this.onShow();
    wx.showToast({ title: '已恢复到清单', icon: 'none' });
  }
});
