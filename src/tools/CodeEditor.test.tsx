import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

// CodeEditor 内嵌 Monaco,jsdom 无法加载,替换为 textarea 替身。
// 暴露 value / onChange / title / language / minimap / fixedTheme / statusBarRight,
// 便于断言工作区是否正确地把 props 传给编辑器。
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    title,
    header,
    statusBarRight,
    minimap,
    language,
    fixedTheme,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    title?: string;
    header?: React.ReactNode;
    statusBarRight?: React.ReactNode;
    minimap?: boolean;
    language?: string;
    fixedTheme?: string;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      <div>
        {header ? (
          <div data-testid={testId ? `${testId}-header` : undefined}>{header}</div>
        ) : (
          title && <span data-testid={testId ? `${testId}-title` : undefined}>{title}</span>
        )}
      </div>
      <span data-testid={testId ? `${testId}-language` : undefined}>{language}</span>
      {fixedTheme && (
        <span data-testid={testId ? `${testId}-fixed-theme` : undefined}>{fixedTheme}</span>
      )}
      {minimap && <span data-testid={testId ? `${testId}-minimap` : undefined}>minimap</span>}
      <textarea
        data-testid={testId ? `${testId}-textarea` : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {statusBarRight && (
        <div data-testid={testId ? `${testId}-status-right` : undefined}>{statusBarRight}</div>
      )}
    </div>
  ),
}));

// mock IPC:hydrate 时 config_get 返回空,persist 静默成功;
// listen 用于窗口关闭事件(仅 Tauri 环境启用,测试默认不触发)
vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(),
  listen: vi.fn(),
}));

// react-resizable-panels 在 jsdom 下依赖 ResizeObserver 内部布局与拖动测量,
// 与 jsdom 的 mock ResizeObserver 同步回调不兼容(会导致面板内容挂载竞态)。
// 渲染静态面板以保留 children,业务逻辑(分栏结构/面板内容)不受影响。
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// mock 文件对话框与保存命令(含窗口关闭守卫)
vi.mock('./code-editor-workspace/fileOps', () => ({
  openTextFileDialog: vi.fn(),
  saveToPath: vi.fn(),
  saveToPathEncoded: vi.fn(),
  readTextFileChecked: vi.fn(),
  readTextFileEncoded: vi.fn(),
  saveWithDialog: vi.fn(),
  encodeTextToBase64: vi.fn((t: string) => `b64:${t}`),
  windowCloseReady: vi.fn(),
}));

// mock sonner,避免 toast 在 jsdom 中产生副作用
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import userEvent from '@testing-library/user-event';
import { listen, safeInvoke } from '@/lib/ipc';
import { CodeEditorTool } from './CodeEditor';
import { useEditorWorkspaceStore } from './code-editor-workspace/useEditorWorkspaceStore';
import { ToolMenuBar } from '@/components/layout/ToolMenuBar';
import {
  openTextFileDialog,
  saveToPathEncoded,
  saveWithDialog,
} from './code-editor-workspace/fileOps';
import { DEFAULT_WORKSPACE } from './code-editor-workspace/schema';

const safeInvokeMock = safeInvoke as unknown as Mock;

beforeEach(() => {
  safeInvokeMock.mockReset();
  // config_get 返回空工作区
  safeInvokeMock.mockResolvedValue({ ok: true, value: null });
  useEditorWorkspaceStore.setState({
    workspace: { ...DEFAULT_WORKSPACE },
    ready: false,
    userTouched: false,
    error: null,
  });
  (openTextFileDialog as unknown as Mock).mockReset();
  (saveToPathEncoded as unknown as Mock).mockReset();
  (saveWithDialog as unknown as Mock).mockReset();
  (listen as unknown as Mock).mockReset();
  (listen as unknown as Mock).mockResolvedValue(() => {});
});

/**
 * 测试包装器 —— 模拟生产环境的 AppShell:
 * - 顶部 header 容纳 Titlebar 中的菜单栏区域(ToolMenuBar)
 * - 下方渲染 CodeEditorTool,使其挂载并通过 useToolMenus 注册菜单
 *
 * 之所以需要这个包装:菜单栏从原编辑器内工具栏迁移到 Titlebar,
 * 测试必须同时挂载菜单栏所在位置(注册菜单的 store 才会填充数据)
 * 与工具组件,否则 `getByTestId('tool-menubar-trigger-file')` 无法找到元素。
 */
