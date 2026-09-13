/**
 * 公钥/私钥解析核心逻辑 —— @peculiar ASN.1 全家桶直解,零网络零 IPC
 *
 * 支持格式与展示口径(对标 `openssl pkey -text -noout`):
 * - PEM:PUBLIC KEY(SPKI,RSA/EC/Ed25519)、PRIVATE KEY(PKCS#8)、RSA PRIVATE KEY(传统 PKCS#1)
 * - 解析后的结构信息:算法名(OID → 友好名)、密钥位数 / 曲线、RSA 模数与指数、
 *   EC 公私钥点、Ed25519 原始字节、SPKI 指纹(SHA-256,WebCrypto subtle.digest)。
 *
 * ASN.1 数据访问约定(实测 asn1-schema 2.8.0 行为):
 * - OctetString 类型字段(RSAPublicKey.modulus 等)返回含 .buffer 的对象,
 *   直接 new Uint8Array(field) 会得到空视图,必须经 .buffer 间接访问;
 * - PKCS#8 PrivateKeyInfo.privateKey 已由 schema 剥去外层封装,直接是内层 DER。
 */

import 'reflect-metadata';
import { AsnParser } from '@peculiar/asn1-schema';
import { PrivateKeyInfo } from '@peculiar/asn1-pkcs8';
import { RSAPrivateKey, RSAPublicKey } from '@peculiar/asn1-rsa';
import { ECParameters, ECPrivateKey } from '@peculiar/asn1-ecc';
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509';

/** 密钥种类(展示分组) */
export type KeyKind = 'public' | 'private';

/** 算法家族 */
export type KeyFamily = 'rsa' | 'ec' | 'ed25519';

export interface PublicKeyReport {
  kind: KeyKind;
  family: KeyFamily;
  /** 算法 OID(如 1.2.840.113549.1.1.1) */
  algorithmOid: string;
  /** 算法友好名(如 RSA / ECDSA / Ed25519) */
  algorithmName: string;
  /** 密钥位数:RSA 为模数实际位数,EC 为曲线位宽,Ed25519 为 253(有效位) */
  keySize: number;
  /** RSA 专属:十六进制模数(大写连续)与十进制指数 */
  rsa: { modulusHex: string; exponent: number } | null;
  /** EC 专属:曲线 OID、友好名、公钥点(x/y 各半,未压缩 SEC1 格式 0x04 前缀) */
  ec: { curveOid: string; curveName: string; pointHex: string } | null;
  /** Ed25519 专属:32 字节原始公钥十六进制 */
  ed25519: { rawHex: string } | null;
  /** 私钥专属:是否含公钥材料(EC/Ed25519 私钥常内嵌公钥点) */
  hasPublicKeyMaterial: boolean;
  /** SPKI DER 的 SHA-256 指纹(小写 hex,64 字符) */
  fingerprintSha256: string;
  /** SPKI DER 字节数 */
  spkiBytes: number;
}

/** ASN.1 OctetString-like 字段统一取 ArrayBuffer(规避 new Uint8Array(octet) 为空的坑) */
function fieldBytes(field: unknown): ArrayBuffer | null {
  if (field === null || field === undefined) return null;
  if (field instanceof ArrayBuffer) return field;
  const withBuffer = field as { buffer?: ArrayBuffer };
  if (withBuffer.buffer instanceof ArrayBuffer) return withBuffer.buffer;
  const arrLike = field as ArrayLike<number> & { byteLength?: number };
  if (typeof arrLike.length === 'number' && arrLike.length > 0) {
    const u8 = new Uint8Array(arrLike.length);
    for (let i = 0; i < arrLike.length; i += 1) u8[i] = arrLike[i];
    return u8.buffer;
  }
  return null;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

/** 模数实际位数:去前导零字节后按最高位 + 1 计算(对照 openssl 的 Private-Key: (2048 bit)) */
function modulusBits(buf: ArrayBuffer): number {
  const m = new Uint8Array(buf);
  let msb = 0;
  while (msb < m.length && m[msb] === 0) msb += 1;
  if (msb >= m.length) return 0;
  return (m.length - msb - 1) * 8 + (32 - Math.clz32(m[msb]));
}

function bigEndianValue(buf: ArrayBuffer): number {
  const b = new Uint8Array(buf);
  let v = 0;
  for (const byte of b) v = v * 256 + byte;
  return v;
}

/** OID → 友好名映射(覆盖本工具支持的三个家族 + 常见曲线) */
const OID_RSA = '1.2.840.113549.1.1.1';
const OID_EC = '1.2.840.10045.2.1';
const OID_ED25519 = '1.3.101.112';

const CURVE_NAMES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256 (secp256r1)',
  '1.3.132.0.10': 'P-384 (secp384r1)',
  '1.3.132.0.34': 'P-521 (secp521r1)',
  '1.3.132.0.35': 'P-256K (secp256k1)',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  '1.3.36.3.3.2.8.1.1.11': 'brainpoolP384r1',
  '1.3.36.3.3.2.8.1.1.13': 'brainpoolP512r1',
};

