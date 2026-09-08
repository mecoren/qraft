/**
 * JSON 错误定位与诊断(纯前端,零依赖)
 *
 * 背景:V8 的 JSON.parse 错误消息没有行列号(新版连 "at position N" 都已移除),
 * 把定位信息写到输出框的用户只能靠肉眼找错。本模块用轻量字符级扫描器在
 * JSON.parse 失败后精确定位第一个语法错误的行列(1-based),并归类错误类型,
 * 供 JsonFormatter 的 Monaco marker / 跳转 / 修复动作使用。
 *
 * 约定:扫描器逐字符状态机,不做完整解析树 —— 只需要停在第一个
 * JSON.parse 也会拒绝的位置上;唯一例外是 duplicate-key(JSON.parse
 * 静默吞掉重复键,但属用户通常想知道的数据问题,扫描器主动检出)。
 */

/** JSON 语法错误分类(键值同时是 i18n 键 tools.json_formatter.diag_<kind> 的后缀) */
export type JsonErrorKind =
  | 'unexpected-token'
  | 'missing-comma'
  | 'missing-colon'
  | 'trailing-comma'
  | 'unterminated-string'
  | 'single-quotes'
  | 'unquoted-key'
  | 'unbalanced-brackets'
  | 'unclosed-brackets'
  | 'duplicate-key'
  | 'bad-escape';

/** 语法错误定位结果;line/column 均为 1-based */
export interface JsonErrorLocation {
  line: number;
  column: number;
  kind: JsonErrorKind;
  /** 补充细节(如重复键的键名);缺省空串 */
  detail: string;
}

/** offset(0-based)→ 行列(1-based);offset 超界按末尾处理 */
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < safeOffset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/** JSON 白名单空白字符 */
function isJsonWhitespace(ch: string): boolean {
  return ch === ' ' || (ch === '\t') === false ? ch === ' ' || ch === '\n' || ch === '\r' : false;
}

/** 跳过从 offset 开始的连续 JSON 空白,返回新的 offset */
function skipWhitespace(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && isJsonWhitespace(text[i])) i++;
  return i;
}

function locate(text: string, offset: number, kind: JsonErrorKind, detail = ''): JsonErrorLocation {
  const { line, column } = offsetToLineColumn(text, offset);
  return { line, column, kind, detail };
}

/**
 * 定位 text 中第一个 JSON 语法错误;合法 JSON(含空文本)返回 null。
 * 重复键虽不违反 JSON 语法(JSON.parse 静默保留后者),也视为错误检出,
 * 因此不能只依赖 JSON.parse 的成败,恒走扫描器。
 */
export function locateJsonError(text: string): JsonErrorLocation | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const start = skipWhitespace(text, 0);
  const err = scanValue(text, start, 0);
  if (err) return err;

  // 顶层值本身完整:若其后还有非空白内容,必是 JSON.parse 同样拒绝的
  // 多余闭合括号等尾缀,位置指向首个尾缀字符
  const end = scanValueAt(text, start, 0).end;
  const tail = skipWhitespace(text, end);
  if (tail < text.length) {
    const kind =
      text[tail] === '}' || text[tail] === ']' ? 'unbalanced-brackets' : 'unexpected-token';
    return locate(text, tail, kind);
  }
  return null;
}

/**
 * 状态机扫描容器(对象/数组)与顶层值,在第一个非法处返回定位。
 * 递归深度上限防御病态嵌套(与 JsonTreeView 的防御口径一致)。
 */
function scanValue(text: string, offset: number, depth: number): JsonErrorLocation | null {
  if (depth > 1000) return locate(text, offset, 'unexpected-token');
  const i = skipWhitespace(text, offset);
  if (i >= text.length) return locate(text, text.length, 'unclosed-brackets');

  const ch = text[i];
  if (ch === '{') return scanContainer(text, i, depth, 'object');
  if (ch === '[') return scanContainer(text, i, depth, 'array');
  if (ch === '"') return scanString(text, i).error;
  if (ch === "'") return locate(text, i, 'single-quotes');
  return scanLiteral(text, i);
}

/** 字符串扫描:返回 { error, end };字符串完整时 error 为 null、end 为闭合引号后一位 */
function scanString(text: string, start: number): { error: JsonErrorLocation | null; end: number } {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      if (i + 1 >= text.length) {
        return { error: locate(text, text.length, 'unterminated-string'), end: -1 };
      }
      const esc = text[i + 1];
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(esc)) {
        return { error: locate(text, i, 'bad-escape'), end: -1 };
      }
      i += 2;
      continue;
    }
    if (ch === '"') return { error: null, end: i + 1 };
    // 裸控制字符(0x00-0x1F):JSON 字符串内必须转义;CR 视为字符串被换行截断
    if (ch === '\r' || ch === '\n') {
      return { error: locate(text, i, 'unterminated-string'), end: -1 };
    }
    if (ch.charCodeAt(0) < 0x20) {
      return { error: locate(text, i, 'bad-escape'), end: -1 };
    }
    i++;
  }
  return { error: locate(text, text.length, 'unterminated-string'), end: -1 };
}

