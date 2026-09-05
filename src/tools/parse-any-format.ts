/**
 * 多格式输入解析(YAML / TOML / JSON5 / Properties / URL 参数 → JSON 值)
 *
 * 与 json-utils 的关系:parseSmart 是「自动嗅探 + 解析」的入口,本模块只
 * 提供各格式解析器与格式判定;两者共同支撑 JSON 格式化工具的
 * 「任意格式输入自动转 JSON」。XML 不在本模块(以 `<` 开头,由 json-utils
 * 的 xmlToJson 处理)。
 *
 * 设计约束:
 * - 零新增依赖:YAML 复用项目既有 `yaml` 包,TOML / JSON5 / Properties /
 *   URL 参数为内置实现(覆盖范围见各解析器注释)
 * - 判定规则保守:宁可对失败输入如实抛错,也不把破损 JSON 误判成别的格式
 *   静默吞掉
 */

import { parse as yamlParse } from 'yaml';

/** 解析失败的统一错误类型:对外只呈现 message,由调用方写入输出框 */
export class ParseFormatError extends Error {
  /** 按哪种格式解析失败(用于错误消息) */
  readonly formatId: string;
  constructor(formatId: string, message: string) {
    super(message);
    this.name = 'ParseFormatError';
    this.formatId = formatId;
  }
}

// ============================================================
// YAML → JSON
// ============================================================

/** 解析 YAML 文本为 JSON 值(yaml 包 YAML.parse,支持多文档时取首个) */
export function yamlToJson(input: string): unknown {
  try {
    return yamlParse(input);
  } catch (e) {
    throw new ParseFormatError('yaml', e instanceof Error ? e.message : String(e));
  }
}

// ============================================================
// TOML → JSON(内置子集解析器)
// ============================================================

/**
 * 解析 TOML 文本为 JSON 值(固定为对象)。
 * 覆盖 TOML v1.0 常用子集:
 * - 键值对:bare / "basic" / 'literal' 键与 dotted 路径
 * - 值:字符串(含多行 """ '''、转义、\uXXXX)、整数(含 0x/0o/0b、下划线分隔)、
 *   浮点(含 inf/nan/e 记法)、布尔、RFC 3339 日期时间、数组、行内表
 * - [table] / [[array of tables]] 头(含 dotted 头)
 * - 注释与空白;字符串外的多行空白宽容(数组换行等)
 * 不支持:表内键重定义、键路径部分覆盖冲突检测按保守规则(冲突抛错)
 */
interface TomlParser {
  src: string;
  pos: number;
}

function tomlSkipInline(p: TomlParser): void {
  while (p.pos < p.src.length && (p.src[p.pos] === ' ' || p.src[p.pos] === '\t' || p.src[p.pos] === '\r')) {
    p.pos++;
  }
}

function tomlSkipAll(p: TomlParser): void {
  for (;;) {
    tomlSkipInline(p);
    if (p.src[p.pos] === '#') {
      while (p.pos < p.src.length && p.src[p.pos] !== '\n') p.pos++;
      continue;
    }
    if (p.src[p.pos] === '\n') {
      p.pos++;
      continue;
    }
    return;
  }
}

/** 行尾:跳过空白/注释后必须是换行或 EOF(多余内容抛错) */
function tomlEndOfLine(p: TomlParser): void {
  tomlSkipInline(p);
  if (p.pos >= p.src.length) return;
  if (p.src[p.pos] === '#') {
    while (p.pos < p.src.length && p.src[p.pos] !== '\n') p.pos++;
    return;
  }
  if (p.src[p.pos] === '\n') return;
  throw new ParseFormatError('toml', `invalid syntax at offset ${p.pos}`);
}

function tomlBasicChar(p: TomlParser): string {
  // p.pos 位于反斜杠:消耗并返回一个转义序列
  if (p.src[p.pos] !== '\\') return p.src[p.pos++];
  p.pos++;
  const c = p.src[p.pos++];
  switch (c) {
    case 'b':
      return '\b';
    case 't':
      return '\t';
    case 'n':
      return '\n';
    case 'f':
      return '\f';
    case 'r':
      return '\r';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case 'e':
      return '\x1B'; // TOML \e escape: ESC control character
    case 'u':
    case 'U': {
      const size = c === 'u' ? 4 : 8;
      const hex = p.src.slice(p.pos, p.pos + size);
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new ParseFormatError('toml', 'invalid unicode escape');
      }
      p.pos += size;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    default:
      throw new ParseFormatError('toml', `invalid escape: \\${c}`);
  }
}

