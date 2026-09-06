/**
 * PDF 工具的本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openPdfDialog`:弹出「打开 PDF」对话框,取消返回 null,成功返回
 *   `{ path, size }` 元信息(内容不在此阶段载入)。
 * - `readPdfFile`:读取已授权路径的 PDF 字节(系统打开入口),整读直返。
 * - `readPdfBytesChunked`:分块拉取大文件字节(打开对话框路径专用,
 *   大文件按 2MB 块循环过 IPC,避免整读 base64 的序列化峰值与 UI 卡顿)。
 * - `savePdfBytes`:直接覆盖写回已授权路径。
 * - `savePdfWithDialog`:弹「另存为」对话框写入 PDF 字节。
 *
 * Rust 端(`fs_read_pdf*` / `fs_save_bytes`)以 base64 过 IPC(对齐
 * `fs_save_bytes` 的通道),此处解码为 Uint8Array 供 pdf-lib / pdfjs 使用。
 * 大小上限 `PDF_FILE_MAX_BYTES`(100MB)由 Rust 端强制。
 */
import { base64ToBytes, bytesToBase64 } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';

/** `fs_read_pdf` / `fs_read_pdf_info` / `fs_open_pdf_dialog` 返回的元信息载荷 */
export interface PdfFileMetaResult {
  path: string;
  size: number;
}

/** `fs_read_pdf` 的整读载荷(元信息 + base64 内容) */
interface PdfFileContentResult extends PdfFileMetaResult {
  base64: string;
}

/** `fs_read_pdf_chunk` 返回载荷(Rust PdfChunkContent) */
interface PdfChunkResult {
  offset: number;
  length: number;
  base64: string;
  last: boolean;
}

/** 打开对话框后的文件描述(字节经分块通道拉取后拼装) */
export interface PdfFile {
  path: string;
  size: number;
  bytes: Uint8Array;
  /** 原始 base64(store 持有形态;由字节本地编码,不再依赖 IPC 原样携带) */
  base64: string;
}

/** 分块拉取的单块字节上限(与 Rust PDF_CHUNK_MAX_BYTES 对齐) */
const CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * 分块读取已授权路径的完整字节:循环 `fs_read_pdf_chunk` 直至 `last`。
 * 每块独立 base64 过 IPC(块级序列化,峰值内存 = 块大小 × 4/3 而非全文件),
 * 拼装在全量 Uint8Array 上完成,无中间字符串放大。
 */
async function readBytesChunked(path: string, size: number): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = await invokeCommand<PdfChunkResult>('fs_read_pdf_chunk', {
      path,
      offset,
      length: CHUNK_BYTES,
    });
    const part = base64ToBytes(chunk.base64);
    out.set(part, offset);
    offset += chunk.length;
    if (chunk.last) break;
  }
  return out;
}

/** 弹出「打开 PDF」对话框;取消返回 null,成功返回元信息(内容待拉取) */
export async function openPdfDialog(): Promise<PdfFileMetaResult | null> {
  return invokeCommand<PdfFileMetaResult | null>('fs_open_pdf_dialog', {});
}

/**
 * 以元信息为起点拉取完整 PDF(对话框路径):按大小自动选择整读或分块。
 * 小文件(≤ 单块)直接整读;大文件走分块,兼顾首字节延迟与内存峰值。
 * 返回 store 持有所需的 { path, size, bytes, base64 }。
 */
export async function fetchPdfFile(meta: PdfFileMetaResult): Promise<PdfFile> {
  const bytes =
    meta.size <= CHUNK_BYTES
      ? base64ToBytes(
          (
            await invokeCommand<PdfFileContentResult>('fs_read_pdf', {
              path: meta.path,
            })
          ).base64,
        )
      : await readBytesChunked(meta.path, meta.size);
  return { path: meta.path, size: meta.size, bytes, base64: bytesToBase64(bytes) };
}

/** 读取已授权路径的 PDF(系统打开入口;整读,沿用既有通道) */
export async function readPdfFile(path: string): Promise<PdfFile> {
  const result = await invokeCommand<PdfFileContentResult>('fs_read_pdf', { path });
  return {
    path: result.path,
    size: result.size,
    bytes: base64ToBytes(result.base64),
    base64: result.base64,
  };
}

/** 直接覆盖写回已授权路径;成功返回 true,失败抛 CommandError */
export async function savePdfBytes(path: string, bytes: Uint8Array): Promise<boolean> {
  await invokeCommand<boolean>('fs_save_bytes_to_path', { path, base64: bytesToBase64(bytes) });
  return true;
}

/** 弹「另存为」对话框写入;用户取消返回 null,成功返回保存路径(已授权) */
export async function savePdfWithDialog(
  fileName: string,
  bytes: Uint8Array,
): Promise<string | null> {
  return invokeCommand<string | null>('fs_save_bytes', {
    fileName,
    base64: bytesToBase64(bytes),
    mime: 'application/pdf',
  });
}
