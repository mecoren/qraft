/**
 * 统一悬停提示浮层 —— 应用内所有 tooltip 的唯一样式来源
 *
 * 样式基准:Monaco 查找组件(Ctrl+F)按钮的自绘提示
 * (rounded-md border bg-popover-layer px-3 py-1.5 text-xs shadow-md,无动画)。
 * 查找组件专属模块(monaco-find-close-tooltip)与全局 title 接管模块
 * (global-title-tooltip)共同复用本文件,保证两处浮层永不分化。
 */

/** 浮层与锚点控件的间距(px) */
export const HINT_GAP = 6;
/** 浮层预估最大宽度(px):测量前决定是否向内翻转 */
const ESTIMATED_MAX_WIDTH = 200;
/** 浮层预估高度(px):底部翻转判定(测量前,px-3 py-1.5 text-xs 实测约 32~36) */
const ESTIMATED_HEIGHT = 36;
/** 视口最小留白(px),保证浮层不贴死窗口边缘 */
const VIEWPORT_PADDING = 8;
/**
 * 浮层 z-index:取浏览器安全范围内的极大值,确保悬停在任意浮层
 * (编辑器 Tab 栏、Monaco 自绘 widget、滚动容器的合成层等)之上。
 * 之前用 10000,在部分布局下会被更高层遮住;提升到该级别后,
 * 只要浮层 append 到 document.body,即恒为页面最顶层。
 */
const HINT_Z_INDEX = 2147483000;

/** 统一浮层样式:与查找组件提示完全一致。
 *  背景用实心 bg-popover 而非分层的 bg-popover-layer(95% 半透明):
 *  tooltip 会浮在窗口任意位置(含标题栏等 Mica 透出区),半透明背景
 *  在这些区域会显形为透明,实心才能保证可读性。
 *  阴影不用 shadow-md utility:该 utility 在本应用解析为全透明
 *  (Tailwind v4 已知问题),真实阴影由 createHintLayer 内联
 *  var(--shadow-card-hover) 提供,与 .md-fn-popover 同源。 */
export const HINT_LAYER_CLASS =
  'pointer-events-none fixed rounded-md border bg-popover px-3 py-1.5 ' +
  'text-xs text-popover-foreground';

/** 鼠标锚点:浮层横向位置跟随鼠标,纵向仍以元素矩形为基准做翻转 */
export interface HintPoint {
  x: number;
  y: number;
}

/**
 * 创建统一样式浮层,锚定在 anchor 附近并随视口空间自适应翻转:
 * - 横向:左缘优先取鼠标 x(未提供时回落到锚点左缘),右侧空间不足时向左翻转;
 * - 纵向:默认锚点下方,贴近窗口底边放不下时翻转到锚点上方,避免被底边遮挡。
 * 追加到 body 后按实测宽高二次钳制,把浮层完整收回视口内。
 */
export function createHintLayer(
  anchor: HTMLElement,
  text: string,
  markerAttr: string,
  at?: HintPoint,
): HTMLDivElement {
  const rect = anchor.getBoundingClientRect();
  const viewportW = document.documentElement.clientWidth || window.innerWidth;
  const viewportH = document.documentElement.clientHeight || window.innerHeight;

  const anchorX = at ? at.x : rect.left;
  // 横向翻转判定用常量而非实测宽度(测试环境无布局,真实文案较短也足够准);
  // 是否需翻到锚点左侧,取决于预估宽能否放在锚点右侧
  let left = anchorX + HINT_GAP;
  const placeLeft = left + ESTIMATED_MAX_WIDTH > viewportW - VIEWPORT_PADDING;
  if (placeLeft) {
    // 先按预估宽占位(测试环境无布局),追加后再按实测宽右缘贴近锚点
    left = Math.max(VIEWPORT_PADDING, anchorX - HINT_GAP - ESTIMATED_MAX_WIDTH);
  }

  // 纵向:下方空间不足(贴近窗口底边)时翻转到锚点上方
  let top = rect.bottom + HINT_GAP;
  if (top + ESTIMATED_HEIGHT > viewportH - VIEWPORT_PADDING) {
    top = Math.max(VIEWPORT_PADDING, rect.top - HINT_GAP - ESTIMATED_HEIGHT);
  }

  const hint = document.createElement('div');
  hint.setAttribute(markerAttr, '');
  hint.textContent = text;
  hint.className = HINT_LAYER_CLASS;
  hint.style.zIndex = String(HINT_Z_INDEX);
  // 真实投影:与 .md-fn-popover(应用内已有浮层)同源的阴影 token。
  // shadow-md utility 在本应用解析为全透明,深色主题下浮层会因
  // 缺乏边界而看起来"透明"(实测 popover 与背景仅差 7/255)
  hint.style.boxShadow = 'var(--shadow-card-hover)';
  document.body.appendChild(hint);
  // 追加后按实测宽高二次钳制,把浮层完整收回视口内
  if (placeLeft) {
    // 翻到左侧后:右缘贴近锚点左侧 HINT_GAP,文案按实测宽度向左展开。
    // 此前按固定 200px 占位会把"关闭/最小化"等窄文案也推得很远
    left = Math.max(VIEWPORT_PADDING, anchorX - HINT_GAP - hint.offsetWidth);
  } else {
    left = Math.max(VIEWPORT_PADDING, left);
  }
  const maxLeft = viewportW - hint.offsetWidth - VIEWPORT_PADDING;
  if (left > maxLeft) {
    left = Math.max(VIEWPORT_PADDING, maxLeft);
  }
  const maxTop = viewportH - hint.offsetHeight - VIEWPORT_PADDING;
  if (top > maxTop) {
    top = Math.max(VIEWPORT_PADDING, maxTop);
  }
  hint.style.left = `${left}px`;
  hint.style.top = `${top}px`;
  return hint;
}
