/* 二级页顶部导航。小程序自带导航栏无法承载「大号衬线标题」的设计，
   故全局 navigationStyle:custom，由本组件统一处理状态栏占位。
   ------------------------------------------------------------
   右上角胶囊按钮（●●●/◉）是原生组件，层级高于一切，页面内容
   不能与它同高。这里按 wx.getMenuButtonBoundingClientRect() 实测：
   状态栏之下、胶囊上下留白对称地展开出整条导航行高（navRow），
   spacer-only（tab 页）垫到胶囊下沿，导航模式（二级页）的返回行
   与胶囊垂直对齐 —— 所有内容都从胶囊下方开始，不被遮挡。 */
'use strict';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    backText: { type: String, value: '返回' },
    rightText: { type: String, value: '' },
    /* 只做状态栏+胶囊区占位、不显示导航（tab 页用） */
    spacerOnly: { type: Boolean, value: false }
  },
  data: { statusBarHeight: 20, navRow: 44 },
  lifetimes: {
    attached() {
      try {
        const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = w.statusBarHeight || 20;
        let navRow = 44;
        try {
          const m = wx.getMenuButtonBoundingClientRect
            ? wx.getMenuButtonBoundingClientRect() : null;
          if (m && m.height && m.top >= statusBarHeight) {
            const gap = m.top - statusBarHeight;   /* 状态栏到胶囊上沿 */
            navRow = m.height + gap * 2;           /* 上下等距 → 整条导航行高 */
          }
        } catch (e2) { /* 取不到胶囊就用 44px 惯例值 */ }
        this.setData({ statusBarHeight, navRow });
      } catch (e) { /* 保底 20 + 44 */ }
    }
  },
  methods: {
    onBack() { this.triggerEvent('back'); },
    onRight() { this.triggerEvent('right'); }
  }
});
