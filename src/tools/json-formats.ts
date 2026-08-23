/**
 * JSON → 数据格式转换(YAML / XML / TOML / JSON5 / Properties / URL 参数)
 *
 * 实现说明:
 * - YAML:复用项目既有 `yaml` 包(YAML.stringify)
 * - XML:与 json-utils 的 xmlToJson 约定互逆(@ 键 → 属性、#text → 文本),
 *   数组输出同名兄弟元素,标签名做合法性清洗
 * - TOML:顶层标量在前,对象 → [table],对象数组 → [[array of tables]],
 *   混合数组 → 行内数组;null 无对应类型,输出空串
 * - JSON5:键为合法 ES5 标识符时省略引号,字符串沿用双引号(均为合法 JSON5)
 * - Properties:点号扁平化(a.b.c=v),纯标量数组以逗号合并,其余按下标展开
 * - URL 参数:URLSearchParams 编码,数组重复同名键,嵌套用点号路径
 */

import { stringify as yamlStringify } from 'yaml';

export type DataFormatId = 'xml' | 'yaml' | 'toml' | 'json5' | 'properties' | 'urlparams';

/** 转换为菜单「数据格式」分组项(label 与顺序供 UI 使用) */
export const DATA_FORMAT_ITEMS: ReadonlyArray<{ id: DataFormatId; label: string }> = [
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'json5', label: 'JSON5' },
  { id: 'properties', label: 'Properties' },
  { id: 'urlparams', label: 'URL 参数' },
];

// ============================================================
// YAML
// ============================================================

/** 由 JSON 值生成 YAML(yaml 包默认 2 空格缩进) */
export function jsonToYaml(value: unknown): string {
  return yamlStringify(value);
}

// ============================================================
// XML
// ============================================================

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttribute(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

/** 由键名清洗出合法 XML 标签名(非法字符 → _,数字开头补前缀,空回退 item) */
function xmlTagName(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!cleaned || /^[.0-9-]/.test(cleaned)) return `_${cleaned}`.replace(/^[._-]+/, '_') || 'item';
  return cleaned;
}

interface XmlEmitState {
  lines: string[];
  indent: number;
}

function emitXmlElement(state: XmlEmitState, tag: string, value: unknown): void {
  const pad = '  '.repeat(state.indent);
  if (value === null || value === undefined) {
    state.lines.push(`${pad}<${tag}/>`);
    return;
  }
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean': {
      const text = escapeXmlText(String(value));
      state.lines.push(`${pad}<${tag}>${text}</${tag}>`);
      return;
    }
    case 'object': {
      if (Array.isArray(value)) {
        // 数组:同名兄弟元素
        for (const item of value) emitXmlElement(state, tag, item);
        return;
      }
      const entries = Object.entries(value as Record<string, unknown>);
      const attributes = entries.filter(([k]) => k.startsWith('@'));
      const children = entries.filter(([k]) => !k.startsWith('@'));
      const textEntry = children.find(([k]) => k === '#text');
      const elements = children.filter(([k]) => k !== '#text');

      const attrPart = attributes
        .map(([k, v]) => ` ${xmlTagName(k.slice(1))}="${escapeXmlAttribute(String(v ?? ''))}"`)
        .join('');
      const innerText = textEntry ? escapeXmlText(String(textEntry[1] ?? '')) : '';

      if (elements.length === 0 && !innerText) {
        state.lines.push(`${pad}<${tag}${attrPart}/>`);
        return;
      }
      if (elements.length === 0) {
        state.lines.push(`${pad}<${tag}${attrPart}>${innerText}</${tag}>`);
        return;
      }
      state.lines.push(`${pad}<${tag}${attrPart}>`);
      if (innerText) state.lines.push(`${'  '.repeat(state.indent + 1)}${innerText}`);
      const childState: XmlEmitState = { ...state, indent: state.indent + 1 };
      for (const [childTag, childValue] of elements) {
        emitXmlElement(childState, xmlTagName(childTag), childValue);
      }
      state.lines.push(`${pad}</${tag}>`);
      return;
    }
    default:
      state.lines.push(`${pad}<${tag}/>`);
  }
}

/**
 * 由 JSON 值生成 XML 文本(带声明头)。
 * - 对象根:每个键作为顶层元素(多顶层元素,便于片段使用)
 * - 数组根 / 标量根:包裹在 <root> 下保证单根合法文档
 * - 对象键以 @ 开头视为属性、#text 视为文本内容(与 xmlToJson 往返兼容)
 */
export function jsonToXml(value: unknown): string {
  const state: XmlEmitState = { lines: [], indent: 0 };
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length > 0
  ) {
    // 对象根:每个键作为顶层元素
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      emitXmlElement(state, xmlTagName(key), child);
    }
  } else if (Array.isArray(value)) {
    state.lines.push('<root>');
    const childState: XmlEmitState = { lines: state.lines, indent: 1 };
    for (const item of value) emitXmlElement(childState, 'item', item);
    state.lines.push('</root>');
  } else {
    // 标量或空对象根:<root> 包裹
    emitXmlElement(state, 'root', value ?? '');
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>', ...state.lines].join('\n');
}

// ============================================================
// TOML
// ============================================================

/** TOML 裸键仅允许 A-Za-z0-9_-;其余加引号 */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlScalar(value: unknown): string {
  if (value === null || value === undefined) return '""';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
    case 'number':
      return String(value);
    default:
      return JSON.stringify(JSON.stringify(value));
  }
}

/** 行内数组(仅当元素全为标量);否则返回 null 表示需展开 */
function tomlInlineArray(items: unknown[]): string | null {
  if (items.some((v) => v !== null && typeof v === 'object')) return null;
  return `[${items.map(tomlScalar).join(', ')}]`;
}

