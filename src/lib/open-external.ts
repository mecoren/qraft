/**
 * 打开外部链接(带降级)
 *
 * Tauri 环境经 plugin-shell 打开系统浏览器;浏览器环境用 window.open。
 * 两者都不可用时静默失败(返回 false)。
 */

export async function openExternal(url: string): Promise<boolean> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return true;
  } catch {
    // 非 Tauri 环境,走浏览器
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
