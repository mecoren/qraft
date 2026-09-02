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
import { useMdDocsStore } from './markdownPreviewDocsStore';
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
      // 多 Tab 文档 store 重置为「单个空白文档」初始态(hydrate 未完成,
      // safeInvoke 在测试环境不可用 → hydrate 失败但 ready 置位后走 firstUse 示例文档)
      useMdDocsStore.setState({
        docs: [
          { id: 'md-default', title: 'md-1', autoTitle: 'md-1', pinned: false, content: '' },
        ],
        activeDocId: 'md-default',
        ready: false,
        userTouched: false,
        firstUse: true,
        error: null,
      });
    });
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(renderMermaidIn).mockClear();
  });

  /** 等待 hydrate + 首文档 effect 完成(测试环境 safeInvoke 失败 → 无持久化数据,
   * 走 firstUse 示例文档或旧草稿迁移,取决于 localStorage 里有无旧 key) */
  async function waitForHydrate() {
    await waitFor(() => {
      expect(useMdDocsStore.getState().ready).toBe(true);
    });
    // hydrate 后的文档补位 effect(新建文档/修正激活 id)落地
    await waitFor(() => {
      const s = useMdDocsStore.getState();
      expect(s.docs.length).toBeGreaterThanOrEqual(1);
      expect(s.activeDocId).toBe(s.docs[0].id);
    });
  }

  it('无持久化数据时加载示例文档并渲染预览与统计', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitFor(
      () => expect(screen.getByTestId('md-preview').textContent).toContain('Qraft Markdown 预览'),
      { timeout: 2000 },
    );
    const stats = screen.getByTestId('md-stats').textContent ?? '';
    expect(stats).toMatch(/\d+ 词/);
    // 示例文档包含 mermaid 图表 → 触发懒渲染
    await waitFor(() => expect(renderMermaidIn).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('旧版 localStorage 草稿迁移为文档(hydrate 无持久化数据时)', async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '# Legacy Draft');
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    const s = useMdDocsStore.getState();
    // 旧草稿成为唯一文档,标题取首个标题行
    expect(s.docs.length).toBe(1);
    expect(s.docs[0].content).toBe('# Legacy Draft');
    expect(s.docs[0].title).toBe('Legacy Draft');
    // 旧 key 已清除,不再双写
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('md-preview').textContent).toContain('Legacy Draft'),
    );
  });

  it('输入更新当前文档内容(不再写 localStorage 草稿)', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    fireEvent.change(screen.getByTestId('md-input-textarea'), {
      target: { value: '# Hello Preview' },
    });
    await waitFor(
      () => expect(screen.getByTestId('md-preview').textContent).toContain('Hello Preview'),
      { timeout: 2000 },
    );
    expect(useMdDocsStore.getState().docs[0].content).toBe('# Hello Preview');
    // 草稿不再落 localStorage(由 Rust config 持久化接管)
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('空输入显示空态提示', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // 清空当前文档内容 → 预览空态
    fireEvent.change(screen.getByTestId('md-input-textarea'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('md-empty')).toBeInTheDocument());
  });

  it('视图模式切换:仅预览隐藏编辑器,仅编辑隐藏预览', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
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

  it('排版主题切换同步 article 类名(store 驱动)', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    expect(screen.getByTestId('md-preview')).toHaveClass('md-theme-typora');
    act(() => {
      useMarkdownPreviewStore.setState({ themeId: 'github' });
    });
    expect(screen.getByTestId('md-preview')).toHaveClass('md-theme-github');
  });

  it('大纲面板列出标题,点击滚动到锚点;可整体收起', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // 用带标题的文档替换示例文档内容
    act(() => {
      const s = useMdDocsStore.getState();
      s.setDocContent(s.activeDocId!, '# One\n\n## Two\n\ncontent');
    });
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
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    act(() => {
      const s = useMdDocsStore.getState();
      s.setDocContent(s.activeDocId!, '![示例图](qraft.png)');
    });
    const img = await screen.findByRole('img');
    fireEvent.click(img);
    expect(screen.getByTestId('md-lightbox')).toBeInTheDocument();
    expect(screen.getByTestId('md-lightbox').querySelector('img')?.getAttribute('src')).toBe(
      'qraft.png',
    );
    fireEvent.click(screen.getByTestId('md-lightbox-close'));
    expect(screen.queryByTestId('md-lightbox')).not.toBeInTheDocument();
  });

  it('en-US:工具条/状态栏/主题文案随语言切换(手动切语言场景),结束恢复 zh 桩', async () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(
      <MarkdownPreview toolId="markdown_preview" metadata={null as never} />,
    );
    try {
      await waitForHydrate();
      expect(screen.getByTestId('mode-edit').textContent).toContain('Edit');
      expect(screen.getByTestId('btn-outline').textContent).toContain('Outline');
      expect(screen.getByTestId('md-cursor').textContent).toContain('Line 1, Col 1');
      expect(screen.getByTestId('md-stats').textContent).toContain('words');
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });

  // ============================================================
  // 多 Tab 文档
  // ============================================================

  it('渲染 Tab 栏:示例文档单 Tab + 新建按钮', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    expect(screen.getByTestId('md-doc-tabs')).toBeInTheDocument();
    expect(screen.getAllByTestId('md-doc-tab').length).toBe(1);
    expect(screen.getByTestId('md-doc-add')).toBeInTheDocument();
  });

  it('新建文档切换 Tab:内容隔离,标题随首个标题行派生', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    fireEvent.click(screen.getByTestId('md-doc-add'));
    const s1 = useMdDocsStore.getState();
    expect(s1.docs.length).toBe(2);
    expect(s1.activeDocId).toBe(s1.docs[1].id);
    // 新文档空白:标题回退自动命名。示例文档标题是派生文本(非 md-N),
    // 序号扫描从 1 起,因此新 Tab 名为 md-1
    expect(s1.docs[1].title).toBe('md-1');

    // 在新 Tab 输入标题 → Tab 名派生为首行标题
    fireEvent.change(screen.getByTestId('md-input-textarea'), {
      target: { value: '# Second Doc' },
    });
    await waitFor(() =>
      expect(useMdDocsStore.getState().docs[1].title).toBe('Second Doc'),
    );

    // 切回第一个 Tab:编辑器展示示例文档内容(重挂载生效)
    fireEvent.click(screen.getAllByTestId('md-doc-tab')[0]);
    await waitFor(() =>
      expect(screen.getByTestId('md-input-textarea').value).toContain('# Qraft'),
    );
    // 再切到第二个 Tab:内容隔离
    fireEvent.click(screen.getAllByTestId('md-doc-tab')[1]);
    await waitFor(() =>
      expect(screen.getByTestId('md-input-textarea').value).toBe('# Second Doc'),
    );
  });

  it('关闭非空文档需确认,确认后激活态跳到相邻', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // 新建第二个 Tab 并输入内容(非空 → 关闭需确认)
    fireEvent.click(screen.getByTestId('md-doc-add'));
    fireEvent.change(screen.getByTestId('md-input-textarea'), {
      target: { value: '# To Close' },
    });

    // 点击第二个 Tab 的关闭按钮
    fireEvent.click(screen.getAllByTestId('md-doc-tab-close')[1]);
    expect(screen.getByTestId('md-doc-close-dialog')).toBeInTheDocument();
    // 取消:文档保留
    fireEvent.click(screen.getByTestId('md-doc-close-dialog-cancel'));
    expect(screen.queryByTestId('md-doc-close-dialog')).not.toBeInTheDocument();
    expect(useMdDocsStore.getState().docs.length).toBe(2);

    // 再次关闭并确认:文档移除,激活跳回第一个
    fireEvent.click(screen.getAllByTestId('md-doc-tab-close')[1]);
    fireEvent.click(screen.getByTestId('md-doc-close-dialog-confirm'));
    await waitFor(() => expect(useMdDocsStore.getState().docs.length).toBe(1));
    const s = useMdDocsStore.getState();
    expect(s.activeDocId).toBe(s.docs[0].id);
  });

  it('重命名对话框:确认后 Tab 名更新且不再随内容派生', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // 打开右键菜单比较绕(jsdom ContextMenu 交互),直接驱动 store 层:
    // renameDoc 是右键菜单 onSelect 的直通动作,等价验证 store 契约
    const docId = useMdDocsStore.getState().activeDocId!;
    act(() => {
      useMdDocsStore.getState().renameDoc(docId, 'My Notes');
    });
    expect(useMdDocsStore.getState().docs[0].title).toBe('My Notes');
    // 内容变化不再派生标题(手动重命名后 autoTitle 已清除)
    act(() => {
      useMdDocsStore.getState().setDocContent(docId, '# Changed Heading');
    });
    expect(useMdDocsStore.getState().docs[0].title).toBe('My Notes');
  });

  it('固定 Tab 恒排 Tab 栏最前', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    fireEvent.click(screen.getByTestId('md-doc-add'));
    // 固定第一个(原示例)Tab
    const firstId = useMdDocsStore.getState().docs[0].id;
    act(() => {
      useMdDocsStore.getState().togglePinDoc(firstId);
    });
    // 排序在组件内完成:Tab 栏首项应为被固定的文档
    const tabs = screen.getAllByTestId('md-doc-tab');
    expect(tabs[0].getAttribute('data-doc-id')).toBe(firstId);
  });
});
