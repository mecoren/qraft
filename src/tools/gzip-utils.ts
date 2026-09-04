/**
 * GZip 压缩/解压缩纯逻辑:文本与字节双向,基于原生
 * CompressionStream / DecompressionStream,无第三方依赖。
 */

/** gzip 文件头魔数 0x1F 0x8B */
const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** 检测字节流是否为 gzip 格式(魔数 1F 8B) */
export function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/** 检测 base64 字符串解码后是否为 gzip(自动兼容 URL-safe 与缺省 padding) */
export function isGzipBase64(base64: string): boolean {
  try {
    return isGzipBytes(base64ToBytesLoose(base64));
  } catch {
    return false;
  }
}

/** 宽容 base64:去空白、补 padding、URL-safe → 标准,失败抛错 */
export function base64ToBytesLoose(base64: string): Uint8Array {
  const cleaned = base64
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  // 复制一份保证独立 buffer(Blob 构造对共享 ArrayBuffer 视图按字节截取)
  const source = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(stream);
  const buffer = await new Response(source).arrayBuffer();
  return new Uint8Array(buffer);
}

/** gzip 压缩:任意字节 → gzip 字节流 */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream('gzip'));
}

/** gunzip 解压:gzip 字节流 → 原始字节 */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream('gzip'));
}

/** 文本 → gzip 字节流(UTF-8) */
export async function gzipText(text: string): Promise<Uint8Array> {
  return gzipBytes(new TextEncoder().encode(text));
}

/** gzip 字节流 → 文本(UTF-8;含无效序列时替换而非抛错) */
export async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const out = await gunzipBytes(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(out);
}
