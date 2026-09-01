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

/**
 * 在整段文本中找出全部匹配范围(Monaco 1-based,行内多处匹配全部返回,
 * 最多 MAX_HIGHLIGHT_RANGES 条;首个匹配始终保留供跳转定位)。空查询返回 []。
 */
export function findMatchRangesInContent(content: string, query: string): TextRange[] {
  const q = query.trim();
  if (!q) return [];
  const needle = q.toLowerCase();
  const ranges: TextRange[] = [];
  content.split('\n').forEach((line, idx) => {
    if (ranges.length >= MAX_HIGHLIGHT_RANGES) return;
    const lower = line.toLowerCase();
    let from = 0;
    // indexOf 循环收集行内全部匹配
    while (from <= lower.length) {
      const pos = lower.indexOf(needle, from);
      if (pos === -1) break;
      ranges.push({
        startLineNumber: idx + 1,
        startColumn: pos + 1,
        endLineNumber: idx + 1,
        endColumn: pos + 1 + needle.length,
      });
      if (ranges.length >= MAX_HIGHLIGHT_RANGES) break;
      from = pos + needle.length;
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
  needleLen: number,
): TextMatch {
  let lineContent = rawLine;
  let matchStart = hit;
  if (rawLine.length > MAX_LINE_PREVIEW_CHARS) {
    const start = Math.max(0, hit - Math.floor((MAX_LINE_PREVIEW_CHARS - needleLen) / 2));
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
    matchEnd: matchStart + needleLen,
  };
}

/**
 * 在已打开文件(tabs)中搜索文本,返回按 tab 分组的结果。
 * 空 query / 空 tabs 返回 [];大小写不敏感;保持 tabs 原始顺序。
 * count 为真实匹配行数;matches 受收集上限约束,截断时 truncated=true。
 */
export function searchTabsText(
  tabs: readonly EditorTab[],
  query: string,
  matchLimit = MATCH_BATCH_SIZE,
): TabGroup[] {
  const q = query.trim();
  if (!q) return [];
  const needle = q.toLowerCase();
  const groups: TabGroup[] = [];
  for (const tab of tabs) {
    const lines = tab.content.split('\n');
    const matches: TextMatch[] = [];
    let count = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const hit = lines[idx].toLowerCase().indexOf(needle);
      if (hit === -1) continue;
      count++;
      if (matches.length < matchLimit) {
        matches.push(buildTextMatch(tab, lines[idx], idx, hit, needle.length));
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
