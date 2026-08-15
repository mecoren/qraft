/**
 * 本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openTextFileDialog`:弹出系统打开对话框,返回 `{ path, content }` 或 null(取消)。
 *   Rust 端 `fs_open_dialog` 已把所选路径加入授权集合,后续可直接 `fs_write_file`。
 * - `saveToPath`:直接覆盖写回已授权路径(`fs_write_file`)。
 * - `saveWithDialog`:弹「另存为」对话框(`fs_save_bytes`),保存后路径同样被授权。
 * - `encodeTextToBase64`:文本 → UTF-8 base64(`fs_save_bytes` 的输入格式)。
 */
import { bytesToBase64 } from '@/lib/file-utils';
import { invokeCommand, safeInvoke } from '@/lib/ipc';

export interface OpenFileResult {
  path: string;
  content: string;
}

/** 通知后端:前端已加载完成,可拦截窗口关闭并询问未保存内容 */
export async function windowCloseReady(): Promise<void> {
  await safeInvoke('window_close_ready');
}

/** 通知后端:用户取消退出,复位关闭确认流程(下次关闭可再次确认) */
export async function windowCloseCancel(): Promise<void> {
  await safeInvoke('window_close_cancel');
}

/** 弹出打开对话框选择单个文本文件;用户取消返回 null */
export async function openTextFileDialog(): Promise<OpenFileResult | null> {
  return invokeCommand<OpenFileResult | null>('fs_open_dialog', {});
}

/** 直接覆盖写入已授权路径;成功返回 true,失败抛 CommandError */
export async function saveToPath(path: string, content: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_write_file', { path, content });
  return true;
}

/** 在系统文件管理器中定位指定文件;成功返回 true,失败抛 CommandError */
export async function revealInExplorer(path: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_reveal_in_explorer', { path });
  return true;
}

/** 弹「另存为」对话框并写入;用户取消返回 null,成功返回保存路径 */
export async function saveWithDialog(
  fileName: string,
  content: string,
): Promise<string | null> {
  const base64 = encodeTextToBase64(content);
  const path = await invokeCommand<string | null>('fs_save_bytes', {
    fileName,
    base64,
    mime: 'text/plain',
  });
  return path;
}

/** 文本 → UTF-8 base64(兼容中文/emoji) */
export function encodeTextToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
