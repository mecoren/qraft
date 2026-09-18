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
import { bytesToBase64, base64ToBytes } from '@/lib/file-utils';
import { invokeCommand, safeInvoke } from '@/lib/ipc';
import { DEFAULT_ENCODING_ID } from '@/lib/text-encodings';
import type { LargeFileMeta } from './schema';

export interface OpenFileResult {
  path: string;
  content: string;
  /** 探测到的文件编码标识(Rust 端 detect_encoding 输出) */
  encoding?: string;
  /** 文件当前 mtime(epoch 毫秒);保存时回传做外部修改校验 */
  mtimeMs?: number;
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

/** 拖放落点坐标(webview CSS 像素;Rust 端已除以 scale factor) */
export interface DropPosition {
  x: number;
  y: number;
}

/** `app:open-file` 事件载荷(Rust `OpenFilePayload`,无判别字段) */
export interface OpenFileEventPayload {
  path: string;
  content: string;
  /** 探测到的编码标识(Rust 端附带;省略时按 UTF-8 处理) */
  encoding?: string;
  /** 打开时刻的文件 mtime(epoch 毫秒;省略时前端跳过保存乐观校验) */
  mtimeMs?: number;
  /** 拖放落点(拖放入口附带;文件关联/命令行打开不携带) */
  dropPosition?: DropPosition;
}

/** 通过文件关联/命令行「用 Qraft 打开」的待打开项(Rust PendingOpenItem) */
export type PendingOpenItem =
  | {
      /** 正常打开:内容 + 编码 + mtime 基准 */
      kind: 'file';
      path: string;
      content: string;
      /** 探测到的编码标识(Rust 端附带;省略时按 UTF-8 处理) */
      encoding?: string;
      /** 打开时刻的文件 mtime(epoch 毫秒;省略时前端跳过保存乐观校验) */
      mtimeMs?: number;
    }
  | {
      /** 超限文件:切换大文件只读查看模式(fs_large_file_info 流式打开) */
      kind: 'tooLarge';
      path: string;
    }
  | {
      /** PDF 文档:切换到 PDF 工具打开(fs_read_pdf 读取);拖放入口附带落点 */
      kind: 'pdf';
      path: string;
      /** 拖放落点(拖放入口附带;命中 Monaco 编辑框时前端豁免 PDF 分流) */
      dropPosition?: DropPosition;
    }
  | {
      /** Office 文档:切换到 Office 工具打开(fs_read_office 读取);拖放入口附带落点 */
      kind: 'office';
      path: string;
      /** 拖放落点(拖放入口附带;命中 Monaco 编辑框时前端豁免 Office 分流) */
      dropPosition?: DropPosition;
    };

/** 拖放/打开失败的载荷(Rust `OpenFileUnsupported` 事件的 serde 形态) */
export interface OpenFileUnsupportedPayload {
  kind: 'unsupported' | 'too-large' | 'error' | 'pdf' | 'office';
  /** kind=unsupported / too-large / pdf / office 时为文件完整路径 */
  path?: string;
  /** kind=error 时为错误消息 */
  message?: string;
  /** kind=pdf / office 拖放入口的落点坐标(前端据此豁免「拖入 Monaco 编辑框」的分流) */
  dropPosition?: DropPosition;
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
 * 文件树新建条目(VSCode 资源管理器「新建文件 / 新建文件夹」)。
 * 目标已存在时后端抛 CommandError(code=`ERR_ALREADY_EXISTS`),
 * 不覆盖既有内容;返回创建后的完整路径。
 */
export async function createTreeEntry(path: string, isDir: boolean): Promise<string> {
  return invokeCommand<string>('fs_create_entry', { path, isDir });
}

/**
 * 文件树重命名(同目录改名或授权子树内移动)。
 * 新旧路径都必须在授权范围内;目标已存在时抛 `ERR_ALREADY_EXISTS`。
 * 返回重命名后的完整路径。
 */
export async function renameTreeEntry(oldPath: string, newPath: string): Promise<string> {
  return invokeCommand<string>('fs_rename_entry', { oldPath, newPath });
}

/**
 * 删除文件树条目(文件或**空目录**,非递归)。
 * 目录非空时抛 CommandError(code=`ERR_FILE_UNSUPPORTED`,detail 含
 * "directory not empty"),提示用户在系统资源管理器处理。
 */
export async function deleteTreeEntry(path: string): Promise<void> {
  await invokeCommand<unknown>('fs_delete_entry', { path });
}

/** 读取文件的 mtime(epoch 毫秒);供保存前刷新乐观校验基准 */
export async function fileMtimeMs(path: string): Promise<number> {
  return invokeCommand<number>('fs_file_mtime', { path });
}

/**
 * 读取文本文件并探测编码(编辑器打开文件的推荐入口)。
 * GB18030/Big5/Shift-JIS 等编码自动解码;二进制内容抛
 * CommandError(code=`ERR_FILE_UNSUPPORTED`),超大文件抛
 * `ERR_FILE_TOO_LARGE`。返回内容 + 编码标识 + 打开时刻 mtime。
 *
 * `encoding` 提供时跳过探测,直接按该编码解码(VSCode「通过编码重新打开」);
 * 编码不受支持时后端抛 CommandError(ERR_FILE_UNSUPPORTED)。
 */
export async function readTextFileEncoded(
  path: string,
  encoding?: string,
): Promise<OpenFileResult> {
  const result = await invokeCommand<{ content: string; encoding: string; mtimeMs: number }>(
    'fs_read_text_file_encoded',
    { path, encoding: encoding ?? null },
  );
  return { path, content: result.content, encoding: result.encoding, mtimeMs: result.mtimeMs };
}

/**
 * 强制以文本打开文件(VSCode「仍要打开」):跳过二进制启发式,
 * 按探测编码有损解码;仍受大小上限约束(超大抛 `ERR_FILE_TOO_LARGE`)。
 */
export async function forceOpenFile(path: string): Promise<OpenFileResult> {
  const result = await invokeCommand<{ content: string; encoding: string; mtimeMs: number }>(
    'fs_read_text_file_encoded',
    { path, encoding: null, force: true },
  );
  return { path, content: result.content, encoding: result.encoding, mtimeMs: result.mtimeMs };
}

// ============ 大文件只读查看(超过编辑器整读上限的文件)============

/** 行校准点(Rust `LineCalibrationPoint` 的 camelCase 序列化形态) */
export interface LineCalibrationPoint {
  /** 1-based 行号 */
  line: number;
  /** 该行首字节偏移(精确) */
  offset: number;
}

/** `fs_large_file_info` 返回载荷(Rust LargeFileInfo 的 camelCase 形态) */
export interface LargeFileInfoResult {
  path: string;
  size: number;
  encoding: string;
  /** lf / crlf */
  eol: string;
  lineCount: number;
  /** 行校准点(升序,首项恒为 line=1 / offset=BOM 长度) */
  calibration: LineCalibrationPoint[];
}

/** `fs_read_file_lines` 返回载荷(Rust LinesWindow 的 camelCase 形态) */
export interface LinesWindowResult {
  /** 窗口首行(1-based);目标行超出文件末尾时为 0 */
  startLine: number;
  count: number;
  lines: string[];
  /** 下一窗口精确锚点(偏移 + 行号配对) */
  nextOffset: number;
  nextLine: number;
  /** 末行因超长被截断 */
  truncated: boolean;
}

/** 行索引扫描进度事件载荷(`app:large-file-progress`) */
export interface LargeFileProgressPayload {
  path: string;
  scanned: number;
  total: number;
}

/** 全文搜索的单条命中(Rust `SearchHit` 的 camelCase 形态) */
export interface LargeFileSearchHit {
  /** 命中行号(1-based) */
  line: number;
  /** 命中行内容预览(超长截断) */
  preview: string;
}

/** 全文搜索结果(`fs_large_file_search` 返回) */
export interface LargeFileSearchResult {
  hits: LargeFileSearchHit[];
  /** 因命中数上限提前终止(前端提示「仅显示前 N 条」) */
  truncated: boolean;
}

/** 搜索进度事件载荷(`app:large-file-search-progress`) */
export interface LargeFileSearchProgressPayload {
  path: string;
  scanned: number;
  total: number;
}

/**
 * 大文件后台任务(索引扫描 / 全文搜索)的取消标识,由前端生成:
 * 后端按它登记 `CancellationToken`,故同一文件的两次任务互不误伤
 * (按路径取消会在快速重发时取消错任务)。
 */
export function newLargeFileScanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 请求取消在飞的大文件扫描 / 搜索(幂等:任务已结束或未登记时静默返回)。
 * 后端在下一个 1MB 节奏点停止读盘并回 ERR_CANCELLED。
 */
export async function cancelLargeFileScan(scanId: string): Promise<void> {
  await safeInvoke<boolean>('fs_cancel_large_file_scan', { scanId });
}

/**
 * 大文件流式全文搜索(只读视图 Ctrl+F 入口):
 * `caseSensitive` 决定匹配口径(默认 false 不敏感,与编辑器跨文件搜索一致),
 * 命中数达上限(服务端钳制)即停并在 truncated 标记。
 * 扫描期间经 `app:large-file-search-progress` 事件上报进度。
 * `scanId` 见 `newLargeFileScanId`:被新搜索取代时经 `cancelLargeFileScan` 中断。
 */
export async function largeFileSearch(
  path: string,
  needle: string,
  caseSensitive: boolean,
  scanId: string,
): Promise<LargeFileSearchResult> {
  return invokeCommand<LargeFileSearchResult>('fs_large_file_search', {
    path,
    needle,
    caseSensitive,
    scanId,
  });
}

/**
 * 大文件索引扫描:一次顺序扫描建立行校准点(10GB 文件数秒完成),
 * 期间经 `app:large-file-progress` 事件上报进度。
 * 返回元数据 + 校准点,供 LargeFileViewer 做行号 → 偏移折算与窗口读取。
 * `scanId` 用于 Tab 关闭时取消尚未完成的扫描。
 */
export async function largeFileInfo(path: string, scanId: string): Promise<LargeFileMeta> {
  const result = await invokeCommand<LargeFileInfoResult>('fs_large_file_info', {
    path,
    scanId,
  });
  return {
    size: result.size,
    encoding: result.encoding,
    eol: result.eol,
    lineCount: result.lineCount,
    calibration: result.calibration,
  };
}

/**
 * 行窗口读取(大文件滚动/跳转按需加载)。
 *
 * `anchorOffset/anchorLine` 为精确锚点(校准点或上一窗口 nextOffset/nextLine),
 * `targetLine` 为要读取的首行(1-based);后端从锚点顺序数行到目标行,
 * 行号恒精确。返回内容与下一个精确锚点(接续滚动零数行开销)。
 */
export async function readFileLines(
  path: string,
  encoding: string,
  anchorOffset: number,
  anchorLine: number,
  targetLine: number,
  maxLines: number,
): Promise<LinesWindowResult> {
  return invokeCommand<LinesWindowResult>('fs_read_file_lines', {
    path,
    encoding,
    anchorOffset,
    anchorLine,
    targetLine,
    maxLines,
  });
}

/**
 * 由校准点选取目标行的最近锚点(不超过目标行的最大校准点):
 * 跳转读取用「锚点 → 数行到目标」保证行号精确,锚点越近扫描越短。
 * 无合适校准点(目标行在首点之前)时退回首行锚点 (0, 1)。
 */
export function anchorForLine(
  calibration: ReadonlyArray<LineCalibrationPoint>,
  targetLine: number,
): { offset: number; line: number } {
  let best: LineCalibrationPoint | null = null;
  for (const point of calibration) {
    if (point.line <= targetLine) best = point;
    else break;
  }
  if (!best) return { offset: 0, line: 1 };
  return { offset: best.offset, line: best.line };
}

/** 直接覆盖写入已授权路径;成功返回 true,失败抛 CommandError */
export async function saveToPath(path: string, content: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_write_file', { path, content });
  return true;
}

/**
 * 以指定编码写回已授权路径(utf-8-bom 自动补 BOM)。
 * `expectedMtime` 提供时做乐观并发校验:磁盘文件被外部修改则抛
 * CommandError(code=`ERR_FILE_MODIFIED`,details.mtimeMs 为磁盘当前值),
 * 不写盘;缺省直接覆盖(既有语义)。成功返回 true。
 */
export async function saveToPathEncoded(
  path: string,
  content: string,
  encoding: string = DEFAULT_ENCODING_ID,
  expectedMtime?: number,
): Promise<boolean> {
  await invokeCommand<boolean>('fs_write_file_encoded', {
    path,
    content,
    encoding,
    expectedMtime: expectedMtime ?? null,
  });
  return true;
}

/** 在系统文件管理器中定位指定文件;成功返回 true,失败抛 CommandError */
export async function revealInExplorer(path: string): Promise<boolean> {
  await invokeCommand<boolean>('fs_reveal_in_explorer', { path });
  return true;
}

/**
 * 拉取「通过文件关联/命令行打开」的待打开项列表(并清空 Rust 端队列)。
 * 作为 `app:open-file` / `app:open-file-unsupported` 事件在 webview
 * 就绪前丢失时的兜底,前端初始化时调用一次。
 */
export async function pullPendingOpenFiles(): Promise<PendingOpenItem[]> {
  return invokeCommand<PendingOpenItem[]>('app_pull_open_files', {});
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

// ============ 文件本地历史(编辑器「历史版本」)============

/** 单条历史快照元数据(`fs_file_history_list` 返回项) */
export interface FileSnapshotMeta {
  /** 快照 id(读取用;保存时刻的 epoch 毫秒) */
  id: string;
  /** 保存发生时刻(epoch 毫秒;被快照旧内容的「死亡时间」) */
  savedAtMs: number;
  /** 被快照旧内容的字节数 */
  originalBytes: number;
}

/** 列出指定文件的本地历史快照(新 → 旧);无历史返回 [] */
export async function listFileHistory(path: string): Promise<FileSnapshotMeta[]> {
  return invokeCommand<FileSnapshotMeta[]>('fs_file_history_list', { path });
}

/**
 * 读取历史快照字节并按 UTF-8 解码为文本(base64 往返,兼容任意字节)。
 * 快照是磁盘旧内容的字节级拷贝,编辑器场景按 UTF-8 解读
 * (非 UTF-8 编码文件的历史对比在恢复后按内容提示)。
 */
export async function readFileHistorySnapshot(path: string, snapshotId: string): Promise<string> {
  const b64 = await invokeCommand<string>('fs_file_history_get', {
    path,
    snapshotId,
  });
  return new TextDecoder().decode(base64ToBytes(b64));
}

/** 清空指定文件的全部本地历史;失败抛 CommandError */
export async function clearFileHistory(path: string): Promise<void> {
  await invokeCommand<null>('fs_file_history_clear', { path });
}