function ToolWorkspaceShell(): React.JSX.Element {
  return (
    <div>
      <header data-testid="titlebar">
        <ToolMenuBar />
      </header>
      <CodeEditorTool toolId="text_editor" metadata={null as never} />
    </div>
  );
}

const renderTool = (): void => {
  render(<ToolWorkspaceShell />);
};

/**
 * 编辑器工具栏已迁移到 Titlebar 菜单栏(File / View 菜单),
 * 测试需要先打开顶级菜单触发器,再点击具体菜单项。
 * - 工具栏项默认在 '文件' 菜单下(testId: toolbar-*)
 * - 切换左栏项在 '视图' 菜单下(testId: toolbar-toggle-sidebar)
 *
 * 关键实现细节:
 * - Radix Menubar 的 Trigger 用 pointer 事件监听点击;jsdom 中 fireEvent.click()
 *   不会触发表单 click → mousedown 序列,菜单不会展开。必须用 userEvent.click()
 *   才能完整模拟 pointerdown + mousedown + pointerup + click,触发 Radix 状态机
 * - 菜单 Content 通过 Portal 渲染到 document.body;getByTestId 默认查找整个 DOM,
 *   无需指定 container
 */
const user = userEvent.setup();
async function clickMenubarItem(menu: 'file' | 'view', testId: string): Promise<void> {
  await user.click(screen.getByTestId(`tool-menubar-trigger-${menu}`));
  // Portal 渲染后,菜单项出现在 document.body 末尾;user.click 会等待元素可交互
  await user.click(await screen.findByTestId(testId));
}

const clickToolbarItem = (testId: string): Promise<void> => {
  // 默认归属 '文件' 菜单;view 菜单的项由调用方显式指定
  if (testId === 'toolbar-toggle-sidebar') {
    return clickMenubarItem('view', testId);
  }
  return clickMenubarItem('file', testId);
};

