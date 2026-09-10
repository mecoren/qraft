/**
 * 文本差异计算与装饰构建 —— jsdiff 纯函数封装(TextDiffView 共享)
 *
 * 消费方:TextDiffView(文本比较工具 / 文本编辑器文件对比共用)。
 *
 * 职责:
 * - 把 jsdiff 的 diffLines 输出规整为「每侧行号 → 差异装饰」结构,
 *   供双 Monaco 编辑器直接渲染装饰(整行背景 + 行内词级高亮)。
 * - 统计口径与旧版 summarizeLineChanges(Monaco getLineChanges)一致:
 *   连续 removed/added 段按行数取 min 配对为「修改行」,余量为纯新增/纯删除。
 * - 相似度(similarity):diffLines 公共段字符数 / 较长侧字符数,
 *   0~1 区间,退化为 1(相同)时为一,替换降级时为 0。
 * - 补丁导出(buildUnifiedPatch):jsdiff createTwoFilesPatch 统一格式。
 *
 * 设计说明:
 * - 词级差异用 diffWordsWithSpace 按配对行逐行计算,列号以 UTF-16 码元
 *   计数(与 Monaco 列口径一致),start 为 1-based、end 为开区间。
 * - 行级 diff 带 maxEditLength 上限:超限时 jsdiff 返回 undefined,
 *   降级为「整文件替换」语义(原始侧全部标红、修改侧全部标绿),避免
 *   O(ND) 病态输入卡死 UI。
 * - ignoreNewlineAtEof: 忽略末尾换行差异,与 DiffEditor 的宽松观感一致,
 *   避免「看起来没变但统计显示已修改」的困惑。
 * - CRLF: diffLines 的 chunk value 含 '\r\n' 终结符,按 '\n' 切行后
 *   逐行剥掉尾部 '\r'(Monaco 模型行不含终结符,词级列号按剥后文本计算)。
 * - ignoreEol: 比较前把 CRLF 归一为 LF(仅用于比较;编辑器内容与装饰
 *   行号不变——归一不改行数,词级列号按已剥 \r 的原始行计算)。
 */
import { createTwoFilesPatch, diffLines, diffWordsWithSpace, type Change } from 'diff';
import type { editor } from 'monaco-editor';
import type { MonacoEditor } from '@/components/ui/monaco-context-menu';

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

/** 行内词级差异区间(1-based 起列,开区间止列,单位 UTF-16 码元) */
export interface WordSpan {
  start: number;
  end: number;
}

/** 一行的差异装饰:整行背景由行号决定,wordSpans 仅配对修改行携带 */
export interface LineDeco {
  line: number;
  wordSpans: WordSpan[];
}

export interface LineDiffResult {
  stats: DiffStats;
  /** 原始侧需要差异背景的行(纯删除 + 配对修改) */
  originalDecos: LineDeco[];
  /** 修改侧需要差异背景的行(纯新增 + 配对修改) */
  modifiedDecos: LineDeco[];
  /** 行级 diff 因超限降级为整体替换时为 true */
  degraded: boolean;
  /**
   * 相似度(0~1):公共段字符数 / 较长侧字符数;双侧均空时为 1,
   * 降级(整体替换)时为 0
   */
  similarity: number;
}

export interface ComputeLineDiffOptions {
  /** 是否计算行内词级差异(大文档可关闭以省时),默认 true */
  includeWordDiff?: boolean;
  /** 行级 diff 的编辑距离上限,超限降级为整体替换 */
  maxEditLength?: number;
  /** 忽略行尾空白差异(预处理剥掉每行行尾空白),默认 false */
  ignoreWhitespace?: boolean;
  /** 忽略大小写差异(预处理统一小写比较),默认 false */
  ignoreCase?: boolean;
  /** 忽略换行符差异(比较前把 CRLF 归一为 LF),默认 false */
  ignoreEol?: boolean;
}

/** 默认编辑距离上限:正常文档远低于此值,病态输入触发降级 */
const DEFAULT_MAX_EDIT_LENGTH = 20_000;

