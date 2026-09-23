/* 空状态。文案由调用方给出，图标固定为 note。 */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    btn: { type: String, value: '' }
  },
  methods: {
    onBtn() { this.triggerEvent('btn'); }
  }
});
