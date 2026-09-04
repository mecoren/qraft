/**
 * Basic Auth 纯逻辑:RFC 7617(user:password ↔ Basic base64)双向转换。
 * UTF-8 安全:先 TextEncoder 转字节再 btoa,避免 btoa 对非 Latin1 抛错。
 */

/** user:password → `Basic <base64>` 请求头值 */
export function encodeBasicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

export interface DecodedBasicAuth {
  user: string;
  password: string;
}

/**
 * 解码 Authorization 头或裸 base64:
 * - 完整头:`Basic dXNlcjpwYXNz`(大小写不敏感,前缀可选)
 * - 裸 base64:`dXNlcjpwYXNz`
 * - 明文 user:password 直接透传
 * 失败(非法 base64 / 无冒号分隔)抛 Error。
 */
export function decodeBasicAuth(input: string): DecodedBasicAuth {
  let value = input.trim();
  const m = value.match(/^basic\s+(.+)$/i);
  if (m) value = m[1].trim();

  // 尝试 base64:含冒号即视为明文,否则按 base64 解码
  let decodedText: string;
  if (value.includes(':')) {
    decodedText = value;
  } else {
    try {
      const bytes = base64ToBytes(value);
      decodedText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      throw new Error('invalid base64');
    }
  }

  const sep = decodedText.indexOf(':');
  if (sep < 0) {
    throw new Error('decoded value has no user:password separator');
  }
  return { user: decodedText.slice(0, sep), password: decodedText.slice(sep + 1) };
}

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
