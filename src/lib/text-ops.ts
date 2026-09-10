/**
 * 文本处理工具的结构化操作:查找替换、模式提取、词频统计。
 *
 * 纯函数、零依赖、无副作用;查找替换抛出的 SyntaxError 由 UI 层捕获并 toast。
 */

export interface FindReplaceOptions {
  /** true 按 RegExp 解释 pattern,false 按纯文本字面量匹配 */
  regex: boolean;
  /** false 时 pattern 大小写不敏感 */
  caseSensitive: boolean;
}

/**
 * 查找替换:regex 模式下支持 $1/$2… 捕获组模板(与 JS replace 原生语义一致)。
 * 空 pattern 原样返回;非法正则抛 SyntaxError。
 */
export function applyFindReplace(
  input: string,
  pattern: string,
  replacement: string,
  options: FindReplaceOptions,
): string {
  if (pattern === '') return input;
  const flags = options.caseSensitive ? 'g' : 'gi';
  const source = options.regex ? pattern : escapeRegExp(pattern);
  const re = new RegExp(source, flags);
  // String.replace 的 replacement 原生支持 $1..$99 捕获组引用
  return input.replace(re, replacement);
}

/** 纯文本查找用的正则元字符转义 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 提取器预设(在线工具站与 CyberChef Extractors 验证的高频族)
// ============================================================

export type ExtractPresetId = 'url' | 'email' | 'ip' | 'date' | 'quoted';

export interface ExtractPreset {
  id: ExtractPresetId;
  /** 提取正则(全局,自 source 直接构造) */
  source: string;
}

export const EXTRACT_PRESETS: ReadonlyArray<ExtractPreset> = [
  {
    id: 'url',
    // 覆盖 http/https 常见 URL;不含结尾标点(如句末的 . ,)
    source: 'https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+[A-Za-z0-9_~:/?#@!$&*+,;=%-]',
  },
  {
    id: 'email',
    source: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
  },
  {
    id: 'ip',
    source: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
  },
  {
    id: 'date',
    // ISO 8601 短形式,兼容 - 与 / 分隔
    source: '\\b\\d{4}[-/]\\d{2}[-/]\\d{2}\\b',
  },
  {
    id: 'quoted',
    source: '"([^"\\n]*)"',
  },
];

const PRESET_BY_ID: ReadonlyMap<ExtractPresetId, ExtractPreset> = new Map(
  EXTRACT_PRESETS.map((p) => [p.id, p]),
);

/**
 * 按预设提取匹配项,每项一行;按首次出现顺序去重。
 * quoted 预设返回引号内的内容(捕获组 1),其余返回整段匹配。
 */
export function extractPattern(input: string, presetId: ExtractPresetId): string {
  const preset = PRESET_BY_ID.get(presetId);
  if (!preset || !input) return '';
  const re = new RegExp(preset.source, 'g');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of input.matchAll(re)) {
    const value = presetId === 'quoted' ? (m[1] ?? '') : m[0];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.join('\n');
}

// ============================================================
// 词频统计
// ============================================================

export interface WordFreqRow {
  value: string;
  count: number;
}

export interface WordFrequencyOptions {
  /** 分隔符;缺省按任意空白切分 */
  delimiter?: string;
}

/**
 * 词频统计:切分文本并对每段计数,按「次数降序、首次出现升序」排列,
 * 与重复行检测器的「值 / 数量」表格同一口径。
 */
export function wordFrequency(
  input: string,
  options: WordFrequencyOptions = {},
): WordFreqRow[] {
  const { delimiter } = options;
  const segments = delimiter !== undefined ? input.split(delimiter) : input.split(/\s+/);
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const seg of segments) {
    const value = delimiter !== undefined ? seg.trim() : seg;
    if (!value) continue;
    const prev = counts.get(value);
    if (prev === undefined) {
      counts.set(value, 1);
      order.push(value);
    } else {
      counts.set(value, prev + 1);
    }
  }
  return order
    .map((value) => ({ value, count: counts.get(value)! }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.value) - order.indexOf(b.value));
}