/**
 * 词级差异的每侧载荷上限(字符数):任一侧超过即停用行内词级高亮,
 * 只保留行级红绿背景,避免大文档逐行 diffWordsWithSpace 拖垮输入。
 */
export const WORD_DIFF_MAX_CHARS = 100_000;

/** 把 diffLines 的 chunk value 切成单行数组(剥掉换行终结符,含 CRLF 的 '\r') */
function splitChunkLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** 统计一个字符串的行数(空串视为 0 行,末尾换行不额外计一行) */
function countLines(text: string): number {
  if (text === '') return 0;
  const stripped = text.endsWith('\n') ? text.slice(0, -1) : text;
  return stripped.split('\n').length;
}

/** 计算一对配对行的行内词级差异区间(两侧各自的高亮段) */
function computeWordSpans(
  originalLine: string,
  modifiedLine: string,
): { origSpans: WordSpan[]; modSpans: WordSpan[] } {
  const parts = diffWordsWithSpace(originalLine, modifiedLine);
  const origSpans: WordSpan[] = [];
  const modSpans: WordSpan[] = [];
  let origOffset = 0;
  let modOffset = 0;
  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
      modSpans.push({ start: modOffset + 1, end: modOffset + len + 1 });
      modOffset += len;
    } else if (part.removed) {
      origSpans.push({ start: origOffset + 1, end: origOffset + len + 1 });
      origOffset += len;
    } else {
      origOffset += len;
      modOffset += len;
    }
  }
  return { origSpans, modSpans };
}

/** 比较前预处理:剥掉每行行尾空白(保留换行结构) */
function stripTrailingWhitespacePerLine(text: string): string {
  return text.replace(/[ \t]+(?=\r?\n|$)/g, '');
}

/** 比较前预处理:CRLF 归一为 LF(仅用于比较,不回写编辑器内容) */
function normalizeEol(text: string): string {
  return text.includes('\r\n') ? text.split('\r\n').join('\n') : text;
}

/**
 * 计算两侧文本的相似度(0~1):diffLines 公共段字符数占较长侧的比例。
 * 行级 diff 超限(降级)时返回 0;双侧均空视为完全相同返回 1。
 * 输入应为已应用 ignore* 规范化的比较文本。
 */
function computeSimilarity(
  parts: Change[] | undefined,
  cmpOriginal: string,
  cmpModified: string,
): number {
  if (!parts) return 0;
  const base = Math.max(cmpOriginal.length, cmpModified.length);
  if (base === 0) return 1;
  let common = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return common / base;
}

/**
 * 生成统一格式补丁(unified diff,即 git diff / diff -u 输出格式)。
 * 文件名缺省用 original / modified 占位;ignore 选项与主比较同口径,
 * 保证「导出的补丁」与「界面上看到的高亮」一致。
 */
export function buildUnifiedPatch(
  original: string,
  modified: string,
  options: ComputeLineDiffOptions & { originalName?: string; modifiedName?: string } = {},
): string {
  const {
    ignoreWhitespace = false,
    ignoreCase = false,
    ignoreEol = false,
    originalName = 'original',
    modifiedName = 'modified',
  } = options;
  let cmpOriginal = original;
  let cmpModified = modified;
  if (ignoreEol) {
    cmpOriginal = normalizeEol(cmpOriginal);
    cmpModified = normalizeEol(cmpModified);
  }
  if (ignoreWhitespace) {
    cmpOriginal = stripTrailingWhitespacePerLine(cmpOriginal);
    cmpModified = stripTrailingWhitespacePerLine(cmpModified);
  }
  if (ignoreCase) {
    cmpOriginal = cmpOriginal.toLowerCase();
    cmpModified = cmpModified.toLowerCase();
  }
  return createTwoFilesPatch(originalName, modifiedName, cmpOriginal, cmpModified);
}

