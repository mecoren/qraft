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
  /**
   * 差异块列表(「复制到对侧」的操作粒度):每个连续差异 chunk 一块,
   * 由 chunk 循环直接产出——块边界与配对关系(decos 单侧连续性推不出
   * 「配对行 vs 余量行」的分界)只有 chunk 语境才可靠。
   */
  blocks: DiffBlock[];
  /** 行级 diff 因超限降级为整体替换时为 true */
  degraded: boolean;
  /**
   * 相似度(0~1):公共段字符数 / 较长侧字符数;双侧均空时为 1,
   * 降级(整体替换)时为 0
   */
  similarity: number;
}

/**
 * 一个差异块(两侧连续差异段的配对视图):
 * 原始侧 [origStart, origEnd] 行 ↔ 修改侧 [modStart, modEnd] 行。
 * 「复制到对侧」按块操作——把本侧区间整段替换成对侧区间内容。
 */
export interface DiffBlock {
  /** 原始侧起始行(1-based,inclusive);纯新增块为 null(原始侧无对应行) */
  origStart: number | null;
  /** 原始侧结束行(inclusive);origStart 为 null 时恒 null */
  origEnd: number | null;
  /** 修改侧起始行(1-based,inclusive);纯删除块为 null(修改侧无对应行) */
  modStart: number | null;
  /** 修改侧结束行(inclusive);modStart 为 null 时恒 null */
  modEnd: number | null;
}

/**
 * 差异快照(导出补丁用):某次差异计算的输入原文 + 生效选项 + 产出块。
 * 调用方存 ref,导出时比对新鲜度——新鲜即按显示块生成补丁,过期回退
 * jsdiff 独立计算,避免异步滞后导致「补丁与当前文本不符」。
 */
