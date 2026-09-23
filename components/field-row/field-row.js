/* 字段行。四种形态合一，避免为每个设置项各写一遍：
     type=tap     → 可点，右侧显示值 + 箭头
     type=switch  → 右侧开关
     type=text    → 只读展示（如「免打扰时段 · 即将上线」）
     type=button  → 整行是一个动作按钮（如「注销并删除全部数据」） */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    type: { type: String, value: 'tap' },
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    icon: { type: String, value: '' },
    sw: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    danger: { type: Boolean, value: false },
    disabledTip: { type: String, value: '即将上线' }
  },
  methods: {
    onTap() {
      if (this.data.disabled) return;
      this.triggerEvent('tap');
    },
    onSwitch() {
      if (this.data.disabled) return;
      this.triggerEvent('switch', { value: !this.data.sw });
    }
  }
});
