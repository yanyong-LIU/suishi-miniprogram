/* 居中确认框。比 wx.showModal 多两件事：
     1. 可内嵌一个开关（订阅消息授权时勾选「总是保持以上选择」）
     2. 按钮数量与文案可控（一周起始日、字号这类三选一）
   对外只暴露 open(opts) → Promise<{ index, switchValue }>，index=-1 表示取消。 */
'use strict';
const PF = require('../../utils/platform.js');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    show: false, title: '', desc: '', actions: [], danger: false,
    showCancel: true, disabled: false,
    showSwitch: false, switchLabel: '', switchSub: '', switchValue: false
  },
  methods: {
    open(opt) {
      opt = opt || {};
      const acts = opt.actions || ['取消', '确定'];
      /* 灰色「取消」只补在「单一主按钮型」的框下面 —— 一颗主按钮、没有别的退路，
         才需要它在底下兜一颗取消（《碎事清单-UI设计方案.md》3.15 的注销确认弹层
         就是这种形状：一颗 danger 主按钮 + 居中的灰字取消）。
         按钮行里只要不止一颗按钮，左键本身就承担了「取消 / 再想想」这类退路，
         再补一颗灰字「取消」就是把同一件事说两遍。
         选项列表型（同文档 3.9「删除重复任务」四选一）走的是 action-sheet，
         由它自带的 .ascancel 兜底，与本组件无关。
         历史 bug：本组件曾以「actions 里有没有字面『取消』」判断，于是「注销」
         写成 actions:['再想想','删除全部']（不含字面「取消」）时，底下多挂了
         一颗灰字取消；而「清除本地缓存」写成 ['取消','清除'] 时又会少挂 ——
         同一个规则在两种写法上给出相反的答案，说明判据本身就选错了。 */
      const needCancel = opt.cancel !== false && acts.length === 1;
      /* 居中对框用 'dim' 而不是 'hide'：它不贴底、不占 TabBar 那 100rpx，
         摘掉反而让底部**凭空少一条**，看着像故障。原型里 TabBar 也从未消失 ——
         .tabbar(z-index 10) 在 #dlgLayer(z-index 70) 之下，只是被遮罩罩暗了。
         小程序侧原生 TabBar 盖不住，就让它自己压一层同色暗罩（custom-tab-bar 的
         .tbdim），那一层同时吃掉点击，所以「遮罩期间点到 TabBar 把页面切走」
         也一并堵住。

         open() 必须幂等：overlayTab 按嵌套深度计数，已在显示时重入 open
         （连点两下触发行）会把深度推到 2，用户关一次回不到 0，
         TabBar 就永远回不来了 —— 详见 editor-sheet 的同款守卫。 */
      if (!this.data.show) PF.overlayTab(true, 'dim');
      return new Promise(resolve => {
        this._resolve = resolve;
        this.setData({
          show: true,
          title: opt.title || '',
          desc: opt.desc || '',
          actions: acts,
          danger: !!opt.danger,
          showCancel: needCancel,
          disabled: !!opt.disabled,
          showSwitch: !!opt.showSwitch,
          switchLabel: opt.switchLabel || '',
          switchSub: opt.switchSub || '',
          switchValue: !!opt.switchValue
        });
      });
    },
    close(result) {
      /* 幂等，理由同 action-sheet：overlayTab 按嵌套深度计数 */
      if (!this.data.show) return;
      this.setData({ show: false });
      PF.overlayTab(false, 'dim');
      const fn = this._resolve;
      this._resolve = null;
      if (fn) setTimeout(() => fn(result), 200);
    },
    onPick(e) {
      const i = e.currentTarget.dataset.i;
      if (this.data.disabled && i === this.data.actions.length - 1) return;
      this.close({ index: i, switchValue: this.data.switchValue });
    },
    onCancel() { this.close({ index: -1, switchValue: this.data.switchValue }); },
    onToggleSwitch() { this.setData({ switchValue: !this.data.switchValue }); },
    noop() { /* 阻止点击面板穿透到遮罩 */ }
  }
});
