/**
 * Monaco ILineChange → LineDiffResult 映射 —— 并排差异的原生算法适配层
 *
 * 背景:并排模式(双 CodeEditor + 自研装饰)之前用 jsdiff diffLines 自算,
 * 同一 hunk 内的 removed + added 按位置硬配成「修改行」(见
 * diff-utils.computeLineDiff 的配对分支),无关的删除与新增会被显示成
 * 「改成对侧首行」并附带噪音词级高亮;词级还是逐行 diffWordsWithSpace,
 * 单 token 内变化会被整词标红。本模块把隐藏 DiffEditor(advanced 算法)
 * 算出的 ILineChange(含字符级 innerChanges)映射回既有 LineDiffResult
 * 结构,下游渲染(buildDiffDecorations / 统计徽标 / 导航 / 复制块)零改动。
 *
 * 约定(经 monaco-editor 0.56 ESM 实现核验,见 legacyLinesDiffComputer.js
 * 的 LineChange.createFromDiffResult 与 diffEditorWidget.js 的 toLineChanges):
 * - 空侧以 EndLineNumber === 0 表示:纯新增时 originalEnd 为 0,纯删除时
 *   modifiedEnd 为 0;其余区间均为 1-based inclusive。
 * - charChanges 为 undefined 时(纯增删块、或 Monaco 判定过复杂而未算字符级)
 *   无词级区间,只保留行级红绿背景;有 charChanges 时按其绝对行号逐行渲染,
 *   与原生 DiffEditor 完全一致(块两侧行数不等时也不裁剪到高亮窗口)。
 * - charChanges 的区间即「被替换区域」(原始侧区间 → 修改侧区间),零宽
 *   区间(纯插入点)在该侧自然无高亮,与既有单侧悬空高亮语义一致。
 * - 相似度为近似口径:等价字符数 / 较长侧字符数,与 jsdiff 版
 *   computeSimilarity 同量纲可比,不代表 git 语义。
 */
import type { editor } from 'monaco-editor';
import type { DiffBlock, LineDeco, LineDiffResult, WordSpan } from './diff-utils';

/** 空文本按 0 行处理(与 computeLineDiff 的 countLines 口径一致) */
function splitModelLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/**
 * 闭区间行号切片的字符量(含行间换行符,相似度近似口径用)。
 * 越界区间按模型实际行数夹取;空区间返回 0。
 */
function rangeTextLength(lines: readonly string[], start: number, end: number): number {
  if (end <= 0 || start > end) return 0;
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  if (from > to) return 0;
  let len = 0;
  for (let line = from; line <= to; line++) len += (lines[line - 1] ?? '').length;
  return len + Math.max(0, to - from);
}

/** 词级区间入桶(同行多段保留先后顺序) */
function pushSpan(bucket: Map<number, WordSpan[]>, line: number, span: WordSpan): void {
  const list = bucket.get(line);
  if (list) list.push(span);
  else bucket.set(line, [span]);
}

/**
 * 把一条字符级变更裁剪到指定行,落到该行的列区间(1-based 起列,开区间止列)。
 * 跨行变更在首行取 startColumn→行尾、在尾行取行首→endColumn、在中间整行,
 * 与 buildDiffDecorations 的列夹取语义衔接;零宽/越界区间返回 null 跳过。
 */
function clipCharChangeToLine(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  line: number,
  lineLength: number,
): WordSpan | null {
  if (line < startLine || line > endLine) return null;
  const maxCol = lineLength + 1;
  const start = line === startLine ? startColumn : 1;
  const end = line === endLine ? endColumn : maxCol;
  const clampedStart = Math.max(1, Math.min(start, maxCol));
  const clampedEnd = Math.max(1, Math.min(end, maxCol));
  if (clampedEnd <= clampedStart) return null;
  return { start: clampedStart, end: clampedEnd };
}

/**
 * 把 Monaco 行级变更序列映射为 interfacial LineDiffResult。
 *
 * 统计语义(沿用既有口径,块边界改由 Monaco 判定):
 * - 双侧非空块:前 min 行两两配对记「修改」(附字符级区间),余量记纯增/纯删;
 * - 单侧为空块:整段记纯增/纯删。
 * 输入应为与隐藏 DiffEditor 内模型一致的比较文本(即已应用 ignore* 预处理
 * 的文本);changes 为空表示完全相同。
 */
