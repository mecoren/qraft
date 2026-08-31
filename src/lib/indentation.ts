/**
 * 缩进检测与转换 —— 编辑器状态栏「选择缩进操作」弹窗的纯逻辑
 *
 * 职责(全部为无副作用的字符串/数据变换,便于单测):
 * - detectIndentation:按前导空白统计推断缩进方式(空格宽度 / 制表符),
 *   与 VSCode「从内容中检测缩进方式」语义一致
 * - convertIndentation:按目标方式与宽度转换每行「前导空白」
 *   (行内文本中的 Tab/空格不触碰,与 VSCode 行为一致)
 * - trimTrailingWhitespace:去除每行行尾空白
 *
 * 说明:
 * - 兼容 CRLF:按 `\r?\n` 拆行/保留原始换行符,转换不改变行尾风格
 * - 老式孤立 `\r` 行尾不在处理范围(编辑器场景几乎不存在)
 */

/** 缩进方式(Monaco model options 的对应子集) */
export interface IndentStyle {
  /** true=空格缩进,false=制表符缩进 */
  insertSpaces: boolean;
  /** 缩进/制表符宽度 */
  tabSize: number;
}

/** 缩进宽度候选(「更改制表符显示大小」等子列表) */
export const INDENT_WIDTHS: ReadonlyArray<number> = [1, 2, 4, 8];

/** 检测时统计的采样行数上限(超大文件防止整篇扫描) */
const DETECT_SAMPLE_LINES = 1000;

/** 空格缩进的候选宽度上限(与 Monaco guessIndentation 一致,限制在 [1,8]) */
const MAX_TAB_SIZE_GUESS = 8;

/** 无法检测时的默认缩进(与 VSCode/编辑器默认一致) */
const DEFAULT_INDENT: IndentStyle = { insertSpaces: true, tabSize: 4 };

/**
 * 计算两行前导空白之间的「空格差」(移植 Monaco indentationGuesser.spacesDiff):
 * - 先跳过两行前导空白公共前缀,再分别统计剩余部分的空格/制表符数
 * - 一侧空格与制表符混用 → 0(信息不可信)
 * - 制表符数相同 → 直接取空格数差;否则空格差需能被制表符差整除(商为等效宽度),否则 0
 */
function spacesDiffBetween(aText: string, aIndent: number, bText: string, bIndent: number): number {
  let i = 0;
  while (i < aIndent && i < bIndent && aText.charCodeAt(i) === bText.charCodeAt(i)) i += 1;
  let aSpaces = 0;
  let aTabs = 0;
  let bSpaces = 0;
  let bTabs = 0;
  for (let j = i; j < aIndent; j += 1) {
    if (aText.charCodeAt(j) === 32) aSpaces += 1;
    else aTabs += 1;
  }
  for (let j = i; j < bIndent; j += 1) {
    if (bText.charCodeAt(j) === 32) bSpaces += 1;
    else bTabs += 1;
  }
  if ((aSpaces > 0 && aTabs > 0) || (bSpaces > 0 && bTabs > 0)) return 0;
  const tabsDiff = Math.abs(aTabs - bTabs);
  const spacesDiff = Math.abs(aSpaces - bSpaces);
  if (tabsDiff === 0) return spacesDiff;
  return spacesDiff % tabsDiff === 0 ? spacesDiff / tabsDiff : 0;
}

/**
 * 由内容检测缩进方式(移植 Monaco TextModel.guessIndentation 核心算法):
 * 1. 逐行扫描前导空白;含 Tab 的行计入「制表符缩进行」,纯空格(>1)行计入「空格缩进行」
 * 2. 相邻内容行前导空白的「空格差」对宽度 1-8 投票
 * 3. 空格/制表符行数不等者胜;相等时默认空格
 * 4. 得票(带制表符先验加成)最高的宽度胜出;平票保留默认
 * 无任何带缩进的内容行 → null(无法检测)。
 */
export function detectIndentation(content: string): IndentStyle | null {
  const lines = content.split(/\r?\n/).slice(0, DETECT_SAMPLE_LINES);
  let linesWithTabs = 0;
  let linesWithSpaces = 0;
  let prevText = '';
  let prevIndent = 0;
  const scores = new Array<number>(MAX_TAB_SIZE_GUESS + 1).fill(0);
  for (const line of lines) {
    let hasContent = false;
    let spaces = 0;
    let tabs = 0;
    let indent = 0;
    for (let j = 0; j < line.length; j += 1) {
      const code = line.charCodeAt(j);
      if (code === 9) tabs += 1;
      else if (code === 32) spaces += 1;
      else {
        hasContent = true;
        indent = j;
        break;
      }
    }
    if (!hasContent) continue;
    if (tabs > 0) linesWithTabs += 1;
    else if (spaces > 1) linesWithSpaces += 1;
    const diff = spacesDiffBetween(prevText, prevIndent, line, indent);
    if (diff > 0 && diff <= MAX_TAB_SIZE_GUESS) scores[diff] += 1;
    prevText = line;
    prevIndent = indent;
  }
  if (linesWithTabs + linesWithSpaces === 0) return null;
  const insertSpaces = linesWithTabs === linesWithSpaces ? true : linesWithTabs < linesWithSpaces;
  let tabSize = DEFAULT_INDENT.tabSize;
  // 制表符先验:已判定制表符时,空格票需超过半数空格行 + 制表符行数才能改写宽度
  let bestScore = insertSpaces ? 0 : 0.5 * linesWithSpaces + linesWithTabs;
  for (let w = 1; w <= MAX_TAB_SIZE_GUESS; w += 1) {
    if (scores[w] > bestScore) {
      bestScore = scores[w];
      tabSize = w;
    }
  }
  return { insertSpaces, tabSize };
}

/**
 * 按目标方式转换每行前导空白:
 * - 前导空白的视觉列宽 = 空格逐列 + Tab 步进到下一 tabStop
 * - 目标为空格:整体展开为等宽空格
 * - 目标为制表符:整除部分转 Tab,余数保留空格
 * 行内(非前导)空白不处理;换行符原样保留(CRLF 不被破坏)。
 */
export function convertIndentation(
  content: string,
  options: { useSpaces: boolean; tabSize: number },
): string {
  const size = Math.max(1, Math.floor(options.tabSize) || 4);
  // split 捕获分组:偶数下标为行内容,奇数下标为换行符(\r\n / \n)
  return content
    .split(/(\r?\n)/)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      const m = /^[ \t]+/.exec(segment);
      if (!m) return segment;
      let column = 0;
      for (const ch of m[0]) {
        column += ch === '\t' ? size - (column % size) : 1;
      }
      const replacement = options.useSpaces
        ? ' '.repeat(column)
        : '\t'.repeat(Math.floor(column / size)) + ' '.repeat(column % size);
      return replacement + segment.slice(m[0].length);
    })
    .join('');
}

/** 去除每行行尾空格与制表符(换行符本身保留) */
export function trimTrailingWhitespace(content: string): string {
  return content.replace(/[ \t]+(?=\r?\n|$)/g, '');
}
