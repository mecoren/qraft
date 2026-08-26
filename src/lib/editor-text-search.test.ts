/**
 * editor-text-search 单元测试 —— 文本编辑器工作区文件内容搜索的匹配规则、分组行为与海量命中护栏。
 */
import { describe, it, expect } from 'vitest';
import {
  searchTabsText,
  findMatchRangesInContent,
  MAX_MATCHES_PER_TAB,
  MAX_TOTAL_MATCHES,
  MAX_LINE_PREVIEW_CHARS,
  MAX_HIGHLIGHT_RANGES,
  type TabGroup,
} from './editor-text-search';
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    title: overrides.id,
    path: null,
    language: 'plaintext',
    content: '',
    savedContent: '',
    pinned: false,
    ...overrides,
  };
}

describe('searchTabsText', () => {
  it('空查询返回空数组', () => {
    const tabs = [makeTab({ id: 'a', content: 'hello world' })];
    expect(searchTabsText(tabs, '')).toEqual([]);
    expect(searchTabsText(tabs, '   ')).toEqual([]);
  });

  it('空 tabs 返回空数组', () => {
    expect(searchTabsText([], 'hello')).toEqual([]);
  });

  it('无匹配返回空数组', () => {
    const tabs = [makeTab({ id: 'a', content: 'foo bar' })];
    expect(searchTabsText(tabs, 'hello')).toEqual([]);
  });

  it('大小写不敏感匹配', () => {
    const tabs = [makeTab({ id: 'a', content: 'Hello world\nHELLO again' })];
    const groups = searchTabsText(tabs, 'hello');
    expect(groups[0].count).toBe(2);
    const first = groups[0].matches[0];
    expect(first.line).toBe(1);
    expect(first.column).toBe(1);
    expect(first.lineContent).toBe('Hello world');
  });

  it('一行内多处匹配按行聚合为一条结果,column 指向首个匹配', () => {
    const tabs = [makeTab({ id: 'a', content: 'abc foo def foo ghi' })];
    const groups = searchTabsText(tabs, 'foo');
    expect(groups[0].count).toBe(1);
    const m = groups[0].matches[0];
    expect(m.column).toBe(5);
    expect(m.matchStart).toBe(4); // 0-based 首个匹配起点
    expect(m.matchEnd).toBe(7);
  });

  it('中文匹配正确', () => {
    const tabs = [makeTab({ id: 'a', content: '你好世界\n今天天气不错' })];
    const groups = searchTabsText(tabs, '天气');
    expect(groups[0].count).toBe(1);
    expect(groups[0].matches[0].line).toBe(2);
  });

  it('多行多 tab 按原始顺序分组,count 为匹配行数', () => {
    const tabs = [
      makeTab({ id: 'b', title: 'beta.txt', content: 'x' }),
      makeTab({ id: 'a', title: 'alpha.ts', content: 'find me\nno match\nfind again' }),
    ];
    const groups = searchTabsText(tabs, 'find');
    // 保持 tabs 原始顺序;无匹配的 tab 不出现在结果中
    expect(groups.map((g) => g.tabId)).toEqual(['a']);
    expect(groups[0].count).toBe(2);
    expect(groups[0].matches.map((m) => m.line)).toEqual([1, 3]);
  });

  it('tab 元信息透传(path/tabTitle)', () => {
    const tabs = [
      makeTab({ id: 'a', title: 'notes.md', path: '/home/notes.md', content: 'find x' }),
    ];
    const [group] = searchTabsText(tabs, 'find');
    expect(group.tabId).toBe('a');
    expect(group.tabTitle).toBe('notes.md');
    expect(group.path).toBe('/home/notes.md');
  });

  it('搜索结果结构完整(类型级别校验)', () => {
    const tabs = [makeTab({ id: 'a', content: 'find\n' })];
    const groups: TabGroup[] = searchTabsText(tabs, 'find');
    expect(groups[0].matches[0].tabId).toBe('a');
    expect(typeof groups[0].matches[0].line).toBe('number');
    expect(typeof groups[0].matches[0].column).toBe('number');
  });

  it('海量命中:单文件超过收集上限时截断,count 保持真实匹配行数', () => {
    const content = Array.from({ length: MAX_MATCHES_PER_TAB + 10 }, (_, i) => `find line ${i}`).join('\n');
    const tabs = [makeTab({ id: 'a', content })];
    const groups = searchTabsText(tabs, 'find');
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(MAX_MATCHES_PER_TAB + 10);
    expect(groups[0].matches).toHaveLength(MAX_MATCHES_PER_TAB);
    expect(groups[0].truncated).toBe(true);
    // 截断时保留前 MAX 行,顺序不变
    expect(groups[0].matches[0].line).toBe(1);
    expect(groups[0].matches[MAX_MATCHES_PER_TAB - 1].line).toBe(MAX_MATCHES_PER_TAB);
  });

  it('未截断时 truncated 为 false', () => {
    const tabs = [makeTab({ id: 'a', content: 'find\nnope\nfind again' })];
    const groups = searchTabsText(tabs, 'find');
    expect(groups[0].truncated).toBe(false);
  });

  it('海量命中:全局收集上限达到后停止收集后续 tab', () => {
    const tabCount = Math.ceil(MAX_TOTAL_MATCHES / MAX_MATCHES_PER_TAB) + 2;
    const tabs = Array.from({ length: tabCount }, (_, i) =>
      makeTab({ id: `t${i}`, title: `t${i}.txt`, content: Array.from({ length: 100 }, () => 'hit').join('\n') }),
    );
    const groups = searchTabsText(tabs, 'hit');
    // 每组最多 MAX_MATCHES_PER_TAB 条;总收集量不超过 MAX_TOTAL_MATCHES
    const total = groups.reduce((n, g) => n + g.matches.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_MATCHES);
    for (const g of groups) {
      expect(g.matches.length).toBeLessThanOrEqual(MAX_MATCHES_PER_TAB);
      expect(g.count).toBe(100);
    }
    // 达到全局上限后,后续 tab 不再出现
    expect(groups.length).toBe(Math.floor(MAX_TOTAL_MATCHES / MAX_MATCHES_PER_TAB));
  });

  it('超长行只保留首个匹配附近的预览窗口,matchStart/matchEnd 平移到截取后坐标', () => {
    const prefix = 'x'.repeat(1000);
    const rawLine = `${prefix}needle${'y'.repeat(1000)}`;
    const tabs = [makeTab({ id: 'a', content: rawLine })];
    const groups = searchTabsText(tabs, 'needle');
    const m = groups[0].matches[0];
    expect(rawLine.length).toBeGreaterThan(MAX_LINE_PREVIEW_CHARS);
    expect(m.lineContent.length).toBeLessThanOrEqual(MAX_LINE_PREVIEW_CHARS);
    // 截取窗口包含完整匹配片段
    expect(m.lineContent.slice(m.matchStart, m.matchEnd)).toBe('needle');
    // column 仍基于原始行
    expect(m.column).toBe(1001);
  });
});