describe('CodeEditorTool workspace', () => {
  it('shows empty state with open/new actions when no tabs', async () => {
    renderTool();
    expect(await screen.findByTestId('editor-empty')).toBeInTheDocument();
    expect(screen.getByTestId('empty-open')).toBeInTheDocument();
    expect(screen.getByTestId('empty-new')).toBeInTheDocument();
  });

  it('creates an untitled tab when clicking 新建', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');

    // untitled-1 Tab 出现在 Tab 栏与左栏
    expect(screen.getByTestId('editor-tabs-tab-untitled-1')).toBeInTheDocument();
    expect(screen.getByTestId('editor-sidebar-item-untitled-1')).toBeInTheDocument();
    expect(screen.getByTestId('editor-title').textContent).toBe('untitled-1');
  });

  it('opens a local file and infers language from extension', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: 'C:\\work\\app.json',
      content: '{"a":1}',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');

    // 本地文件:编辑器左上角用面包屑(header)展示路径,末段为文件名
    await waitFor(() => {
      expect(screen.getByTestId('editor-header')).toHaveTextContent('app.json');
    });
    // 扩展名 .json → json 语言
    expect(screen.getByTestId('editor-language').textContent).toBe('json');
    expect(screen.getByTestId('editor-textarea')).toHaveValue('{"a":1}');
    // 左栏与 Tab 栏同步出现
    expect(screen.getByTestId('editor-sidebar-item-app.json')).toBeInTheDocument();
  });

  it('does not duplicate a tab when the same file is opened twice', async () => {
    const file = { path: '/x.json', content: '{}' };
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce(file);
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce(file);
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    // 标题为路径面包屑(末段文件名)
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('x.json'));
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getAllByTestId(/editor-tabs-tab-/)).toHaveLength(1));
  });

  it('marks a tab dirty after editing and clears on save', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/a.txt',
      content: 'hello',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('a.txt'));

    // 编辑 → dirty 圆点出现
    fireEvent.change(screen.getByTestId('editor-textarea'), {
      target: { value: 'hello world' },
    });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-a.txt')).toBeInTheDocument());

    // 保存 → dirty 消失
    (saveToPathEncoded as unknown as Mock).mockResolvedValueOnce(true);
    await clickToolbarItem('toolbar-save');
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-dirty-a.txt')).toBeNull());
    expect(saveToPathEncoded).toHaveBeenCalledWith('/a.txt', 'hello world', 'utf-8');
  });

  it('switches tabs and closes via the tabs bar close button', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-2')).toBeInTheDocument(),
    );

    // 切回 untitled-1
    fireEvent.click(screen.getByTestId('editor-tabs-tab-untitled-1'));
    await waitFor(() => expect(screen.getByTestId('editor-title').textContent).toBe('untitled-1'));

    // 关闭 untitled-2 → 从 Tab 栏与左栏消失
    fireEvent.click(screen.getByTestId('editor-tabs-close-untitled-2'));
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-tab-untitled-2')).toBeNull());
    expect(screen.queryByTestId('editor-sidebar-item-untitled-2')).toBeNull();
  });

  it('closes a tab via middle-click on the tab', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-2')).toBeInTheDocument(),
    );

    // 在 untitled-1 上按下中键(button=1)→ 关闭该 Tab,且不触发选中切换
    fireEvent.mouseDown(screen.getByTestId('editor-tabs-tab-untitled-1'), { button: 1 });
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-tab-untitled-1')).toBeNull());
    expect(screen.queryByTestId('editor-sidebar-item-untitled-1')).toBeNull();
    // 关闭的是中键点击的那个 Tab,另一个仍保留
    expect(screen.getByTestId('editor-tabs-tab-untitled-2')).toBeInTheDocument();
  });

  it('does not close on left-click of the tab (only switches)', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-2')).toBeInTheDocument(),
    );

    // 左键按下(mousedown button=0)→ 仅选中,不关闭
    fireEvent.mouseDown(screen.getByTestId('editor-tabs-tab-untitled-1'), { button: 0 });
    expect(screen.getByTestId('editor-tabs-tab-untitled-1')).toBeInTheDocument();
  });

  it('closes all tabs via toolbar action', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-2')).toBeInTheDocument(),
    );

    await clickToolbarItem('toolbar-close-all');
    await waitFor(() => expect(screen.getByTestId('editor-empty')).toBeInTheDocument());
    expect(screen.getByTestId('editor-tabs-empty')).toBeInTheDocument();
  });

  it('closes a clean tab via the sidebar close icon', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-1')).toBeInTheDocument(),
    );

    // 左栏 hover 图标切换为关闭按钮,点击直接关闭(无未保存)
    fireEvent.click(screen.getByTestId('editor-sidebar-close-untitled-1'));
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-tab-untitled-1')).toBeNull());
    expect(screen.queryByTestId('editor-sidebar-item-untitled-1')).toBeNull();
  });

  it('collapses and expands the file list by clicking the sidebar header', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-1')).toBeInTheDocument(),
    );

    // 点击标题区 → 折叠(列表隐藏)
    fireEvent.click(screen.getByTestId('editor-sidebar-header'));
    await waitFor(() => expect(screen.queryByTestId('editor-sidebar-item-untitled-1')).toBeNull());

    // 再次点击标题区 → 展开(列表恢复)
    fireEvent.click(screen.getByTestId('editor-sidebar-header'));
    await waitFor(() =>
      expect(screen.getByTestId('editor-sidebar-item-untitled-1')).toBeInTheDocument(),
    );
  });

  it('creates a new tab via the sidebar header action button', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');

    // 空列表时标题区动作按钮直接可见(无列表项可悬浮)
    const newBtn = screen.getByTestId('editor-sidebar-action-new');
    await waitFor(() => expect(newBtn).toBeInTheDocument());
    fireEvent.click(newBtn);

    await waitFor(() =>
      expect(screen.getByTestId('editor-tabs-tab-untitled-1')).toBeInTheDocument(),
    );
  });

  it('saves all dirty tabs via the sidebar header action button', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/a.txt',
      content: 'a',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('a.txt'));

    // 编辑 → dirty
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'a!' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-a.txt')).toBeInTheDocument());

    // 悬浮列表项(文件名),标题区动作按钮显示,点击全部保存
    fireEvent.mouseEnter(screen.getByTestId('editor-sidebar-item-a.txt'));
    fireEvent.click(screen.getByTestId('editor-sidebar-action-save-all'));

    await waitFor(() => expect(saveToPathEncoded).toHaveBeenCalledWith('/a.txt', 'a!', 'utf-8'));
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-dirty-a.txt')).toBeNull());
  });

  it('prompts before closing a dirty tab via the sidebar close icon', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/s.txt',
      content: 'hello',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('s.txt'));

    // 编辑 → dirty
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'hello!' } });
    await waitFor(() =>
      expect(screen.getByTestId('editor-sidebar-dirty-s.txt')).toBeInTheDocument(),
    );

    // 左栏关闭 → 弹未保存确认 → 取消 → Tab 保留
    fireEvent.click(screen.getByTestId('editor-sidebar-close-s.txt'));
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('unsaved-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-dialog')).toBeNull());
    expect(screen.getByTestId('editor-tabs-tab-s.txt')).toBeInTheDocument();
  });

  it('toggles the left sidebar visibility', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    // 左栏可见:菜单项文案随左栏状态变化
    expect(screen.getByTestId('editor-sidebar')).toBeInTheDocument();
    // 打开「视图」菜单以检查 toggle 项目文案
    await user.click(screen.getByTestId('tool-menubar-trigger-view'));
    expect(screen.getByTestId('toolbar-toggle-sidebar')).toHaveTextContent('隐藏左栏');
    // 关闭菜单以便下一次打开
    await user.keyboard('{Escape}');

    // 点击 → 左栏收起(store 状态翻转,菜单项文案变「显示左栏」)
    await clickToolbarItem('toolbar-toggle-sidebar');
    await user.click(screen.getByTestId('tool-menubar-trigger-view'));
    expect(screen.getByTestId('toolbar-toggle-sidebar')).toHaveTextContent('显示左栏');
    await user.keyboard('{Escape}');

    // 再点 → 展开
    await clickToolbarItem('toolbar-toggle-sidebar');
    await user.click(screen.getByTestId('tool-menubar-trigger-view'));
    expect(screen.getByTestId('toolbar-toggle-sidebar')).toHaveTextContent('隐藏左栏');
  });

  it('persists the workspace via config_set after hydrate', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await waitFor(() => expect(screen.getByTestId('editor-title').textContent).toBe('untitled-1'));

    // 防抖 400ms 后 persist
    await waitFor(
      () => {
        expect(safeInvokeMock).toHaveBeenCalledWith('config_set', expect.anything());
      },
      { timeout: 1000 },
    );
    const persistCall = safeInvokeMock.mock.calls.find((c) => c[0] === 'config_set');
    expect(persistCall?.[1].key).toBe('tool_prefs.editor_workspace_v1');
  });

  it('restores persisted workspace on mount', async () => {
    safeInvokeMock.mockReset();
    // config_get 返回已保存的工作区;config_set 静默成功
    safeInvokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'config_get') {
        return {
          ok: true,
          value: {
            tabs: [
              {
                id: 't1',
                title: 'resume.md',
                path: '/resume.md',
                language: 'markdown',
                content: '# title',
                savedContent: '# title',
              },
            ],
            activeTabId: 't1',
            leftSidebarVisible: true,
          },
        };
      }
      return { ok: true, value: true };
    });
    renderTool();

    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('resume.md'));
    expect(screen.getByTestId('editor-language').textContent).toBe('markdown');
    expect(screen.getByTestId('editor-tabs-tab-resume.md')).toBeInTheDocument();
  });

  it('follows the app palette without locking a fixed editor theme', async () => {
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-new');
    await waitFor(() => expect(screen.getByTestId('editor-title').textContent).toBe('untitled-1'));
    // 不再传 fixedTheme:编辑器颜色跟随应用 data-palette 亮/暗切换
    expect(screen.queryByTestId('editor-fixed-theme')).toBeNull();
    expect(screen.getByTestId('editor-minimap')).toBeInTheDocument();
  });

  it('prompts before closing a dirty tab and keeps it on cancel', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/b.txt',
      content: 'hi',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('b.txt'));

    // 编辑 → dirty
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'hi!' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-b.txt')).toBeInTheDocument());

    // 关闭 → 弹未保存确认
    fireEvent.click(screen.getByTestId('editor-tabs-close-b.txt'));
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    expect(screen.getByText(/是否保存对 "b\.txt" 的更改\?/)).toBeInTheDocument();

    // 取消 → Tab 保留,dirty 保留
    fireEvent.click(screen.getByTestId('unsaved-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-dialog')).toBeNull());
    expect(screen.getByTestId('editor-tabs-tab-b.txt')).toBeInTheDocument();
    expect(screen.getByTestId('editor-tabs-dirty-b.txt')).toBeInTheDocument();
  });

  it('closes a dirty tab after confirming discard', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/b.txt',
      content: 'hi',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('b.txt'));

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'hi!' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-b.txt')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('editor-tabs-close-b.txt'));
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('unsaved-dialog-discard'));

    await waitFor(() => expect(screen.queryByTestId('editor-tabs-tab-b.txt')).toBeNull());
    expect(screen.getByTestId('editor-empty')).toBeInTheDocument();
  });

  it('saves and closes a dirty tab via the confirm dialog', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/c.txt',
      content: 'x',
    });
    (saveToPathEncoded as unknown as Mock).mockResolvedValueOnce(true);
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('c.txt'));

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'xx' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-c.txt')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('editor-tabs-close-c.txt'));
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('unsaved-dialog-save'));

    await waitFor(() => expect(saveToPathEncoded).toHaveBeenCalledWith('/c.txt', 'xx', 'utf-8'));
    await waitFor(() => expect(screen.queryByTestId('editor-tabs-tab-c.txt')).toBeNull());
  });

  it('prompts before closing all tabs when any tab is dirty', async () => {
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/d.txt',
      content: 'z',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('d.txt'));

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'zz' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-d.txt')).toBeInTheDocument());

    // 全部关闭 → 弹确认 → 取消 → Tab 保留
    await clickToolbarItem('toolbar-close-all');
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('unsaved-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-dialog')).toBeNull());
    expect(screen.getByTestId('editor-tabs-tab-d.txt')).toBeInTheDocument();

    // 再次全部关闭 → 确认全部不保存 → 清空
    await clickToolbarItem('toolbar-close-all');
    await waitFor(() => expect(screen.getByTestId('unsaved-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('unsaved-dialog-discard'));
    await waitFor(() => expect(screen.getByTestId('editor-empty')).toBeInTheDocument());
  });

  it('flushes the workspace cache and quits the app without prompting, even with unsaved changes', async () => {
    // 模拟 Tauri 运行时(仅本测试)
    const hadInternals = Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
    const prevInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

    // 捕获 app:close-requested 事件 handler,模拟 Rust 端拦截窗口关闭
    let closeHandler: (() => void) | undefined;
    (listen as unknown as Mock).mockImplementation((event: string, handler: () => void) => {
      if (event === 'app:close-requested') closeHandler = handler;
      return Promise.resolve(() => {});
    });

    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/q.txt',
      content: 'q',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('q.txt'));

    // 标记一份未保存内容(打破 savedContent)
    safeInvokeMock.mockClear();
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'qq' } });
    await waitFor(() => expect(screen.getByTestId('editor-tabs-dirty-q.txt')).toBeInTheDocument());

    // 等待防抖窗结束后,一次 config_set 已被排期
    await waitFor(
      () => {
        const setCalls = safeInvokeMock.mock.calls.filter((c) => c[0] === 'config_set');
        expect(setCalls.length).toBeGreaterThan(0);
      },
      { timeout: 1000 },
    );

    // 触发窗口关闭事件 → 不应弹确认框,直接冲刷缓存并退出
    safeInvokeMock.mockClear();
    await act(async () => {
      await closeHandler?.();
    });
    // 没有未保存对话框
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    // 退出前立即调用了一次 config_set 冲刷(即使原本尚未到防抖窗口)
    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenCalledWith('config_set', expect.anything()),
    );
    const flushCall = safeInvokeMock.mock.calls.find((c) => c[0] === 'config_set');
    expect(flushCall?.[1].key).toBe('tool_prefs.editor_workspace_v1');
    expect(flushCall?.[1].value.tabs[0].content).toBe('qq');
    // 最后调用 app_quit
    await waitFor(() => expect(safeInvokeMock).toHaveBeenCalledWith('app_quit'));

    // 清理 Tauri 模拟
    if (hadInternals) {
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: prevInternals,
        configurable: true,
      });
    } else {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('quits directly when closing the window without unsaved changes', async () => {
    const hadInternals = Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
    const prevInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

    let closeHandler: (() => void) | undefined;
    (listen as unknown as Mock).mockImplementation((event: string, handler: () => void) => {
      if (event === 'app:close-requested') closeHandler = handler;
      return Promise.resolve(() => {});
    });

    // 打开一个未编辑文件(无 dirty)
    (openTextFileDialog as unknown as Mock).mockResolvedValueOnce({
      path: '/clean.txt',
      content: 'clean',
    });
    renderTool();
    await screen.findByTestId('editor-empty');
    await clickToolbarItem('toolbar-open');
    await waitFor(() => expect(screen.getByTestId('editor-header')).toHaveTextContent('clean.txt'));

    // 触发窗口关闭 → 无未保存 → 直接退出,不弹确认
    await act(async () => {
      await closeHandler?.();
    });
    await waitFor(() => expect(safeInvokeMock).toHaveBeenCalledWith('app_quit'));
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();

    if (hadInternals) {
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: prevInternals,
        configurable: true,
      });
    } else {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
