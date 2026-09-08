/**
 * OTP(TOTP / HOTP)纯函数,遵循 RFC 4226(HOTP)与 RFC 6238(TOTP)。
 * HMAC-SHA1 计算,Base32 密钥解码(RFC 4648,容忍小写与空格)。
 * 与组件分离,避免 react-refresh 混合导出警告。
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * 解码 Base32 密钥(RFC 4648)。
 * 容忍:小写自动转大写、忽略空格与连字符、忽略 padding `=`。
 * @throws 密钥为空或含非法字符时抛错
 */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (clean.length === 0) throw new Error('empty secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * RFC 4226 HOTP:按计数器生成一次性口令。
 * @param secretBytes Base32 解码后的密钥字节
 * @param counter 计数器(内部转 8 字节大端)
 * @param digits 口令位数(6/7/8,默认 6)
 */
export async function generateHotp(
  secretBytes: Uint8Array,
  counter: number,
  digits = 6,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  // counter → 8 字节大端
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg as BufferSource));
  // 动态截断(RFC 4226 §5.3)
  const offset = sig[sig.length - 1]! & 0x0f;
  const bin =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * RFC 6238 TOTP:HOTP 的时间窗形态,counter = floor(unix秒 / period)。
 */
export async function generateTotp(
  secretBytes: Uint8Array,
  now = Date.now(),
  period = 30,
  digits = 6,
): Promise<string> {
  const counter = Math.floor(now / 1000 / period);
  return generateHotp(secretBytes, counter, digits);
}

/** 当前时间窗剩余秒数(1 ~ period;整点对齐时为 period) */
export function secondsRemainingInWindow(now = Date.now(), period = 30): number {
  return period - (Math.floor(now / 1000) % period);
}

/**
 * 常数时间字符串比较(避免口令比对的计时侧信道)。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
