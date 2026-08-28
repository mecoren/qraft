import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock @/lib/ipc:safeInvoke 默认失败,hydrate 走默认空态(与 JsonFormatter 测试同模式)
vi.mock('@/lib/ipc', () => {
  class CommandError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'CommandError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    invokeCommand: vi.fn(),
    CommandError,
    safeInvoke: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'mock', message: 'mocked' } }),
    ),
  };
});

// 导入必须在 mock 声明之后,确保组件拿到的是 mocked 模块
import { TextCompare } from './TextCompare';
import { buildDiffDecorations } from './text-compare-utils';
import { useTextCompareStore } from './textCompareStore';

/** 构建最小 Monaco 编辑器实例桩:按行内容数组模拟 model 行数与最大列号 */
function mockEditorInstance(lines: string[]) {
  return {
    getModel: () => ({
      getLineCount: () => lines.length,
      getLineMaxColumn: (line: number) => (lines[line - 1]?.length ?? 0) + 1,
    }),
  } as unknown as Parameters<typeof buildDiffDecorations>[0];
}

describe('buildDiffDecorations', () => {
  it('差异行同时产出整行背景类与 VSCode 风格 gutter 色条类', () => {
    const editor = mockEditorInstance(['a', 'b']);
    const out = buildDiffDecorations(editor, [{ line: 2, wordSpans: [] }], 'original');
    expect(out).toHaveLength(1);
    expect(out[0].options).toEqual({
      isWholeLine: true,
      className: 'text-compare-line-removed',
      marginClassName: 'text-compare-gutter-removed',
    });
    expect(out[0].range).toMatchObject({ startLineNumber: 2, endLineNumber: 2 });

    const added = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'modified');
    expect(added[0].options).toEqual({
      isWholeLine: true,
      className: 'text-compare-line-added',
      marginClassName: 'text-compare-gutter-added',
    });
  });

  it('词级区间映射为行内装饰,原始侧与修改侧用各自的词级类', () => {
    const editor = mockEditorInstance(['hello world']);
    const out = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 7, end: 12 }] }],
      'modified',
    );
    // 1 个整行装饰 + 1 个词级装饰
    expect(out).toHaveLength(2);
    expect(out[1].options).toEqual({ className: 'text-compare-word-added' });
    expect(out[1].range).toMatchObject({ startLineNumber: 1, startColumn: 7, endColumn: 12 });

    const orig = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 1, end: 6 }] }],
      'original',
    );
    expect(orig[1].options).toEqual({ className: 'text-compare-word-removed' });
  });

  it('越界行号跳过(deferred 值滞后时不刷到别的行),词级列号夹取到行宽', () => {
    const editor = mockEditorInstance(['one line']);
    // 行号 2 超出模型行数:整行装饰与词级装饰一并跳过
    expect(
      buildDiffDecorations(editor, [{ line: 2, wordSpans: [{ start: 1, end: 3 }] }], 'original'),
    ).toEqual([]);

    // 词级 end 超出该行最大列号(9):夹取到 9
    const out = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 4, end: 99 }] }],
      'modified',
    );
    expect(out[1].range).toMatchObject({ startColumn: 4, endColumn: 9 });
  });
});

