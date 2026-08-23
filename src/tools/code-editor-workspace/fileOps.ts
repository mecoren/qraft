/**
 * 本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openTextFileDialog`:弹出系统打开对话框,返回 `{ path, content, encoding }` 或 null(取消)。
 *   Rust 端 `fs_open_dialog` 已把所选路径加入授权集合,后续可直接 `fs_write_file`;
 *   内容按探测到的编码自动解码(UTF-8 / GB18030 / Big5 / Shift-JIS 等)。
 * - `openFolderDialog`:弹出「打开文件夹」对话框,返回目录根路径或 null(取消)。
 *   所选目录加入授权集合,其子树内文件可读写/枚举。
 * - `readDirectory`:枚举已授权目录的子项(目录在前、名称不分大小写升序)。
 * - `readTextFileEncoded`:读取文本并自动探测编码;二进制抛
 *   code=`ERR_FILE_UNSUPPORTED` 的 CommandError,前端弹「格式不支持」提示。
 * - `saveToPath`:直接覆盖写回已授权路径(`fs_write_file`,恒 UTF-8)。
 * - `saveToPathEncoded`:以指定编码写回(`fs_write_file_encoded`)。
 * - `saveWithDialog`:弹「另存为」对话框(`fs_save_bytes`),保存后路径同样被授权。
 * - `encodeTextToBase64`:文本 → UTF-8 base64(`fs_save_bytes` 的输入格式)。
 */
import { bytesToBase64 } from '@/lib/file-utils';
import { invokeCommand, safeInvoke } from '@/lib/ipc';
import { DEFAULT_ENCODING_ID } from '@/lib/text-encodings';

export interface OpenFileResult {
  path: string;
  content: string;
  /** 探测到的文件编码标识(Rust 端 detect_encoding 输出) */
  encoding?: string;
}

/** 目录条目(fs_read_dir 返回) */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 通过文件关联/命令行「用 Qraft 打开」的待打开文件 */
export interface PendingOpenFile {
  path: string;
  content: string;
}

/** 通知后端:前端已加载完成,可拦截窗口关闭以冲刷工作区缓存 */
export async function windowCloseReady(): Promise<void> {
  await safeInvoke('window_close_ready');
}

/** 弹出打开对话框选择单个文本文件;用户取消返回 null */
export async function openTextFileDialog(): Promise<OpenFileResult | null> {
  return invokeCommand<OpenFileResult | null>('fs_open_dialog', {});
}

/** 弹出「打开文件夹」对话框;用户取消返回 null,成功返回目录根路径 */
export async function openFolderDialog(): Promise<string | null> {
  const r = await invokeCommand<{ path: string } | null>('fs_open_folder_dialog', {});
  return r?.path ?? null;
}

/** 枚举已授权目录的子项(Rust 端已排序:目录在前、名称不分大小写升序) */
export async function readDirectory(path: string): Promise<DirEntry[]> {
  return invokeCommand<DirEntry[]>('fs_read_dir', { path });
}

/**
 * 读取文本文件并校验可编辑性(文件夹树点击文件时使用)。
 * 二进制 / 非 UTF-8 时抛 CommandError(code=`ERR_FILE_UNSUPPORTED`)。
 */
export async function readTextFileChecked(path: string): Promise<OpenFileResult> {
  const content = await invokeCommand<string>('fs_read_text_file_checked', { path });
  return { path, content };
}

/**
 * 读取文本文件并自动探测编码(编辑器打开文件的推荐入口)。
 * GB18030/Big5/Shift-JIS 等编码自动解码;二进制内容抛
 * CommandError(code=`ERR_FILE_UNSUPPORTED`)。返回内容 + 探测到的编码标识。
 */
export async function readTextFileEncoded(path: string): Promise<OpenFileResult> {
  const result = await invokeCommand<{ content: string; encoding: string }>(
    'fs_read_text_file_encoded',
    { path },
  );
  return { path, content: result.content, encoding: result.encoding };
}

/** 直接覆盖写入已授权路径;成功返回 true,失败抛 CommandError */
export async function saveToPath(path: string, content: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_write_file', { path, content });
  return true;
}

/** 以指定编码写回已授权路径(utf-8-bom 自动补 BOM);失败抛 CommandError */
export async function saveToPathEncoded(
  path: string,
  content: string,
  encoding: string = DEFAULT_ENCODING_ID,
): Promise<boolean> {
  await invokeCommand<boolean>('fs_write_file_encoded', { path, content, encoding });
  return true;
}

/** 在系统文件管理器中定位指定文件;成功返回 true,失败抛 CommandError */
export async function revealInExplorer(path: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_reveal_in_explorer', { path });
  return true;
}

/**
 * 拉取「通过文件关联/命令行打开」的待打开文件列表(并清空 Rust 端队列)。
 * 作为 `app:open-file` 事件在 webview 就绪前丢失时的兜底,前端初始化时调用一次。
 */
export async function pullPendingOpenFiles(): Promise<PendingOpenFile[]> {
  return invokeCommand<PendingOpenFile[]>('app_pull_open_files', {});
}

/** 弹「另存为」对话框并写入;用户取消返回 null,成功返回保存路径 */
export async function saveWithDialog(fileName: string, content: string): Promise<string | null> {
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
