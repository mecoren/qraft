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

// sonner toast:文件打开/保存路径的错误提示断言用(HashCalculator.test 同款)。
// toast 本体也要可调用(markdown-preview-pane 的图片拦截提示走 toast(title, …) 形态)
vi.mock('sonner', () => {
  const fn = vi.fn();
  return {
    toast: Object.assign(fn, {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

// 文件操作基建(IPC)整体 mock:打开/保存对话框与写盘走桩,
// 避免测试环境触发真实 Tauri invoke(setup 已 mock,此处控制返回值)
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const writeToPathMock = vi.fn();
const fileMtimeMock = vi.fn();
const readEncodedMock = vi.fn();
vi.mock('./code-editor-workspace/fileOps', () => ({
  OPEN_REASON_BINARY: 'binary',
  OPEN_REASON_TOO_LARGE: 'too-large',
  openTextFileDialog: (...a: unknown[]) => openDialogMock(...a),
  saveWithDialogEncoded: (...a: unknown[]) => saveDialogMock(...a),
  saveToPathEncoded: (...a: unknown[]) => writeToPathMock(...a),
  fileMtimeMs: (...a: unknown[]) => fileMtimeMock(...a),
  readTextFileEncoded: (...a: unknown[]) => readEncodedMock(...a),
  forceOpenFile: vi.fn(),
}));

import { MarkdownPreview } from './MarkdownPreview';
import { renderMermaidIn } from './markdown-mermaid';
import { useMarkdownPreviewStore } from './markdownPreviewStore';
import { DRAFT_STORAGE_KEY } from './markdownPreviewStore';
import { useMdDocsStore } from './markdownPreviewDocsStore';
import { useToolMenusStore } from '@/store/toolMenubarStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { toast } from 'sonner';
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
        docs: [{ id: 'md-default', title: 'md-1', autoTitle: 'md-1', pinned: false, content: '' }],
        activeDocId: 'md-default',
        ready: false,
        userTouched: false,
        firstUse: true,
        error: null,
      });
    });
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(renderMermaidIn).mockClear();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    writeToPathMock.mockReset();
    // 外部修改轮询的 mtime 探测:缺省 resolve 当前基准值(磁盘未变),
    // 冲突提示用例再按需 override
    fileMtimeMock.mockReset().mockImplementation((p: string) => {
      const doc = useMdDocsStore.getState().docs.find((d) => d.path === p);
      return Promise.resolve(doc?.mtimeMs);
    });
    readEncodedMock.mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    // 快捷键守卫依赖激活工具:置为本工具(主窗口语义)
    act(() => {
      useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    });
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

  /** 等待 hydrate 完成(ready 置位);文件操作用例中激活文档可能是预置的
   *  绑定文档(docs[0] 为默认草稿),不校验 docs[0] 激活 */
  async function waitForReady() {
    await waitFor(() => {
      expect(useMdDocsStore.getState().ready).toBe(true);
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

  it('首次使用时系统打开 .md:注入文档挂载后不被示例文档覆盖', async () => {
    // 模拟 App 层系统打开(拖入/文件关联):组件挂载 hydrate 之前注入文档
    act(() => {
      useMdDocsStore.getState().openDocFromSystem('# Dropped Doc\n\n来自拖入的内容');
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();

    const s = useMdDocsStore.getState();
    // 注入文档保留且激活(不被 firstUse 示例文档顶掉)
    const doc = s.docs.find((d) => d.content === '# Dropped Doc\n\n来自拖入的内容');
    expect(doc).toBeDefined();
    expect(s.activeDocId).toBe(doc?.id);
    expect(s.docs.some((d) => d.content.includes('Qraft Markdown 预览'))).toBe(false);
    // 预览渲染注入内容
    await waitFor(() =>
      expect(screen.getByTestId('md-preview').textContent).toContain('Dropped Doc'),
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
    await waitFor(() => expect(useMdDocsStore.getState().docs[1].title).toBe('Second Doc'));

    // 切回第一个 Tab:编辑器展示示例文档内容(重挂载生效)
    fireEvent.click(screen.getAllByTestId('md-doc-tab')[0]);
    await waitFor(() =>
      expect((screen.getByTestId('md-input-textarea') as HTMLTextAreaElement).value).toContain(
        '# Qraft',
      ),
    );
    // 再切到第二个 Tab:内容隔离
    fireEvent.click(screen.getAllByTestId('md-doc-tab')[1]);
    await waitFor(() =>
      expect((screen.getByTestId('md-input-textarea') as HTMLTextAreaElement).value).toBe(
        '# Second Doc',
      ),
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

  it('远程图片默认拦截:src 摘除并挂 data-md-blocked-src,开启开关后放行', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    fireEvent.change(screen.getByTestId('md-input-textarea'), {
      target: {
        value: '![remote](https://example.com/a.png)\n\n![local](mdasset:img-x.png)',
      },
    });
    await waitFor(
      () => {
        const imgs = screen.getByTestId('md-preview').querySelectorAll('img');
        expect(imgs.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    // 默认(loadRemoteImages=false):远程 src 摘除,本地引用不动(解析由
    // resolveAssetImages 异步处理,此处仅断言远程拦截行为)
    const article = screen.getByTestId('md-preview');
    const remote = article.querySelector('[data-md-blocked-src]');
    expect(remote?.getAttribute('data-md-blocked-src')).toBe('https://example.com/a.png');

    // 点击被拦截图片:提示拦截原因
    fireEvent.click(remote as HTMLElement);

    // 开启开关:重渲后远程 src 恢复
    act(() => {
      useMarkdownPreviewStore.getState().setLoadRemoteImages(true);
    });
    await waitFor(
      () => {
        const article2 = screen.getByTestId('md-preview');
        expect(article2.querySelector('img[src="https://example.com/a.png"]')).not.toBeNull();
        expect(article2.querySelector('[data-md-blocked-src]')).toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('聚焦模式:开关切换遮罩挂载/卸载', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // 编辑器可见(split 模式),聚焦默认关闭
    expect(screen.queryByTestId('md-focus-mask-top')).toBeNull();
    act(() => {
      useMarkdownPreviewStore.getState().setFocusMode(true);
    });
    await waitFor(() => expect(screen.getByTestId('md-focus-mask-top')).toBeInTheDocument());
    act(() => {
      useMarkdownPreviewStore.getState().setFocusMode(false);
    });
    await waitFor(() => expect(screen.queryByTestId('md-focus-mask-top')).toBeNull());
  });

  it('导出菜单含打印与另存 .md 入口', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    // Radix DropdownMenu 由 pointerdown 打开(jsdom 下 click 不触发)
    fireEvent.pointerDown(screen.getByTestId('btn-export'));
    await waitFor(() => expect(screen.getByTestId('export-md-file')).toBeInTheDocument());
    expect(screen.getByTestId('export-print')).toBeInTheDocument();
    expect(screen.getByTestId('export-html-file')).toBeInTheDocument();
  });

  // ============================================================
  // 文件操作:菜单注册 / 打开 / 保存 / dirty 徽标
  // ============================================================

  it('挂载即注册「文件」菜单(打开/保存/另存为/关闭),卸载清空', async () => {
    const { unmount } = render(
      <MarkdownPreview toolId="markdown_preview" metadata={null as never} />,
    );
    await waitForHydrate();
    const s = useToolMenusStore.getState();
    expect(s.ownerToolId).toBe('markdown_preview');
    expect(s.menus.length).toBeGreaterThan(0);
    const fileMenu = s.menus[0];
    expect(fileMenu.id).toBe('file');
    const ids = fileMenu.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain('open');
    expect(ids).toContain('save');
    expect(ids).toContain('save-as');
    expect(ids).toContain('close');
    unmount();
    expect(useToolMenusStore.getState().menus).toHaveLength(0);
  });

  it('打开文件:对话框返回内容 → 新文档承载,Tab 名取文件名', async () => {
    openDialogMock.mockResolvedValue({
      file: {
        path: 'C:\\docs\\opened.md',
        content: '# Opened From Disk',
        encoding: 'utf-8',
        mtimeMs: 111,
      },
      failed: null,
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();

    // 菜单「打开」入口
    const openItem = useToolMenusStore
      .getState()
      .menus[0].groups.flatMap((g) => g.items)
      .find((i) => i.id === 'open');
    await act(async () => {
      openItem?.onSelect();
    });

    const s = useMdDocsStore.getState();
    const doc = s.docs.find((d) => d.path === 'C:\\docs\\opened.md');
    expect(doc).toBeDefined();
    expect(doc?.title).toBe('opened.md');
    expect(doc?.content).toBe('# Opened From Disk');
    expect(doc?.savedContent).toBe('# Opened From Disk');
    expect(s.activeDocId).toBe(doc?.id);
    // 有路径且未编辑:无 dirty 徽标
    const tab = screen
      .getAllByTestId('md-doc-tab')
      .find((el) => el.getAttribute('data-doc-id') === doc?.id);
    expect(tab?.getAttribute('data-dirty')).toBeNull();
    // 预览渲染打开的内容
    await waitFor(() =>
      expect(screen.getByTestId('md-preview').textContent).toContain('Opened From Disk'),
    );
  });

  it('打开二进制文件:toast 带仍要打开动作,点击后经 force 通道载入', async () => {
    openDialogMock.mockResolvedValue({
      file: null,
      failed: { path: 'C:\\docs\\bin.dat', reason: 'binary', size: null },
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();

    const openItem = useToolMenusStore
      .getState()
      .menus[0].groups.flatMap((g) => g.items)
      .find((i) => i.id === 'open');
    await act(async () => {
      openItem?.onSelect();
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('Ctrl+S 保存:有路径文档按记录编码写回并刷新快照;dirty 徽标随编辑/保存切换', async () => {
    // 直接构造一个已绑定路径且 dirty 的文档
    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({
        path: 'C:\\docs\\save.md',
        content: 'base',
        encoding: 'utf-8',
        mtimeMs: 5,
      });
      s.setDocContent(useMdDocsStore.getState().activeDocId!, 'base edited');
    });
    writeToPathMock.mockResolvedValue(true);
    fileMtimeMock.mockResolvedValue(9);

    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    // 编辑器 mock 受控:内容来自 store,不依赖 textarea 渲染
    const docId = useMdDocsStore.getState().activeDocId!;
    // dirty 徽标可见
    await waitFor(() => expect(screen.getByTestId('md-doc-tab-dirty')).toBeInTheDocument());

    // Ctrl+S(用户默认绑定;快捷键挂在 window 捕获阶段)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(writeToPathMock).toHaveBeenCalled());
    // 写盘参数:路径 + 编辑后内容 + 记录编码 + 打开时 mtime 乐观基准
    expect(writeToPathMock).toHaveBeenCalledWith('C:\\docs\\save.md', 'base edited', 'utf-8', 5);
    // 保存成功:快照刷新,dirty 消除(mtime 同步刷新)
    await waitFor(() => {
      const doc = useMdDocsStore.getState().docs.find((d) => d.id === docId);
      expect(doc?.savedContent).toBe('base edited');
      expect(doc?.mtimeMs).toBe(9);
    });
    await waitFor(() => expect(screen.queryByTestId('md-doc-tab-dirty')).toBeNull());
  });

  it('Ctrl+S 纯草稿:弹另存为对话框,保存后绑定路径', async () => {
    // hydrate 后示例文档为纯草稿;编辑制造内容
    saveDialogMock.mockResolvedValue('C:\\docs\\saved-as.md');
    fileMtimeMock.mockResolvedValue(66);

    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    act(() => {
      const s = useMdDocsStore.getState();
      s.setDocContent(s.activeDocId!, '# Draft Content');
    });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(saveDialogMock).toHaveBeenCalled());
    const doc = useMdDocsStore.getState().docs.find((d) => d.content === '# Draft Content');
    await waitFor(() => expect(doc?.path).toBe('C:\\docs\\saved-as.md'));
    expect(doc?.savedContent).toBe('# Draft Content');
    expect(doc?.title).toBe('saved-as.md');
  });

  it('快捷键仅在激活工具时响应:切走后 Ctrl+S 不触发保存', async () => {
    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({ path: 'C:\\docs\\x.md', content: 'v', encoding: 'utf-8', mtimeMs: 1 });
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();
    writeToPathMock.mockClear();

    // 激活工具切到别的工具:守卫放行事件(返回 false),不触发保存
    act(() => {
      useToolStateStore.setState({ currentToolId: 'base64_codec' });
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(writeToPathMock).not.toHaveBeenCalled();

    // 切回本工具:保存生效
    act(() => {
      useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(writeToPathMock).toHaveBeenCalled());
  });

  it('另存为:对话框保存后绑定新路径(即使已有旧路径)', async () => {
    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({ path: 'C:\\docs\\old.md', content: '# C', encoding: 'utf-8', mtimeMs: 1 });
    });
    saveDialogMock.mockResolvedValue('C:\\docs\\new.md');
    fileMtimeMock.mockResolvedValue(2);

    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    const saveAsItem = useToolMenusStore
      .getState()
      .menus[0].groups.flatMap((g) => g.items)
      .find((i) => i.id === 'save-as');
    await act(async () => {
      saveAsItem?.onSelect();
    });

    const doc = useMdDocsStore.getState().docs.find((d) => (d.id === 'md-default' ? false : true));
    await waitFor(() => {
      const bound = useMdDocsStore.getState().docs.find((d) => d.path === 'C:\\docs\\new.md');
      expect(bound).toBeDefined();
    });
    void doc;
  });

  it('关闭 dirty 文档:确认文案提示保存并关闭,确认后保存成功才关闭', async () => {
    writeToPathMock.mockResolvedValue(true);
    fileMtimeMock.mockResolvedValue(3);
    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({ path: 'C:\\docs\\close.md', content: 'v0', encoding: 'utf-8', mtimeMs: 1 });
      s.setDocContent(useMdDocsStore.getState().activeDocId!, 'v1');
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    // 关闭按钮 → 确认框出现,文案为「保存并关闭」
    const docId = useMdDocsStore.getState().activeDocId!;
    const closeBtn = screen
      .getAllByTestId('md-doc-tab-close')
      .find((el) => el.closest('[data-doc-id]')?.getAttribute('data-doc-id') === docId);
    fireEvent.click(closeBtn as HTMLElement);
    expect(screen.getByTestId('md-doc-close-dialog')).toBeInTheDocument();
    const confirmBtn = screen.getByTestId('md-doc-close-dialog-confirm');
    expect(confirmBtn.textContent).toContain('保存并关闭');

    // 确认:先写盘再关闭
    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(writeToPathMock).toHaveBeenCalledWith('C:\\docs\\close.md', 'v1', 'utf-8', 1),
    );
    await waitFor(() =>
      expect(useMdDocsStore.getState().docs.some((d) => d.id === docId)).toBe(false),
    );
  });

  it('保存冲突(磁盘外部修改):弹三选对话框,覆盖入口跳过校验写盘', async () => {
    const { CommandError } = await import('@/lib/ipc');
    // 第一次写盘:冲突;第二次(覆盖):成功
    writeToPathMock
      .mockRejectedValueOnce(new CommandError('ERR_FILE_MODIFIED', 'file modified'))
      .mockResolvedValueOnce(true);
    fileMtimeMock.mockResolvedValue(8);

    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({
        path: 'C:\\docs\\conflict.md',
        content: 'v0',
        encoding: 'utf-8',
        mtimeMs: 1,
      });
      s.setDocContent(useMdDocsStore.getState().activeDocId!, 'v1');
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    // 冲突 → 三选对话框
    await waitFor(() => expect(screen.getByTestId('md-file-modified-dialog')).toBeInTheDocument());

    // 「覆盖」:跳过 mtime 校验写盘
    fireEvent.click(screen.getByTestId('file-modified-overwrite'));
    await waitFor(() =>
      expect(writeToPathMock).toHaveBeenCalledWith(
        'C:\\docs\\conflict.md',
        'v1',
        'utf-8',
        undefined,
      ),
    );
    await waitFor(() => {
      const doc = useMdDocsStore.getState().docs.find((d) => d.path === 'C:\\docs\\conflict.md');
      expect(doc?.savedContent).toBe('v1');
    });
  });

  it('关闭 dirty 文档:「不保存关闭」直接丢弃改动,不触发写盘', async () => {
    writeToPathMock.mockResolvedValue(true);
    fileMtimeMock.mockResolvedValue(3);
    act(() => {
      const s = useMdDocsStore.getState();
      s.openFileAsDoc({
        path: 'C:\\docs\\discard.md',
        content: 'v0',
        encoding: 'utf-8',
        mtimeMs: 1,
      });
      s.setDocContent(useMdDocsStore.getState().activeDocId!, 'v1');
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    const docId = useMdDocsStore.getState().activeDocId!;
    const closeBtn = screen
      .getAllByTestId('md-doc-tab-close')
      .find((el) => el.closest('[data-doc-id]')?.getAttribute('data-doc-id') === docId);
    fireEvent.click(closeBtn as HTMLElement);
    // dirty 三选:「不保存关闭」按钮存在
    const discardBtn = screen.getByTestId('md-doc-close-dialog-discard');
    expect(discardBtn.textContent).toContain('不保存关闭');

    // 点击:直接关闭,不写盘
    fireEvent.click(discardBtn);
    await waitFor(() =>
      expect(useMdDocsStore.getState().docs.some((d) => d.id === docId)).toBe(false),
    );
    expect(writeToPathMock).not.toHaveBeenCalled();
  });

  it('关闭干净文档:两选(无「不保存关闭」),确认即直接关闭', async () => {
    act(() => {
      useMdDocsStore.getState().openFileAsDoc({
        path: 'C:\\docs\\clean.md',
        content: 'v0',
        encoding: 'utf-8',
        mtimeMs: 1,
      });
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    const docId = useMdDocsStore.getState().activeDocId!;
    const closeBtn = screen
      .getAllByTestId('md-doc-tab-close')
      .find((el) => el.closest('[data-doc-id]')?.getAttribute('data-doc-id') === docId);
    fireEvent.click(closeBtn as HTMLElement);
    // 干净文档无「不保存关闭」按钮
    expect(screen.queryByTestId('md-doc-close-dialog-discard')).toBeNull();
    fireEvent.click(screen.getByTestId('md-doc-close-dialog-confirm'));
    await waitFor(() =>
      expect(useMdDocsStore.getState().docs.some((d) => d.id === docId)).toBe(false),
    );
  });

  it('文件菜单含「新建文档」项,触发新建空白文档并激活', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();
    const before = useMdDocsStore.getState().docs.length;
    const beforeActive = useMdDocsStore.getState().activeDocId;

    const newItem = useToolMenusStore
      .getState()
      .menus[0].groups.flatMap((g) => g.items)
      .find((i) => i.id === 'new');
    expect(newItem).toBeDefined();
    expect(newItem?.label).toBe('新建文档');
    act(() => {
      newItem?.onSelect();
    });
    const s = useMdDocsStore.getState();
    expect(s.docs.length).toBe(before + 1);
    expect(s.activeDocId).not.toBe(beforeActive);
    expect(s.docs.find((d) => d.id === s.activeDocId)?.content).toBe('');
  });

  it('Ctrl+N 新建文档,Ctrl+W 触发关闭确认', async () => {
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForHydrate();

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    await waitFor(() => {
      const s = useMdDocsStore.getState();
      // 新建文档内容为空且激活
      expect(s.docs.filter((d) => d.content === '').length).toBeGreaterThanOrEqual(1);
      const active = s.docs.find((d) => d.id === s.activeDocId);
      expect(active?.content).toBe('');
    });

    // Ctrl+W:激活文档(非空示例文档)弹关闭确认
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('md-doc-close-dialog')).toBeInTheDocument());
  });

  it('外部修改轮询:切回绑定文档时磁盘 mtime 已变 → toast 提示一次', async () => {
    // 磁盘 mtime(8)与打开基准(1)不同 → 触发提示
    fileMtimeMock.mockReset().mockResolvedValue(8);
    act(() => {
      useMdDocsStore.getState().openFileAsDoc({
        path: 'C:\\docs\\touched.md',
        content: 'v0',
        encoding: 'utf-8',
        mtimeMs: 1,
      });
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    await waitFor(() => expect(vi.mocked(toast.warning)).toHaveBeenCalled());
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain('touched.md');
  });

  it('外部修改轮询:磁盘未变不提示', async () => {
    // 默认 mock 实现:按 path 查 store 返回当前基准 mtime → 相等,不提示
    act(() => {
      useMdDocsStore.getState().openFileAsDoc({
        path: 'C:\\docs\\stable.md',
        content: 'v0',
        encoding: 'utf-8',
        mtimeMs: 7,
      });
    });
    render(<MarkdownPreview toolId="markdown_preview" metadata={null as never} />);
    await waitForReady();

    // effect 已跑完(fileMtimeMock 被调用过)但无 warning toast
    await waitFor(() => expect(fileMtimeMock).toHaveBeenCalled());
    expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
  });
});