export interface DiffSnapshot {
  original: string;
  modified: string;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreEol: boolean;
  blocks: DiffBlock[];
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

/**
 * 比较前预处理:剥掉每行行尾空白(保留换行结构)。
 * jsdiff 兜底路的空白忽略手段;原生路走 ignoreTrimWhitespace(首尾全忽略,
 * 与 VSCode 默认同义),兜底命中时行首缩进差异仍会显形,属已知小口径差。
 */
export function stripTrailingWhitespacePerLine(text: string): string {
  return text.replace(/[ \t]+(?=\r?\n|$)/g, '');
}

/**
 * 比较前预处理:CRLF 归一为 LF(仅用于比较,不回写编辑器内容)。
 * monaco-diff-service 的隐藏 DiffEditor 做同款预处理,保证原生/兜底两路口径一致。
 */
export function normalizeEol(text: string): string {
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
 * 把差异装饰行号分组为差异块(「复制到对侧」的操作粒度)。
 *
 * 警告:仅按 decos 单侧连续性推导在「同 chunk 内增删不等长」场景会把
 * 配对行与余量行错误并块——块的准确来源是 computeLineDiff 的 chunk 循环
 * (result.blocks)。本导出保留给调用方对既有 decos 做粗粒度分组
 * (不要求配对精度的场景,如概览统计)。
 */
export function groupDiffBlocks(
  originalDecos: readonly LineDeco[],
  modifiedDecos: readonly LineDeco[],
): DiffBlock[] {
  const origLines = originalDecos.map((d) => d.line);
  const modLines = modifiedDecos.map((d) => d.line);

  /** 把连续行号切成区间数组 */
  const toRanges = (lines: readonly number[]): Array<[number, number]> => {
    const ranges: Array<[number, number]> = [];
    for (const line of lines) {
      const last = ranges[ranges.length - 1];
      if (last && line === last[1] + 1) last[1] = line;
      else ranges.push([line, line]);
    }
    return ranges;
  };

  const origRanges = toRanges(origLines);
  const modRanges = toRanges(modLines);

  // 块数必然相等:每个差异 chunk 在两侧各产生一个连续区间(纯新增/纯删除
  // 侧为空)。但空区间信息已丢失,须靠「上下文对齐」重建配对:
  // 用累加行号推进两侧游标,相同段的行数在同步推进。
  const blocks: DiffBlock[] = [];
  let oi = 0;
  let mi = 0;
  while (oi < origRanges.length || mi < modRanges.length) {
    const oRange = origRanges[oi];
    const mRange = modRanges[mi];
    if (oRange && mRange) {
      // 双侧都有差异:同一 chunk 中原始区间与修改区间成对出现
      blocks.push({
        origStart: oRange[0],
        origEnd: oRange[1],
        modStart: mRange[0],
        modEnd: mRange[1],
      });
      oi += 1;
      mi += 1;
    } else if (oRange) {
      // 纯删除块(修改侧无差异行)
      blocks.push({
        origStart: oRange[0],
        origEnd: oRange[1],
        modStart: null,
        modEnd: null,
      });
      oi += 1;
    } else if (mRange) {
      // 纯新增块
      blocks.push({
        origStart: null,
        origEnd: null,
        modStart: mRange[0],
        modEnd: mRange[1],
      });
      mi += 1;
    } else {
      break;
    }
  }
  return blocks;
}

/** 读文本指定行区间(1-based inclusive)的内容,含行间换行(按文本原 EOL) */
function readLineRange(text: string, start: number, end: number): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  if (from > to) return '';
  return lines.slice(from - 1, to).join(eol);
}

/**
 * 「复制差异块到对侧」的纯函数核心:把一侧的块内容写进另一侧。
 *
 * 方向:side 为动作发起侧('original' | 'modified'),块内容取自该侧,
 * 替换对侧的配对区间(对侧区间为 null 时在配对位置插入)。
 * 返回对侧的新全文;块内容与对侧原内容相同时返回原文本(no-op)。
 */
export function applyDiffBlockCopy(
  fromText: string,
  toText: string,
  block: DiffBlock,
  side: 'original' | 'modified',
): string {
  // 发起侧区间(动作按钮挂在发起侧 gutter,区间非空)
  const srcStart = side === 'original' ? block.origStart : block.modStart;
  const srcEnd = side === 'original' ? block.origEnd : block.modEnd;
  if (srcStart === null || srcEnd === null) return toText;
  // 对侧配对区间(null → 插入语义:替换对侧插入锚点,即修改侧起始行前)
  const dstStart = side === 'original' ? block.modStart : block.origStart;
  const dstEnd = side === 'original' ? block.modEnd : block.origEnd;

  const source = readLineRange(fromText, srcStart, srcEnd);
  const toEol = toText.includes('\r\n') ? '\r\n' : '\n';
  const toLines = toText === '' ? [] : toText.split(/\r\n|\r|\n/);
  // 末尾换行语义:文本以 EOL 结尾时 split 尾部产生空串,保留该空串以维持
  // 「末尾换行」结构;写回时 join 天然还原
  const srcLines = source === '' ? [] : source.split(/\r\n|\r|\n/);

  if (dstStart === null || dstEnd === null) {
    // 插入:发起侧为纯增/纯删,对侧无对应行。插入位置 = 发起侧块起始行
    // 在对侧的对齐点——用「上一相同段的下一行」近似:即发起侧区间起行
    // 对齐到对侧同号行前(块内对侧游标未推进,起始行即对齐锚点)
    const anchor = side === 'original' ? block.origStart! : block.modStart!;
    const insertAt = Math.min(Math.max(anchor - 1, 0), toLines.length);
    const next = [...toLines.slice(0, insertAt), ...srcLines, ...toLines.slice(insertAt)];
    return next.join(toEol);
  }

  // 替换:对侧区间整段换成发起侧块内容
  const from = Math.max(1, dstStart);
  const to = Math.min(toLines.length, dstEnd);
  if (from > to) return toText;
  const next = [...toLines.slice(0, from - 1), ...srcLines, ...toLines.slice(to)];
  return next.join(toEol);
}

/**
 * 差异块归一化(内部):纯增/纯删块的空侧按邻块等价游程推导对齐锚点,
 * 输出双侧半开区间(1-based:起 inclusive、止 exclusive),供补丁 hunk、
 * 行号映射、隐藏区间三处复用。输入块须有序且不重叠(两路引擎天然保证)。
 */
interface AnchoredBlock {
  /** 原始侧区间;纯新增块为空区间 [anchor, anchor)(anchor=其前原始行数) */
  origStart: number;
  origEnd: number;
  /** 修改侧区间;纯删除块为空区间,语义同上 */
  modStart: number;
  modEnd: number;
}

function resolveBlockAnchors(blocks: readonly DiffBlock[]): AnchoredBlock[] {
  const out: AnchoredBlock[] = [];
  // 已消费行数(上一块的结束行,0 起):等价游程长度双侧相等是锚点推导前提
  let consumedOrig = 0;
  let consumedMod = 0;
  for (const b of blocks) {
    if (b.origStart !== null && b.modStart !== null) {
      const origEnd = b.origEnd ?? b.origStart;
      const modEnd = b.modEnd ?? b.modStart;
      out.push({
        origStart: b.origStart,
        origEnd: origEnd + 1,
        modStart: b.modStart,
        modEnd: modEnd + 1,
      });
      consumedOrig = origEnd;
      consumedMod = modEnd;
    } else if (b.modStart !== null) {
      // 纯新增:修改侧等价游程长度平移到原始侧即插入锚点
      const modEnd = b.modEnd ?? b.modStart;
      const anchor = consumedOrig + Math.max(0, b.modStart - 1 - consumedMod);
      out.push({ origStart: anchor, origEnd: anchor, modStart: b.modStart, modEnd: modEnd + 1 });
      consumedMod = modEnd;
    } else if (b.origStart !== null) {
      // 纯删除:对称
      const origEnd = b.origEnd ?? b.origStart;
      const anchor = consumedMod + Math.max(0, b.origStart - 1 - consumedOrig);
      out.push({ origStart: b.origStart, origEnd: origEnd + 1, modStart: anchor, modEnd: anchor });
      consumedOrig = origEnd;
    }
  }
  return out;
}

/**
 * 块级行号映射(滚动对齐用):等价区间 1:1 平移,变更块内按比例落点,
 * 块外尾部按整体漂移。返回行号恒为 1-based,调用方仍需夹取到模型行数。
 */
export interface BlockLineMapper {
  /** 原始侧行号 → 修改侧行号 */
  origToMod(line: number): number;
  /** 修改侧行号 → 原始侧行号 */
  modToOrig(line: number): number;
}

export function createBlockLineMapper(blocks: readonly DiffBlock[]): BlockLineMapper {
  const segs = resolveBlockAnchors(blocks);

  const map = (line: number, from: 'orig' | 'mod'): number => {
    // 下一段未处理的等价行(1-based);游程内双侧行数相等,差值平移即对齐
    let sCursor = 1;
    let tCursor = 1;
    for (const s of segs) {
      const ss = from === 'orig' ? s.origStart : s.modStart;
      const se = from === 'orig' ? s.origEnd : s.modEnd;
      const ts = from === 'orig' ? s.modStart : s.origStart;
      const te = from === 'orig' ? s.modEnd : s.origEnd;
      // 空区间(纯增删在本侧无行):锚点行仍归属其前等价游程,不判入块内
      if (line < ss || (line === ss && ss === se)) return line + (tCursor - sCursor);
      if (line < se) {
        // 变更块内:按块内比例落到对侧区间;对侧空区间落插入锚点
        const sLen = se - ss;
        const tLen = te - ts;
        if (sLen <= 0 || tLen <= 0) return ts;
        const mapped = ts + Math.round(((line - ss) * tLen) / sLen);
        return Math.min(Math.max(mapped, ts), te - 1);
      }
      sCursor = se;
      tCursor = te;
    }
    // 尾部等价游程:按整体漂移(方向相关,正反各算各的差值)
    return line + (tCursor - sCursor);
  };

  return {
    origToMod: (line: number) => map(line, 'orig'),
    modToOrig: (line: number) => map(line, 'mod'),
  };
}

/** 未变更隐藏区间(1-based inclusive),两侧各自的行号 */
/**
 * 行对齐垫块(VSCode 式空白占位):短侧在 anchor 行后垫出高度差,
 * 使等价行垂直同高。afterLineNumber 允许 0(文件首行前垫块)。
 */
export interface AlignZone {
  afterLineNumber: number;
  heightInLines: number;
}

export interface AlignmentZones {
  original: AlignZone[];
  modified: AlignZone[];
}

/**
 * 由差异块推导两侧对齐垫块:等长块无需垫;不等长块在短侧垫出行数差;
 * 纯增/纯删块在空侧锚点垫出整段高度。返回已按 afterLineNumber 排序,
 * 调用方可直喂 changeViewZones。
 */
export function computeAlignmentZones(blocks: readonly DiffBlock[]): AlignmentZones {
  const original: AlignZone[] = [];
  const modified: AlignZone[] = [];
  for (const s of resolveBlockAnchors(blocks)) {
    const oLen = s.origEnd - s.origStart;
    const mLen = s.modEnd - s.modStart;
    if (oLen === mLen) continue;
    if (oLen > mLen) {
      // 修改侧短:垫在块末行后;空区间(纯删除)锚点即 afterLineNumber(可为 0)
      modified.push({
        afterLineNumber: s.modEnd > s.modStart ? s.modEnd - 1 : s.modStart,
        heightInLines: oLen - mLen,
      });
    } else {
      original.push({
        afterLineNumber: s.origEnd > s.origStart ? s.origEnd - 1 : s.origStart,
        heightInLines: mLen - oLen,
      });
    }
  }
  return { original, modified };
}

export interface HiddenLineRange {
  start: number;
  end: number;
}

export interface HiddenRanges {
  original: HiddenLineRange[];
  modified: HiddenLineRange[];
}

/** 「只看差异」在等价游程两端各保留的上下文行数(与行内折叠 3 行对齐) */
export const HIDE_UNCHANGED_CONTEXT = 3;

/**
 * 由差异块推导两侧可隐藏的等价行区间:等价游程掐头去尾各留 context 行,
 * 短游程(≤2×context)全留。返回区间已按起止排序,调用方可直转
 * setHiddenAreas(列取整行)。
 */
export function computeHiddenRanges(
  blocks: readonly DiffBlock[],
  origLineCount: number,
  modLineCount: number,
  context: number = HIDE_UNCHANGED_CONTEXT,
): HiddenRanges {
  const segs = resolveBlockAnchors(blocks);
  const original: HiddenLineRange[] = [];
  const modified: HiddenLineRange[] = [];
  // 下一段未处理的等价行(1-based);半开块的止即下一游程的起
  let oNext = 1;
  let mNext = 1;
  /** 单侧等价游程掐头去尾(短游程全留) */
  const hideSide = (list: HiddenLineRange[], start: number, end: number): void => {
    const hideStart = start + context;
    const hideEnd = end - context;
    if (hideStart <= hideEnd) list.push({ start: hideStart, end: hideEnd });
  };
  for (const s of segs) {
    // 空侧(纯增/纯删的对侧)不切分游程:锚点无可见行,其两侧等价行合并算上下文
    if (s.origEnd > s.origStart) {
      hideSide(original, oNext, s.origStart - 1);
      oNext = s.origEnd;
    }
    if (s.modEnd > s.modStart) {
      hideSide(modified, mNext, s.modStart - 1);
      mNext = s.modEnd;
    }
  }
  // 尾部等价游程(块后剩余行)
  hideSide(original, oNext, origLineCount);
  hideSide(modified, mNext, modLineCount);
  return { original, modified };
}

export interface BuildPatchFromBlocksOptions {
  originalName?: string;
  modifiedName?: string;
  /** 每个 hunk 两侧保留的上下文行数,缺省 3(git 默认) */
  context?: number;
}

interface PatchBodyLine {
  prefix: ' ' | '-' | '+' | '\\';
  text: string;
  /** 该行归属:上下文行双侧共有,增删行各归一侧(末尾换行标记定位用) */
  side: 'orig' | 'mod' | 'both' | 'marker';
}

/**
 * 按当前差异块生成统一格式补丁(与界面高亮同源)。
 *
 * 与 buildUnifiedPatch(jsdiff 独立计算)的区别:块边界、增删归属与界面
 * 完全一致,避免两路算法在疑难输入上分组分叉导致「补丁与所见不符」。
 * 行内容取传入原文(块只提供行号,ignore 预处理不改行数故行号通用)。
 *
 * 格式细节(git 对齐):
 * - hunk 头 `@@ -a,b +c,d @@`,上下文缺省 3 行,相邻 hunk 合并;
 * - 文件末尾缺换行时追加 `\ No newline at end of file` 标记;
 * - 输出换行统一 LF;无差异时只有 `---`/`+++` 文件头。
 */
export function buildUnifiedPatchFromBlocks(
  original: string,
  modified: string,
  blocks: readonly DiffBlock[],
  options: BuildPatchFromBlocksOptions = {},
): string {
  const { originalName = 'original', modifiedName = 'modified', context = 3 } = options;
  const ctx = Math.max(0, context);
  const origLines = splitChunkLines(original);
  const modLines = splitChunkLines(modified);
  const out: string[] = [`--- ${originalName}`, `+++ ${modifiedName}`];
  if (blocks.length === 0) return `${out.join('\n')}\n`;

  // 0-based 半开区间:起 = 行号-1,止 = 归一止-1
  interface Hunk {
    oStart: number;
    oEnd: number;
    mStart: number;
    mEnd: number;
  }
  const hunks: Hunk[] = [];
  for (const s of resolveBlockAnchors(blocks)) {
    const h: Hunk = {
      oStart: Math.max(0, s.origStart - 1 - ctx),
      oEnd: Math.min(origLines.length, s.origEnd - 1 + ctx),
      mStart: Math.max(0, s.modStart - 1 - ctx),
      mEnd: Math.min(modLines.length, s.modEnd - 1 + ctx),
    };
    const prev = hunks[hunks.length - 1];
    if (prev && h.oStart <= prev.oEnd && h.mStart <= prev.mEnd) {
      // 重叠/相接即合并,避免无意义的连续 hunk 头
      prev.oEnd = Math.max(prev.oEnd, h.oEnd);
      prev.mEnd = Math.max(prev.mEnd, h.mEnd);
    } else {
      hunks.push(h);
    }
  }

  // hunk 内覆盖的变更段(归一区间与 hunk 求交,顺序即块序)
  const segs = resolveBlockAnchors(blocks);
  for (const h of hunks) {
    const oCount = h.oEnd - h.oStart;
    const mCount = h.mEnd - h.mStart;
    out.push(`@@ -${h.oStart + 1},${oCount} +${h.mStart + 1},${mCount} @@`);
    const body: PatchBodyLine[] = [];
    let oCursor = h.oStart;
    let mCursor = h.mStart;
    for (const s of segs) {
      const sOs = s.origStart - 1;
      const sOe = s.origEnd - 1;
      const sMs = s.modStart - 1;
      const sMe = s.modEnd - 1;
      if (sOe <= h.oStart && sMe <= h.mStart) continue;
      if (sOs >= h.oEnd && sMs >= h.mEnd) break;
      // 段前上下文(等价行,双侧同文本,取原始侧)
      while (oCursor < Math.min(sOs, h.oEnd) && mCursor < Math.min(sMs, h.mEnd)) {
        body.push({ prefix: ' ', text: origLines[oCursor] ?? '', side: 'both' });
        oCursor += 1;
        mCursor += 1;
      }
      // 段内:先全部删除行,再全部新增行(git 同款分组)
      while (oCursor < Math.min(sOe, h.oEnd)) {
        body.push({ prefix: '-', text: origLines[oCursor] ?? '', side: 'orig' });
        oCursor += 1;
      }
      while (mCursor < Math.min(sMe, h.mEnd)) {
        body.push({ prefix: '+', text: modLines[mCursor] ?? '', side: 'mod' });
        mCursor += 1;
      }
    }
    // 段后尾部上下文(双侧等长;单侧兜底防非常规块丢行)
    while (oCursor < h.oEnd && mCursor < h.mEnd) {
      body.push({ prefix: ' ', text: origLines[oCursor] ?? '', side: 'both' });
      oCursor += 1;
      mCursor += 1;
    }
    while (oCursor < h.oEnd) {
      body.push({ prefix: ' ', text: origLines[oCursor] ?? '', side: 'orig' });
      oCursor += 1;
    }
    while (mCursor < h.mEnd) {
      body.push({ prefix: ' ', text: modLines[mCursor] ?? '', side: 'mod' });
      mCursor += 1;
    }
    // 末尾换行标记:hunk 覆盖到文件末行且原文缺换行时追加
    const origNoNl = original !== '' && !original.endsWith('\n');
    const modNoNl = modified !== '' && !modified.endsWith('\n');
    if (origNoNl && h.oEnd === origLines.length && oCount > 0) {
      for (let i = body.length - 1; i >= 0; i--) {
        if (body[i].side === 'orig' || body[i].side === 'both') {
          body.splice(i + 1, 0, {
            prefix: '\\',
            text: ' No newline at end of file',
            side: 'marker',
          });
          break;
        }
      }
    }
    if (modNoNl && h.mEnd === modLines.length && mCount > 0) {
      for (let i = body.length - 1; i >= 0; i--) {
        if (body[i].side === 'mod' || body[i].side === 'both') {
          body.splice(i + 1, 0, {
            prefix: '\\',
            text: ' No newline at end of file',
            side: 'marker',
          });
          break;
        }
      }
    }
    for (const l of body) out.push(`${l.prefix}${l.text}`);
  }
  return `${out.join('\n')}\n`;
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
  const blocks: DiffBlock[] = [];

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
    return { stats, originalDecos, modifiedDecos, blocks, degraded: false, similarity: 1 };
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
    // 降级块:两侧各自一个整文件块(复制语义 = 整文件覆盖)
    blocks.push({ origStart: 1, origEnd: origCount, modStart: 1, modEnd: modCount });
    return { stats, originalDecos, modifiedDecos, blocks, degraded: true, similarity: 0 };
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
      blocks.push({
        origStart: null,
        origEnd: null,
        modStart: modLine,
        modEnd: modLine + lines.length - 1,
      });
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
        // 混合段一块:配对行与增/删余量行同属一个连续差异段(拷贝时整段搬运)。
        // 先记块后推进行号(此处 origLine/modLine 仍指向块起始行)
        blocks.push({
          origStart: origLine,
          origEnd: origLine + removedLines.length - 1,
          modStart: modLine,
          modEnd: modLine + addedLines.length - 1,
        });
        origLine += removedLines.length;
        modLine += addedLines.length;
        i += 2;
      } else {
        // 纯删除段
        for (let k = 0; k < removedLines.length; k++) {
          originalDecos.push({ line: origLine + k, wordSpans: [] });
        }
        stats.removed += removedLines.length;
        blocks.push({
          origStart: origLine,
          origEnd: origLine + removedLines.length - 1,
          modStart: null,
          modEnd: null,
        });
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

  return { stats, originalDecos, modifiedDecos, blocks, degraded: false, similarity };
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
