/**
 * 剪贴板内容 → 建议工具 的本地启发式探测(Smart Detection)。
 * 纯函数、零网络、零副作用;仅在用户开启开关后被 App 层调用(见 App.tsx)。
 */
export interface DetectionResult {
  toolId: string;
  /** 命中原因(i18n 键名,展示层翻译) */
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

/** 完整 http/https URL(单行、无空白;须带 host,避免把普通域名文本误判) */
function looksLikeUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 纯数字时间戳:10 位秒级(2001-2286 年)或 13 位毫秒级(1971-5138 年)。
 * 正则限定纯数字,天然排除十六进制哈希歧义。
 */
function looksLikeTimestamp(text: string): boolean {
  return /^\d{10}$/.test(text) || /^\d{13}$/.test(text);
}

/** 十六进制哈希摘要:长度 ∈ {32,40,56,64,96,128}(MD5/SHA1/SHA224/SHA256/SHA384/SHA512) */
function looksLikeHash(text: string): boolean {
  if (!/^[0-9a-f]+$/i.test(text)) return false;
  return [32, 40, 56, 64, 96, 128].includes(text.length);
}

/**
 * 命中置信度:决定同一次探测多命中时的排序(PREMIUM 高置信,其余标准)。
 * 高置信特征:单一格式、无歧义、整段内容就是该格式本身(PEM/JWT/时间戳/UUID/哈希)。
 */
const PREMIUM_TOOLS = new Set([
  'certificate_decoder',
  'public_key_decoder',
  'jwt_parser',
  'timestamp_converter',
  'hash_calculator',
]);

/** 对剪贴板原文做类型探测,返回建议工具(置信度降序,至多 3 条) */
export function detectClipboardTools(raw: string): DetectionResult[] {
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text || text.length > MAX_INPUT_CHARS) return [];

  const results: DetectionResult[] = [];
  if (/^-----BEGIN CERTIFICATE-----/.test(text)) {
    results.push({ toolId: 'certificate_decoder', reason: 'chrome.detect.reason_pem' });
  }
  // 公钥/私钥 PEM(须在证书判断之后:BEGIN 词不同互不冲突,但保持语义分组清晰)
  if (/^-----BEGIN (RSA )?(PUBLIC|PRIVATE) KEY-----/.test(text)) {
    results.push({ toolId: 'public_key_decoder', reason: 'chrome.detect.reason_key_pem' });
  }
  if (looksLikeJwt(text))
    results.push({ toolId: 'jwt_parser', reason: 'chrome.detect.reason_jwt' });
  if (looksLikeTimestamp(text))
    results.push({ toolId: 'timestamp_converter', reason: 'chrome.detect.reason_timestamp' });
  if (looksLikeHash(text))
    results.push({ toolId: 'hash_calculator', reason: 'chrome.detect.reason_hash' });
  if (looksLikeUrl(text))
    results.push({ toolId: 'qrcode_tool', reason: 'chrome.detect.reason_url' });
  if (isProbablyJson(text))
    results.push({ toolId: 'json_formatter', reason: 'chrome.detect.reason_json' });
  if (looksLikeBase64(text))
    results.push({ toolId: 'base64_codec', reason: 'chrome.detect.reason_base64' });
  if (looksLikeUrlEncoded(text))
    results.push({ toolId: 'json_minifier', reason: 'chrome.detect.reason_url_encoded' });

  const premium = results.filter((r) => PREMIUM_TOOLS.has(r.toolId));
  const standard = results.filter((r) => !PREMIUM_TOOLS.has(r.toolId));
  return [...premium, ...standard].slice(0, MAX_RESULTS);
}
