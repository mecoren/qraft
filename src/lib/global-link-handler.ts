/**
 * 全局 Ctrl/Cmd+点击链接处理
 *
 * 捕获阶段处理,优先于 React/Monaco 之外的点击代理;仅拦截 http/https
 * 且非下载链接,普通点击完全保持原行为。
 */

import { openExternal } from './open-external';

export function installGlobalLinkHandler(): () => void {
  const handler = (event: MouseEvent): void => {
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    if (!event.ctrlKey && !event.metaKey) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.download) return;

    // 取原始 href,而非解析后的 anchor.href:
    // - 页面内锚点(#foo)经解析会带上当前页 origin,会被误判成外部链接
    // - 保留用户书写的原样链接,不做多余规范化(与 markdown-preview-pane 一致)
    const href = anchor.getAttribute('href')?.trim();
    if (!href || href.startsWith('#')) return;
    // 仅接管绝对 http/https 链接;相对路径交给应用内路由处理
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return;

    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    event.preventDefault();
    event.stopPropagation();
    void openExternal(href);
  };

  window.addEventListener('click', handler, true);
  return () => window.removeEventListener('click', handler, true);
}
