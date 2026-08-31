/**
 * 全局 title 悬停提示接管 —— 统一为查找组件同款自绘浮层
 *
 * 背景:应用内大量控件使用原生 DOM title 属性(窗口控制按钮、Markdown
 * 格式工具栏、编辑器状态栏、截断文本等),浏览器原生提示样式与查找组件
 * (Ctrl+F)的自绘浮层(见 monaco-find-close-tooltip)不一致。
 *
 * 方案:在 document 上捕获阶段委托 mouseover/mouseout ——
 * - 进入带 title 的元素:移除 title(浏览器原生提示不再出现),用共享层
 *   (hint-tooltip-layer)展示统一样式浮层;
 * - 离开元素:浮层移除,并把 title 原样还原 —— React 后续渲染以 JSX 声明
 *   为准,还原可避免 DOM 与虚拟 DOM 漂移,同时保留无障碍名称;
 * - 悬停源被移出 DOM(如关闭 Tab)时没有 mouseout 可依赖,
 *   由 MutationObserver 兜底收起浮层。
 *
 * 与查找组件模块的分工:`.find-widget` 内控件由其专属模块接管(还需要
 * stopImmediatePropagation 抑制 Monaco HoverService),全局层跳过该子树,
 * 避免双重浮层;全局层本身不阻断事件传播。
 */
import { createHintLayer } from './hint-tooltip-layer';

/** 浮层标记属性:全局提示浮层的孤儿清扫依据 */
const TITLE_HINT_MARKER = 'data-title-hint';

export interface GlobalTitleTooltipHandle {
  dispose(): void;
}

export function attachGlobalTitleTooltip(): GlobalTitleTooltipHandle {
  let hintEl: HTMLDivElement | null = null;
  let sourceEl: HTMLElement | null = null;
  let sourceTitle: string | null = null;

  function hideHint(): void {
    // 离开时还原 title:React diff 仍以 JSX 声明为准,还原避免 DOM 漂移;
    // 仅在值确实变化时写回,防止无意义的 attribute mutation
    if (sourceEl && sourceTitle !== null && sourceEl.getAttribute('title') !== sourceTitle) {
      sourceEl.setAttribute('title', sourceTitle);
    }
    hintEl?.remove();
    hintEl = null;
    sourceEl = null;
    sourceTitle = null;
  }

  const onMouseOver = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>('[title]');
    if (!el) return;
    // 查找组件由 monaco-find-close-tooltip 专属接管(含 Monaco hover 抑制),
    // 此处跳过避免双重浮层与 title 争夺
    if (el.closest('.find-widget')) return;
    const title = el.getAttribute('title');
    if (!title) return; // 空 title 无提示意义
    // 在源元素内部的子节点间移动:浮层保持,不重复创建
    if (hintEl && sourceEl === el) return;
    hideHint();
    // 悬停期间移除 title:浏览器原生提示被抑制,由统一浮层接管;
    // 传入鼠标坐标让浮层横向跟随鼠标、贴近底边时自动向上翻转
    el.removeAttribute('title');
    sourceEl = el;
    sourceTitle = title;
    hintEl = createHintLayer(
      el,
      title,
      TITLE_HINT_MARKER,
      e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : undefined,
    );
  };

  const onMouseOut = (e: MouseEvent): void => {
    if (!sourceEl) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // 只关心离开源元素(或其子节点)的 mouseout;无关元素的离开不收起浮层
    if (target !== sourceEl && !sourceEl.contains(target)) return;
    const next = e.relatedTarget;
    if (next instanceof Node && sourceEl.contains(next)) return;
    hideHint();
  };

  // 兜底:悬停源被移出 DOM(关闭 Tab/重建列表)时没有 mouseout 可依赖,
  // 强制收起浮层。回调仅做一次 isConnected 判断,Monaco 高频 DOM 变更下开销可忽略
  const observer = new MutationObserver(() => {
    if (sourceEl && !sourceEl.isConnected) {
      hintEl?.remove();
      hintEl = null;
      sourceEl = null;
      sourceTitle = null;
    }
  });

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  observer.observe(document.body, { childList: true, subtree: true });
  // 清扫热更新等异常路径遗留在 body 上的孤儿浮层
  document.body
    .querySelectorAll<HTMLElement>(`[${TITLE_HINT_MARKER}]`)
    .forEach((el) => el.remove());

  return {
    dispose(): void {
      observer.disconnect();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      hideHint();
    },
  };
}
