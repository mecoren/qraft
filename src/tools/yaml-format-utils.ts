/**
 * YAML 格式化核心逻辑 —— 基于 yaml 包(YAML 1.2)的 Document 级往返:
 *
 * - 格式化走 parseDocument/parseAllDocuments(而非 parse/stringify 值级 API),
 *   保留注释、锚点/别名、块标量(|、>)与多文档(---)结构;
 *   值级 API 会把上述全部抹平,只适合压缩形态。
 * - minify 用值级 stringify 的 flow 形态:压缩语义是“机器形态”,丢注释换最紧凑
 *   单行输出(doc 级 flow 会把多行注释压成一行破坏语法,故不走)。
 * - 键排序需手动递归排 YAMLMap.items:toString 的 sortMapEntries 选项只作用于
 *   createNode 新建文档,对已解析文档不生效。
 * - 所有序列化 lineWidth: 0 关闭折行(默认 80 会在长字符串上引入续行,
 *   与 prettier-yaml / VSCode YAML 扩展的主流格式化行为不符)。
 */

import {
  isMap,
  isSeq,
  parseAllDocuments,
  stringify,
  type Document,
  type Pair,
  type ToStringOptions,
} from 'yaml';

/** 缩进模式:2/4 空格或单行压缩(yaml 库仅支持数字空格缩进,无 tab 选项) */
export type YamlIndentMode = '2' | '4' | 'minify';

export interface YamlFormatError extends Error {
  /** 1 起始行列(取自 YAMLParseError.linePos[0],无位置信息时为 null) */
  line: number | null;
  column: number | null;
}

/** 从 YAMLParseError 上提取行列(1 起始);无 linePos 的错误返回 null */
function extractLineCol(err: unknown): { line: number | null; column: number | null } {
  const raw = err as { linePos?: Array<{ line: number; col: number }> | null } | null;
  const pos = raw?.linePos?.[0];
  if (pos && typeof pos.line === 'number' && typeof pos.col === 'number') {
    return { line: pos.line, column: pos.col };
  }
  return { line: null, column: null };
}

/** 把底层错误转译为带行列信息的 YamlFormatError 再抛出(供组件层渲染错误位置) */
function throwFormatError(cause: unknown): never {
  const source = cause instanceof Error ? cause : null;
  const message = source?.message ?? String(cause);
  const { line, column } = extractLineCol(cause);
  const err = new Error(message) as YamlFormatError;
  err.line = line;
  err.column = column;
  throw err;
}

/**
 * 递归就地排序映射键:Pair.key 经 toJSON 归一为字符串后按 localeCompare 排;
 * 序列内的映射、映射值里的嵌套集合全覆盖,纯标量不动。
 */
function sortMapEntriesInPlace(node: unknown): void {
  if (isMap(node)) {
    node.items.sort((a: Pair<unknown, unknown>, b: Pair<unknown, unknown>) =>
      keyToSortable(a).localeCompare(keyToSortable(b)),
    );
    for (const pair of node.items) {
      sortMapEntriesInPlace(pair.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      sortMapEntriesInPlace(item);
    }
  }
}

/** 键归一为可比较字符串:数字/布尔取 JSON 形态,保证 "10" 字典序排在 "2" 后、"true" 排在 "abc" 前 */
function keyToSortable(pair: Pair<unknown, unknown>): string {
  const key = pair.key as { toJSON?: () => unknown } | number | string | boolean | null | undefined;
  const value =
    key && typeof key === 'object' && typeof key.toJSON === 'function' ? key.toJSON() : key;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  return String(value);
}

/** 值级 flow 压缩选项(无 padding 最紧凑形态) */
const FLOW_OPTIONS: ToStringOptions = {
  collectionStyle: 'flow',
  lineWidth: 0,
  flowCollectionPadding: false,
};

/**
 * 格式化 YAML 文本。
 *
 * @param text 输入 YAML 源文本
 * @param mode 缩进模式(2/4 空格;minify 输出单行 flow 形态,丢失注释)
 * @param sortKeys 递归排序映射键(默认保留原文顺序)
 * @returns 格式化后的文本(以单个换行结尾)
 * @throws YamlFormatError 带 line/column 的解析错误
 */
export function formatYaml(text: string, mode: YamlIndentMode, sortKeys = false): string {
  if (!text.trim()) return '';

  let docs: Document[];
  try {
    docs = parseAllDocuments(text);
  } catch (e) {
    // 单文档语法错误会收进 doc.errors,但流级结构错误(如 --- 前有内容)
    // 直接抛出,两条路径统一转译成带行列的 YamlFormatError
    throwFormatError(e);
  }

  // 带错误的 Document 在 toString 时会抛错,提前统一转译
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      throwFormatError(doc.errors[0]);
    }
  }

  if (sortKeys) {
    for (const doc of docs) {
      sortMapEntriesInPlace(doc.contents);
    }
  }

  if (mode === 'minify') {
    // 值级 stringify:注释/锚点丢弃,数字键加引号保合法性
    return docs.map((doc) => stringify(doc.toJS(), FLOW_OPTIONS).trimEnd()).join('\n---\n') + '\n';
  }

  const indent = mode === '4' ? 4 : 2;
  // 后续文档的 toString 自带 --- 前缀,首文档无前缀,join('') 即完整流
  return docs.map((doc) => doc.toString({ indent, lineWidth: 0 })).join('');
}

/**
 * 解析统计(输入校验用,不抛错):文档数、顶层键数与最大嵌套深度。
 * 纯注释/空内容文档计为空文档。
 */
export function inspectYaml(text: string): {
  documents: number;
  keys: number;
  depth: number;
} {
  if (!text.trim()) return { documents: 0, keys: 0, depth: 0 };
  let docs: Document[];
  try {
    docs = parseAllDocuments(text);
  } catch {
    return { documents: 0, keys: 0, depth: 0 };
  }
  if (docs.some((doc) => doc.errors.length > 0)) {
    return { documents: 0, keys: 0, depth: 0 };
  }

  let keys = 0;
  let depth = 0;
  const walk = (node: unknown, level: number): void => {
    depth = Math.max(depth, level);
    if (isMap(node)) {
      keys += node.items.length;
      for (const pair of node.items) {
        walk(pair.value, level + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        walk(item, level + 1);
      }
    }
  };
  for (const doc of docs) {
    walk(doc.contents, 0);
  }
  return { documents: docs.length, keys, depth };
}
