/**
 * HMAC 纯函数(与组件分离,避免 react-refresh 混合导出警告)。
 * WebCrypto subtle.sign('HMAC', …) 计算,输出 hex / base64 / base64url。
 */

export const HMAC_ALGORITHMS = ['SHA-1', 'SHA-224', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type HmacAlgorithm = (typeof HMAC_ALGORITHMS)[number];

export const HMAC_ENCODINGS = ['hex', 'base64', 'base64url'] as const;
export type HmacEncoding = (typeof HMAC_ENCODINGS)[number];

/** 字节转十六进制小写 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 字节转 base64(标准字母表) */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 字节转 base64url(无填充) */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 计算 HMAC 摘要。
 * @param message 待签消息(UTF-8 编码)
 * @param secret 密钥(UTF-8 编码)
 * @param algorithm 哈希算法
 * @param encoding 输出编码
 * @returns 摘要字符串(hex 小写 / base64 / base64url)
 */
export async function computeHmac(
  message: string,
  secret: string,
  algorithm: HmacAlgorithm,
  encoding: HmacEncoding,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret) as BufferSource,
    { name: 'HMAC', hash: algorithm.replace('SHA-', 'SHA-') },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(message) as BufferSource),
  );
  switch (encoding) {
    case 'hex':
      return bytesToHex(sig);
    case 'base64':
      return bytesToBase64(sig);
    case 'base64url':
      return bytesToBase64Url(sig);
    default: {
      const exhaustive: never = encoding;
      throw new Error(`unknown encoding: ${String(exhaustive)}`);
    }
  }
}
