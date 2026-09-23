/* 顶部提示条。四种语义：danger(额度用尽) / warning(额度告急·未授权)
   / normal(离线) / info。关闭后 24 小时内不再出现（由调用方判定）。 */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    kind: { type: String, value: 'info' },      /* danger | warning | normal | info */
    text: { type: String, value: '' },
    action: { type: String, value: '' },
    code: { type: String, value: '' }
  },
  data: { icon: 'info' },
  observers: {
    kind(k) {
      this.setData({ icon: k === 'danger' ? 'warn' : k === 'normal' ? 'wifi' : 'info' });
    }
  },
  methods: {
    onAct() { this.triggerEvent('act', { code: this.data.code }); },
    onClose() { this.triggerEvent('close', { code: this.data.code }); }
  }
});
