/**
 * NanoID 纯函数:生成与解析(与组件分离,避免 react-refresh 混合导出警告)。
 * NanoID 语义:长度 N、字母表 K,总组合数 K^N;从 crypto.getRandomValues
 * 均匀取样 —— 拒绝采样法消除模偏差(modulo bias),这是 nanoid 官方实现
 * 的核心算法,不用 Math.random。
 */

/** 默认 URL 安全字母表:64 字符 A-Z a-z 0-9 _-(与 nanoid 官方默认同一字符集;顺序无语义) */
export const NANO_DEFAULT_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 默认长度(nanoid 官方默认 21:64^21 ≈ 121 bit 熵,与 UUID v4 抗碰撞等价) */
export const NANO_DEFAULT_SIZE = 21;

/**
 * 生成单个 NanoID。
 * @param size 长度;非法值回退默认 21
 * @param alphabet 字母表;须 ≥ 2 且 ≤ 255 字符且无重复,非法回退默认字母表
 */
export function generateNanoId(size = NANO_DEFAULT_SIZE, alphabet = NANO_DEFAULT_ALPHABET): string {
  const len = Number.isInteger(size) && size > 0 ? size : NANO_DEFAULT_SIZE;
  let chars = alphabet;
  if (chars.length < 2 || chars.length > 255 || new Set(chars).size !== chars.length) {
    chars = NANO_DEFAULT_ALPHABET;
  }
  // 拒绝采样:mask = 2^ceil(log2(K)) - 1;> mask 的随机字节丢弃重取,保证均匀
  const mask = (2 << Math.floor(Math.log2(chars.length - 1))) - 1;
  const step = Math.ceil((1.6 * mask * len) / chars.length);
  let id = '';
  const bytes = new Uint8Array(step);
  while (id.length < len) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && id.length < len; i++) {
      const idx = bytes[i]! & mask;
      if (idx < chars.length) id += chars[idx]!;
    }
  }
  return id;
}

/** 校验字符串是否是指定字母表与长度下的合法 NanoID */
export function isValidNanoId(
  s: string,
  size = NANO_DEFAULT_SIZE,
  alphabet = NANO_DEFAULT_ALPHABET,
): boolean {
  if (s.length !== size || alphabet.length < 2) return false;
  const set = new Set(alphabet);
  for (const ch of s) {
    if (!set.has(ch)) return false;
  }
  return true;
}
