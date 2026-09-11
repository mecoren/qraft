/**
 * editor-text-search 单元测试 —— 文本编辑器工作区文件内容搜索的匹配规则、分组行为与海量命中护栏。
 */
import { describe, it, expect } from 'vitest';
import {
  searchTabsText,
  findMatchRangesInContent,
  isRegexQueryValid,
  replaceInContent,
  MATCH_BATCH_SIZE,
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

  it('海量命中:超过本次加载数时截断,count 保持真实匹配行数', () => {
    const content = Array.from({ length: MATCH_BATCH_SIZE + 10 }, (_, i) => `find line ${i}`).join(
      '\n',
    );
    const tabs = [makeTab({ id: 'a', content })];
    const groups = searchTabsText(tabs, 'find');
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(MATCH_BATCH_SIZE + 10);
    expect(groups[0].matches).toHaveLength(MATCH_BATCH_SIZE);
    expect(groups[0].truncated).toBe(true);
    // 截断时保留前 MAX 行,顺序不变
    expect(groups[0].matches[0].line).toBe(1);
    expect(groups[0].matches[MATCH_BATCH_SIZE - 1].line).toBe(MATCH_BATCH_SIZE);
  });

  it('未截断时 truncated 为 false', () => {
    const tabs = [makeTab({ id: 'a', content: 'find\nnope\nfind again' })];
    const groups = searchTabsText(tabs, 'find');
    expect(groups[0].truncated).toBe(false);
  });

  it('海量命中:所有 tab 都保留真实总数', () => {
    const tabs = Array.from({ length: 6 }, (_, i) =>
      makeTab({
        id: `t${i}`,
        title: `t${i}.txt`,
        content: Array.from({ length: 100 }, () => 'hit').join('\n'),
      }),
    );
    const groups = searchTabsText(tabs, 'hit');
    expect(groups).toHaveLength(6);
    for (const g of groups) expect(g.count).toBe(100);
  });

  it('增量加载:提高加载数后补足匹配行且不重复', () => {
    const content = Array.from({ length: MATCH_BATCH_SIZE * 2 }, (_, i) => `find line ${i}`).join(
      '\n',
    );
    const tabs = [makeTab({ id: 'a', content })];
    const loaded = searchTabsText(tabs, 'find', MATCH_BATCH_SIZE * 2);

    expect(loaded[0].matches).toHaveLength(content.split('\n').length);
    expect(loaded[0].truncated).toBe(false);
    const lines = loaded[0].matches.map((match) => match.line);
    expect(new Set(lines).size).toBe(lines.length);
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

describe('searchTabsText 搜索选项(大小写敏感/整词/正则)', () => {
  const tabs = [makeTab({ id: 'a', content: 'Hello world\nhello_world again\nHELLO' })];

  it('默认保持大小写不敏感(向后兼容)', () => {
    const groups = searchTabsText(tabs, 'hello');
    // 三行全命中(默认不区分大小写)
    expect(groups[0].count).toBe(3);
  });

  it('caseSensitive:仅匹配同大小写', () => {
    const groups = searchTabsText(tabs, 'Hello', MATCH_BATCH_SIZE, { caseSensitive: true });
    // 仅第 1 行「Hello world」命中
    expect(groups[0].count).toBe(1);
    expect(groups[0].matches[0].line).toBe(1);
  });

  it('wholeWord:子串命中被排除,词边界命中保留(含中文语境)', () => {
    const g = searchTabsText(tabs, 'hello', MATCH_BATCH_SIZE, { wholeWord: true });
    // hello_world 的 hello 是标识符一部分 → 不算整词;
    // 首行 Hello world 与第 3 行 HELLO 均为词边界命中(不区分大小写)
    expect(g[0].count).toBe(2);
    expect(g[0].matches[0].line).toBe(1);
    expect(g[0].matches[1].line).toBe(3);

    const zh = searchTabsText(
      [makeTab({ id: 'zh', content: '天气\n今天天气好' })],
      '天气',
      MATCH_BATCH_SIZE,
      { wholeWord: true },
    );
    // 中文语境:CJK 属于「词字符」,「今天天气好」中的天气被汉字包裹不算整词;
    // 独立成词的首行保留(行首行尾均为边界)
    expect(zh[0].count).toBe(1);
    expect(zh[0].matches[0].line).toBe(1);
  });

  it('regex:按正则匹配,匹配区间为实际命中长度', () => {
    const g = searchTabsText(
      [makeTab({ id: 'r', content: 'id: 42\nid: 7\nno match' })],
      'id: \\d+',
      MATCH_BATCH_SIZE,
      { regex: true },
    );
    expect(g[0].count).toBe(2);
    const first = g[0].matches[0];
    expect(first.matchEnd - first.matchStart).toBe('id: 42'.length);
  });

  it('非法正则按无匹配处理(不抛错)', () => {
    const g = searchTabsText(tabs, '[unclosed', MATCH_BATCH_SIZE, { regex: true });
    expect(g).toEqual([]);
  });

  it('regex + caseSensitive 组合生效', () => {
    const g = searchTabsText(
      [makeTab({ id: 'rc', content: 'Foo 1\nfoo 2' })],
      'F\\soo',
      MATCH_BATCH_SIZE,
      { regex: true, caseSensitive: true },
    );
    // \\s 失配:两行都不命中
    expect(g).toEqual([]);
    const g2 = searchTabsText(
      [makeTab({ id: 'rc2', content: 'Foo 1\nfoo 2' })],
      'f\\w\\w',
      MATCH_BATCH_SIZE,
      { regex: true, caseSensitive: true },
    );
    // 仅「foo 2」命中(小写 f 开头;Foo 1 无小写 f)
    expect(g2[0].count).toBe(1);
    expect(g2[0].matches[0].line).toBe(2);
  });
});

describe('findMatchRangesInContent 搜索选项(跳转高亮同口径)', () => {
  it('caseSensitive:高亮范围与列表口径一致', () => {
    const ranges = findMatchRangesInContent('Foo bar\nfoo end', 'foo', { caseSensitive: true });
    expect(ranges).toEqual([
      { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
    ]);
  });

  it('wholeWord:高亮仅词边界命中', () => {
    const ranges = findMatchRangesInContent('foo bar\nfoobar\nfoo.', 'foo', {
      wholeWord: true,
    });
    // 第 1 行独立词 + 第 3 行句点结尾(非字母数字)算边界;第 2 行 foobar 不算
    expect(ranges).toHaveLength(2);
    expect(ranges[0].startLineNumber).toBe(1);
    expect(ranges[1].startLineNumber).toBe(3);
  });

  it('regex:高亮按正则命中区间', () => {
    const ranges = findMatchRangesInContent('v1.2.3\nv10.20.30', 'v\\d+', { regex: true });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].endColumn - ranges[0].startColumn).toBe(2); // v1
    expect(ranges[1].endColumn - ranges[1].startColumn).toBe(3); // v10
  });
});

describe('isRegexQueryValid(正则合法性,UI 空态区分)', () => {
  it('空查询 / 非正则模式恒合法', () => {
    expect(isRegexQueryValid('', { regex: true })).toBe(true);
    expect(isRegexQueryValid('(((', {})).toBe(true);
    expect(isRegexQueryValid('(((', undefined)).toBe(true);
  });

  it('合法正则返回 true(含 flags 组合)', () => {
    expect(isRegexQueryValid('v\\d+', { regex: true })).toBe(true);
    expect(isRegexQueryValid('a|b', { regex: true, caseSensitive: true })).toBe(true);
    expect(isRegexQueryValid('[a-z]+', { regex: true, wholeWord: true })).toBe(true);
  });

  it('非法正则返回 false(半截括号 / 悬挂反斜杠 / 未闭合字符类)', () => {
    expect(isRegexQueryValid('[unclosed', { regex: true })).toBe(false);
    expect(isRegexQueryValid('trailing\\', { regex: true })).toBe(false);
    expect(isRegexQueryValid('(', { regex: true, caseSensitive: true })).toBe(false);
  });
});

describe('replaceInContent(跨文件查找替换)', () => {
  it('普通子串替换:一行内多处全部替换并计数', () => {
    const r = replaceInContent('foo bar foo\nbaz foo', 'foo', 'qux');
    expect(r?.content).toBe('qux bar qux\nbaz qux');
    expect(r?.replacements).toBe(3);
  });

  it('大小写口径:默认不敏感(foo 匹配 FOO),caseSensitive 只匹配原样', () => {
    const ci = replaceInContent('FOO bar', 'foo', 'x');
    expect(ci?.content).toBe('x bar');
    expect(ci?.replacements).toBe(1);

    const cs = replaceInContent('FOO bar foo', 'foo', 'x', { caseSensitive: true });
    expect(cs?.content).toBe('FOO bar x');
    expect(cs?.replacements).toBe(1);
  });

  it('整词口径:wholeWord 排除词内命中', () => {
    const r = replaceInContent('foo food fool', 'foo', 'X', { wholeWord: true });
    expect(r?.content).toBe('X food fool');
    expect(r?.replacements).toBe(1);
  });

  it('正则替换:支持 $1 反向引用', () => {
    const r = replaceInContent('v1 v10', 'v(\\d+)', 'V$1!', { regex: true });
    expect(r?.content).toBe('V1! V10!');
    expect(r?.replacements).toBe(2);
  });

  it('空查询/无匹配返回 null 或 0 次(调用方跳过写回)', () => {
    expect(replaceInContent('abc', '', 'x')).toBeNull();
    const r = replaceInContent('abc', 'zzz', 'x');
    expect(r?.content).toBe('abc');
    expect(r?.replacements).toBe(0);
  });

  it('替换为空串 = 删除匹配片段', () => {
    const r = replaceInContent('a-b-c', '-', '');
    expect(r?.content).toBe('abc');
    expect(r?.replacements).toBe(2);
  });

  it('与 searchTabsText 同口径:命中数一致(替换处数 = 命中处数)', () => {
    const content = 'Alpha beta ALPHA\nalpha';
    const tab = makeTab({ id: 't1', content });
    const group = searchTabsText([tab], 'alpha', 100);
    // 命中行数:2(两行都含 alpha,不敏感)
    expect(group[0]?.count).toBe(2);
    const r = replaceInContent(content, 'alpha', 'x');
    expect(r?.replacements).toBe(3);
  });
});