/**
 * 计算两侧文本的行级差异 + 配对行词级差异。
 *
 * 统计语义(与旧版 Monaco getLineChanges 汇总一致):
 * - 连续 removed/added 段:前 min(n,m) 行两两配对记「修改」,
 *   removed 余量记「删除」、added 余量记「新增」。
 * - 配对行额外给出两侧行内变更片段的列区间(wordSpans)。
 * - ignoreWhitespace / ignoreCase / ignoreEol 在比较前对输入做规范化,
 *   但装饰行号仍按原文行号(两侧行结构不变)。
 */
export function computeLineDiff(
  original: string,
  modified: string,
  options: ComputeLineDiffOptions = {},
): LineDiffResult {
  const {
    includeWordDiff = true,
    maxEditLength = DEFAULT_MAX_EDIT_LENGTH,
    ignoreWhitespace = false,
    ignoreCase = false,
    ignoreEol = false,
  } = options;
  const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
  const originalDecos: LineDeco[] = [];
  const modifiedDecos: LineDeco[] = [];

  // 规范化仅用于比较;原文行号结构不变(剥空白/小写化/EOL 归一均不改行数,
  // EOL 归一只把 '\r\n' 收敛为 '\n',切行后每行内容与原文剥 \r 后一致)
  let cmpOriginal = original;
  let cmpModified = modified;
  if (ignoreEol) {
    cmpOriginal = normalizeEol(cmpOriginal);
    cmpModified = normalizeEol(cmpModified);
  }
  if (ignoreWhitespace) {
    cmpOriginal = stripTrailingWhitespacePerLine(cmpOriginal);
    cmpModified = stripTrailingWhitespacePerLine(cmpModified);
  }
  if (ignoreCase) {
    cmpOriginal = cmpOriginal.toLowerCase();
    cmpModified = cmpModified.toLowerCase();
  }

  if (cmpOriginal === cmpModified) {
    return { stats, originalDecos, modifiedDecos, degraded: false, similarity: 1 };
  }

  const parts: Change[] | undefined = diffLines(cmpOriginal, cmpModified, {
    maxEditLength,
    ignoreNewlineAtEof: true,
  });

  const similarity = computeSimilarity(parts, cmpOriginal, cmpModified);

  // 降级:编辑距离超限(jsdiff 返回 undefined),按整文件替换展示
  if (!parts) {
    const origCount = countLines(original);
    const modCount = countLines(modified);
    stats.removed = origCount;
    stats.added = modCount;
    for (let line = 1; line <= origCount; line++) originalDecos.push({ line, wordSpans: [] });
    for (let line = 1; line <= modCount; line++) modifiedDecos.push({ line, wordSpans: [] });
    return { stats, originalDecos, modifiedDecos, degraded: true, similarity: 0 };
  }

  let origLine = 1;
  let modLine = 1;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];

    if (part.added) {
      // 纯新增段(前面没有配对的删除段)
      const lines = splitChunkLines(part.value);
      for (let k = 0; k < lines.length; k++)
        modifiedDecos.push({ line: modLine + k, wordSpans: [] });
      stats.added += lines.length;
      modLine += lines.length;
      i += 1;
      continue;
    }

    if (part.removed) {
      const removedLines = splitChunkLines(part.value);
      const next = parts[i + 1];
      if (next && next.added) {
        // 连续 removed + added:按行数配对为「修改」,余量为纯删/纯增
        const addedLines = splitChunkLines(next.value);
        const paired = Math.min(removedLines.length, addedLines.length);
        for (let k = 0; k < paired; k++) {
          const { origSpans, modSpans } =
            includeWordDiff && (removedLines[k] || addedLines[k])
              ? computeWordSpans(removedLines[k], addedLines[k])
              : { origSpans: [], modSpans: [] };
          originalDecos.push({ line: origLine + k, wordSpans: origSpans });
          modifiedDecos.push({ line: modLine + k, wordSpans: modSpans });
        }
        stats.modified += paired;
        for (let k = paired; k < removedLines.length; k++) {
          originalDecos.push({ line: origLine + k, wordSpans: [] });
        }
        stats.removed += removedLines.length - paired;
        for (let k = paired; k < addedLines.length; k++) {
          modifiedDecos.push({ line: modLine + k, wordSpans: [] });
        }
        stats.added += addedLines.length - paired;
        origLine += removedLines.length;
        modLine += addedLines.length;
        i += 2;
      } else {
        // 纯删除段
        for (let k = 0; k < removedLines.length; k++) {
          originalDecos.push({ line: origLine + k, wordSpans: [] });
        }
        stats.removed += removedLines.length;
        origLine += removedLines.length;
        i += 1;
      }
      continue;
    }

    // 相同上下文段:两侧行号同步推进
    const n = splitChunkLines(part.value).length;
    origLine += n;
    modLine += n;
    i += 1;
  }

  return { stats, originalDecos, modifiedDecos, degraded: false, similarity };
}