function emitTomlTable(lines: string[], path: string[], obj: Record<string, unknown>): void {
  const header = path.length > 0 ? `[${path.map(tomlKey).join('.')}]` : '';
  const entries = Object.entries(obj);
  // 分类:标量与行内数组先输出(必须位于任何 [table] 头之前),
  // 对象数组([[table]])次之,子表深度优先最后
  const inline = entries.filter(([, v]) => {
    if (v === null || typeof v !== 'object') return true;
    return Array.isArray(v) && tomlInlineArray(v) !== null;
  });
  const arrayOfTables = entries.filter(([, v]) => Array.isArray(v) && tomlInlineArray(v) === null);
  const tables = entries.filter(
    ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
  );

  if (header) {
    if (lines.length > 0) lines.push('');
    lines.push(header);
  }
  for (const [key, value] of inline) {
    lines.push(
      `${tomlKey(key)} = ${Array.isArray(value) ? tomlInlineArray(value) : tomlScalar(value)}`,
    );
  }
  for (const [key, value] of arrayOfTables) {
    emitTomlArrayOfTables(lines, [...path, key], value as Array<Record<string, unknown>>);
  }
  // 子表深度优先,保证父表先于子表出现
  for (const [key, value] of tables) {
    emitTomlTable(lines, [...path, key], value as Record<string, unknown>);
  }
}

function emitTomlArrayOfTables(
  lines: string[],
  path: string[],
  items: Array<Record<string, unknown>>,
): void {
  for (const item of items) {
    const entries = Object.entries(item);
    const inline = entries.filter(([, v]) => {
      if (v === null || typeof v !== 'object') return true;
      return Array.isArray(v) && tomlInlineArray(v) !== null;
    });
    const arrayOfTables = entries.filter(
      ([, v]) => Array.isArray(v) && tomlInlineArray(v) === null,
    );
    const tables = entries.filter(
      ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
    );

    if (lines.length > 0) lines.push('');
    lines.push(`[[${path.map(tomlKey).join('.')}]]`);
    for (const [key, value] of inline) {
      lines.push(
        `${tomlKey(key)} = ${Array.isArray(value) ? tomlInlineArray(value) : tomlScalar(value)}`,
      );
    }
    for (const [key, value] of arrayOfTables) {
      emitTomlArrayOfTables(lines, [...path, key], value as Array<Record<string, unknown>>);
    }
    for (const [key, value] of tables) {
      emitTomlTable(lines, [...path, key], value as Record<string, unknown>);
    }
  }
}

/**
 * 由 JSON 值生成 TOML 文本。
 * 根须为对象(数组/标量根返回注释说明);null 输出空串(TOML 无 null 类型)。
 */
export function jsonToToml(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return '# 根节点不是 JSON 对象,无法生成 TOML';
  }
  const lines: string[] = [];
  emitTomlTable(lines, [], value as Record<string, unknown>);
  return lines.join('\n');
}

// ============================================================
// JSON5
// ============================================================

/** 合法 ES5 标识符的键可省略引号 */
function json5Key(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function json5Value(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return `[\n${value
          .map((v) => `${innerPad}${json5Value(v, indent + 1)}`)
          .join(',\n')}\n${pad}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      return `{\n${entries
        .map(([k, v]) => `${innerPad}${json5Key(k)}: ${json5Value(v, indent + 1)}`)
        .join(',\n')}\n${pad}}`;
    }
    default:
      return 'null';
  }
}

/** 由 JSON 值生成 JSON5 文本(标识符键免引号) */
export function toJson5(value: unknown): string {
  return json5Value(value, 0);
}

// ============================================================
// Properties
// ============================================================

function escapePropertiesKey(key: string): string {
  return key.replace(/([=:\s#!!\\])/g, '\\$1');
}

function escapePropertiesValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function flattenProperties(value: unknown, prefix: string, out: Array<[string, string]>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.push([prefix, '']);
      return;
    }
    for (const [key, child] of entries) {
      flattenProperties(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    // 全标量数组:逗号合并;含对象/数组则按下标展开
    if (value.every((v) => v === null || typeof v !== 'object')) {
      out.push([
        prefix,
        value.map((v) => (v === null || v === undefined ? '' : String(v))).join(', '),
      ]);
      return;
    }
    value.forEach((child, i) => flattenProperties(child, `${prefix}.${i}`, out));
    return;
  }
  out.push([
    prefix,
    value === null || value === undefined ? '' : escapePropertiesValue(String(value)),
  ]);
}

/**
 * 由 JSON 值生成 .properties 文本(点号扁平化;键转义空格/=/: 等)。
 * 根须为对象。
 */
export function jsonToProperties(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return '# 根节点不是 JSON 对象,无法生成 Properties';
  }
  const out: Array<[string, string]> = [];
  flattenProperties(value, '', out);
  return out.map(([k, v]) => `${escapePropertiesKey(k)}=${v}`).join('\n');
}

// ============================================================
// URL 参数
// ============================================================

/**
 * 由 JSON 值生成 URL 查询字符串(application/x-www-form-urlencoded):
 * - 嵌套对象使用点号路径(a.b=c)
 * - 数组重复同名键(a=1&a=2);全标量数组亦可选逗号合并——此处保持重复键语义
 * - null / undefined 输出仅有键名?URLSearchParams 需要值,统一输出空值(key=)
 */
export function jsonToUrlParams(value: unknown): string {
  const params = new URLSearchParams();
  const walk = (node: unknown, prefix: string): void => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, prefix);
      return;
    }
    params.append(prefix, node === null || node === undefined ? '' : String(node));
  };
  walk(value, '');
  return params.toString();
}
