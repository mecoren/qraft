/**
 * Monaco 查找组件悬停提示 —— 应用内自绘(统一样式)
 *
 * 背景(运行时探针实证):查找组件内按钮没有原生 title(Monaco 0.56 只设置
 * 本地化 aria-label),可见提示来自 Monaco 自家的 HoverService 浮层
 * (.context-view > .monaco-hover)。它在窗口右上角边缘会被裁剪,
 * 还会覆盖按钮自身导致后续交互受阻。
 *
 * 方案:在编辑器根节点用捕获阶段的委托监听 mouseover/mouseout ——
 * 捕获阶段先于目标阶段,stopImmediatePropagation() 可以让 Monaco
 * 后挂的同事件监听完全收不到事件,从而抑制它的 hover;随后用我们
 * 自己的浮层(anchor 到控件下方、右侧空间不足向内翻转)展示文案。
 * 覆盖查找组件内全部可悬停控件(箭头/替换展开/大小写·全词·正则开关/
 * 关闭按钮等),保证同一组件内提示样式统一。文案来源:title 优先,
 * 缺失时回落到 aria-label。输入框本体不参与(聚焦元素不该弹提示)。
 */

/**
 * 查找组件内需要统一自绘提示的控件选择器。
 * 仅匹配带 aria-label/title 的 button 与 role=button/checkbox 控件;
 * 搜索/替换输入框不匹配 —— 文本输入聚焦时弹提示只会造成干扰。
 */
const HINTABLE_SELECTOR = [
  '.find-widget button[aria-label]',
  '.find-widget button[title]',
  '.find-widget [role="button"][aria-label]',
  '.find-widget [role="checkbox"][aria-label]',
].join(', ');
/** 文案缓存用的 data 属性名 */
const HINT_TEXT_ATTR = 'findHintText';
/** 浮层预估最大宽度(px):测量前决定是否向内翻转 */
const ESTIMATED_MAX_WIDTH = 200;
/** 浮层与按钮的间距(px) */
const GAP = 6;
/** 视口最小留白(px),保证浮层不贴死窗口边缘 */
const VIEWPORT_PADDING = 8;

export interface FindCloseTooltipHandle {
  dispose(): void;
}

export function attachFindCloseTooltip(root: HTMLElement): FindCloseTooltipHandle {
  let hintEl: HTMLDivElement | null = null;
  let sourceBtn: HTMLElement | null = null;

  function hideHint(): void {
    hintEl?.remove();
    hintEl = null;
    sourceBtn = null;
  }

  function showHint(btn: HTMLElement): void {
    const text = btn.dataset[HINT_TEXT_ATTR];
    if (!text) return;
    hideHint();

    const rect = btn.getBoundingClientRect();
    const viewportW = document.documentElement.clientWidth || window.innerWidth;
    // 翻转判定用常量而非实测宽度(测试环境无布局,真实文案较短也足够准)
    let left = rect.left - GAP;
    if (left + ESTIMATED_MAX_WIDTH > viewportW - VIEWPORT_PADDING) {
      // 右侧放不下:向内翻转到按钮左侧,并钳制不越过左缘
      left = Math.max(VIEWPORT_PADDING, rect.left - GAP - ESTIMATED_MAX_WIDTH);
    }

    const hint = document.createElement('div');
    hint.dataset.findCloseHint = '';
    hint.textContent = text;
    hint.className =
      'pointer-events-none fixed rounded-md border bg-popover-layer px-3 py-1.5 ' +
      'text-xs text-popover-foreground shadow-md';
    hint.style.zIndex = '10000';
    hint.style.top = `${rect.bottom + GAP}px`;
    hint.style.left = `${left}px`;
    document.body.appendChild(hint);
    // 追加后实测宽度做二次钳制,把浮层完整收回视口内
    const maxLeft = viewportW - hint.offsetWidth - VIEWPORT_PADDING;
    if (left > maxLeft) {
      hint.style.left = `${Math.max(VIEWPORT_PADDING, maxLeft)}px`;
    }
    hintEl = hint;
    sourceBtn = btn;
  }

  /** 文案入缓存并保证控件始终留在匹配集内:
   * 移除 title 防原生 hover 回归;若按钮原本没有 aria-label,
   * 用 title 原文补齐 —— 否则该控件会从 "[aria-label]/[title]" 选择器
   * 中掉出去(真实事故:悬停切换后提示不再更新),且丧失可访问名称。 */
  function sanitizeButton(btn: HTMLElement): void {
    const title = btn.getAttribute('title');
    if (title !== null) {
      btn.removeAttribute('title');
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', title);
    }
    const text = btn.getAttribute('aria-label') ?? title;
    if (text) btn.dataset[HINT_TEXT_ATTR] = text;
  }

  function sanitize(): void {
    root.querySelectorAll<HTMLElement>(HINTABLE_SELECTOR).forEach(sanitizeButton);
    // 悬停源若已被移出文档(查找组件关闭/重建),同步收起浮层
    if (sourceBtn && !sourceBtn.isConnected) hideHint();
  }

  // 委托到捕获阶段:hover 进入按钮即显示浮层并抑制 Monaco 自家 hover,
  // 离开即收起。即便 Monaco 克隆/重建按钮节点,委托也天然生效。
  const onMouseOver = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>(HINTABLE_SELECTOR);
    if (!btn) return;
    // 捕获阶段拦截:Monaco 的 HoverService 监听同一批悬停事件,
    // 不拦下就会出现第二个浮层并被窗口边缘裁剪(原始问题)
    e.stopImmediatePropagation();
    e.preventDefault();
    sanitizeButton(btn);
    showHint(btn);
  };
  const onMouseOut = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(HINTABLE_SELECTOR)) return;
    // 与 enter 对称地吞掉离开事件,避免 Monaco 收到残留信号重建浮层
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!sourceBtn) return;
    const next = e.relatedTarget;
    if (next instanceof Element && sourceBtn.contains(next)) return;
    hideHint();
  };
  root.addEventListener('mouseover', onMouseOver, true);
  root.addEventListener('mouseout', onMouseOut, true);

  // 监听子树新增节点:Monaco 可能在按键绑定更新时重设 title/重建按钮
  const observer = new MutationObserver(sanitize);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  // 补偿观察建立前就已渲染好的查找组件;同时清扫 body 上可能遗留的
  // 孤儿浮层(热更新等异常路径可能只留下 DOM 而失去管理句柄)
  document.body.querySelectorAll<HTMLElement>('[data-find-close-hint]').forEach((el) => el.remove());
  sanitize();

  return {
    dispose(): void {
      observer.disconnect();
      root.removeEventListener('mouseover', onMouseOver, true);
      root.removeEventListener('mouseout', onMouseOut, true);
      hideHint();
    },
  };
}