/**
 * 概览标尺刻度色(VSCode 对齐:差异行在编辑器右缘标尺绘制红/绿刻度)。
 * Monaco 概览标尺经 canvas 绘制,不接受 CSS var() —— 调用方须经
 * getComputedStyle 把 --diff-add-emph / --diff-remove-emph 解析成
 * 具体色值后传入(随主题/调色板切换重算)。
 */
export interface DiffRulerColors {
  added: string;
  removed: string;
}

/**
 * 把差异计算结果转换为 Monaco 装饰数组。
 * 行号/列号对当前模型夹取:deferred 值短暂滞后于模型内容时,越界的
 * 装饰直接跳过(而非夹到最后 一行,避免把过期行号错误刷到别的行上)。
 *
 * 每个差异行产出三类装饰:
 * - 行级:isWholeLine 背景类 + marginClassName gutter 色条类
 *   (VSCode 风格行号槽标记,见 globals.css 的 text-compare-gutter-*)
 * - 概览标尺:position=Full(7,左中右全泳道)的红/绿刻度,
 *   需编辑器 overviewRulerLanes > 0 且提供 rulerColors
 * - 词级:配对修改行的行内变更片段高亮(开区间列号夹取)。
 */
export function buildDiffDecorations(
  editorInstance: MonacoEditor,
  decos: readonly LineDeco[],
  side: 'original' | 'modified',
  rulerColors?: DiffRulerColors,
): editor.IModelDeltaDecoration[] {
  const model = editorInstance.getModel();
  if (!model) return [];
  const lineCount = model.getLineCount();
  const lineClass = side === 'original' ? 'text-compare-line-removed' : 'text-compare-line-added';
  const wordClass = side === 'original' ? 'text-compare-word-removed' : 'text-compare-word-added';
  const gutterClass =
    side === 'original' ? 'text-compare-gutter-removed' : 'text-compare-gutter-added';
  const rulerColor = rulerColors
    ? side === 'original'
      ? rulerColors.removed
      : rulerColors.added
    : undefined;
  const out: editor.IModelDeltaDecoration[] = [];
  for (const deco of decos) {
    if (deco.line < 1 || deco.line > lineCount) continue;
    out.push({
      range: { startLineNumber: deco.line, startColumn: 1, endLineNumber: deco.line, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: lineClass,
        marginClassName: gutterClass,
        // OverviewRulerLane.Full = 7(左/中/右全泳道),对齐 VSCode 差异刻度
        overviewRuler: rulerColor ? { color: rulerColor, position: 7 } : undefined,
      },
    });
    const maxCol = model.getLineMaxColumn(deco.line);
    for (const span of deco.wordSpans) {
      const start = Math.max(1, Math.min(span.start, maxCol));
      const end = Math.min(span.end, maxCol);
      if (end > start) {
        out.push({
          range: {
            startLineNumber: deco.line,
            startColumn: start,
            endLineNumber: deco.line,
            endColumn: end,
          },
          options: { className: wordClass },
        });
      }
    }
  }
  return out;
}
