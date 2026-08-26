import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// CodeEditor 内嵌 Monaco,jsdom 无法加载:替换为 textarea 替身(与 CodeEditor.test 同策略)
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    'data-testid': testId,
    showStatusBar,
  }: {
    value: string;
    onChange?: (v: string) => void;
    title?: string;
    'data-testid'?: string;
    showStatusBar?: boolean;
  }) => (
    <div data-testid={testId} data-status-bar={String(showStatusBar)}>
      <textarea
        data-testid={`${testId}-textarea`}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  ),
}));

// react-resizable-panels 在 jsdom 下不可用(见 CodeEditor.test 说明),渲染静态面板
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// mermaid 懒渲染不参与组件测试(jsdom 无 SVG 布局意义),仅断言调用
vi.mock('./markdown-mermaid', () => ({ renderMermaidIn: vi.fn(async () => undefined) }));

import { MarkdownPreview } from './MarkdownPreview';
import { renderMermaidIn } from './markdown-mermaid';
import { useMarkdownPreviewStore } from './markdownPreviewStore';
import { DRAFT_STORAGE_KEY } from './markdownPreviewStore';
import { changeLocale } from '@/i18n';

describe('MarkdownPreview', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      useMarkdownPreviewStore.setState({
        themeId: 'typora',
        viewMode: 'split',
        outlineOpen: true,
        syncScroll: true,
      });
    });
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(renderMermaidIn).mockClear();
  });

  it('无草稿时加载示例文档并渲染预览与统计', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitFor(
      () => expect(screen.getByTestId('md-preview').textContent).toContain('Qraft Markdown 预览'),
      { timeout: 1500 },
    );
    const stats = screen.getByTestId('md-stats').textContent ?? '';
    expect(stats).toMatch(/\d+ 词/);
    // 示例文档包含 mermaid 图表 → 触发懒渲染
    await waitFor(() => expect(renderMermaidIn).toHaveBeenCalled(), { timeout: 1500 });
  });

  it('输入经防抖后刷新预览 HTML', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('md-input-textarea'), {
      target: { value: '# Hello Preview' },
    });
    await waitFor(
      () => expect(screen.getByTestId('md-preview').textContent).toContain('Hello Preview'),
      { timeout: 1500 },
    );
    // 草稿防抖持久化
    await waitFor(
      () => {
        expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toContain('Hello Preview');
      },
      { timeout: 1500 },
    );
  });

  it('空输入显示空态提示', async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '');
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitFor(() => expect(screen.getByTestId('md-empty')).toBeInTheDocument());
  });

  it('视图模式切换:仅预览隐藏编辑器,仅编辑隐藏预览', () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    expect(screen.getByTestId('md-input')).toBeInTheDocument();
    expect(screen.getByTestId('md-preview-scroll')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mode-preview'));
    expect(useMarkdownPreviewStore.getState().viewMode).toBe('preview');
    expect(screen.queryByTestId('md-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('md-preview-scroll')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mode-edit'));
    expect(screen.getByTestId('md-input')).toBeInTheDocument();
    expect(screen.queryByTestId('md-preview-scroll')).not.toBeInTheDocument();
  });

  it('排版主题切换同步 article 类名(store 驱动)', () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    expect(screen.getByTestId('md-preview')).toHaveClass('md-theme-typora');
    act(() => {
      useMarkdownPreviewStore.setState({ themeId: 'github' });
    });
    expect(screen.getByTestId('md-preview')).toHaveClass('md-theme-github');
  });

  it('大纲面板列出标题,点击滚动到锚点;可整体收起', async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '# One\n\n## Two\n\ncontent');
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    const items = await screen.findAllByTestId('outline-item');
    expect(items.length).toBe(2);

    fireEvent.click(items[1]);
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      ),
    );

    fireEvent.click(screen.getByTestId('btn-outline'));
    expect(screen.queryByTestId('outline-panel')).not.toBeInTheDocument();
    expect(useMarkdownPreviewStore.getState().outlineOpen).toBe(false);
  });

  it('同步滚动开关写入 store', () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    const toggle = screen.getByTestId('md-sync-scroll');
    expect(toggle).toHaveAttribute('data-state', 'checked');
    fireEvent.click(toggle);
    expect(useMarkdownPreviewStore.getState().syncScroll).toBe(false);
  });

  it('状态栏展示光标行列占位', () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    expect(screen.getByTestId('md-cursor').textContent).toContain('行 1, 列 1');
  });

  it('点击预览图片打开 lightbox,关闭按钮收起', async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '![示例图](qraft.png)');
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    const img = await screen.findByRole('img');
    fireEvent.click(img);
    expect(screen.getByTestId('md-lightbox')).toBeInTheDocument();
    expect(screen.getByTestId('md-lightbox').querySelector('img')?.getAttribute('src')).toBe(
      'qraft.png',
    );
    fireEvent.click(screen.getByTestId('md-lightbox-close'));
    expect(screen.queryByTestId('md-lightbox')).not.toBeInTheDocument();
  });

  it('en-US:工具条/状态栏/主题文案随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '# Hello');
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    try {
      expect(screen.getByTestId('mode-edit').textContent).toContain('Edit');
      expect(screen.getByTestId('btn-outline').textContent).toContain('Outline');
      expect(screen.getByTestId('md-cursor').textContent).toContain('Line 1, Col 1');
      expect(screen.getByTestId('md-stats').textContent).toContain('words');
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
});
