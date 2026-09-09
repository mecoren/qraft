/**
 * editor-text-search —— 文本编辑器工作区文件内容的全局搜索纯函数。
 *
 * 参考 VSCode「在文件中查找」:按文件(tab)分组,每行一条匹配结果,
 * 编辑器内跳转时对该行全部匹配项高亮。海量命中按批次渲染(见 MATCH_BATCH_SIZE)。
 */
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

/**
 * 性能护栏:海量命中时一次性渲染全部结果会卡死主线程
 * (每条结果都是一个 cmdk Item + 高亮 span 拆分),故按批次渲染;
 * count 始终统计真实匹配行数,截断时以 truncated 标记由 UI 提示。
 * 超长行(如压缩后的单行 bundle)只保留首个匹配附近的预览窗口。
 */
/** Incremental text-match batch size */
export const MATCH_BATCH_SIZE = 50;
/** 匹配行预览最大长度(超出则截取首个匹配附近窗口) */
export const MAX_LINE_PREVIEW_CHARS = 300;

/** 单个匹配行(1-based line/column;matchStart/matchEnd 为 0-based 首个匹配片段区间,相对 lineContent) */
export interface TextMatch {
  tabId: string;
  tabTitle: string;
  path: string | null;
  /** 1-based 行号 */
  line: number;
  /** 1-based 列号(首个匹配起点,基于原始行) */
  column: number;
  /** 行内容(超长行截取为首个匹配附近的预览窗口) */
  lineContent: string;
  /** 0-based 首个匹配起点(相对 lineContent) */
  matchStart: number;
  /** 0-based 首个匹配终点(相对 lineContent) */
  matchEnd: number;
}

/** 按 tab 分组的搜索结果 */
export interface TabGroup {
  tabId: string;
  tabTitle: string;
  path: string | null;
  /** 真实匹配行数(一行内多处匹配计 1 行;不受收集上限影响) */
  count: number;
  matches: TextMatch[];
  /** matches 是否因达到收集上限被截断(count > matches.length) */
  truncated: boolean;
}

/** Monaco 兼容的匹配范围(1-based) */
export interface TextRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Monaco decoration 高亮最多应用的范围数(海量 decoration 会拖慢编辑器) */
export const MAX_HIGHLIGHT_RANGES = 1000;

/** 文本搜索选项(VSCode 搜索四件套的匹配三件,替换另议) */
export interface TextSearchOptions {
  /** 区分大小写(默认 false:不区分,保持既有行为) */
  caseSensitive?: boolean;
  /** 整词匹配:命中两侧不得紧邻字母/数字/下划线/Unicode 字母(中文语境同样适用) */
  wholeWord?: boolean;
  /** 正则模式:query 按正则解释;非法正则按无匹配处理(不抛错) */
  regex?: boolean;
}

/**
 * 编译查询为行匹配器:返回「在单行内容中找出全部命中」的函数。
 * 统一供 searchTabsText(结果列表)与 findMatchRangesInContent(跳转高亮)
 * 使用,保证两处口径永远一致。空查询返回 null(调用方短路)。
 *
 * - 默认:大小写不敏感子串(indexOf)
 * - caseSensitive:原文 indexOf
 * - regex:全局 RegExp(g;caseSensitive 决定 flags 加不加 i);
 *   非法正则返回 null(视为无匹配,不抛错——用户输入过程中半截正则很常见)
 * - wholeWord:对每个命中做字符级边界检查,边界 = 字母/数字/下划线
 *   (\w 的 Unicode 扩展;中文等 CJK 属于「字母」,故「今天天气好」里的
 *   「天气」不算整词,与 VSCode 的 word boundary 语义一致)
 *
 * 结果列表/编辑器高亮/面板行内高亮三处共用本匹配器(exported),
 * 保证任一开关组合下口径逐字符一致。
 */
