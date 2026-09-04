/**
 * 证书解码纯逻辑:PEM / Base64 DER / HEX 输入 → 结构化字段模型。
 *
 * 与 UI 解耦,导出供单元测试复用;UI 组件仅负责渲染 describeCertificate
 * 产出的 CertificateReport。字段覆盖对齐 openssl x509 -text 的常用区段。
 */

import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509Certificate,
} from '@peculiar/x509';

/** 通用键值行 */
export interface CertField {
  key: string;
  value: string;
  /** 值过长时允许折行展示 */
  wrap?: boolean;
}

/** 扩展条目:OID 名称 + 类型化摘要(SAN 域名、密钥用途等) */
export interface CertExtensionInfo {
  type: string;
  critical: boolean;
  /** 人类可读摘要;无类型化解析结果时回退 OID */
  summary: string;
}

/** 证书有效期状态(相对当前时间) */
export type CertValidityStatus = 'valid' | 'not_yet_valid' | 'expired';

export interface CertificateReport {
  /** X.509 结构版本号,如 "v3" */
  version: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  signatureAlgorithm: string;
  publicKeyAlgorithm: string;
  notBefore: Date;
  notAfter: Date;
  validityStatus: CertValidityStatus;
  /** SHA-1 指纹(大写十六进制冒号分隔) */
  sha1: string;
  /** SHA-256 指纹 */
  sha256: string;
  extensions: CertExtensionInfo[];
  /** SAN 各条目(域名 / IP / URI / 邮箱),无 SAN 扩展时为空数组 */
  sans: string[];
  /** Key Usage 位标志摘要;无该扩展时为空数组 */
  keyUsages: string[];
  /** Extended Key Usage OID 列表;无该扩展时为空数组 */
  extendedUsages: string[];
  /** 是否为 CA 证书;无 BasicConstraints 扩展时为 null */
  isCA: boolean | null;
  /** ASN.1 结构完整文本(@peculiar/x509 toTextObject 序列化,对标 openssl -text) */
  asn1Text: string;
}

/** KeyUsageFlags 位 → 名称映射(顺序即位序) */
const KEY_USAGE_NAMES: Array<{ flag: number; name: string }> = [
  { flag: KeyUsageFlags.digitalSignature, name: 'digitalSignature' },
  { flag: KeyUsageFlags.nonRepudiation, name: 'nonRepudiation' },
  { flag: KeyUsageFlags.keyEncipherment, name: 'keyEncipherment' },
  { flag: KeyUsageFlags.dataEncipherment, name: 'dataEncipherment' },
  { flag: KeyUsageFlags.keyAgreement, name: 'keyAgreement' },
  { flag: KeyUsageFlags.keyCertSign, name: 'keyCertSign' },
  { flag: KeyUsageFlags.cRLSign, name: 'cRLSign' },
  { flag: KeyUsageFlags.encipherOnly, name: 'encipherOnly' },
  { flag: KeyUsageFlags.decipherOnly, name: 'decipherOnly' },
];

/** EKU 常用 OID → 名称(RFC 5280 / CA/Browser Forum) */
const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '2.5.29.37.0': 'anyExtendedKeyUsage',
};

/** 字节数组 → 大写十六进制冒号分隔(指纹格式,同 openssl) */
export function hex(buffer: ArrayBuffer, sep = ':'): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

/** 输入预处理:剥离粘贴时可能带入的首尾引号与空白(PEM / Base64 DER / HEX 均可容忍) */
export function normalizeCertInput(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, '');
}

function validityStatusOf(cert: X509Certificate): CertValidityStatus {
  const now = new Date();
  if (now < cert.notBefore) return 'not_yet_valid';
  if (now > cert.notAfter) return 'expired';
  return 'valid';
}

function keyUsagesOf(cert: X509Certificate): string[] {
  const ext = cert.getExtension(KeyUsagesExtension);
  if (!ext) return [];
  return KEY_USAGE_NAMES.filter(({ flag }) => (ext.usages & flag) === flag).map((k) => k.name);
}

function extendedUsagesOf(cert: X509Certificate): string[] {
  const ext = cert.getExtension(ExtendedKeyUsageExtension);
  if (!ext) return [];
  // ExtendedKeyUsage 是 string 枚举,统一按 string 处理
  return ext.usages.map((oid) => EKU_NAMES[oid as string] ?? (oid as string));
}