export function mapLineChangesToDiffResult(
  changes: readonly editor.ILineChange[],
  original: string,
  modified: string,
): LineDiffResult {
  const stats = { added: 0, removed: 0, modified: 0 };
  const originalDecos: LineDeco[] = [];
  const modifiedDecos: LineDeco[] = [];
  const blocks: DiffBlock[] = [];
  const origLines = splitModelLines(original);
  const modLines = splitModelLines(modified);

  if (changes.length === 0) {
    return { stats, originalDecos, modifiedDecos, blocks, degraded: false, similarity: 1 };
  }

  // 变更字符量(取双侧区间字符量的较大值,纯增/纯删即单侧长度)
  let changedChars = 0;

  for (const change of changes) {
    const origEmpty = change.originalEndLineNumber === 0;
    const modEmpty = change.modifiedEndLineNumber === 0;
    const origStart = change.originalStartLineNumber;
    const origEnd = change.originalEndLineNumber;
    const modStart = change.modifiedStartLineNumber;
    const modEnd = change.modifiedEndLineNumber;

    if (origEmpty) {
      for (let line = modStart; line <= modEnd; line++) {
        modifiedDecos.push({ line, wordSpans: [] });
      }
      stats.added += Math.max(0, modEnd - modStart + 1);
      blocks.push({ origStart: null, origEnd: null, modStart, modEnd });
      changedChars += rangeTextLength(modLines, modStart, modEnd);
      continue;
    }

    if (modEmpty) {
      for (let line = origStart; line <= origEnd; line++) {
        originalDecos.push({ line, wordSpans: [] });
      }
      stats.removed += Math.max(0, origEnd - origStart + 1);
      blocks.push({ origStart, origEnd, modStart: null, modEnd: null });
      changedChars += rangeTextLength(origLines, origStart, origEnd);
      continue;
    }

    const origLen = origEnd - origStart + 1;
    const modLen = modEnd - modStart + 1;
    const paired = Math.min(origLen, modLen);

    // 字符级变更按绝对行号分桶,逐行裁剪覆盖整块(不用 paired 窗口):
    // Monaco 会把删除行语义配对到非相邻的新增行(如中间夹一行纯插入),
    // 窗口式裁剪会丢掉那行的词级高亮,与原生 DiffEditor 表现分叉。
    const origSpans = new Map<number, WordSpan[]>();
    const modSpans = new Map<number, WordSpan[]>();
    for (const cc of change.charChanges ?? []) {
      for (let line = origStart; line <= origEnd; line++) {
        const span = clipCharChangeToLine(
          cc.originalStartLineNumber,
          cc.originalStartColumn,
          cc.originalEndLineNumber,
          cc.originalEndColumn,
          line,
          (origLines[line - 1] ?? '').length,
        );
        if (span) pushSpan(origSpans, line, span);
      }
      for (let line = modStart; line <= modEnd; line++) {
        const span = clipCharChangeToLine(
          cc.modifiedStartLineNumber,
          cc.modifiedStartColumn,
          cc.modifiedEndLineNumber,
          cc.modifiedEndColumn,
          line,
          (modLines[line - 1] ?? '').length,
        );
        if (span) pushSpan(modSpans, line, span);
      }
    }

    // 块内每行都标行级背景;词级区间取自已按绝对行分桶的 charChanges
    for (let line = origStart; line <= origEnd; line++) {
      originalDecos.push({ line, wordSpans: origSpans.get(line) ?? [] });
    }
    for (let line = modStart; line <= modEnd; line++) {
      modifiedDecos.push({ line, wordSpans: modSpans.get(line) ?? [] });
    }
    stats.modified += paired;
    stats.removed += origLen - paired;
    stats.added += modLen - paired;
    blocks.push({ origStart, origEnd, modStart, modEnd });
    changedChars += Math.max(
      rangeTextLength(origLines, origStart, origEnd),
      rangeTextLength(modLines, modStart, modEnd),
    );
  }

  const base = Math.max(original.length, modified.length);
  const similarity = base === 0 ? 1 : Math.min(1, Math.max(0, (base - changedChars) / base));
  return { stats, originalDecos, modifiedDecos, blocks, degraded: false, similarity };
}