export function compileMatcher(
  query: string,
  opts?: TextSearchOptions,
): ((line: string) => Array<{ start: number; end: number }>) | null {
  const q = query.trim();
  if (!q) return null;
  const caseSensitive = opts?.caseSensitive ?? false;
  const wholeWord = opts?.wholeWord ?? false;

  /** Unicode 词字符判定:字母 / 数字 / 下划线(word boundary 的「词」定义) */
  const isWordChar = (ch: string | undefined): boolean => {
    if (ch === undefined || ch === '') return false;
    return /\p{L}|\p{N}|_/u.test(ch);
  };
  /** 命中 [start, end) 是否为整词:两侧(存在时)均不得是词字符 */
  const isWhole = (line: string, start: number, end: number): boolean =>
    !isWordChar(line[start - 1]) && !isWordChar(line[end]);

  if (opts?.regex) {
    // 'd' 避免 lastIndex 状态污染;非法正则静默按无匹配处理
    let re: RegExp;
    try {
      re = new RegExp(q, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
    return (line: string) => {
      re.lastIndex = 0;
      const hits: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (wholeWord && !isWhole(line, start, end)) {
          // 零宽命中会死循环,手动步进
          if (m[0].length === 0) re.lastIndex += 1;
          continue;
        }
        hits.push({ start, end });
        if (m[0].length === 0) re.lastIndex += 1;
      }
      return hits;
    };
  }

  const needle = caseSensitive ? q : q.toLowerCase();
  return (line: string) => {
    const hay = caseSensitive ? line : line.toLowerCase();
    const hits: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (from <= hay.length) {
      const pos = hay.indexOf(needle, from);
      if (pos === -1) break;
      const end = pos + needle.length;
      if (!wholeWord || isWhole(line, pos, end)) {
        hits.push({ start: pos, end });
      }
      from = pos + needle.length;
    }
    return hits;
  };
}

/**
 * 在整段文本中找出全部匹配范围(Monaco 1-based,行内多处匹配全部返回,
 * 最多 MAX_HIGHLIGHT_RANGES 条;首个匹配始终保留供跳转定位)。
 * 空查询返回 [];options 与 searchTabsText 同口径(跳转高亮一致性)。
 */
export function findMatchRangesInContent(
  content: string,
  query: string,
  options?: TextSearchOptions,
): TextRange[] {
  const matcher = compileMatcher(query, options);
  if (!matcher) return [];
  const ranges: TextRange[] = [];
  content.split('\n').forEach((line, idx) => {
    if (ranges.length >= MAX_HIGHLIGHT_RANGES) return;
    for (const { start, end } of matcher(line)) {
      ranges.push({
        startLineNumber: idx + 1,
        startColumn: start + 1,
        endLineNumber: idx + 1,
        endColumn: end + 1,
      });
      if (ranges.length >= MAX_HIGHLIGHT_RANGES) break;
    }
  });
  return ranges;
}

/**
 * 构造单条匹配结果;超长行截取首个匹配附近的预览窗口
 * (matchStart/matchEnd 同步平移到截取后内容的坐标)。
 */
function buildTextMatch(
  tab: EditorTab,
  rawLine: string,
  lineIdx: number,
  hit: number,
  hitLen: number,
): TextMatch {
  let lineContent = rawLine;
  let matchStart = hit;
  if (rawLine.length > MAX_LINE_PREVIEW_CHARS) {
    const start = Math.max(0, hit - Math.floor((MAX_LINE_PREVIEW_CHARS - hitLen) / 2));
    lineContent = rawLine.slice(start, start + MAX_LINE_PREVIEW_CHARS);
    matchStart = hit - start;
  }
  return {
    tabId: tab.id,
    tabTitle: tab.title,
    path: tab.path,
    line: lineIdx + 1,
    column: hit + 1,
    lineContent,
    matchStart,
    matchEnd: matchStart + hitLen,
  };
}

/**
 * 在已打开文件(tabs)中搜索文本,返回按 tab 分组的结果。
 * 空 query / 空 tabs 返回 [];保持 tabs 原始顺序。
 * options 决定匹配口径(默认大小写不敏感子串,与历史行为一致);
 * count 为真实匹配行数;matches 受收集上限约束,截断时 truncated=true。
 */
export function searchTabsText(
  tabs: readonly EditorTab[],
  query: string,
  matchLimit = MATCH_BATCH_SIZE,
  options?: TextSearchOptions,
): TabGroup[] {
  const matcher = compileMatcher(query, options);
  if (!matcher) return [];
  const groups: TabGroup[] = [];
  for (const tab of tabs) {
    const lines = tab.content.split('\n');
    const matches: TextMatch[] = [];
    let count = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const hits = matcher(lines[idx]);
      if (hits.length === 0) continue;
      count++;
      if (matches.length < matchLimit) {
        const first = hits[0];
        matches.push(buildTextMatch(tab, lines[idx], idx, first.start, first.end - first.start));
      }
    }
    if (count > 0) {
      groups.push({
        tabId: tab.id,
        tabTitle: tab.title,
        path: tab.path,
        count,
        matches,
        truncated: matches.length < count,
      });
    }
  }
  return groups;
}
