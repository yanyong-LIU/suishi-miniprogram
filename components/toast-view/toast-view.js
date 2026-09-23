/* 轻提示。支持一个内联操作（「撤销」），这是完成/删除后唯一能挽回的入口，
   所以不能退化成 wx.showToast。 */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  data: { show: false, msg: '', actionLabel: '' },
  methods: {
    showToast(opt) {
      opt = opt || {};
      clearTimeout(this._t);
      this._actionFn = opt.onAction || null;
      this._dur = opt.onAction ? 3000 : 2000;
      this.setData({ show: true, msg: opt.msg || '', actionLabel: opt.actionLabel || '' });
      this._t = setTimeout(() => this.hide(), this._dur);
    },
    hide() {
      clearTimeout(this._t);
      this.setData({ show: false });
    },
    onAction() {
      const fn = this._actionFn;
      this._actionFn = null;
      this.hide();
      if (fn) fn();
    }
  }
});
