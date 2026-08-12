import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import {
  DuplicateDetector,
  splitLines,
  listDuplicates,
  summarize,
  unduplicateLines,
  buildDuplicatesTable,
} from './DuplicateDetector';

// CodeEditor 内部会嵌套 Monaco,jsdom 下 ResizeObserver mock 与 react-resizable-panels
// 触发的 mountGroup 流程不兼容;在本测试集内把它替换为单层 div,
// 仅保留 children,让 CodeEditor 的 textarea mock(来自 setup.ts)仍能挂载。
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

const inputValueOf = (testId: string): string =>
  (screen.getByTestId(testId).querySelector('textarea') as HTMLTextAreaElement).value;

const setTextarea = (testId: string, value: string): void => {
  const ta = screen
    .getByTestId(testId)
    .querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value } });
};

describe('DuplicateDetector utilities', () => {
  it('splitLines:兼容 LF 与 CRLF,行尾不残留 \\r', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c']);
    expect(splitLines('')).toEqual([]);
  });

  it('splitLines + buildDuplicatesTable:CRLF 文本不会把相同行拆成不同 key', () => {
    // 模拟从 Windows 编辑器粘贴的 CRLF 文本(含行尾 \r)
    const text = '12321\r\n12312\r\n12321312\r\n2131231213\r\n12312\r\n12312\r\n12312';
    const lines = splitLines(text);
    const rows = buildDuplicatesTable(lines, 'line', 0, 0, true);
    // 12312 全部合并为一行,count=4
    const dup = rows.find((r) => r.value === '12312');
    expect(dup).toEqual({ value: '12312', count: 4 });
    // 表格共 4 行(12321 / 12312 / 12321312 / 2131231213)
    expect(rows).toHaveLength(4);
  });

  it('buildDuplicatesTable (行模式):仅返回重复行,按首次出现顺序', () => {
    const rows = buildDuplicatesTable(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0);
    expect(rows).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 2 },
    ]);
  });

  it('buildDuplicatesTable (includeUnique=true):统计全部数据(含不重复行)', () => {
    const rows = buildDuplicatesTable(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0, true);
    expect(rows).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 2 },
      { value: 'c', count: 1 },
    ]);
  });

  it('buildDuplicatesTable (子串模式):以子串为键匹配,并展示原始整行', () => {
    // offset 1, length 2 → 每行中间两位作为键
    const lines = ['aAA1', 'bAA2', 'cAA3', 'dXX4'];
    // 'AA' 在前 3 行重复
    const rows = buildDuplicatesTable(lines, 'substring', 1, 2);
    expect(rows).toEqual([{ value: 'aAA1', count: 3 }]);
  });

  it('buildDuplicatesTable (子串模式):长度 0 → 无任何重复', () => {
    expect(buildDuplicatesTable(['x', 'x', 'x'], 'substring', 0, 0)).toEqual([]);
  });

  it('listDuplicates (兼容旧 API):仅返回展示「值」', () => {
    expect(listDuplicates(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0)).toEqual(['a', 'b']);
    expect(listDuplicates(['x', 'y', 'z'], 'line', 0, 0)).toEqual([]);
  });

  it('summarize:总计 = 不重复 + 重复(每个成员都被计入)', () => {
    // 6 行:'a' 出现 2 次,'b' 出现 3 次,'c' 出现 1 次
    // 唯一成员:仅 c(1 行)→ unique=1
    // 重复成员:'a' 的 2 行 + 'b' 的 3 行 → duplicates=5
    // 验证 unique + duplicates === total
    const s = summarize(['a', 'b', 'a', 'c', 'b', 'b'], 'line', 0, 0);
    expect(s).toEqual({ total: 6, unique: 1, duplicates: 5 });
  });

  it('summarize:无重复行 → duplicates=0', () => {
    expect(summarize(['a', 'b', 'c'], 'line', 0, 0)).toEqual({
      total: 3,
      unique: 3,
      duplicates: 0,
    });
  });

  it('summarize:全部重复 → unique=0、duplicates=total', () => {
    expect(summarize(['x', 'x', 'x'], 'line', 0, 0)).toEqual({
      total: 3,
      unique: 0,
      duplicates: 3,
    });
  });

  it('unduplicateLines (保留首次):只保留每组的首次出现', () => {
    expect(unduplicateLines(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0, 'keepFirst')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('unduplicateLines (保留末次):只保留每组的最后出现', () => {
    // 'a' 在索引 0/2,保留 2;'b' 在 1/4,保留 4;'c' 在 3,保留
    expect(unduplicateLines(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0, 'keepLast')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('unduplicateLines (全部移除):每个重复组的所有成员都被丢弃', () => {
    expect(unduplicateLines(['a', 'b', 'a', 'c', 'b'], 'line', 0, 0, 'removeAll')).toEqual(['c']);
    expect(unduplicateLines(['x', 'y', 'z', 'y', 'x', 'z'], 'line', 0, 0, 'removeAll')).toEqual([]);
  });

  it('unduplicateLines (子串模式):按子串键去重', () => {
    // offset=2,length=1 → 4 行第 3 个字符都相同(都是 'A')→ 全重复
    const lines = ['aAA1', 'bAA2', 'aAA3', 'bAA4'];
    expect(unduplicateLines(lines, 'substring', 2, 1, 'keepFirst')).toEqual(['aAA1']);
    expect(unduplicateLines(lines, 'substring', 2, 1, 'keepLast')).toEqual(['bAA4']);
    expect(unduplicateLines(lines, 'substring', 2, 1, 'removeAll')).toEqual([]);
  });
});

describe('DuplicateDetector component', () => {
  it('渲染输入、表格区域与去重按钮', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    expect(screen.getByTestId('dd-input')).toBeInTheDocument();
    expect(screen.getByTestId('dd-duplicates')).toBeInTheDocument();
    expect(screen.getByTestId('dd-undup')).toBeInTheDocument();
    expect(screen.getByTestId('dd-stat-unique-toggle')).toBeInTheDocument();
  });

  it('顶部单行:显示全部配置项与按钮', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    expect(screen.getByTestId('dd-mode')).toBeInTheDocument();
    expect(screen.getByTestId('dd-offset')).toBeInTheDocument();
    expect(screen.getByTestId('dd-length')).toBeInTheDocument();
    expect(screen.getByTestId('dd-uniq')).toBeInTheDocument();
    expect(screen.getByTestId('dd-stat-unique-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('dd-undup')).toBeInTheDocument();
    expect(screen.getByTestId('dd-copy')).toBeInTheDocument();
  });

  it('空输入时表格显示「暂无数据」空状态(默认统计全部数据)', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    expect(screen.getByTestId('dd-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dd-empty')).toHaveTextContent(/暂无数据/);
  });

  it('默认开启「是否统计」:表格展示全部数据(含不重复行),汇总含「不重复」', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    setTextarea('dd-input', 'a\nb\nc\nb\na\nb');
    // 顶部汇总:总计=6, 不重复=1(仅 c), 重复=5(a×2 + b×3)
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 6');
    expect(screen.getByTestId('dd-stat-unique')).toHaveTextContent('不重复 1');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 5');
    // 表格内容:含全部数据行(a×2, b×3, c×1)
    const rows = screen.getByTestId('dd-rows');
    const values = rows.querySelectorAll('[data-testid="dd-row-value"]');
    const counts = rows.querySelectorAll('[data-testid="dd-row-count"]');
    expect(values).toHaveLength(3);
    expect(counts).toHaveLength(3);
    expect(values[0]).toHaveTextContent('a');
    expect(values[1]).toHaveTextContent('b');
    expect(values[2]).toHaveTextContent('c');
    expect(counts[0]).toHaveTextContent('2');
    expect(counts[1]).toHaveTextContent('3');
    expect(counts[2]).toHaveTextContent('1');
  });

  it('关闭「是否统计」:仅显示重复行,汇总隐藏「不重复」', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    setTextarea('dd-input', 'a\nb\nc\nb\na\nb');
    fireEvent.click(screen.getByTestId('dd-stat-unique-toggle'));
    // 汇总:不重复项不再显示,总计/重复仍显示
    expect(screen.queryByTestId('dd-stat-unique')).not.toBeInTheDocument();
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 6');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 5');
    // 表格:仅重复行(a×2, b×3),c(不重复)被排除
    const rows = screen.getByTestId('dd-rows');
    const values = rows.querySelectorAll('[data-testid="dd-row-value"]');
    const counts = rows.querySelectorAll('[data-testid="dd-row-count"]');
    expect(values).toHaveLength(2);
    expect(counts).toHaveLength(2);
    expect(values[0]).toHaveTextContent('a');
    expect(values[1]).toHaveTextContent('b');
    expect(counts[0]).toHaveTextContent('2');
    expect(counts[1]).toHaveTextContent('3');
  });

  it('三段计数始终满足 unique + duplicates = total', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    setTextarea('dd-input', '12321\n12312\n12321312\n2131231213\n12312\n12312\n12312');
    // 总计 7:'12321' '12312' '12321312' '2131231213' 各 1,'12312' 出现 4 次
    // unique = 3(三个只出现 1 次的 key)
    // duplicates = 4(12312 的全部 4 行,均视为重复成员)
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 7');
    expect(screen.getByTestId('dd-stat-unique')).toHaveTextContent('不重复 3');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 4');
  });

  it('CRLF 输入:相同的行不会被拆开,统计正确', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    // 模拟 Windows 粘贴的 CRLF 文本(每个 \n 前都有 \r)
    setTextarea(
      'dd-input',
      '12321\r\n12312\r\n12321312\r\n2131231213\r\n12312\r\n12312\r\n12312',
    );
    // 汇总:总计 7,不重复 3,重复 4
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 7');
    expect(screen.getByTestId('dd-stat-unique')).toHaveTextContent('不重复 3');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 4');
    // 表格:'12312' 只有一行(合并),count=4
    const rows = screen.getByTestId('dd-rows');
    const values = [...rows.querySelectorAll('[data-testid="dd-row-value"]')].map((el) =>
      el.textContent,
    );
    const counts = [...rows.querySelectorAll('[data-testid="dd-row-count"]')].map((el) =>
      el.textContent,
    );
    expect(values.filter((v) => v === '12312')).toHaveLength(1);
    expect(counts[values.indexOf('12312')]).toBe('4');
  });

  it('默认保留首次:点击「去重」后输入框保留每组的首次出现', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    setTextarea('dd-input', 'a\nb\nc\nb\na\nb');
    fireEvent.click(screen.getByTestId('dd-undup'));
    expect(inputValueOf('dd-input')).toBe('a\nb\nc');
  });

  it('大数据量:1 万行输入统计正确且表格仅渲染可见行(虚拟化)', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    // 10000 行:'A' 与 'B' 各 5000 次
    const big = Array.from({ length: 5000 }, () => 'A')
      .concat(Array.from({ length: 5000 }, () => 'B'))
      .join('\n');
    setTextarea('dd-input', big);
    // 统计正确
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 10000');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 10000');
    // 虚拟化:DOM 中渲染的行数远小于 2(实际只有可见 + overscan 的几十行)
    const rows = screen.getByTestId('dd-rows');
    const rendered = rows.querySelectorAll('[data-index]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });

  it('快速输入:deferred 计算不阻塞输入框同步更新', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    setTextarea('dd-input', 'x\ny\nx');
    // input 立即反映最新值
    expect(inputValueOf('dd-input')).toBe('x\ny\nx');
    // 统计同步(useDeferredValue 在测试环境中同步 flush)
    expect(screen.getByTestId('dd-stat-total')).toHaveTextContent('总计 3');
    expect(screen.getByTestId('dd-stat-dup')).toHaveTextContent('重复 2');
  });

  it('输入为空时去重按钮禁用', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    expect(screen.getByTestId('dd-undup')).toBeDisabled();
  });

  it('所有配置项与去重/复制按钮位于同一个顶部工具栏卡片内', () => {
    render(<DuplicateDetector toolId="duplicate_detector" metadata={null as never} />);
    // 配置卡片 section[aria-label=配置] 内应同时包含配置控件与操作按钮
    const toolbar = screen.getByRole('region', { name: '配置' });
    expect(toolbar.querySelector('[data-testid="dd-mode"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-offset"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-length"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-uniq"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-stat-unique-toggle"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-undup"]')).toBeTruthy();
    expect(toolbar.querySelector('[data-testid="dd-copy"]')).toBeTruthy();
  });
});
