/* 分段控件。滑块位置用 CSS 计算，不做 DOM 测量——四个分段等宽，
   translateX(index * 100%) 正好移动 index 个自身宽度。 */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    items: { type: Array, value: [] },          /* [{key,label}] */
    value: { type: String, value: '' }
  },
  data: { thumbStyle: '' },
  observers: {
    'items, value'(items, value) {
      const n = (items && items.length) || 1;
      const i = Math.max(0, (items || []).findIndex(x => x.key === value));
      this.setData({
        thumbStyle: 'width:calc((100% - 12rpx)/' + n + ');transform:translateX(' + (i * 100) + '%)'
      });
    }
  },
  methods: {
    onTap(e) {
      const k = e.currentTarget.dataset.k;
      if (k === this.data.value) return;
      this.triggerEvent('change', { value: k });
    }
  }
});
