/**
 * JSON 修复(纯前端,零依赖;仅显式用户动作触发,绝不自动修复)
 *
 * 设计:复用 locateJsonError 的错误分类逐轮修复,每轮消掉一个确定的语法
 * 错误,直到 JSON.parse 成功或达到轮次上限(防病态输入死循环)。所有修复
 * 只做「语法上唯一确定」的变换;原意不明的(如字符串内裸换行)不猜,
 * 如实返回未修复状态,交还用户人工处理 —— 用户可能正需要通过错误位置
 * 人工查错,修复入口必须是显式按钮而非隐式自动行为。
 */

import { locateJsonError, type JsonErrorKind } from './json-diagnostics';

/** 修复动作记录(kind 同时是 i18n 键 tools.json_formatter.repair_<kind> 的后缀) */
export interface RepairAction {
  kind:
    | 'strip-fence'
    | 'strip-comment'
    | 'single-quotes'
    | 'unquoted-key'
    | 'constants'
    | 'trailing-comma'
    | 'missing-comma'
    | 'missing-colon'
    | 'unclosed-brackets'
    | 'unbalanced-brackets'
    | 'ndjson'
    | 'wrap-bare';
  /** 该类动作累计应用次数(同轮同类多处记一次,次数累计) */
  count: number;
}

/** 修复结果:text 总是「最新可用文本」(未修复成功时为原文) */
export interface RepairResult {
  text: string;
  /** 是否修复成功(JSON.parse 可通过) */
  fixed: boolean;
  /** 应用的全部动作(同类聚合 count) */
  actions: RepairAction[];
}

/** 每轮修复至少消一个错误,20 轮足够常见 LLM 输出粘贴场景,上限防死循环 */
const MAX_ROUNDS = 20;

/** 把动作列表按 kind 聚合出累计次数 */
function mergeActions(actions: RepairAction[]): RepairAction[] {
  const order: RepairAction['kind'][] = [];
  const counts = new Map<RepairAction['kind'], number>();
  for (const a of actions) {
    if (!counts.has(a.kind)) order.push(a.kind);
    counts.set(a.kind, (counts.get(a.kind) ?? 0) + a.count);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

/** 判定 text 是否已是合法 JSON(JSON.parse 成功即合法,忽略重复键) */
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 修复 JSON 文本。
 * 已合法时原样返回(fixed=false 无动作);修不动时返回原文与已应用动作。
 */
export function repairJson(input: string): RepairResult {
  const actions: RepairAction[] = [];
  let text = input;

  // —— 预处理(一次性行为,作用于整篇)——
  const pre = preprocess(text);
  text = pre.text;
  actions.push(...pre.actions);

  if (parses(text)) {
    return { text, fixed: true, actions: mergeActions(actions) };
  }

  // —— 逐轮定向修复:每轮取第一个定位到的错误,按类型施加确定变换 ——
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const err = locateJsonError(text);
    if (!err) break;
    const applied = applyFix(text, err.kind);
    if (!applied) break; // 该类错误无确定修法(不猜),交还用户
    text = applied.text;
    actions.push({ kind: applied.kind, count: 1 });
    if (parses(text)) break;
  }

  const fixed = parses(text);
  return {
    text: fixed ? text : input,
    fixed,
    actions: mergeActions(actions),
  };
}

/** 预处理结果(整篇级变换,不依赖错误定位) */
interface PreprocessResult {
  text: string;
  actions: RepairAction[];
}

/**
 * 整篇预处理:剥代码围栏 → 注释剥离 → NDJSON 合并 → Python/JS 常量替换 →
 * 裸标量包裹。每步只在语法层面确定时施加;字符串内容经 tokenizeStrings
 * 保护,注释剥离不会误伤字符串内的 //。
 */
function preprocess(input: string): PreprocessResult {
  const actions: RepairAction[] = [];
  let text = input;

  // Markdown 代码围栏:```json ... ``` / ``` ... ```(围栏必须包住全文)
  const fence = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  if (fence) {
    text = fence[1];
    actions.push({ kind: 'strip-fence', count: 1 });
  }

  const stripped = stripComments(text);
  if (stripped !== text) {
    text = stripped;
    actions.push({ kind: 'strip-comment', count: 1 });
  }

  const constants = replaceConstants(text);
  if (constants !== text) {
    text = constants;
    actions.push({ kind: 'constants', count: 1 });
  }

  // NDJSON:多行且每行都是完整 JSON 值 → 合并为数组
  if (isNdjson(text)) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    text = JSON.stringify(lines.map((l) => JSON.parse(l)));
    actions.push({ kind: 'ndjson', count: 1 });
    return { text, actions };
  }

  // 裸标量包裹:非空、不含 JSON 结构符,且整篇不是合法 JSON(42 等裸数字
  // 本身即合法,无需动作)→ 包成 JSON 字符串标量。用户从日志复制单个值的常见形态。
  const trimmed = text.trim();
  if (trimmed && !/[{}[\]",:]/.test(trimmed) && !parses(trimmed)) {
    text = JSON.stringify(trimmed);
    actions.push({ kind: 'wrap-bare', count: 1 });
  }

  return { text, actions };
}

/** 剥离字符串外的 // 行注释与 /* 块注释(字符串内容原样保留) */
function stripComments(text: string): string {
  const parts: string[] = [];
  for (const seg of tokenizeStrings(text)) {
    if (seg.isString) {
      parts.push(seg.text);
      continue;
    }
    parts.push(seg.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ''));
  }
  return parts.join('');
}