/** 裸字面量扫描:true/false/null/数字合法;其余裸词(标识符等)报意外 token */
function scanLiteral(text: string, start: number): JsonErrorLocation | null {
  const rest = text.slice(start);
  if (rest.startsWith('true') || rest.startsWith('false') || rest.startsWith('null')) return null;
  const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (m && m[0].length > 0) {
    const after = start + m[0].length;
    // 数字后紧跟标识符字符属非法 token(如 1x);位置指向越界字符
    if (after < text.length && /[a-zA-Z_$]/.test(text[after])) {
      return locate(text, after, 'unexpected-token');
    }
    return null;
  }
  return locate(text, start, 'unexpected-token');
}

/**
 * 容器(对象/数组)扫描:单循环骨架,「跳空白 → 按状态看当前字符 → 推进」,
 * 不递归回读;值用 scanValueAt 一次扫描同时得到错误与终点。
 *
 * 位置语义(实现与测试一致以此为准):
 * - 裸值 / 单引号 / 裸键 / 坏转义 / 多余闭合括号:指向该 token 首字符
 * - 缺逗号 / 缺冒号:指向下一个成员(值)token 的首字符
 * - 尾逗号:指向闭合括号
 * - 未闭合 / 未终止字符串:指向文本末尾
 */
function scanContainer(
  text: string,
  start: number,
  depth: number,
  kind: 'object' | 'array',
): JsonErrorLocation | null {
  const close = kind === 'object' ? '}' : ']';
  const ownKeys = kind === 'object' ? new Set<string>() : null;
  // 对象:KEY → COLON → VALUE → COMMA;数组:VALUE → COMMA
  let expectKey = kind === 'object';
  let expectValue = kind === 'array';
  let expectCommaOrClose = false;
  let expectColon = false;
  let memberCount = 0;
  let i = start + 1;

  for (;;) {
    i = skipWhitespace(text, i);
    if (i >= text.length) return locate(text, text.length, 'unclosed-brackets');
    const ch = text[i];

    // 闭合:仅允许在「期待键(空对象)/期待值(空数组)/逗号之后」;
    // 有成员后直接闭合 → 上一 token 是尾逗号
    if (ch === close) {
      if (memberCount > 0 && (expectKey || expectValue)) {
        return locate(text, i, 'trailing-comma');
      }
      return null;
    }

    if (expectKey) {
      if (ch === '"') {
        const scanned = scanString(text, i);
        if (scanned.error) return scanned.error;
        const key = text.slice(i + 1, scanned.end - 1);
        if (ownKeys && ownKeys.has(key)) {
          return locate(text, i, 'duplicate-key', key);
        }
        ownKeys?.add(key);
        i = scanned.end;
        expectKey = false;
        expectColon = true;
        continue;
      }
      if (ch === "'") return locate(text, i, 'single-quotes');
      if (/[a-zA-Z_$]/.test(ch)) return locate(text, i, 'unquoted-key');
      return locate(text, i, 'unexpected-token');
    }

    if (expectColon) {
      if (ch === ':') {
        expectColon = false;
        expectValue = true;
        i++;
        continue;
      }
      // 键后缺冒号:位置指向值 token 首字符
      return locate(text, i, 'missing-colon');
    }

    if (expectValue) {
      const scanned = scanValueAt(text, i, depth);
      if (scanned.error) return scanned.error;
      i = scanned.end;
      expectValue = false;
      expectCommaOrClose = true;
      memberCount++;
      continue;
    }

    if (expectCommaOrClose) {
      if (ch === ',') {
        expectCommaOrClose = false;
        expectKey = kind === 'object';
        expectValue = kind === 'array';
        i++;
        continue;
      }
      // 非逗号非闭合 → 缺逗号,位置指向下一 token 首字符
      return locate(text, i, 'missing-comma');
    }
  }
}

/**
 * 值的「一次扫描」封装:错误与终点一并返回,供容器推进。
 * 与 scanValue 行为一致(错误优先返回),但保证成功时给出值的终点。
 */
function scanValueAt(
  text: string,
  offset: number,
  depth: number,
): { error: JsonErrorLocation | null; end: number } {
  const i = skipWhitespace(text, offset);
  if (i >= text.length) {
    return { error: locate(text, text.length, 'unclosed-brackets'), end: -1 };
  }
  const ch = text[i];

  if (ch === '{' || ch === '[') {
    const err = scanContainer(text, i, depth + 1, ch === '{' ? 'object' : 'array');
    if (err) return { error: err, end: -1 };
    return { error: null, end: findContainerEnd(text, i) };
  }
  if (ch === '"') {
    const s = scanString(text, i);
    return s.error ? { error: s.error, end: -1 } : { error: null, end: s.end };
  }
  if (ch === "'") return { error: locate(text, i, 'single-quotes'), end: -1 };

  const lit = scanLiteral(text, i);
  if (lit) return { error: lit, end: -1 };
  const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
  return { error: null, end: m ? i + m[0].length : i + 1 };
}

/** 已知从 openOffset 开始的是完整容器,返回闭合括号后一位(不复检,纯几何推进) */
function findContainerEnd(text: string, openOffset: number): number {
  const open = text[openOffset];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let i = openOffset;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const s = scanString(text, i);
      // 容器已被 scanContainer 判定完整,字符串必然闭合;防御性兜底
      if (s.error) return text.length;
      i = s.end;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}
