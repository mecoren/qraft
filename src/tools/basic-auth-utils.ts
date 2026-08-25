/**
 * Basic Auth 编码纯函数:RFC 7617(user:password → Basic base64)。
 * UTF-8 安全:先 TextEncoder 转字节再 btoa,避免 btoa 对非 Latin1 抛错。
 */
export function encodeBasicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}
