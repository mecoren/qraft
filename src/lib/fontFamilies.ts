/**
 * 字体族工具：UI 字体与代码字体(Mono)的选项构造、排序、搜索匹配。
 *
 * 参考 GoNavi 的实现思路：
 * - 优先展示系统已安装字体；UI 字体按字母序排列
 * - 代码字体(Mono)按"名称是否包含 Mono/Code/Console 等关键字"打分，
 *   分数高者靠前；分数相同再按字母序
 * - 提供 sanitize(清理)、dedupe(去重)、buildOptions(构造)、matchOption(搜索匹配) 等纯函数
 *
 * 与 GoNavi 的差异：
 * - 不区分平台静态预设(Windows/macOS/Linux)，qraft 只展示"系统已安装 + 默认项"
 * - 选项 value 直接是"字体族名(不带 fallback 栈)"，由 theme.ts 在应用时拼接 fallback
 */

// ============================================================
// 常量
// ============================================================

/** UI 字体默认值(未自定义时回退到此栈) */
export const DEFAULT_UI_FONT_FAMILY =
  "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";

/** 代码字体默认值(默认 JetBrains Mono) */
export const DEFAULT_MONO_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', monospace";

/** 单个字体族字符串最大长度(防御性截断) */
const MAX_FONT_FAMILY_LENGTH = 512;

/**
 * Mono 字体优先关键字：包含这些字样的字体族在"代码字体"下拉中靠前展示。
 *
 * 来源：GoNavi fontFamilies.ts 的 MONO_FONT_PRIORITY_HINTS
 */
const MONO_FONT_PRIORITY_HINTS = [
  'mono',
  'code',
  'console',
  'terminal',
  'jetbrains',
  'cascadia',
  'consolas',
  'courier',
  'fira',
  'hack',
  'iosevka',
  'menlo',
  'monaco',
  'operator',
  'sarasa',
  'sf mono',
  'source code',
  'ubuntu mono',
];

// ============================================================
// 类型
// ============================================================

export interface FontFamilyOption {
  /** CSS font-family 用的字体族名(单一名，不含 fallback) */
  value: string;
  /** UI 展示名称 */
  label: string;
  /** 是否为默认项(显示在列表顶部) */
  isDefault?: boolean;
  /** 搜索关键词(由 family 派生，无需外部传入) */
  keywords?: string[];
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 规范化用户输入/外部字符串为字体族名。
 * - 折叠空白、去首尾空白
 * - 空字符串/非字符串/null 返回 null
 * - 长度超过 512 字符截断
 */
export function sanitizeFontFamilyInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_FONT_FAMILY_LENGTH);
}

/**
 * 解析最终生效的 UI 字体栈：自定义值优先，否则回退到默认栈。
 */
export function resolveUIFontFamily(customValue: unknown): string {
  return sanitizeFontFamilyInput(customValue) ?? DEFAULT_UI_FONT_FAMILY;
}

/**
 * 解析最终生效的代码字体栈：自定义值优先，否则回退到默认栈(JetBrains Mono)。
 */
export function resolveMonoFontFamily(customValue: unknown): string {
  return sanitizeFontFamilyInput(customValue) ?? DEFAULT_MONO_FONT_FAMILY;
}

/**
 * 把任意字符串转为搜索 token：转小写并移除非字母数字/CJK 字符。
 * 用于"忽略大小写、忽略空格/连字符"的模糊匹配。
 */
function normalizeFontSearchToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

/**
 * 在字体名中插入词边界空格，便于"JetBrainsMono" → "JetBrains Mono" 的展示。
 * 用于 PascalCase / camelCase 字体名的展示标签。
 */
function insertFontNameWordBreaks(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2');
}

/**
 * 给字体族名打"是否疑似等宽字体"的分数：包含 MONO_FONT_PRIORITY_HINTS 中
 * 任一关键字加 10 分，否则 0 分。分数高者在代码字体下拉中靠前。
 */
export function scoreMonoFontFamily(family: string): number {
  const normalized = family.toLowerCase();
  return MONO_FONT_PRIORITY_HINTS.reduce(
    (score, hint) => (normalized.includes(hint) ? score + 10 : score),
    0,
  );
}

/** 该字体族是否疑似等宽字体(分数 > 0) */
export function isMonoFontCandidate(family: string): boolean {
  return scoreMonoFontFamily(family) > 0;
}

/**
 * 由字体族名派生搜索关键词：family 原文、family 小写、family 紧凑形式、
 * 展示标签、展示标签小写、展示标签紧凑形式。
 */
function buildFontKeywords(family: string): string[] {
  const label = insertFontNameWordBreaks(family);
  const tokens = family
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  const labelTokens = label
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  return Array.from(
    new Set(
      [
        ...tokens,
        ...labelTokens,
        family.toLowerCase(),
        label.toLowerCase(),
        normalizeFontSearchToken(family),
        normalizeFontSearchToken(label),
      ].filter(Boolean),
    ),
  );
}

/**
 * 规范化字体族名：与 sanitizeFontFamilyInput 一致，但保证返回非空字符串或 null。
 * 用于选项构造时的统一清洗。
 */
