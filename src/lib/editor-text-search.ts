/**
 * editor-text-search —— 文本编辑器工作区文件内容的全局搜索纯函数。
 *
 * 参考 VSCode「在文件中查找」:按文件(tab)分组,每行一条匹配结果,
 * 编辑器内跳转时对该行全部匹配项高亮。
 */
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

/** 单个匹配行(1-based line/column;matchStart/matchEnd 为 0-based 首个匹配片段区间) */
export interface TextMatch {
  tabId: string;
  tabTitle: string;
  path: string | null;
  /** 1-based 行号 */
  line: number;
  /** 1-based 列号(首个匹配起点) */
  column: number;
  /** 该行完整内容(渲染预览用) */
  lineContent: string;
  /** 0-based 首个匹配起点 */
  matchStart: number;
  /** 0-based 首个匹配终点 */
  matchEnd: number;
}

/** 按 tab 分组的搜索结果 */
export interface TabGroup {
  tabId: string;
  tabTitle: string;
  path: string | null;
  /** 匹配行数(一行内多处匹配计 1 行) */
  count: number;
  matches: TextMatch[];
}

/** Monaco 兼容的匹配范围(1-based) */
export interface TextRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * 在整段文本中找出全部匹配范围(Monaco 1-based,行内多处匹配全部返回)。
 * 空查询返回 [];大小写不敏感。供编辑器 decoration 高亮使用。
 */
export function findMatchRangesInContent(content: string, query: string): TextRange[] {
  const q = query.trim();
  if (!q) return [];
  const needle = q.toLowerCase();
  const ranges: TextRange[] = [];
  content.split('\n').forEach((line, idx) => {
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
      from = pos + needle.length;
    }
  });
  return ranges;
}

/**
 * 在已打开文件(tabs)中搜索文本,返回按 tab 分组的结果。
 * 空 query / 空 tabs 返回 [];大小写不敏感;保持 tabs 原始顺序。
 */
export function searchTabsText(tabs: readonly EditorTab[], query: string): TabGroup[] {
  const q = query.trim();
  if (!q) return [];
  const groups: TabGroup[] = [];
  for (const tab of tabs) {
    const lines = tab.content.split('\n');
    const matches: TextMatch[] = [];
    lines.forEach((lineContent, idx) => {
      const lower = lineContent.toLowerCase();
      const needle = q.toLowerCase();
      const hit = lower.indexOf(needle);
      if (hit === -1) return;
      matches.push({
        tabId: tab.id,
        tabTitle: tab.title,
        path: tab.path,
        line: idx + 1,
        column: hit + 1,
        lineContent,
        matchStart: hit,
        matchEnd: hit + needle.length,
      });
    });
    if (matches.length > 0) {
      groups.push({ tabId: tab.id, tabTitle: tab.title, path: tab.path, count: matches.length, matches });
    }
  }
  return groups;
}