function tomlParseString(p: TomlParser): { value: string; kind: 'basic' | 'literal' } {
  if (p.src.startsWith('"""', p.pos)) {
    p.pos += 3;
    if (p.src[p.pos] === '\n') p.pos++;
    let out = '';
    while (p.pos < p.src.length && !p.src.startsWith('"""', p.pos)) {
      if (p.src[p.pos] === '\\') {
        const rest = p.src.slice(p.pos + 1);
        const lineEnd = rest.indexOf('\n');
        if (lineEnd >= 0 && /^[ \t]*$/.test(rest.slice(0, lineEnd))) {
          p.pos += 1 + lineEnd + 1;
          continue;
        }
        out += tomlBasicChar(p);
        continue;
      }
      out += p.src[p.pos++];
    }
    if (!p.src.startsWith('"""', p.pos)) {
      throw new ParseFormatError('toml', 'unterminated multi-line basic string');
    }
    p.pos += 3;
    return { value: out, kind: 'basic' };
  }
  if (p.src.startsWith("'''", p.pos)) {
    p.pos += 3;
    if (p.src[p.pos] === '\n') p.pos++;
    const end = p.src.indexOf("'''", p.pos);
    if (end < 0) throw new ParseFormatError('toml', 'unterminated multi-line literal string');
    const value = p.src.slice(p.pos, end);
    p.pos = end + 3;
    return { value, kind: 'literal' };
  }
  if (p.src[p.pos] === '"') {
    p.pos++;
    let out = '';
    while (p.pos < p.src.length && p.src[p.pos] !== '"') {
      if (p.src[p.pos] === '\n') {
        throw new ParseFormatError('toml', 'newline in basic string');
      }
      if (p.src[p.pos] === '\\') {
        out += tomlBasicChar(p);
        continue;
      }
      out += p.src[p.pos++];
    }
    if (p.pos >= p.src.length) {
      throw new ParseFormatError('toml', 'unterminated basic string');
    }
    p.pos++;
    return { value: out, kind: 'basic' };
  }
  if (p.src[p.pos] === "'") {
    p.pos++;
    const end = p.src.indexOf("'", p.pos);
    if (end < 0) throw new ParseFormatError('toml', 'unterminated literal string');
    const value = p.src.slice(p.pos, end);
    if (value.includes('\n')) {
      throw new ParseFormatError('toml', 'newline in literal string');
    }
    p.pos = end + 1;
    return { value, kind: 'literal' };
  }
  throw new ParseFormatError('toml', 'expected string');
}

function tomlParseNumberOrDate(text: string): unknown {
  // RFC 3339 日期时间(offset / local / 空格分隔);截掉尾注释已由调用方保证
  const dt = parseTomlDateTime(text);
  if (dt !== null) return dt;
  const t = text.replace(/_/g, '');
  if (t === 'inf' || t === '+inf') return Number.POSITIVE_INFINITY;
  if (t === '-inf') return Number.NEGATIVE_INFINITY;
  if (t === 'nan' || t === '+nan' || t === '-nan') return Number.NaN;
  if (/^0x[0-9a-fA-F]+$/.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^0o[0-7]+$/.test(t)) return Number.parseInt(t.slice(2), 8);
  if (/^0b[01]+$/.test(t)) return Number.parseInt(t.slice(2), 2);
  if (/^[+-]?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  throw new ParseFormatError('toml', `invalid value: ${text}`);
}
/** RFC 3339 / TOML 本地日期时间:合法返回 ISO 字符串,否则 null */
function parseTomlDateTime(text: string): string | null {
  const s = text.trim();
  const re =
    /^(\d{4}-\d{2}-\d{2})([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|z|[+-]\d{2}:\d{2})?)?$/;
  const m = re.exec(s);
  if (!m) return null;
  // 用 Date 校验分量合法性(如 2026-13-01 无效)
  const iso = m[2] ? `${m[1]}T${s.slice(m[1].length + 1).replace(' ', 'T')}` : m[1];
  const ms = Date.parse(m[2] ? iso : `${m[1]}T00:00:00`);
  if (Number.isNaN(ms)) return null;
  return iso;
}

function tomlParseValue(p: TomlParser): unknown {
  tomlSkipAll(p);
  const ch = p.src[p.pos];
  if (ch === '"' || ch === "'") return tomlParseString(p).value;
  if (ch === '[') return tomlParseArray(p);
  if (ch === '{') return tomlParseInlineTable(p);
  if (ch === '\n' || ch === undefined) {
    throw new ParseFormatError('toml', 'missing value');
  }
  // 数值/布尔/日期/inf/nan:单记号扫描,终止于行尾、#、,、] 或 }
  // (数组/行内表内的值同样适用,不再按整行截取)
  let end = p.pos;
  while (end < p.src.length) {
    const c = p.src[end];
    if (c === '\n' || c === '\r' || c === '#' || c === ',' || c === ']' || c === '}') break;
    end++;
  }
  const token = p.src.slice(p.pos, end).trim();
  if (!token) throw new ParseFormatError('toml', 'missing value');
  p.pos = end;
  if (token === 'true') return true;
  if (token === 'false') return false;
  // RFC 3339 允许日期与时间之间一个空格(2026-01-02 03:04:05):
  // 记号扫描按空格截断,这里尝试与后继时间部分合并
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    const timeMatch = /^[ \t]+(\d{2}:\d{2}:\d{2}(\.\d+)?(Z|z|[+-]\d{2}:\d{2})?)/.exec(
      p.src.slice(p.pos),
    );
    if (timeMatch) {
      p.pos += timeMatch[0].length;
      return tomlParseNumberOrDate(`${token}T${timeMatch[1]}`);
    }
  }
  return tomlParseNumberOrDate(token);
}