function normalizeFamilyName(family: string): string | null {
  return sanitizeFontFamilyInput(family);
}

/**
 * 格式化字体族展示标签：插入词边界空格 + 清洗。
 */
function formatFontLabel(family: string): string {
  return sanitizeFontFamilyInput(insertFontNameWordBreaks(family)) ?? family;
}

/**
 * 选项去重：按 value 与 label 双键去重，保留首次出现的版本。
 */
function dedupeFontOptions(options: FontFamilyOption[]): FontFamilyOption[] {
  const seenLabels = new Set<string>();
  const seenValues = new Set<string>();
  const result: FontFamilyOption[] = [];
  for (const option of options) {
    const value = sanitizeFontFamilyInput(option.value);
    if (!value) continue;
    const label = sanitizeFontFamilyInput(option.label)?.toLowerCase() ?? '';
    if ((label && seenLabels.has(label)) || seenValues.has(value)) continue;
    if (label) seenLabels.add(label);
    seenValues.add(value);
    result.push({
      value,
      label: option.label,
      isDefault: option.isDefault,
      keywords: option.keywords,
    });
  }
  return result;
}

/**
 * 选项排序：
 * - isDefault 项始终排最前
 * - 其余按 label 字母序(localeCompare，base sensitivity，numeric)
 */
function sortFontOptions(options: FontFamilyOption[]): FontFamilyOption[] {
  const defaultOptions: FontFamilyOption[] = [];
  const regularOptions: FontFamilyOption[] = [];
  options.forEach((option) => {
    if (option.isDefault) defaultOptions.push(option);
    else regularOptions.push(option);
  });
  regularOptions.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  );
  return [...defaultOptions, ...regularOptions];
}

// ============================================================
// 选项构造
// ============================================================

/**
 * 把系统已安装的字体族列表转化为下拉选项。
 *
 * @param families 系统已安装的字体族名数组(由 listSystemFonts 返回)
 * @param kind 'ui' 或 'mono'
 * - 'ui'：全部安装字体按字母序展示
 * - 'mono'：仅保留 isMonoFontCandidate 为 true 的字体，按 Mono 分数降序后字母序
 */
export function buildInstalledFontOptions(
  families: string[],
  kind: 'ui' | 'mono',
): FontFamilyOption[] {
  const familyNames: string[] = [];
  const seen = new Set<string>();

  for (const raw of families) {
    const family = normalizeFamilyName(raw);
    if (!family) continue;
    // mono 模式：过滤掉非等宽候选
    if (kind === 'mono' && !isMonoFontCandidate(family)) continue;
    const dedupeKey = family.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    familyNames.push(family);
  }

  // 排序：mono 模式按 Mono 分数降序优先，再字母序；ui 模式仅字母序
  familyNames.sort((left, right) => {
    if (kind === 'mono') {
      const scoreDiff = scoreMonoFontFamily(right) - scoreMonoFontFamily(left);
      if (scoreDiff !== 0) return scoreDiff;
    }
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });

  return familyNames.map((family) => ({
    value: family,
    label: formatFontLabel(family),
    keywords: ['installed', ...buildFontKeywords(family)],
  }));
}

/**
 * 构造完整的字体族下拉选项：
 * - 第一项为"默认"项(isDefault=true)
 * - 之后是系统已安装字体(已按 kind 排序)
 *
 * @param families 系统已安装字体族名数组
 * @param kind 'ui' 或 'mono'
 * @param defaultLabel 默认项的展示文案(如"默认 UI 字体"/"默认代码字体")
 */
export function buildFontFamilyOptions(
  families: string[],
  kind: 'ui' | 'mono',
  defaultLabel: string,
): FontFamilyOption[] {
  const defaultValue = kind === 'ui' ? DEFAULT_UI_FONT_FAMILY : DEFAULT_MONO_FONT_FAMILY;
  return sortFontOptions(
    dedupeFontOptions([
      {
        value: defaultValue,
        label: defaultLabel,
        isDefault: true,
        keywords: ['default', 'system', kind],
      },
      ...buildInstalledFontOptions(families, kind),
    ]),
  );
}

// ============================================================
// 搜索匹配
// ============================================================

/**
 * 自定义搜索匹配函数(用于 cmdk combobox 的 filter)：
 * - 空输入匹配所有项
 * - 否则在 option.label / option.value / option.keywords 中查找包含关系
 * - 支持紧凑形式匹配(忽略空格/连字符/大小写)
 */
export function matchFontFamilyOption(
  input: string,
  option?: FontFamilyOption,
): boolean {
  const normalizedInput = String(input || '').trim().toLowerCase();
  if (!normalizedInput) return true;
  if (!option) return false;
  const compactInput = normalizeFontSearchToken(normalizedInput);
  return [option.label, option.value, ...(option.keywords ?? [])].some((entry) => {
    const text = String(entry || '').toLowerCase();
    if (text.includes(normalizedInput)) return true;
    return compactInput ? normalizeFontSearchToken(text).includes(compactInput) : false;
  });
}
