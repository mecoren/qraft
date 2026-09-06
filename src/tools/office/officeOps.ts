/**
 * Office 工具的本地文件操作 —— 封装 Tauri fs IPC 命令
 *
 * - `openOfficeDialog`:弹出「打开 Office 文档」对话框,取消返回 null,
 *   成功返回 `{ path, size }`(元信息;字节按需读取,与 PDF 工具两步式一致)。
 * - `readOfficeFile`:读取已授权路径的 Office 字节(系统打开入口复用)。
 *
 * Rust 端(`fs_read_office` / `fs_open_office_dialog`)以 base64 过 IPC,
 * 此处解码为 Uint8Array 供渲染库(docx-preview / SheetJS / jszip)使用。
 * 大小上限 `OFFICE_FILE_MAX_BYTES`(100MB,与 PDF 通道对齐)由 Rust 端强制。
 */
import { base64ToBytes } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';

/** `fs_read_office` 返回载荷(Rust OfficeFileContent) */
interface OfficeFileContentResult {
  path: string;
  size: number;
  base64: string;
}

/** `fs_open_office_dialog` 返回载荷(Rust OfficeFileMeta) */
export interface OfficeFileMeta {
  path: string;
  size: number;
}

/** 读取后的 Office 文件(字节已解码;base64 同步携带,store 持有形态) */
export interface OfficeFile {
  path: string;
  size: number;
  bytes: Uint8Array;
  /** 原始 base64(IPC 通道原样;store 持有,避免二次转换) */
  base64: string;
}

/** 弹出「打开 Office 文档」对话框;取消返回 null,成功返回元信息(路径已授权) */
export async function openOfficeDialog(): Promise<OfficeFileMeta | null> {
  return invokeCommand<OfficeFileMeta | null>('fs_open_office_dialog', {});
}

/** 读取已授权路径的 Office 文件字节(系统打开 / 对话框后按需读取) */
export async function readOfficeFile(path: string): Promise<OfficeFile> {
  const result = await invokeCommand<OfficeFileContentResult>('fs_read_office', { path });
  return {
    path: result.path,
    size: result.size,
    bytes: base64ToBytes(result.base64),
    base64: result.base64,
  };
}
