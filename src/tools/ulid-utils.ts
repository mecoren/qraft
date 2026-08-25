/**
 * ULID 纯函数:生成与校验(与组件分离,避免 react-refresh 混合导出警告)。
 */

/** Crockford Base32 字母表(32 字符,不含 I/L/O/U) */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 校验 26 位 ULID(不含 I/L/O/U;小写宽容) */
export function isValidUlid(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s.toUpperCase());
}

/** 生成 ULID:前 10 字符 = 48bit 毫秒时间戳,后 16 字符 = 80bit 随机 */
export function generateUlid(now = Date.now()): string {
  let time = now;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[time % 32]! + timePart;
    time = Math.floor(time / 32);
  }
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart += ENCODING[bytes[i]! & 31]!;
  }
  return timePart + randomPart;
}
