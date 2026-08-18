/**
 * Monaco 编辑器原生右键菜单 —— shadcn 视觉化覆盖样式
 *
 * 【前置条件:关闭 Monaco Shadow DOM】
 * Monaco 默认 useShadowDOM: true,编辑器(含右键菜单)渲染在 Shadow DOM 内,
 * 应用 CSS 无法穿透 shadow 边界。因此必须在 CodeEditor 的 options 中设置
 * useShadowDOM: false,菜单才会挂载到普通 DOM,本模块注入的样式才能生效。
 *
 * 【为何需要动态注入 <style>】
 * Monaco 从 CDN 加载,其内置菜单 CSS 通过 Monaco 内部 `document.head.appendChild`
 * 在编辑器 mount 时注入,时序晚于应用的 globals.css。即使 globals.css 选择器命中,
 * 也会被 Monaco CSS 后写覆盖无效。本模块在 Monaco mount 后再注入一个专用
 * `<style id="qraft-monaco-menu-override">`,确保覆盖 Monaco 内置样式生效。
 *
 * 【Monaco 真实菜单 DOM】(依据 node_modules/monaco-editor/esm/vs/base/browser/ui/menu/menu.js
 * getMenuWidgetCSS 与 BaseMenuActionViewItem.render):
 * <div class="context-view monaco-menu-container">  ← 容器(双类名,fixed 定位,挂 body)
 *   <div class="monaco-menu">                       ← 面板根
 *     <div class="monaco-action-bar vertical">
 *       <ul class="actions-container">
 *         <li class="action-item">                  ← 菜单项容器(选中态内联样式写在此处)
 *           <a class="action-menu-item">            ← 菜单项主体(flex,24px 高)
 *             <span class="menu-item-check"></span>
 *             <span class="action-label">菜单文字</span>
 *             <span class="keybinding">Ctrl+C</span>
 *             <span class="submenu-indicator codicon"></span>
 *           </a>
 *         </li>
 *         <li class="action-item">
 *           <a class="action-menu-item action-label separator">  ← 分隔线
 *         </li>
 *       </ul>
 *     </div>
 *   </div>
 * </div>
 *
 * 【重要:选中态是 JS 内联样式】
 * Monaco 的 applyStyle() 在 focus/blur 时用 element.style 直接把
 * backgroundColor / color 写到 li.action-item 上(非 CSS 规则),
 * 因此必须用 !important 且命中 li.action-item(.focused) 才能覆盖。
 */

/** 注入到 <head> 的 <style> id,避免重复注入 */
const STYLE_ID = 'qraft-monaco-menu-override';

/** Monaco 菜单 shadcn 化覆盖 CSS */
const MENU_OVERRIDE_CSS = `
/* ========== 容器 .context-view.monaco-menu-container ========== */
.context-view.monaco-menu-container {
  border-radius: var(--radius-md) !important;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.16) !important;
  z-index: 60 !important;
  overflow: hidden !important;
}

/* ========== 面板根 .monaco-menu ========== */
.monaco-menu {
  background-color: var(--bg-popover-layer) !important;
  color: var(--popover-foreground) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-md) !important;
  padding: 4px !important;
  font-size: 13px !important;
  min-width: 160px !important;
}

/* ========== 菜单项容器 li.action-item ==========
 * 选中态内联样式写在 li 上,这里统一覆盖 hover / focused 背景
 */
.monaco-menu .monaco-action-bar.vertical .action-item:hover,
.monaco-menu .monaco-action-bar.vertical .action-item.focused {
  /* 圆角矩形(对齐 ContextMenuItem rounded-sm) */
  border-radius: var(--radius-sm) !important;
  /* 覆盖 Monaco JS 内联样式写入的背景色 */
  background-color: var(--accent) !important;
  color: var(--accent-foreground) !important;
  outline: none !important;
}

/* ========== 菜单项主体 a.action-menu-item ========== */
.monaco-menu .monaco-action-bar.vertical .action-menu-item {
  border-radius: var(--radius-sm) !important;
  margin: 1px 0 !important;
  height: 28px !important;
  padding: 0 12px !important;
  color: var(--popover-foreground) !important;
  font-size: 13px !important;
}

/* hover / focused 时内部文字颜色跟随 accent-foreground */
.monaco-menu .monaco-action-bar.vertical .action-item:hover .action-menu-item,
.monaco-menu .monaco-action-bar.vertical .action-item.focused .action-menu-item {
  color: var(--accent-foreground) !important;
  background: transparent !important;
}

/* ========== 菜单项内文本 span.action-label ========== */
.monaco-menu .monaco-action-bar.vertical .action-label {
  font-size: 13px !important;
  padding: 0 !important;
  background: transparent !important;
}

/* ========== 快捷键 span.keybinding ========== */
.monaco-menu .monaco-action-bar.vertical .keybinding {
  color: var(--muted-foreground) !important;
  font-size: 12px !important;
  opacity: 0.9 !important;
  padding: 0 0 0 24px !important;
}

/* hover / focused 时快捷键跟随 accent-foreground */
.monaco-menu .monaco-action-bar.vertical .action-item:hover .keybinding,
.monaco-menu .monaco-action-bar.vertical .action-item.focused .keybinding {
  color: var(--accent-foreground) !important;
}

/* ========== 子菜单箭头 ========== */
.monaco-menu .monaco-action-bar.vertical .submenu-indicator {
  color: var(--muted-foreground) !important;
}

/* ========== 禁用项 ========== */
.monaco-menu .monaco-action-bar.vertical .action-item.disabled,
.monaco-menu .monaco-action-bar.vertical .action-item.disabled .action-menu-item {
  opacity: 0.5 !important;
  cursor: default !important;
  background-color: transparent !important;
  color: var(--muted-foreground) !important;
}

/* ========== 分隔线(a.action-menu-item.separator) ========== */
.monaco-menu .monaco-action-bar.vertical .action-label.separator {
  border-bottom: 1px solid var(--border) !important;
  margin: 4px 8px !important;
  padding: 0 !important;
  height: 0 !important;
  pointer-events: none !important;
  background-color: transparent !important;
}

/* ========== 文本型分隔线(菜单分组标题) ========== */
.monaco-menu .monaco-action-bar.vertical .action-label.separator.text {
  color: var(--muted-foreground) !important;
  font-weight: 600 !important;
  border-bottom: none !important;
  margin: 2px 0 !important;
  padding: 0.3em 12px !important;
  height: auto !important;
}
`;

/**
 * 注入 Monaco 菜单 shadcn 化覆盖样式到 <head>。
 *
 * 幂等:重复调用无副作用(已存在则跳过注入)。
 * 应在 Monaco 编辑器 mount 之后调用,确保 Monaco CSS 已加载完毕。
 */
export function injectMonacoMenuStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MENU_OVERRIDE_CSS;
  document.head.appendChild(style);
}
