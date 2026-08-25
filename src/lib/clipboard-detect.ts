/**
 * 剪贴板内容 → 建议工具 的本地启发式探测(Smart Detection 轻量版)。
 * 纯函数、零网络、零副作用;仅在用户开启开关后被 App 层调用(见 App.tsx)。
 */
export interface DetectionResult {
  toolId: string;
  reason: string;
}

const MAX_INPUT_CHARS = 65_536;
const MAX_RESULTS = 3;

function looksLikeJwt(text: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text);
}

function looksLikeBase64(text: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  if (text.length < 20 || text.length % 4 !== 0) return false;
  try {
    return atob(text).length >= 8;
  } catch {
    return false;
  }
}

function looksLikeUrlEncoded(text: string): boolean {
  // 至少两组 %XX,避免把「100% 正常文本」误判
  const matches = text.match(/%[0-9A-Fa-f]{2}/g) ?? [];
  return matches.length >= 2;
}

function isProbablyJson(text: string): boolean {
  if (!/^[[{]/.test(text) || !/[\]}]$/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** 对剪贴板原文做类型探测,返回建议工具(置信度降序,至多 3 条) */
export function detectClipboardTools(raw: string): DetectionResult[] {
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text || text.length > MAX_INPUT_CHARS) return [];

  const results: DetectionResult[] = [];
  if (/^-----BEGIN CERTIFICATE-----/.test(text)) {
    results.push({ toolId: 'certificate_decoder', reason: 'PEM 证书' });
  }
  if (looksLikeJwt(text)) results.push({ toolId: 'jwt_parser', reason: 'JWT 结构' });
  if (isProbablyJson(text)) results.push({ toolId: 'json_formatter', reason: 'JSON 内容' });
  if (looksLikeBase64(text)) results.push({ toolId: 'base64_codec', reason: 'Base64 编码' });
  if (looksLikeUrlEncoded(text)) results.push({ toolId: 'url_codec', reason: 'URL 编码片段' });
  return results.slice(0, MAX_RESULTS);
}