function curveName(oid: string): string {
  return CURVE_NAMES[oid] ?? oid;
}

/** SPKI(公钥部分)解析:三个家族分发,产出结构信息(不含指纹,指纹由调用层补) */
function describeSpki(spki: SubjectPublicKeyInfo): Omit<
  PublicKeyReport,
  'kind' | 'fingerprintSha256' | 'spkiBytes' | 'hasPublicKeyMaterial'
> & {
  /** 私钥场景重用:PKCS#8 内嵌的公钥点(EC)/裸字节(Ed25519) */
  embeddedPublicKey: ArrayBuffer | null;
} {
  const oid = spki.algorithm.algorithm;
  const keyBytes = fieldBytes(spki.subjectPublicKey);

  if (oid === OID_RSA) {
    if (!keyBytes) throw new Error('RSA public key content is empty');
    const rsa = AsnParser.parse(keyBytes, RSAPublicKey);
    const modulus = fieldBytes(rsa.modulus);
    const exponent = fieldBytes(rsa.publicExponent);
    if (!modulus || !exponent) throw new Error('RSA modulus or exponent missing');
    return {
      family: 'rsa',
      algorithmOid: oid,
      algorithmName: 'RSA',
      keySize: modulusBits(modulus),
      rsa: { modulusHex: toHex(modulus), exponent: bigEndianValue(exponent) },
      ec: null,
      ed25519: null,
      embeddedPublicKey: null,
    };
  }

  if (oid === OID_EC) {
    if (!keyBytes) throw new Error('EC public key point is empty');
    const paramsRaw = fieldBytes(spki.algorithm.parameters);
    const curveOid = paramsRaw ? AsnParser.parse(paramsRaw, ECParameters).namedCurve : '';
    if (!curveOid) throw new Error('EC named curve missing');
    // 未压缩 SEC1 point:0x04 || X || Y,X/Y 位宽 = 曲线位数 / 8
    const pointLen = new Uint8Array(keyBytes).length;
    const coordBytes = pointLen > 1 ? pointLen - 1 : 0;
    const keySize = (coordBytes / 2) * 8;
    return {
      family: 'ec',
      algorithmOid: oid,
      algorithmName: 'EC',
      keySize,
      rsa: null,
      ec: { curveOid, curveName: curveName(curveOid), pointHex: toHex(keyBytes) },
      ed25519: null,
      embeddedPublicKey: keyBytes,
    };
  }

  if (oid === OID_ED25519) {
    if (!keyBytes) throw new Error('Ed25519 public key content is empty');
    return {
      family: 'ed25519',
      algorithmOid: oid,
      algorithmName: 'Ed25519',
      // Ed25519 签名密钥有效位 253(2^255 - 19 域截断),惯例展示 253
      keySize: 253,
      rsa: null,
      ec: null,
      ed25519: { rawHex: toHex(keyBytes) },
      embeddedPublicKey: keyBytes,
    };
  }

  throw new Error(`Unsupported key algorithm OID: ${oid}`);
}

