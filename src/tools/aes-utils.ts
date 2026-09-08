/**
 * AES-256-GCM 文本加解密纯函数(与组件分离,避免 react-refresh 混合导出警告)。
 * 全套 WebCrypto:加密 AesGcm、口令派生 PBKDF2-SHA256(100k 迭代)。
 * 输出为自包含「密封信封」:base64( iv(12) + [salt(16)] + ciphertext+tag(16) ),
 * salt 仅口令派生模式存在;同一密文可用同口令/密钥直接解回。
 */

import { bytesToBase64 } from './hmac-utils';

const IV_BYTES = 12;
const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 100_000;

/** base64 / base64url 解码为字节(容忍无填充与 URL 形态) */
export function base64ToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** hex 解码为字节(输入须为偶数长度十六进制) */
export function hexToBytes(input: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(input) || input.length % 2 !== 0) {
    throw new Error('invalid hex');
  }
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(input.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 解析原始密钥输入:自动识别 hex(64 字符 = 256bit)或 base64(44 字符) */
export function parseRawKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = hexToBytes(trimmed);
    if (bytes.length === 32) return bytes;
    throw new Error('hex key must be 256-bit (64 hex chars)');
  }
  const bytes = base64ToBytes(trimmed);
  if (bytes.length === 32) return bytes;
  throw new Error('key must be 256-bit (64 hex chars or 44 base64 chars)');
}

/** 由口令 + 盐派生 256-bit 密钥(PBKDF2-SHA256,100k 迭代) */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 由原始 256-bit 密钥字节构造 AES-GCM CryptoKey */
async function importRawKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * 加密文本。
 * @param plaintext 明文
 * @param keySource 口令或 256-bit 原始密钥(hex/base64)
 * @param usePassphrase true = PBKDF2 口令派生(生成随机盐并随文输出);false = raw key
 * @returns base64 密封信封:iv(12) + [salt(16)] + ciphertext+tag(16)
 */
export async function aesEncrypt(
  plaintext: string,
  keySource: string,
  usePassphrase: boolean,
): Promise<string> {
  if (!keySource) throw new Error('empty key');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  let key: CryptoKey;
  let salt = new Uint8Array(0);
  if (usePassphrase) {
    salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    key = await deriveKey(keySource, salt);
  } else {
    key = await importRawKey(parseRawKey(keySource));
  }
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  const envelope = new Uint8Array(iv.length + salt.length + cipher.length);
  envelope.set(iv, 0);
  envelope.set(salt, iv.length);
  envelope.set(cipher, iv.length + salt.length);
  return bytesToBase64(envelope);
}

/**
 * 解密封信封。
 * @param envelopeText aesEncrypt 输出的 base64
 * @param keySource 与加密一致的口令或原始密钥
 * @param usePassphrase 与加密一致的密钥来源模式
 * @returns 明文;口令/密钥错误时 WebCrypto 抛 OperationError
 */
export async function aesDecrypt(
  envelopeText: string,
  keySource: string,
  usePassphrase: boolean,
): Promise<string> {
  if (!keySource) throw new Error('empty key');
  const envelope = base64ToBytes(envelopeText.trim());
  if (envelope.length < IV_BYTES + 16) {
    throw new Error('ciphertext too short');
  }
  const iv = envelope.slice(0, IV_BYTES);
  if (usePassphrase) {
    if (envelope.length < IV_BYTES + SALT_BYTES + 16) {
      throw new Error('ciphertext too short for passphrase mode');
    }
    const salt = envelope.slice(IV_BYTES, IV_BYTES + SALT_BYTES);
    const cipher = envelope.slice(IV_BYTES + SALT_BYTES);
    const key = await deriveKey(keySource, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
  }
  const cipher = envelope.slice(IV_BYTES);
  const key = await importRawKey(parseRawKey(keySource));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
