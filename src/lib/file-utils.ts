/**
 * 文件辅助:下载与本机文件读�? *
 * 设计说明:
 * - 生产 CSP �?img-src 'self' data:,因此图片预览一律使�?data URL 而非 blob URL
 * - 下载通过 <a download> + data/blob URL 触发,无需后端参与
 */

import { t } from '@/i18n';

/** 将字节数组转�?base64 字符�?分块避免栈溢�? */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** �?base64 字符串解码为字节数组,非法输入抛错 */
export function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** �?base64 data URL 中提取纯 base64 部分(无前缀时原样返�? */
export function stripDataUrlPrefix(input: string): { base64: string; mime: string | null } {
  const match = input.trim().match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (match) {
    return { base64: match[2], mime: match[1] ?? null };
  }
  return { base64: input.trim(), mime: null };
}

/** 触发浏览器下载一个文本文�?*/
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

/** 触发浏览器下载一�?Blob */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟回收,确保下载已启�?  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读取 File �?data URL(图片预览�?CSP 安全) */
export function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error(t('chrome.code_editor.read_file_failed')));
    reader.readAsDataURL(file);
  });
}

/** 读取 File 为文�?*/
export function readFileAsText(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error(t('chrome.code_editor.read_file_failed')));
    reader.readAsText(file);
  });
}

/** 格式化字节数为可读字符串 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}