describe('TextCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // zustand 模块级单例:每个用例重置为「单个空白文档」初始态,避免跨用例污染
    useTextCompareStore.setState({
      docs: [
        { id: 'default', title: 'compare-1', autoTitle: 'compare-1', pinned: false, original: '', modified: '' },
      ],
      activeDocId: 'default',
      ready: false,
      userTouched: false,
      error: null,
    });
  });

  const getOriginalEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('original').querySelector('textarea')!;
  const getModifiedEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('modified').querySelector('textarea')!;

  it('默认渲染并排布局:Tab 栏 + 双编辑器 + 统计徽标', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.getByTestId('doc-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('original')).toBeInTheDocument();
    expect(screen.getByTestId('modified')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-diff')).not.toBeInTheDocument();
    expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
  });

  it('工具栏在并排/行内布局间切换,行内模式隐藏同步滚动按钮', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 并排模式:同步滚动按钮可见,无行内 DiffEditor
    expect(screen.getByTestId('sync-scroll')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-diff-editor')).not.toBeInTheDocument();

    // 切到行内:并排编辑器卸载,单体 DiffEditor 接管,同步滚动按钮隐藏
    fireEvent.click(screen.getByTestId('inline-toggle'));
    expect(screen.getByTestId('inline-diff')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('original')).not.toBeInTheDocument();
    expect(screen.queryByTestId('modified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sync-scroll')).not.toBeInTheDocument();

    // 切回并排:双编辑器重新挂载
    fireEvent.click(screen.getByTestId('inline-toggle'));
    expect(screen.getByTestId('original')).toBeInTheDocument();
    expect(screen.getByTestId('modified')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-diff')).not.toBeInTheDocument();
  });

  it('行内模式内容与文档同步,修改侧编辑写回当前文档且原始侧只读', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'default',
          title: 'compare-1',
          autoTitle: 'compare-1',
          pinned: false,
          original: 'a\nb',
          modified: 'a\nc',
        },
      ],
      activeDocId: 'default',
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('inline-toggle'));

    expect(screen.getByTestId('monaco-diff-original')).toHaveValue('a\nb');
    expect(screen.getByTestId('monaco-diff-original')).toHaveProperty('readOnly', true);
    expect(screen.getByTestId('monaco-diff-modified')).toHaveValue('a\nc');
    expect(screen.getByTestId('monaco-diff-modified')).toHaveProperty('readOnly', false);

    // 行内模式修改侧可编辑:改动写回当前文档(与并排模式右侧编辑器同源)
    fireEvent.change(screen.getByTestId('monaco-diff-modified'), { target: { value: 'a\nd' } });
    expect(useTextCompareStore.getState().docs[0].modified).toBe('a\nd');
  });

  it('差异统计随内容变化刷新', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 连续增删段配对后:1 行修改 + 1 行纯新增
    fireEvent.change(getOriginalEditor(), { target: { value: 'a\nb' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'a\nx\nc' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('+1');
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~1');
    });
  });

  it('行内模式切换 Tab 后编辑写回新激活文档', () => {
    useTextCompareStore.setState({
      docs: [
        { id: 'a', title: 'compare-1', autoTitle: 'compare-1', pinned: false, original: 'x', modified: 'y' },
        { id: 'b', title: 'compare-2', autoTitle: 'compare-2', pinned: false, original: '1', modified: '2' },
      ],
      activeDocId: 'a',
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('inline-toggle'));

    // 切到第二个 Tab(DiffEditor 不重挂载,onMount 监听不重注册)
    fireEvent.click(screen.getAllByTestId('doc-tab')[1]);
    fireEvent.change(screen.getByTestId('monaco-diff-modified'), { target: { value: 'changed' } });

    const docs = useTextCompareStore.getState().docs;
    expect(docs.find((d) => d.id === 'b')?.modified).toBe('changed');
    expect(docs.find((d) => d.id === 'a')?.modified).toBe('y');
  });

  it('提供标尺色时差异行携带右缘概览标尺刻度(VSCode 对齐)', () => {
    const editor = mockEditorInstance(['a']);
    const out = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [] }],
      'modified',
      { added: '#0a0', removed: '#a00' },
    );
    // toEqual 忽略 undefined 属性:未传 rulerColors 时不产生 overviewRuler 键
    expect(out[0].options).toMatchObject({
      overviewRuler: { color: '#0a0', position: 7 },
    });
    const removed = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [] }],
      'original',
      { added: '#0a0', removed: '#a00' },
    );
    expect(removed[0].options).toMatchObject({
      overviewRuler: { color: '#a00', position: 7 },
    });
    const noColors = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'modified');
    expect(noColors[0].options).not.toHaveProperty('overviewRuler', expect.anything());
  });

  it('差异统计与操作按钮紧跟「修改后文本」标题展示(VSCode 风格,不贴工具栏右缘)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    const header = screen.getByTestId('modified-header');
    expect(header).toContainElement(screen.getByTestId('diff-stats'));
    expect(header).toContainElement(screen.getByTestId('inline-toggle'));
    expect(header).toContainElement(screen.getByTestId('sync-scroll'));
  });

  it('不渲染全屏弹窗(已按需求移除)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.queryByTestId('diff-fullscreen')).not.toBeInTheDocument();
  });
});