function tomlParseArray(p: TomlParser): unknown[] {
  p.pos++; // [
  const items: unknown[] = [];
  for (;;) {
    tomlSkipAll(p);
    if (p.pos >= p.src.length) throw new ParseFormatError('toml', 'unterminated array');
    if (p.src[p.pos] === ']') {
      p.pos++;
      return items;
    }
    if (items.length > 0) {
      if (p.src[p.pos] !== ',') {
        throw new ParseFormatError('toml', `expected ',' at offset ${p.pos}`);
      }
      p.pos++;
      tomlSkipAll(p);
      if (p.src[p.pos] === ']') {
        p.pos++;
        return items; // 尾逗号
      }
    }
    items.push(tomlParseValue(p));
  }
}

function tomlParseKey(p: TomlParser): string {
  tomlSkipInline(p);
  const ch = p.src[p.pos];
  if (ch === '"' || ch === "'") return tomlParseString(p).value;
  const m = /^[A-Za-z0-9_-]+/.exec(p.src.slice(p.pos));
  if (!m) throw new ParseFormatError('toml', 'invalid key');
  p.pos += m[0].length;
  return m[0];
}

function tomlParseDottedKey(p: TomlParser): string[] {
  const parts = [tomlParseKey(p)];
  for (;;) {
    tomlSkipInline(p);
    if (p.src[p.pos] === '.') {
      p.pos++;
      parts.push(tomlParseKey(p));
    } else {
      return parts;
    }
  }
}

function tomlParseInlineTable(p: TomlParser): Record<string, unknown> {
  p.pos++; // {
  const obj: Record<string, unknown> = {};
  tomlSkipInline(p);
  if (p.src[p.pos] === '}') {
    p.pos++;
    return obj;
  }
  for (;;) {
    const path = tomlParseDottedKey(p);
    tomlSkipInline(p);
    if (p.src[p.pos] !== '=') throw new ParseFormatError('toml', "expected '='");
    p.pos++;
    const value = tomlParseValue(p);
    setTomlPath(obj, path, value);
    tomlSkipInline(p);
    if (p.src[p.pos] === ',') {
      p.pos++;
      tomlSkipInline(p);
      continue;
    }
    if (p.src[p.pos] === '}') {
      p.pos++;
      return obj;
    }
    throw new ParseFormatError('toml', 'invalid inline table');
  }
}

/** dotted 路径赋值:中间段已被标量/数组占用时抛错(标准 TOML 禁止) */
function setTomlPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const existing = node[seg];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      node[seg] = next;
      node = next;
    } else if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      node = existing as Record<string, unknown>;
    } else {
      throw new ParseFormatError('toml', `cannot redefine key: ${path.slice(0, i + 1).join('.')}`);
    }
  }
  const last = path[path.length - 1];
  if (node[last] !== undefined) {
    throw new ParseFormatError('toml', `duplicate key: ${path.join('.')}`);
  }
  node[last] = value;
}

