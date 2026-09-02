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
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.href || anchor.download) return;

    let url: URL;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    event.preventDefault();
    event.stopPropagation();
    void openExternal(url.toString());
  };

  window.addEventListener('click', handler, true);
  return () => window.removeEventListener('click', handler, true);
}