/** Python / JS 常量 → JSON 常量(仅字符串外的裸词,大小写敏感全词匹配) */
function replaceConstants(text: string): string {
  const parts: string[] = [];
  for (const seg of tokenizeStrings(text)) {
    if (seg.isString) {
      parts.push(seg.text);
      continue;
    }
    parts.push(
      seg.text
        .replace(/\b(?:None|undefined)\b/g, 'null')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false'),
    );
  }
  return parts.join('');
}

/** NDJSON 判定:≥2 个非空行,且每行独立 JSON.parse 成功(含 { 开头的行) */
function isNdjson(text: string): boolean {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return false;
  // 单个跨行 JSON 的首行(如 "{")不可独立解析,被 every 淘汰,无需额外排除
  return lines.every((l) => {
    try {
      JSON.parse(l);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * 按错误类型施加一次确定修复;无确定修法(不猜)返回 null。
 * 返回 kind 用于动作记录,可能被细化为比诊断 kind 更具体的类别。
 */
function applyFix(
  text: string,
  kind: JsonErrorKind,
): { text: string; kind: RepairAction['kind'] } | null {
  const err = locateJsonError(text);
  const offset = err ? lineColumnToOffset(text, err.line, err.column) : -1;

  switch (kind) {
    // 单引号串 / 裸键:重打引号(字符串外的全量变换,一次消多处)
    case 'single-quotes': {
      const next = requotesSingle(text);
      return next === text ? null : { text: next, kind: 'single-quotes' };
    }
    case 'unquoted-key': {
      const next = quoteBareKeys(text);
      return next === text ? null : { text: next, kind: 'unquoted-key' };
    }
    // 尾逗号:删除所有闭合括号前(忽略空白与注释)的逗号 —— 定位唯一确定
    case 'trailing-comma': {
      const next = text.replace(/,(\s*)([}\]])/g, '$1$2');
      return next === text ? null : { text: next, kind: 'trailing-comma' };
    }
    // 缺逗号:在定位处(下一 token 首)插入逗号
    case 'missing-comma': {
      if (offset < 0) return null;
      return { text: text.slice(0, offset) + ',' + text.slice(offset), kind: 'missing-comma' };
    }
    // 缺冒号:在定位处(值 token 首)插入冒号
    case 'missing-colon': {
      if (offset < 0) return null;
      return { text: text.slice(0, offset) + ': ' + text.slice(offset), kind: 'missing-colon' };
    }
    // 未闭合:按开括号栈在文末补齐(逆序配对:栈顶 {[ → 追加 }] )
    case 'unclosed-brackets': {
      const stack = unclosedStack(text);
      if (!stack || stack.open.length === 0) return null;
      const closing = [...stack.open]
        .reverse()
        .map((c) => (c === '{' ? '}' : ']'))
        .join('');
      return { text: text + closing, kind: 'unclosed-brackets' };
    }
    // 多余闭合:删除顶层值之后的全部非空白尾缀
    case 'unbalanced-brackets': {
      const trimmedEnd = trimTrailingGarbage(text);
      return trimmedEnd === text ? null : { text: trimmedEnd, kind: 'unbalanced-brackets' };
    }
    // 不猜类:裸值标识符(意图不明)、坏转义(不知道想表达什么字符)、
    // 重复键(改数据)、未终止字符串(裸换行截断,可能是想结束文档)
    default:
      return null;
  }
}

/**
 * 单引号 → 双引号:对字符串外每个 '…' 段落,内部 \" 转双引号、\' 拆转义。
 * tokenizeStrings 默认把单引号串也归为字符串段,此处需按代码段处理,
 * 经 singleAsCode 取出。不完全通用(嵌套转义组合有极罕见歧义),
 * 覆盖常规粘贴场景足够;修不好时下轮 JSON.parse 仍失败,由上限兜底退出。
 */
function requotesSingle(text: string): string {
  const parts: string[] = [];
  for (const seg of tokenizeStrings(text, { singleAsCode: true })) {
    if (seg.isString) {
      parts.push(seg.text);
      continue;
    }
    let code = seg.text;
    // 单引号串:成对匹配,内部处理 \" → "、\' → '(拆掉无效转义)
    code = code.replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => {
      const inner = s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
      return JSON.stringify(inner);
    });
    parts.push(code);
  }
  return parts.join('');
}

/** 裸键加引号:字符串外的 `identifier:` / `identifier<空白>,`} 形态,且确实处于键位 */
function quoteBareKeys(text: string): string {
  const parts: string[] = [];
  for (const seg of tokenizeStrings(text)) {
    if (seg.isString) {
      parts.push(seg.text);
      continue;
    }
    parts.push(
      seg.text.replace(
        /([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
        (_m, pre, ident, post) => pre + JSON.stringify(ident) + post,
      ),
    );
  }
  return parts.join('');
}

/** 未闭合开括号栈几何记录:括号不配对时按开括号记录(单引号串参与配对) */
interface BracketStack {
  /** 栈内开括号序列({ 或 [) */
  open: string[];
}

/**
 * 计算未闭合开括号栈:双引号串按字符串跳过;单引号串视为结构代码参与
 * 括号统计(修复目标是把它重打成双引号串,其中括号按字面处理);
 * 返回空栈(null)表示没有需要补的括号。
 */
function unclosedStack(text: string): BracketStack | null {
  const stack: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let k = i + 1;
      while (k < text.length) {
        if (text[k] === '\\') k += 2;
        else if (text[k] === '"') break;
        else k++;
      }
      if (k >= text.length) return null; // 双引号串未闭合:无确定修法
      i = k + 1;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null;
      stack.pop();
    }
    i++;
  }
  return { open: stack };
}

/** 删除顶层值结束后的全部尾缀(多余闭合括号等) */
function trimTrailingGarbage(text: string): string {
  const start = skipWs(text, 0);
  const end = scanValueEnd(text, start);
  if (end < 0) return text;
  return text.slice(0, end);
}

/** 跳过 JSON 空白 */
function skipWs(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/** 顶层完整值终点(0-based,开区间);无完整值返回 -1(与 json-diagnostics 同型实现) */
function scanValueEnd(text: string, offset: number): number {
  const i = skipWs(text, offset);
  if (i >= text.length) return -1;
  const ch = text[i];
  if (ch === '{' || ch === '[') {
    let depth = 0;
    let j = i;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    while (j < text.length) {
      const c = text[j];
      if (c === '"') {
        let k = j + 1;
        while (k < text.length) {
          if (text[k] === '\\') k += 2;
          else if (text[k] === '"') break;
          else k++;
        }
        if (k >= text.length) return -1;
        j = k + 1;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return -1;
  }
  if (ch === '"') {
    let k = i + 1;
    while (k < text.length) {
      if (text[k] === '\\') k += 2;
      else if (text[k] === '"') return k + 1;
      else k++;
    }
    return -1;
  }
  const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
  return m ? i + m[0].length : -1;
}

/** 1-based 行列 → 0-based offset(与 offsetToLineColumn 同型逆运算) */
function lineColumnToOffset(text: string, line: number, column: number): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < text.length) {
    if (text[offset] === '\n') currentLine++;
    offset++;
  }
  return offset + (column - 1);
}

/** 文本分段:字符串段(带引号原样)与代码段交替 */
interface TextSegment {
  text: string;
  isString: boolean;
}

/** tokenizeStrings 行为选项 */
interface TokenizeOptions {
  /**
   * 把单引号串归为代码段(默认 false 视为字符串段)。
   * 供 requotesSingle 在代码段里重打双引号;其余路径保持默认,
   * 单引号串内容不参与注释剥离 / 常量替换等变换。
   */
  singleAsCode?: boolean;
}

/**
 * 字符串感知分段:双引号串(以及默认模式下的单引号串)原样输出为
 * 字符串段,其余为代码段。供注释剥离 / 常量替换 / 重打引号确保
 * 不误伤字符串内容。未终止字符串:尾段按字符串段处理(保守,不吞内容)。
 */
function tokenizeStrings(text: string, options: TokenizeOptions = {}): TextSegment[] {
  const singleAsString = !options.singleAsCode;
  const segments: TextSegment[] = [];
  let code = '';
  let i = 0;
  const flushCode = () => {
    if (code) {
      segments.push({ text: code, isString: false });
      code = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || (ch === "'" && singleAsString)) {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === quote) {
          closed = true;
          break;
        }
        if (text[j] === '\n') break; // 换行截断视为未闭合
        j++;
      }
      flushCode();
      if (closed) {
        segments.push({ text: text.slice(i, j + 1), isString: true });
        i = j + 1;
      } else {
        // 未闭合:剩余内容按字符串段原样保留(不再参与变换)
        segments.push({ text: text.slice(i), isString: true });
        i = text.length;
      }
      continue;
    }
    code += ch;
    i++;
  }
  flushCode();
  return segments;
}