/** 解析 TOML 全文为 JSON 值 */
export function tomlToJson(input: string): unknown {
  const p: TomlParser = { src: input, pos: 0 };
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;
  /** 显式 [table] 头已定义的路径(以 \u0000 连接,防 ['a','b c'] 与 ['a b','c'] 混淆) */
  const definedTables = new Set<string>();
  const tableKey = (path: string[]): string => path.join('\u0000');

  for (;;) {
    tomlSkipAll(p);
    if (p.pos >= p.src.length) break;
    if (p.src[p.pos] === '[') {
      if (p.src.startsWith('[[', p.pos)) {
        p.pos += 2;
        const path = tomlParseDottedKey(p);
        tomlSkipInline(p);
        if (!p.src.startsWith(']]', p.pos)) {
          throw new ParseFormatError('toml', 'invalid [[table]] header');
        }
        p.pos += 2;
        tomlEndOfLine(p);
        // 数组表:定位或创建父路径下的数组,当前表指向新追加元素
        let node: Record<string, unknown> = root;
        for (let i = 0; i < path.length - 1; i++) {
          const seg = path[i];
          const existing = node[seg];
          if (existing === undefined) {
            const next: Record<string, unknown> = {};
            node[seg] = next;
            node = next;
          } else if (
            existing !== null &&
            typeof existing === 'object' &&
            !Array.isArray(existing)
          ) {
            node = existing as Record<string, unknown>;
          } else {
            throw new ParseFormatError(
              'toml',
              `cannot redefine key: ${path.slice(0, i + 1).join('.')}`,
            );
          }
        }
        const last = path[path.length - 1];
        const existing = node[last];
        if (existing === undefined) {
          const arr: Record<string, unknown>[] = [];
          node[last] = arr;
          current = {};
          arr.push(current);
        } else if (Array.isArray(existing)) {
          current = {};
          (existing as unknown[]).push(current);
        } else {
          throw new ParseFormatError('toml', `cannot redefine table: ${path.join('.')}`);
        }
        continue;
      }
      p.pos++;
      const path = tomlParseDottedKey(p);
      tomlSkipInline(p);
      if (p.src[p.pos] !== ']') throw new ParseFormatError('toml', 'invalid [table] header');
      p.pos++;
      tomlEndOfLine(p);
      // 定位/创建表路径;已存在(由 [[..]] 建)则视为定义冲突
      let node: Record<string, unknown> = root;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        const existing = node[seg];
        if (existing === undefined) {
          const next: Record<string, unknown> = {};
          node[seg] = next;
          node = next;
        } else if (
          existing !== null &&
          typeof existing === 'object' &&
          !Array.isArray(existing)
        ) {
          node = existing as Record<string, unknown>;
        } else {
          throw new ParseFormatError(
            'toml',
            `cannot redefine key: ${path.slice(0, i + 1).join('.')}`,
          );
        }
      }
      const last = path[path.length - 1];
      const existing = node[last];
      if (existing === undefined) {
        const table: Record<string, unknown> = {};
        node[last] = table;
        current = table;
      } else if (
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        // dotted 键隐式创建的表可被显式 [table] 补充定义(TOML 允许);
        // 但同一 [table] 头重复出现视为定义冲突
        if (definedTables.has(tableKey(path))) {
          throw new ParseFormatError('toml', `cannot redefine table: ${path.join('.')}`);
        }
        current = existing as Record<string, unknown>;
      } else {
        throw new ParseFormatError('toml', `cannot redefine table: ${path.join('.')}`);
      }
      definedTables.add(tableKey(path));
      continue;
    }
    // 键值对
    const path = tomlParseDottedKey(p);
    tomlSkipInline(p);
    if (p.src[p.pos] !== '=') throw new ParseFormatError('toml', "expected '='");
    p.pos++;
    const value = tomlParseValue(p);
    setTomlPath(current, path, value);
    tomlEndOfLine(p);
  }
  return root;
}

// ============================================================
// JSON5 → JSON
// ============================================================

