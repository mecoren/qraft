/**
 * JWT 解析纯逻辑:纯前端解码,无 IPC 往返
 *
 * - header / payload base64url 解码 + JSON 解析
 * - 标准 claims(iat / nbf / exp)秒级时间戳可读化与过期状态计算
 * - 解析全程不验证签名(与 jwt.io 解析区一致;签名校验需密钥,超工具范围)
 */

export interface JwtPayloadMeta {
  /** iat → Date;缺失为 null */
  issuedAt: Date | null;
  /** exp → Date */
  expiresAt: Date | null;
  /** nbf → Date */
  notBefore: Date | null;
  /** 相对 now 的过期状态 */
  status: 'valid' | 'expired' | 'not_yet_valid' | 'unknown';
}

export interface ParsedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** 时间戳 claims 元数据(exp/iat/nbf 全缺失时 status='unknown') */
  meta: JwtPayloadMeta;
}

/** base64url(无 padding)→ bytes;宽容处理标准 base64 与空白 */
export function base64UrlToBytes(segment: string): Uint8Array {
  const cleaned = segment.replace(/\s+/g, '');
  const normalized = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToJsonBytes(bytes: Uint8Array): Record<string, unknown> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('segment is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** 秒级时间戳 → Date;非有限数值返回 null */
function tsToDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

/**
 * 解析 JWT;格式错误抛 Error(消息英文技术短语,UI 层本地化包装)。
 * @param token 形如 header.payload.signature 的 JWS 紧凑序列
 */
export function parseJwt(token: string): ParsedJwt {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error(`JWT must have 3 dot-separated segments, got ${parts.length}`);
  }
  if (!parts[0] || !parts[1]) {
    throw new Error('header or payload segment is empty');
  }
  const header = bytesToJsonBytes(base64UrlToBytes(parts[0]));
  const payload = bytesToJsonBytes(base64UrlToBytes(parts[1]));

  const issuedAt = tsToDate(payload.iat);
  const expiresAt = tsToDate(payload.exp);
  const notBefore = tsToDate(payload.nbf);
  const now = Date.now();
  let status: JwtPayloadMeta['status'] = 'unknown';
  if (expiresAt || notBefore) {
    if (expiresAt && now > expiresAt.getTime()) status = 'expired';
    else if (notBefore && now < notBefore.getTime()) status = 'not_yet_valid';
    else status = 'valid';
  }

  return {
    header,
    payload,
    signature: parts[2],
    meta: { issuedAt, expiresAt, notBefore, status },
  };
}

/** 标准 claims 的 key(渲染时高亮为已知字段) */
export const STANDARD_CLAIMS = new Set([
  'iss',
  'sub',
  'aud',
  'exp',
  'nbf',
  'iat',
  'jti',
  'alg',
  'typ',
  'kid',
]);

/** 时间戳 claim 的可读化文案:值 + 本地时间(用于列表渲染) */
export function formatClaimDate(value: unknown): { raw: string; date: Date } | null {
  const d = tsToDate(value);
  return d ? { raw: String(value), date: d } : null;
}