/** 私钥结构解析:PKCS#8 优先,PKCS#1(仅 RSA)兜底 */
function describePrivateKey(der: ArrayBuffer): {
  spkiLike: Omit<
    PublicKeyReport,
    'kind' | 'fingerprintSha256' | 'spkiBytes' | 'hasPublicKeyMaterial'
  >;
  hasPublicKeyMaterial: boolean;
} {
  // PKCS#8:PrivateKeyInfo { version, privateKeyAlgorithm, privateKey }
  const pki = AsnParser.parse(der, PrivateKeyInfo);
  const oid = pki.privateKeyAlgorithm.algorithm;
  const innerBytes = fieldBytes(pki.privateKey);
  if (!innerBytes) throw new Error('PKCS#8 private key content is empty');

  if (oid === OID_RSA) {
    const pkcs1 = AsnParser.parse(innerBytes, RSAPrivateKey);
    const modulus = fieldBytes(pkcs1.modulus);
    const exponent = fieldBytes(pkcs1.publicExponent);
    if (!modulus || !exponent) throw new Error('RSA private key modulus missing');
    return {
      spkiLike: {
        family: 'rsa',
        algorithmOid: oid,
        algorithmName: 'RSA',
        keySize: modulusBits(modulus),
        rsa: { modulusHex: toHex(modulus), exponent: bigEndianValue(exponent) },
        ec: null,
        ed25519: null,
      },
      // PKCS#1 RSAPrivateKey 含 publicExponent → 有公钥材料
      hasPublicKeyMaterial: true,
    };
  }

  if (oid === OID_EC) {
    const sec1 = AsnParser.parse(innerBytes, ECPrivateKey);
    const privBytes = fieldBytes(sec1.privateKey);
    const paramsRaw = fieldBytes(pki.privateKeyAlgorithm.parameters);
    const curveOid = paramsRaw ? AsnParser.parse(paramsRaw, ECParameters).namedCurve : null;
    const pubPoint = fieldBytes(sec1.publicKey);
    const curve = curveOid ?? (paramsRaw && paramsRaw.byteLength > 0 ? '' : '');
    if (!privBytes) throw new Error('EC private scalar missing');
    return {
      spkiLike: {
        family: 'ec',
        algorithmOid: oid,
        algorithmName: 'EC',
        keySize: privBytes.byteLength * 8,
        rsa: null,
        ec: {
          curveOid: curve,
          curveName: curve ? curveName(curve) : '',
          pointHex: pubPoint ? toHex(pubPoint) : '',
        },
        ed25519: null,
      },
      hasPublicKeyMaterial: pubPoint !== null,
    };
  }

  if (oid === OID_ED25519) {
    let raw = fieldBytes(pki.privateKey);
    if (!raw) throw new Error('Ed25519 private key content is empty');
    // RFC 8410:内层是 ASN.1 OCTET STRING(04 20 || 32B);schema 已剥外层
    // PrivateKey 封装,剩余内容是完整 DER OCTET STRING,须再剥一层标签与长度
    raw = unwrapDerOctetString(raw);
    return {
      spkiLike: {
        family: 'ed25519',
        algorithmOid: oid,
        algorithmName: 'Ed25519',
        keySize: 253,
        rsa: null,
        ec: null,
        ed25519: { rawHex: toHex(raw) },
      },
      hasPublicKeyMaterial: false,
    };
  }

  throw new Error(`Unsupported private key algorithm OID: ${oid}`);
}

/** 剥一层 DER OCTET STRING 标签+长度头(04 len || content);非 OCTET STRING 原样返回 */
function unwrapDerOctetString(buf: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x04 || b.length < 2) return buf;
  // 短格式长度(0x20 = 32)覆盖 32 字节私钥场景;长格式(0x81/0x82)一并支持
  if (b[1] < 0x80) {
    return buf.slice(2, 2 + b[1]);
  }
  const lenBytes = b[1]! & 0x7f;
  if (lenBytes > 2 || b.length < 2 + lenBytes) return buf;
  let len = 0;
  for (let i = 0; i < lenBytes; i += 1) len = len * 256 + b[2 + i]!;
  return buf.slice(2 + lenBytes, 2 + lenBytes + len);
}