/**
 * 解析 JSON5 文本为 JSON 值(自定义轻量解析器,非 eval)。
 * JSON5 与 JSON 的差异点(https://spec.json5.org)全部覆盖:
 * - 单引号 / 双引号字符串,跨行字符串,十六进制数字
 * - 前导小数点 .5、尾随小数点 5.、Infinity / -Infinity / NaN
 * - 识别符键免引号(含 $ 与 Unicode 字母,按 ID_Start/ID_Continue 近似)
 * - 尾逗号、注释(单行 // 与多行块注释)
 * - 转义:\xHH 与 \u{...}
 * 输出为纯 JSON 值(非法转义按 JSON 语义抛错)。
 */
interface Json5Parser {
  src: string;
  pos: number;
}

function json5SkipWs(p: Json5Parser): void {
  for (;;) {
    const ch = p.src[p.pos];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      p.pos++;
      continue;
    }
    if (ch === '/' && p.src[p.pos + 1] === '/') {
      while (p.pos < p.src.length && p.src[p.pos] !== '\n') p.pos++;
      continue;
    }
    if (ch === '/' && p.src[p.pos + 1] === '*') {
      const end = p.src.indexOf('*/', p.pos + 2);
      if (end < 0) throw new ParseFormatError('json5', 'unterminated comment');
      p.pos = end + 2;
      continue;
    }
    return;
  }
}

/**
 * Unicode 简易判定(近似 ES ID_Start / ID_Continue,仅用于键免引号识别):
 * 用码点数值范围代替正则字符类,避免视觉相似字符误导。
 */
const ID_START_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x41, 0x5a], // A-Z
  [0x61, 0x7a], // a-z
  [0x24, 0x24], // $
  [0x5f, 0x5f], // _
  [0xc0, 0x2ff], // Latin-1 补充…(含 À–ƿ)
  [0x370, 0x1fff], // 希腊…古意大利
  [0x3040, 0xd7ff], // 平假名…CJK 兼容
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
];

function isIdStart(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  return ID_START_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function isIdContinue(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  // 组合记号(U+0300–U+036F)与连接符(U+203F–U+2040)
  return (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x203f && cp <= 0x2040) ||
    isIdStart(ch)
  );
}

function json5ParseString(p: Json5Parser, quote: string): string {
  p.pos++;
  let out = '';
  while (p.pos < p.src.length && p.src[p.pos] !== quote) {
    const ch = p.src[p.pos];
    if (ch === '\n') {
      // JSON5 允许字符串换行(转为 \n)
      out += '\n';
      p.pos++;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      p.pos++;
      continue;
    }
    // 转义
    p.pos++;
    const c = p.src[p.pos++];
    switch (c) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'v':
        out += '\v';
        break;
      case '0':
        out += '\0';
        break;
      case '\n':
        out += '\n'; // 行 continuation
        break;
      case '\r':
        out += '\r';
        if (p.src[p.pos] === '\n') p.pos++;
        break;
      case 'x': {
        const hex = p.src.slice(p.pos, p.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new ParseFormatError('json5', 'invalid \\x escape');
        }
        out += String.fromCharCode(parseInt(hex, 16));
        p.pos += 2;
        break;
      }
      case 'u': {
        if (p.src[p.pos] === '{') {
          const end = p.src.indexOf('}', p.pos);
          if (end < 0) throw new ParseFormatError('json5', 'invalid \\u{...} escape');
          const hex = p.src.slice(p.pos + 1, end);
          if (!/^[0-9a-fA-F]+$/.test(hex)) {
            throw new ParseFormatError('json5', 'invalid \\u{...} escape');
          }
          out += String.fromCodePoint(parseInt(hex, 16));
          p.pos = end + 1;
        } else {
          const hex = p.src.slice(p.pos, p.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new ParseFormatError('json5', 'invalid \\u escape');
          }
          out += String.fromCharCode(parseInt(hex, 16));
          p.pos += 4;
        }
        break;
      }
      default:
        out += c; // 其他字符按字面(JSON5 语义)
    }
  }
  if (p.pos >= p.src.length) throw new ParseFormatError('json5', 'unterminated string');
  p.pos++;
  return out;
}

