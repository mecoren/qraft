/**
 * PDF 工具的本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openPdfDialog`:弹出「打开 PDF」对话框,取消返回 null,成功返回
 *   `{ path, size, bytes }`(字节已解码为 Uint8Array)。
 * - `readPdfFile`:读取已授权路径的 PDF 字节(系统打开 / 表单回读复用)。
 * - `savePdfBytes`:直接覆盖写回已授权路径。
 * - `savePdfWithDialog`:弹「另存为」对话框写入 PDF 字节。
 *
 * Rust 端(`fs_read_pdf` / `fs_open_pdf_dialog`)以 base64 过 IPC(对齐
 * `fs_save_bytes` 的通道),此处解码为 Uint8Array 供 pdf-lib / pdfjs 使用。
 * 大小上限 `PDF_FILE_MAX_BYTES`(20MB,与文本编辑器对齐)由 Rust 端强制。
 */
import { base64ToBytes, bytesToBase64 } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';

/** `fs_read_pdf` / `fs_open_pdf_dialog` 返回载荷(Rust PdfFileContent) */
interface PdfFileContentResult {
  path: string;
  size: number;
  base64: string;
}

/** 读取后的 PDF 文件(字节已解码;base64 同步携带,store 持有形态) */
export interface PdfFile {
  path: string;
  size: number;
  bytes: Uint8Array;
  /** 原始 base64(IPC 通道原样;store 持有,避免二次转换) */
  base64: string;
}

/** 弹出「打开 PDF」对话框;取消返回 null */
export async function openPdfDialog(): Promise<PdfFile | null> {
  const result = await invokeCommand<PdfFileContentResult | null>('fs_open_pdf_dialog', {});
  if (!result) return null;
  return {
    path: result.path,
    size: result.size,
    bytes: base64ToBytes(result.base64),
    base64: result.base64,
  };
}

/** 读取已授权路径的 PDF(系统打开入口复用) */
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
export async function savePdfWithDialog(fileName: string, bytes: Uint8Array): Promise<string | null> {
  return invokeCommand<string | null>('fs_save_bytes', {
    fileName,
    base64: bytesToBase64(bytes),
    mime: 'application/pdf',
  });
}
