import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { App } from './App';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import { useToolStateStore } from '@/store/toolStateStore';
import { useUiStore } from '@/store/uiStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { DEFAULT_WORKSPACE } from '@/tools/code-editor-workspace/schema';
import { useMdDocsStore } from '@/tools/markdownPreviewDocsStore';
import { useMarkdownPreviewStore } from '@/tools/markdownPreviewStore';
import { usePdfDocsStore } from '@/tools/pdf/pdfDocsStore';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const listenMock = listen as unknown as ReturnType<typeof vi.fn>;

// 仅用于满足 tool_list IPC 的 happy-path mock;侧栏实际从静态目录渲染
const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: [],
  },
];

function setupHappyPath() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({
        success: true,
        data: tools,
      } as CommandResponse<ToolMetadata[]>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({ success: true, data: [] });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  // setup.ts 的全局 listen mock 返回空 unlisten;此处捕获各事件的 handler 供测试触发
  listenMock.mockReset();
  listenMock.mockImplementation(() => Promise.resolve(() => {}));
  // uiStore 经 localStorage 持久化,跨测试会泄漏,这里复位到确定状态
  useUiStore.setState({
    view: 'welcome',
    sidebarCollapsed: false,
    favorites: [],
    recents: [],
    expandedCategories: [],
  });
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
  // 编辑器工作区为全局单例,跨用例泄漏 Tab;事件用例依赖空工作区断言
  useEditorWorkspaceStore.setState({
    workspace: { ...DEFAULT_WORKSPACE },
    ready: false,
    userTouched: false,
    error: null,
  });
  // Markdown 文档工作区同为全局单例,复位避免跨用例泄漏
  useMdDocsStore.setState({
    docs: [],
    activeDocId: null,
    ready: true,
    userTouched: false,
    firstUse: false,
    error: null,
  });
  // PDF 文档工作区同为全局单例,复位避免跨用例泄漏
  usePdfDocsStore.setState({ docs: [], activeDocId: null });
});