function json5ParseValue(p: Json5Parser): unknown {
  json5SkipWs(p);
  const ch = p.src[p.pos];
  if (ch === '"' || ch === "'") return json5ParseString(p, ch);
  if (ch === '[') {
    p.pos++;
    const items: unknown[] = [];
    json5SkipWs(p);
    if (p.src[p.pos] === ']') {
      p.pos++;
      return items;
    }
    for (;;) {
      items.push(json5ParseValue(p));
      json5SkipWs(p);
      if (p.src[p.pos] === ',') {
        p.pos++;
        json5SkipWs(p);
        if (p.src[p.pos] === ']') {
          p.pos++;
          return items;
        }
        continue;
      }
      if (p.src[p.pos] === ']') {
        p.pos++;
        return items;
      }
      throw new ParseFormatError('json5', 'invalid array');
    }
  }
  if (ch === '{') {
    p.pos++;
    const obj: Record<string, unknown> = {};
    json5SkipWs(p);
    if (p.src[p.pos] === '}') {
      p.pos++;
      return obj;
    }
    for (;;) {
      json5SkipWs(p);
      let key: string;
      const kch = p.src[p.pos];
      if (kch === '"' || kch === "'") {
        key = json5ParseString(p, kch);
      } else if (isIdStart(kch)) {
        let end = p.pos + 1;
        while (end < p.src.length && isIdContinue(p.src[end])) end++;
        key = p.src.slice(p.pos, end);
        p.pos = end;
      } else {
        throw new ParseFormatError('json5', 'invalid object key');
      }
      json5SkipWs(p);
      if (p.src[p.pos] !== ':') throw new ParseFormatError('json5', "expected ':'");
      p.pos++;
      obj[key] = json5ParseValue(p);
      json5SkipWs(p);
      if (p.src[p.pos] === ',') {
        p.pos++;
        json5SkipWs(p);
        if (p.src[p.pos] === '}') {
          p.pos++;
          return obj;
        }
        continue;
      }
      if (p.src[p.pos] === '}') {
        p.pos++;
        return obj;
      }
      throw new ParseFormatError('json5', 'invalid object');
    }
  }
  // 字面量 / 数字
  const m = /^(Infinity|NaN|-Infinity|-NaN)/.exec(p.src.slice(p.pos));
  if (m) {
    p.pos += m[0].length;
    if (m[0].endsWith('NaN')) return Number.NaN;
    return m[0].startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (p.src.startsWith('true', p.pos)) {
    p.pos += 4;
    return true;
  }
  if (p.src.startsWith('false', p.pos)) {
    p.pos += 5;
    return false;
  }
  if (p.src.startsWith('null', p.pos)) {
    p.pos += 4;
    return null;
  }
  // 数字(JSON5 数字文法):[+-]?(0x十六进制 | (整数部分)?(.小数)?([eE][+-]?\d+)?)后必须非 ID 字符
  const numRest = /^[+-]?(0[xX][0-9a-fA-F]+|(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(
    p.src.slice(p.pos),
  );
  if (numRest) {
    const token = numRest[0];
    const after = p.src[p.pos + token.length];
    if (after !== undefined && isIdContinue(after)) {
      throw new ParseFormatError('json5', `invalid number at offset ${p.pos}`);
    }
    p.pos += token.length;
    if (/^([+-])?0[xX]/.test(token)) {
      const v = Number.parseInt(token.replace(/^[+-]?0[xX]/, ''), 16);
      return token.startsWith('-') ? -v : v;
    }
    const v = Number(token);
    if (Number.isNaN(v)) throw new ParseFormatError('json5', `invalid number: ${token}`);
    return v;
  }
  if (ch === '+' || ch === '-') {
    // ±Infinity / ±NaN 之外不允许前导符号(如 +5)
    const rest = p.src.slice(p.pos);
    const infNan = /^[+-](Infinity|NaN)/.exec(rest);
    if (infNan) {
      p.pos += infNan[0].length;
      if (infNan[1] === 'NaN') return Number.NaN;
      return infNan[0].startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
  }
  throw new ParseFormatError('json5', `unexpected character '${ch ?? ''}' at offset ${p.pos}`);
}

/** 解析 JSON5 文本为 JSON 值 */
export function json5ToJson(input: string): unknown {
  const p: Json5Parser = { src: input, pos: 0 };
  const value = json5ParseValue(p);
  json5SkipWs(p);
  if (p.pos < p.src.length) {
    throw new ParseFormatError('json5', `unexpected trailing content at offset ${p.pos}`);
  }
  return value;
}

// ============================================================
// Properties → JSON
// ============================================================

/** 转义表还原:\\ \n \t \r \f \uXXXX;其他转义保持字面字符(宽容) */
function unescapeProperties(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\' || i === s.length - 1) {
      out += ch;
      continue;
    }
    const next = s[++i];
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u': {
        const hex = s.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += next;
        }
        break;
      }
      default:
        out += next; // \\、\=、\:、\ 、\#、\! 等
    }
  }
  return out;
}