describe('findMatchRangesInContent', () => {
  it('返回行内全部匹配(Monaco 1-based 范围)', () => {
    expect(findMatchRangesInContent('abc foo def foo ghi\nfoo end', 'foo')).toEqual([
      { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 8 },
      { startLineNumber: 1, startColumn: 13, endLineNumber: 1, endColumn: 16 },
      { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
    ]);
  });

  it('大小写不敏感', () => {
    expect(findMatchRangesInContent('Foo bar', 'foo')).toEqual([
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
    ]);
  });

  it('空查询 / 无匹配返回空数组', () => {
    expect(findMatchRangesInContent('abc', '')).toEqual([]);
    expect(findMatchRangesInContent('abc', 'xyz')).toEqual([]);
  });

  it('中文匹配', () => {
    expect(findMatchRangesInContent('天气不错\n今天天气', '天气')).toEqual([
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
      { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 5 },
    ]);
  });

  it('海量命中:范围数不超过上限且首个匹配保留', () => {
    const content = Array.from({ length: MAX_HIGHLIGHT_RANGES }, () => 'foo').join('\n');
    const ranges = findMatchRangesInContent(content, 'foo');
    expect(ranges).toHaveLength(MAX_HIGHLIGHT_RANGES);
    expect(ranges[0]).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 4,
    });
  });
});