function sansOf(cert: X509Certificate): string[] {
  const ext = cert.getExtension(SubjectAlternativeNameExtension);
  if (!ext) return [];
  return ext.names.items.map((n) => `${n.type}: ${n.value}`);
}

/** 解析证书并产出完整报告;输入非法时抛错(消息由调用方本地化展示)。
 * 自签名检测独立进行(组件层调用 X509Certificate#isSelfSigned),此处不做。 */
export async function describeCertificate(input: string): Promise<CertificateReport> {
  const cert = new X509Certificate(normalizeCertInput(input));
  const [sha1, sha256] = await Promise.all([
    cert.getThumbprint('SHA-1'),
    cert.getThumbprint('SHA-256'),
  ]);

  const bc = cert.getExtension(BasicConstraintsExtension);
  const usages = keyUsagesOf(cert);

  const extensions: CertExtensionInfo[] = cert.extensions.map((ext) => {
    let summary = ext.type;
    if (ext instanceof SubjectAlternativeNameExtension) {
      summary = ext.names.items.map((n) => `${n.type}: ${n.value}`).join(', ');
    } else if (ext instanceof KeyUsagesExtension) {
      const names = KEY_USAGE_NAMES.filter(({ flag }) => (ext.usages & flag) === flag).map(
        (k) => k.name,
      );
      summary = names.join(', ') || '-';
    } else if (ext instanceof ExtendedKeyUsageExtension) {
      summary = ext.usages.map((oid) => EKU_NAMES[oid as string] ?? (oid as string)).join(', ');
    } else if (ext instanceof BasicConstraintsExtension) {
      summary = ext.ca
        ? `CA:TRUE${ext.pathLength !== undefined ? `, pathlen:${ext.pathLength}` : ''}`
        : 'CA:FALSE';
    }
    return { type: ext.type, critical: ext.critical, summary };
  });

  // X509Certificate 暴露的公开字段不含 tbs 版本号,经内部 ASN 对象读取;
  // 私有成员通过交叉类型访问,避免依赖私有 API 类型
  type WithTbs = { tbs?: { version?: number } };
  const inner = cert as unknown as WithTbs;
  const versionNum = inner.tbs?.version ?? 0;
  const version = `v${versionNum + 1}`;

  return {
    version,
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber.toUpperCase(),
    signatureAlgorithm: cert.signatureAlgorithm.name,
    publicKeyAlgorithm: cert.publicKey.algorithm.name,
    notBefore: cert.notBefore,
    notAfter: cert.notAfter,
    validityStatus: validityStatusOf(cert),
    sha1: hex(sha1),
    sha256: hex(sha256),
    extensions,
    sans: sansOf(cert),
    keyUsages: usages,
    extendedUsages: extendedUsagesOf(cert),
    isCA: bc ? bc.ca : null,
    asn1Text: cert.toString('asn'),
  };
}

/** 报告 → 便于复制的纯文本摘要(对标 openssl x509 -noout -text 的常用字段) */
export function reportToText(
  report: CertificateReport,
  field: (key: string, value: string) => string,
  labels: {
    basic: string;
    validity: string;
    signature: string;
    fingerprints: string;
    extensions: string;
  },
  statusText: (s: CertValidityStatus) => string,
  selfSigned?: boolean,
): string {
  const lines: string[] = [
    `[${labels.basic}]`,
    field('Subject', report.subject),
    field('Issuer', report.issuer),
    field('Serial Number', report.serialNumber),
    field('Version', report.version),
    '',
    `[${labels.validity}]`,
    field('Not Before', report.notBefore.toISOString()),
    field('Not After', report.notAfter.toISOString()),
    field('Status', statusText(report.validityStatus)),
    field('Self-Signed', selfSigned === undefined ? '-' : String(selfSigned)),
    '',
    `[${labels.signature}]`,
    field('Signature Algorithm', report.signatureAlgorithm),
    field('Public Key Algorithm', report.publicKeyAlgorithm),
    '',
    `[${labels.fingerprints}]`,
    `SHA-1: ${report.sha1}`,
    `SHA-256: ${report.sha256}`,
  ];
  if (report.extensions.length > 0) {
    lines.push('', `[${labels.extensions}]`);
    for (const ext of report.extensions) {
      lines.push(`${ext.type}${ext.critical ? ' (critical)' : ''}: ${ext.summary}`);
    }
  }
  return lines.join('\n');
}