/** 点号路径切分(转义感知):`\.` 为字面点不分段,裸 `.` 分段;段内再还原转义 */
function splitPropertiesPath(key: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === '\\' && i + 1 < key.length) {
      current += unescapeProperties(key.slice(i, i + 2));
      i++;
      continue;
    }
    if (ch === '.') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * 解析 .properties 文本为 JSON 值(固定为对象)。
 * 覆盖核心语法:`=`/`:`/空白 分隔;`#`/`!` 注释;行尾 `\` 续行;
 * 值内 `\n` `\t` `\uXXXX` 转义;键内转义 `\= \: \ ` 字面化。
 * 点号键还原嵌套对象(a.b.c=1 → {a:{b:{c:1}}})。
 */
export function propertiesToJson(input: string): unknown {
  const physical = input.replace(/\r\n?/g, '\n').split('\n');
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < physical.length; ) {
    let raw = physical[i];
    i++;
    // 续行:行尾单个反斜杠;下一行行首空白裁剪
    while (/(^|[^\\])\\$/.test(raw) && i < physical.length) {
      raw = raw.replace(/\\$/, '') + physical[i].replace(/^[ \t]*/, '');
      i++;
    }
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const sep = /(?<![\\])[=:]/.exec(line) ?? /(?<![\\])[ \t]+/.exec(line);
    if (!sep) continue; // 无分隔符的非注释行:跳过(如纯续行残片)
    const rawKey = line.slice(0, sep.index);
    const rawValue = line.slice(sep.index + sep[0].length);
    const value = unescapeProperties(rawValue.trim());
    if (!rawKey.trim()) continue;
    entries.push([rawKey.trim(), value]);
  }
  if (entries.length === 0) {
    throw new ParseFormatError('properties', 'no entries found');
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const path = splitPropertiesPath(key);
    let node = result;
    for (let s = 0; s < path.length - 1; s++) {
      const seg = path[s];
      const existing = node[seg];
      if (existing === null || typeof existing !== 'object') {
        const next: Record<string, unknown> = {};
        node[seg] = next;
        node = next;
      } else {
        node = existing as Record<string, unknown>;
      }
    }
    node[path[path.length - 1]] = value;
  }
  return result;
}

// ============================================================
// URL 参数 → JSON
// ============================================================

/** 解码 URL 组件(URLSearchParams 语义:+ → 空格) */
function decodeUrlComponent(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return v; // 非法百分号序列:保留原文(宽容)
  }
}

/**
 * 解析 URL 查询串为 JSON 值(固定为对象)。
 * - 支持带前导 `?` / `#` 与 `url?query` 形式(取首个 `?` 之后部分)
 * - 同名键出现 2 次及以上 → 数组;否则字符串
 * - 键中点号还原嵌套对象(a.b=c → {a:{b:c}}),与 jsonToUrlParams 往返兼容
 */
export function urlParamsToJson(input: string): unknown {
  let query = input.trim();
  // 带完整 URL 时取 ? 之后(锚点先剥)
  const hashIdx = query.indexOf('#');
  if (hashIdx >= 0) query = query.slice(0, hashIdx);
  const qIdx = query.indexOf('?');
  if (qIdx >= 0) query = query.slice(qIdx + 1);
  if (!query) throw new ParseFormatError('urlparams', 'no query string found');

  const result: Record<string, unknown> = {};
  let count = 0;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.slice(eq + 1) : '';
    const key = decodeUrlComponent(rawKey);
    const value = decodeUrlComponent(rawValue);
    if (!key) continue;
    count++;
    const path = key.split('.');
    let node = result;
    for (let s = 0; s < path.length - 1; s++) {
      const seg = path[s];
      const existing = node[seg];
      if (existing === null || typeof existing !== 'object') {
        const next: Record<string, unknown> = {};
        node[seg] = next;
        node = next;
      } else {
        node = existing as Record<string, unknown>;
      }
    }
    const last = path[path.length - 1];
    const existing = node[last];
    if (existing === undefined) {
      node[last] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      node[last] = [existing, value];
    }
  }
  if (count === 0) {
    throw new ParseFormatError('urlparams', 'no query parameters found');
  }
  return result;
}
