/**
 * 字符命名转换工具。
 *
 * 支持在多种常见命名风格之间循环切换；无法识别风格时仅切换大小写。
 */

export type NamingConventionId =
  | 'kebab-case'
  | 'SNAKE_CASE'
  | 'Camel Case'
  | 'CamelCase'
  | 'camelCase'
  | 'snake_case'
  | 'space case';

export interface NamingConvention {
  id: NamingConventionId;
  label: string;
  detect: (text: string) => boolean;
  convert: (words: string[]) => string;
}

/** 所有支持的命名风格，按默认循环顺序排列。 */
export const NAMING_CONVENTIONS: NamingConvention[] = [
  {
    id: 'kebab-case',
    label: 'kebab-case',
    detect: (text) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(text),
    convert: (words) => words.map((w) => w.toLowerCase()).join('-'),
  },
  {
    id: 'SNAKE_CASE',
    label: 'SNAKE_CASE',
    detect: (text) => /^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(text),
    convert: (words) => words.map((w) => w.toUpperCase()).join('_'),
  },
  {
    id: 'Camel Case',
    label: 'Camel Case',
    detect: (text) => /^[A-Z][a-z0-9]*([ ][A-Z][a-z0-9]*)+$/.test(text),
    convert: (words) => words.map((w) => capitalize(w)).join(' '),
  },
  {
    id: 'CamelCase',
    label: 'CamelCase',
    detect: (text) => /^[A-Z][a-zA-Z0-9]*([A-Z][a-zA-Z0-9]*)+$/.test(text),
    convert: (words) => words.map((w) => capitalize(w)).join(''),
  },
  {
    id: 'camelCase',
    label: 'camelCase',
    detect: (text) => /^[a-z][a-z0-9]*([A-Z][a-zA-Z0-9]*)+$/.test(text),
    convert: (words) =>
      words
        .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
        .join(''),
  },
  {
    id: 'snake_case',
    label: 'snake_case',
    detect: (text) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(text),
    convert: (words) => words.map((w) => w.toLowerCase()).join('_'),
  },
  {
    id: 'space case',
    label: 'space case',
    detect: (text) => /^[a-z0-9]+([ ][a-z0-9]+)+$/.test(text),
    convert: (words) => words.map((w) => w.toLowerCase()).join(' '),
  },
];

const NAMING_CONVENTION_MAP = new Map<NamingConventionId, NamingConvention>(
  NAMING_CONVENTIONS.map((c) => [c.id, c]),
);

function capitalize(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * 将任意文本拆分为单词数组。
 *
 * 识别分隔符：空格、下划线、连字符；同时识别大小写驼峰边界。
 */
export function splitWords(text: string): string[] {
  const normalized = text
    // 先按显式分隔符切开
    .split(/[\s_-]+/)
    // 再按驼峰边界切开（如 "fooBar" → "foo Bar"）
    .flatMap((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1 $2')
        .split(' '),
    )
    .filter((w) => w.length > 0);
  return normalized;
}

/**
 * 检测文本属于哪一种命名风格。
 *
 * 按 NAMING_CONVENTIONS 的顺序匹配，优先匹配更具体的风格。
 */
export function detectConvention(text: string): NamingConvention | null {
  for (const convention of NAMING_CONVENTIONS) {
    if (convention.detect(text)) return convention;
  }
  return null;
}

/**
 * 在启用风格中循环切换到下一个风格。
 *
 * @param text 当前选中的文本
 * @param enabled 启用的风格 ID 集合
 * @param order 风格排序（决定循环顺序）
 * @returns 转换后的文本；无法识别且不属于任何启用风格时切换大小写
 */
export function cycleNamingCase(
  text: string,
  enabled: NamingConventionId[],
  order: NamingConventionId[],
): string {
  if (enabled.length === 0) {
    return toggleCase(text);
  }

  const ordered = order
    .filter((id) => enabled.includes(id))
    .filter((id, idx, arr) => arr.indexOf(id) === idx);
  if (ordered.length === 0) {
    return toggleCase(text);
  }

  const current = detectConvention(text);
  let startIndex = 0;
  if (current && ordered.includes(current.id)) {
    startIndex = (ordered.indexOf(current.id) + 1) % ordered.length;
  }

  const nextId = ordered[startIndex];
  const nextConvention = NAMING_CONVENTION_MAP.get(nextId);
  if (!nextConvention) {
    return toggleCase(text);
  }

  const words = splitWords(text);
  if (words.length === 0) return text;

  return nextConvention.convert(words);
}

/** 对整段文本切换大小写。 */
function toggleCase(text: string): string {
  if (text === text.toUpperCase()) {
    return text.toLowerCase();
  }
  return text.toUpperCase();
}
