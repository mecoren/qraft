/**
 * 打开外部链接(带降级)
 *
 * 仅允许 http/https。Tauri 环境经 app_open_external 命令复用后端校验;
 * 浏览器环境用 window.open。
 */

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<boolean> {
  if (!isHttpUrl(url)) return false;
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { invokeCommand } = await import('./ipc');
      await invokeCommand('app_open_external', { url });
      return true;
    } catch {
      return false;
    }
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