describe('App', () => {
  it('renders sidebar with tool groups after mount', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    expect(sidebar).toBeInTheDocument();
    // 分类分组标题渲染(默认折叠,仅显示分组标签)
    // 限定在侧栏内查询:欢迎页「所有工具」分区也含分类名,会与侧栏重名
    expect(await within(sidebar).findByText('格式化工具')).toBeInTheDocument();
    expect(within(sidebar).getByText('编解码器')).toBeInTheDocument();
  });

  it('clicking a tool switches main area to ToolPanel', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    // 展开「格式化工具」分类,使工具按钮可见(限定在侧栏内查询,避免与欢迎页网格卡片重名)
    const sidebar = screen.getByRole('navigation');
    await user.click(await within(sidebar).findByTestId('nav-cat-formatter'));
    await user.click(await within(sidebar).findByRole('button', { name: /JSON 格式化器/i }));
    // 标题栏左段显示当前工具名(工具标题区已迁移至 Titlebar)
    expect(await screen.findByTestId('titlebar-tool-name')).toHaveTextContent(/JSON 格式化器/i);
    // 当前工具已切换
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
  });

  it('Ctrl+K opens CommandPalette', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('侧边栏「所有工具」正下方有固定「文本编辑器」菜单项', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    const allTools = within(sidebar).getByTestId('nav-all-tools');
    // 固定条目用 testid 精确定位:「文本编辑器」分类折叠头文本相同,避免 role+name 多匹配
    const editorBtn = within(sidebar).getByTestId('nav-text-editor');
    expect(editorBtn).toBeInTheDocument();
    // 文本编辑器必须紧跟「所有工具」之后(第一个兄弟节点)
    expect(allTools.nextElementSibling).toBe(editorBtn);
  });

  it('侧边栏不渲染「最近使用」条目(recents 仅在欢迎页展示)', async () => {
    useUiStore.setState({ recents: ['base64_codec'] });
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    // 「最近使用」区域已从侧栏移除,Base64 转换器不应出现在侧栏
    expect(
      within(sidebar).queryByRole('button', { name: /Base64 转换器/i }),
    ).not.toBeInTheDocument();
  });

  /** 渲染 App 并捕获指定事件的 handler。
   * 注意:mock 到的是 @tauri-apps/api/event 的原始 listen,而 App 经
   * src/lib/ipc 的包装订阅(handler 收 `e.payload`)→ 触发时须传事件信封。 */
  async function renderAndCaptureEvents(
    eventNames: string[],
  ): Promise<Record<string, (payload: unknown) => void>> {
    const handlers: Record<string, (payload: unknown) => void> = {};
    listenMock.mockImplementation((name: string, cb: (event: { payload: unknown }) => void) => {
      handlers[name] = (payload: unknown) => cb({ payload });
      return Promise.resolve(() => {});
    });
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    for (const name of eventNames) {
      if (!handlers[name]) throw new Error(`listener for ${name} not registered`);
    }
    return handlers;
  }

  it('拖放二进制文件:提示「仍要打开」,点击后强制打开并记录编码', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    // 强制打开走 fs_read_text_file_encoded(force=true):mock 返回有损解码结果
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'fs_read_text_file_encoded') {
        expect(args.force).toBe(true);
        return Promise.resolve({
          success: true,
          data: { content: '\u{FFFD}bin\u{FFFD}', encoding: 'windows-1252' },
        });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Rust 端二进制载荷:{ kind: 'unsupported', path }
    await act(async () => {
      handlers['app:open-file-unsupported']({ kind: 'unsupported', path: 'C:\\data\\x.dat' });
    });

    // toast 提供「仍要打开」动作;点击触发强制打开
    const openAnyway = await screen.findByRole('button', { name: '仍要打开' });
    await act(async () => {
      openAnyway.click();
    });
    await act(async () => {});

    // 编辑器工具被打开且 Tab 携带强制解码内容与编码标识
    const ws = useEditorWorkspaceStore.getState().workspace;
    const tab = ws.tabs.find((t) => t.path === 'C:\\data\\x.dat');
    expect(tab).toBeDefined();
    expect(tab?.content).toBe('\u{FFFD}bin\u{FFFD}');
    expect(tab?.encoding).toBe('windows-1252');
    expect(useToolStateStore.getState().currentToolId).toBe('text_editor');
  });

  it('拖放过大文件:切换到大文件只读模式打开(不提示失败)', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    await act(async () => {
      handlers['app:open-file-unsupported']({ kind: 'too-large', path: 'C:\\big\\huge.dat' });
    });
    // 不再提示「过大」错误:超限文件进入大文件只读查看模式
    expect(screen.queryByText(/过大/i)).not.toBeInTheDocument();
    // 创建 largeFile Tab(内容不进内存,由 Workbench 激活时触发索引扫描)
    const tab = useEditorWorkspaceStore
      .getState()
      .workspace.tabs.find((t) => t.path === 'C:\\big\\huge.dat');
    expect(tab).toBeDefined();
    expect(tab?.largeFile).toBe(true);
    expect(tab?.content).toBe('');
    expect(useToolStateStore.getState().currentToolId).toBe('text_editor');
  });

  it('文件关联打开事件:payload 携带编码时一并记录到 Tab', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file']);
    await act(async () => {
      handlers['app:open-file']({
        path: 'C:\\docs\\gbk.txt',
        content: '你好',
        encoding: 'gb18030',
      });
    });
    const tab = useEditorWorkspaceStore
      .getState()
      .workspace.tabs.find((t) => t.path === 'C:\\docs\\gbk.txt');
    expect(tab?.content).toBe('你好');
    expect(tab?.encoding).toBe('gb18030');
  });

  it('打开 .md 文件(文件关联/命令行):自动切到 Markdown 预览工具并注入文档', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file']);
    // 视图偏好停在「仅编辑」:注入后应被切回分屏(自动打开预览)
    useMarkdownPreviewStore.setState({ viewMode: 'edit' });
    await act(async () => {
      // 文件关联/命令行入口无 dropPosition
      handlers['app:open-file']({
        path: 'C:\\docs\\README.md',
        content: '# 标题\n\n正文',
        encoding: 'utf-8',
      });
    });
    // 切到 markdown_preview 工具且文档已注入激活
    expect(useToolStateStore.getState().currentToolId).toBe('markdown_preview');
    const md = useMdDocsStore.getState();
    const doc = md.docs.find((d) => d.content === '# 标题\n\n正文');
    expect(doc).toBeDefined();
    expect(md.activeDocId).toBe(doc?.id);
    // 自动开启预览:上次偏好为「仅编辑」时切回分屏
    expect(useMarkdownPreviewStore.getState().viewMode).not.toBe('edit');
    // 不进入文本编辑器工作区
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toHaveLength(0);
  });

  it('拖入 .md 到编辑框外的区域:同样切到 Markdown 预览工具打开', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file']);
    await act(async () => {
      handlers['app:open-file']({
        path: '/home/user/notes.md',
        content: '拖到窗口空白处',
        dropPosition: { x: 300, y: 500 },
      });
    });
    expect(useToolStateStore.getState().currentToolId).toBe('markdown_preview');
    const md = useMdDocsStore.getState();
    expect(md.docs.some((d) => d.content === '拖到窗口空白处')).toBe(true);
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toHaveLength(0);
  });

  it('拖入 .md 直接落在文本编辑器的编辑框内:维持编辑器打开,不分流到 Markdown 预览', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file']);
    // 模拟落点命中 Monaco 编辑区:jsdom 无 elementFromPoint,这里定义
    // 一个桩,返回位于 .monaco-editor 根节点内的元素(还原删除标记)
    const editorRoot = document.createElement('div');
    editorRoot.className = 'monaco-editor';
    const child = editorRoot.appendChild(document.createElement('textarea'));
    const original = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => child,
    });
    try {
      await act(async () => {
        handlers['app:open-file']({
          path: '/home/user/notes.md',
          content: '直接拖进编辑框',
          dropPosition: { x: 300, y: 500 },
        });
      });
    } finally {
      if (original) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: original,
        });
      } else {
        delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      }
    }
    // 停留在文本编辑器工具,文件 Tab 正常打开
    expect(useToolStateStore.getState().currentToolId).toBe('text_editor');
    const tab = useEditorWorkspaceStore
      .getState()
      .workspace.tabs.find((t) => t.path === '/home/user/notes.md');
    expect(tab?.content).toBe('直接拖进编辑框');
    // Markdown 工具未收到注入
    expect(useMdDocsStore.getState().docs).toHaveLength(0);
  });

  it('打开/拖入 .pdf:自动切到 PDF 工具并注入文档(Rust 经 Pdf 变体分流)', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    // fs_read_pdf mock:返回 base64 字节载荷
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'fs_read_pdf') {
        expect(args.path).toBe('C:\\docs\\表单.pdf');
        return Promise.resolve({
          success: true,
          data: { path: 'C:\\docs\\表单.pdf', size: 4, base64: 'JVBERj==' },
        });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Rust 端 .pdf 分流载荷:{ kind: 'pdf', path }
    await act(async () => {
      handlers['app:open-file-unsupported']({ kind: 'pdf', path: 'C:\\docs\\表单.pdf' });
    });
    await act(async () => {});

    // 切到 pdf_editor 工具且文档 Tab 已注入激活
    expect(useToolStateStore.getState().currentToolId).toBe('pdf_editor');
    const pdf = usePdfDocsStore.getState();
    expect(pdf.docs).toHaveLength(1);
    expect(pdf.docs[0].path).toBe('C:\\docs\\表单.pdf');
    expect(pdf.docs[0].base64).toBe('JVBERj==');
    expect(pdf.activeDocId).toBe(pdf.docs[0].id);
    // 不进入文本编辑器工作区
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toHaveLength(0);
  });

  it('pdf 超过大小上限:留在原视图并 toast 报错(fs_read_pdf 拒绝)', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'fs_read_pdf') {
        return Promise.resolve({
          success: false,
          error: {
            code: 'ERR_FILE_TOO_LARGE',
            message: 'PDF too large',
            details: { size: 26214400, max: 20971520 },
          },
        });
      }
      return Promise.resolve({ success: true, data: null });
    });

    await act(async () => {
      handlers['app:open-file-unsupported']({ kind: 'pdf', path: 'C:\\huge\\big.pdf' });
    });
    await act(async () => {});

    // 工具已切换(pdf_editor),但读取失败:无 Tab 注入,toast 提示文件过大
    // (带具体大小与上限的本地化文案,而非通用「打开失败」)
    expect(useToolStateStore.getState().currentToolId).toBe('pdf_editor');
    expect(usePdfDocsStore.getState().docs).toHaveLength(0);
    expect(screen.getByText(/PDF 过大/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/20\.0 MB/)).toBeInTheDocument();
  });

  /** elementFromPoint 桩:命中(inside=true)返回 .monaco-editor 内的元素 */
  function stubElementFromPoint(inside: boolean): () => void {
    const editorRoot = document.createElement('div');
    editorRoot.className = 'monaco-editor';
    const child = editorRoot.appendChild(document.createElement('textarea'));
    const original = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => (inside ? child : document.createElement('div')),
    });
    return () => {
      if (original) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: original,
        });
      } else {
        delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      }
    };
  }

  it('拖入 .pdf 落点在编辑框外:落点坐标不豁免,仍切到 PDF 工具打开', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'fs_read_pdf') {
        return Promise.resolve({
          success: true,
          data: { path: '/home/user/合同.pdf', size: 4, base64: 'JVBERj==' },
        });
      }
      return Promise.resolve({ success: true, data: null });
    });
    const restore = stubElementFromPoint(false);
    try {
      await act(async () => {
        // Rust 端拖放入口:Pdf 载荷附带落点坐标,但落点不在 Monaco 编辑框内
        handlers['app:open-file-unsupported']({
          kind: 'pdf',
          path: '/home/user/合同.pdf',
          dropPosition: { x: 300, y: 500 },
        });
      });
      await act(async () => {});
    } finally {
      restore();
    }
    // 编辑框外:维持 PDF 工具分流
    expect(useToolStateStore.getState().currentToolId).toBe('pdf_editor');
    expect(usePdfDocsStore.getState().docs).toHaveLength(1);
    expect(usePdfDocsStore.getState().docs[0].path).toBe('/home/user/合同.pdf');
  });

  it('拖入 .pdf 直接落在文本编辑器的编辑框内:豁免 PDF 分流,回退编辑器二进制提示', async () => {
    const handlers = await renderAndCaptureEvents(['app:open-file-unsupported']);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'fs_read_pdf') {
        throw new Error('fs_read_pdf should not be called for editor-box drops');
      }
      return Promise.resolve({ success: true, data: null });
    });
    const restore = stubElementFromPoint(true);
    try {
      await act(async () => {
        // Rust 端拖放入口:Pdf 载荷附带的落点命中 Monaco 编辑区
        handlers['app:open-file-unsupported']({
          kind: 'pdf',
          path: '/home/user/合同.pdf',
          dropPosition: { x: 300, y: 500 },
        });
      });
    } finally {
      restore();
    }
    // 不切到 PDF 工具、不读取字节、不注入 PDF 工作区
    expect(useToolStateStore.getState().currentToolId).not.toBe('pdf_editor');
    expect(usePdfDocsStore.getState().docs).toHaveLength(0);
    // 回退编辑器对二进制文件的既有提示路径:toast + 「仍要打开」动作
    const openAnyway = await screen.findByRole('button', { name: '仍要打开' });
    expect(
      screen.getByText(/无法在编辑器中打开「合同\.pdf」/),
    ).toBeInTheDocument();
    openAnyway.click();
  });
});
