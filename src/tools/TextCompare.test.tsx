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
import { useTextCompareStore } from './textCompareStore';

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
    screen.getByTestId('diff-original').querySelector('textarea')!;
  const getModifiedEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('diff-modified').querySelector('textarea')!;

  it('默认渲染并排布局:Tab 栏 + 双编辑器 + 统计徽标', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.getByTestId('doc-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('diff-original')).toBeInTheDocument();
    expect(screen.getByTestId('diff-modified')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-inline')).not.toBeInTheDocument();
    expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
  });

  it('工具栏在并排/行内布局间切换,行内模式隐藏同步滚动按钮', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 并排模式:同步滚动按钮可见,无行内 DiffEditor
    expect(screen.getByTestId('diff-sync-scroll')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-diff-editor')).not.toBeInTheDocument();

    // 切到行内:并排编辑器卸载,单体 DiffEditor 接管,同步滚动按钮隐藏
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));
    expect(screen.getByTestId('diff-inline')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-original')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-modified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-sync-scroll')).not.toBeInTheDocument();

    // 切回并排:双编辑器重新挂载
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));
    expect(screen.getByTestId('diff-original')).toBeInTheDocument();
    expect(screen.getByTestId('diff-modified')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-inline')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));

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

  it('大输入(超同步阈值)统计最终一致:走异步 service 路径不丢结果', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 单侧 ~40k 字符(超过 DIFF_SYNC_MAX_CHARS=30k),jsdom 无 Worker 时经
    // service 同步降级,验证异步链路下统计徽标最终一致、不清空
    const base = 'x'.repeat(40_000);
    fireEvent.change(getOriginalEditor(), { target: { value: base } });
    fireEvent.change(getModifiedEditor(), { target: { value: `${base}!` } });
    await waitFor(() => {
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
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));

    // 切到第二个 Tab(DiffEditor 不重挂载,onMount 监听不重注册)
    fireEvent.click(screen.getAllByTestId('doc-tab')[1]);
    fireEvent.change(screen.getByTestId('monaco-diff-modified'), { target: { value: 'changed' } });

    const docs = useTextCompareStore.getState().docs;
    expect(docs.find((d) => d.id === 'b')?.modified).toBe('changed');
    expect(docs.find((d) => d.id === 'a')?.modified).toBe('y');
  });

  it('差异统计与操作按钮紧跟「修改后文本」标题展示(VSCode 风格,不贴工具栏右缘)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    const header = screen.getByTestId('diff-modified-header');
    expect(header).toContainElement(screen.getByTestId('diff-stats'));
    expect(header).toContainElement(screen.getByTestId('diff-inline-toggle'));
    expect(header).toContainElement(screen.getByTestId('diff-sync-scroll'));
  });

  it('不渲染全屏弹窗(已按需求移除)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.queryByTestId('diff-fullscreen')).not.toBeInTheDocument();
  });
});
