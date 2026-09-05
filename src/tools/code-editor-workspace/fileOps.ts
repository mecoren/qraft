/**
 * 本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openTextFileDialog`:弹出系统打开对话框,返回 `OpenDialogOutcome`:
 *   成功 `{ file }` / 取消 `null` / 二进制或过大 `{ failed }`(前端展示
 *   「仍要打开」,VSCode Open Anyway 语义)。
 * - `openFolderDialog`:弹出「打开文件夹」对话框,返回目录根路径或 null(取消)。
 *   所选目录加入授权集合,其子树内文件可读写/枚举。
 * - `readDirectory`:枚举已授权目录的子项(目录在前、名称不分大小写升序)。
 * - `readTextFileEncoded`:读取文本并自动探测编码;二进制抛
 *   code=`ERR_FILE_UNSUPPORTED` 的 CommandError,超大抛 `ERR_FILE_TOO_LARGE`,
 *   均可经 `forceOpenFile` 强制打开(按探测编码有损解码)。
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

/** 打开失败的可恢复原因(`OpenFileFailure.reason` 字段值) */
export const OPEN_REASON_BINARY = 'binary' as const;
export const OPEN_REASON_TOO_LARGE = 'too-large' as const;

/**
 * 打开文件对话框 / 文件树读取的失败载荷。
 * - `binary`:二进制启发式命中,可用 `forceOpenFile` 强制按探测编码打开
 * - `too-large`:超过编辑器大小上限,不可恢复
 */
export interface OpenFileFailure {
  path: string;
  reason: typeof OPEN_REASON_BINARY | typeof OPEN_REASON_TOO_LARGE;
  /** 文件大小(字节;too-large 时后端附带)
   *  `binary` 时为 null,序列化时省略 */
  size?: number | null;
}

/** 打开对话框结果:成功(file)、失败(failed)二选一;取消返回 null */
export interface OpenDialogOutcome {
  file?: OpenFileResult | null;
  failed?: OpenFileFailure | null;
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
  /** 探测到的编码标识(Rust 端附带;省略时按 UTF-8 处理) */
  encoding?: string;
}

/** 拖放/打开失败的载荷(Rust `OpenFileUnsupported` 事件的 serde 形态) */
export interface OpenFileUnsupportedPayload {
  kind: 'unsupported' | 'too-large' | 'error';
  /** kind=unsupported / too-large 时为文件完整路径 */
  path?: string;
  /** kind=error 时为错误消息 */
  message?: string;
}

/** 通知后端:前端已加载完成,可拦截窗口关闭以冲刷工作区缓存 */
export async function windowCloseReady(): Promise<void> {
  await safeInvoke('window_close_ready');
}

/** 弹出打开文件对话框;取消返回 null,成功返回 `{ file }`,二进制/过大返回 `{ failed }` */
export async function openTextFileDialog(): Promise<OpenDialogOutcome | null> {
  return invokeCommand<OpenDialogOutcome | null>('fs_open_dialog', {});
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
 * 读取文本文件并探测编码(编辑器打开文件的推荐入口)。
 * GB18030/Big5/Shift-JIS 等编码自动解码;二进制内容抛
 * CommandError(code=`ERR_FILE_UNSUPPORTED`),超大文件抛
 * `ERR_FILE_TOO_LARGE`。返回内容 + 编码标识。
 *
 * `encoding` 提供时跳过探测,直接按该编码解码(VSCode「通过编码重新打开」);
 * 编码不受支持时后端抛 CommandError(ERR_FILE_UNSUPPORTED)。
 */
export async function readTextFileEncoded(
  path: string,
  encoding?: string,
): Promise<OpenFileResult> {
  const result = await invokeCommand<{ content: string; encoding: string }>(
    'fs_read_text_file_encoded',
    { path, encoding: encoding ?? null },
  );
  return { path, content: result.content, encoding: result.encoding };
}

/**
 * 强制以文本打开文件(VSCode「仍要打开」):跳过二进制启发式,
 * 按探测编码有损解码;仍受大小上限约束(超大抛 `ERR_FILE_TOO_LARGE`)。
 */
export async function forceOpenFile(path: string): Promise<OpenFileResult> {
  const result = await invokeCommand<{ content: string; encoding: string }>(
    'fs_read_text_file_encoded',
    { path, encoding: null, force: true },
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

/**
 * 弹「另存为」对话框并按指定编码写入(untitled Tab「通过编码保存」使用)。
 * utf-8-bom 自动补 BOM;用户取消返回 null,成功返回保存路径(已授权)。
 */
export async function saveWithDialogEncoded(
  fileName: string,
  content: string,
  encoding: string,
): Promise<string | null> {
  return invokeCommand<string | null>('fs_save_text_file_encoded', {
    fileName,
    content,
    encoding,
  });
}

/** 文本 → UTF-8 base64(兼容中文/emoji) */
export function encodeTextToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