/** PEM 剥壳:提取 base64 体解码为 DER(支持 PEM/裸 base64 DER 两种输入) */
export function pemToDer(raw: string): ArrayBuffer | null {
  const text = raw.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!text) return null;
  const pemMatch = text.match(/-----BEGIN [^-]+-----\s*([\s\S]*?)\s*-----END [^-]+-----/);
  const b64Body = pemMatch ? pemMatch[1]!.replace(/\s+/g, '') : text.replace(/\s+/g, '');
  if (!b64Body) return null;
  try {
    const bin = atob(b64Body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** 输入是公钥 PEM(SPKI)还是私钥 PEM/结构 */
export function detectKeyKind(raw: string): KeyKind | null {
  const text = raw.trim();
  if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) return 'private';
  if (/-----BEGIN (RSA )?PUBLIC KEY-----/.test(text)) return 'public';
  // 裸 base64 DER:首字节 0x30(SEQUENCE)且第二字节组合长度后无法直接判定,
  // 统一先按公钥 SPKI 试解,失败再按私钥
  const der = pemToDer(raw);
  if (!der) return null;
  try {
    AsnParser.parse(der, SubjectPublicKeyInfo);
    return 'public';
  } catch {
    try {
      AsnParser.parse(der, PrivateKeyInfo);
      return 'private';
    } catch {
      return null;
    }
  }
}

/** SPKI DER 的 SHA-256 指纹(WebCrypto subtle.digest;jsdom 测试环境由桩提供) */
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(digest).toLowerCase();
}

/** 从 SPKI DER 解析公钥结构信息(kind 固定为 public) */
export async function describePublicKeyDer(der: ArrayBuffer): Promise<PublicKeyReport> {
  const spki = AsnParser.parse(der, SubjectPublicKeyInfo);
  const info = describeSpki(spki);
  return {
    kind: 'public',
    ...info,
    hasPublicKeyMaterial: true,
    fingerprintSha256: await sha256Hex(der),
    spkiBytes: der.byteLength,
  };
}

/** 从私钥 DER 解析结构信息(kind 固定为 private) */
export async function describePrivateKeyInput(der: ArrayBuffer): Promise<PublicKeyReport> {
  const { spkiLike, hasPublicKeyMaterial } = describePrivateKey(der);
  return {
    kind: 'private',
    ...spkiLike,
    hasPublicKeyMaterial,
    fingerprintSha256: await sha256Hex(der),
    spkiBytes: der.byteLength,
  };
}

/**
 * 统一入口:输入 PEM(或 base64 DER)文本,解析为结构信息报告。
 * 私钥场景指纹与字节数按 PKCS#8 整体 DER 计算(与 openssl pkey 指纹口径一致);
 * 公钥场景按 SPKI DER 计算。
 *
 * @throws Error 输入为空 / base64 损坏 / ASN.1 结构不匹配 / 不支持的算法 OID
 */
export async function describeKey(raw: string): Promise<PublicKeyReport> {
  const der = pemToDer(raw);
  if (!der) throw new Error('empty or malformed input');
  const kind = detectKeyKind(raw);
  if (kind === 'private') return describePrivateKeyInput(der);
  if (kind === 'public') return describePublicKeyDer(der);
  // 无法判定:先按 SPKI 试解
  try {
    return await describePublicKeyDer(der);
  } catch (pubErr) {
    try {
      return await describePrivateKeyInput(der);
    } catch {
      throw pubErr instanceof Error ? pubErr : new Error(String(pubErr));
    }
  }
}

/** 便捷判定:是否为证书(非公钥)——供嗅探分流 certificate_decoder */
export function looksLikeCertificatePem(raw: string): boolean {
  return /-----BEGIN CERTIFICATE-----/.test(raw.trim());
}

/** 便捷判定:是否为公钥/私钥 PEM(供剪贴板嗅探) */
export function looksLikeKeyPem(raw: string): boolean {
  const text = raw.trim();
  return /-----BEGIN (RSA )?(PUBLIC|PRIVATE) KEY-----/.test(text);
}

/** 公钥导出语料(CopyAction 用):报告转键值文本 */
export function reportToText(
  report: PublicKeyReport,
  field: (key: string, value: string) => string,
): string {
  const lines = [
    field('Kind', report.kind),
    field('Algorithm', report.algorithmName),
    field('Key Size', `${report.keySize} bits`),
  ];
  if (report.rsa) {
    lines.push(field('Modulus (hex)', report.rsa.modulusHex));
    lines.push(field('Exponent', String(report.rsa.exponent)));
  }
  if (report.ec) {
    lines.push(field('Curve', report.ec.curveName));
    if (report.ec.pointHex) lines.push(field('Public Point (hex)', report.ec.pointHex));
  }
  if (report.ed25519) {
    lines.push(field('Key (hex)', report.ed25519.rawHex));
  }
  lines.push(field('SHA-256 Fingerprint', report.fingerprintSha256));
  lines.push(field('SPKI/PKCS#8 Size', `${report.spkiBytes} bytes`));
  return lines.join('\n');
}
