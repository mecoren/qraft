/**
 * EditorWorkbench 缩进接线 —— Task 3 (RED 先行)。
 *
 * 契约(默认读设置、Tab 独立、全局变更仅影响未自定义):
 * - resolved = activeTab.indentOverride ?? {全局 insertSpaces/tabSize},
 *   以受控 `indent` 传给 CodeEditor;`hasOverride` 标记覆盖态。
 * - TabA 带 override(制表符)、TabB 跟随(空格):切 Tab 徽章各自正确。
 * - 改全局 tabSize 后仅 B 变化、A 保持制表符。
 * - 用户在 B 上选「制表符」→ 落到 B 的 override;再改全局 B 不动;
 *   经「跟随设置」清除后 B 重新跟随全局。
 *
 * 说明:用真实 CodeEditor 断言状态栏徽章(端到端),Monaco 本体仍是
 * jsdom 垫片,handleMount 永不触发,不断言 Monaco 内部状态。
 * 全程经 Dialog(Modal)交互,无 Radix 非 modal Popover 的 focus 竞态。
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// mock IPC:hydrate 时 config_get 返回空(本文件用 ready:true 预置绕过 hydrate 覆盖),
// persist 静默成功;listen 返回空 unlisten。
vi.mock('@/lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipc')>();
  return { ...actual, safeInvoke: vi.fn(), listen: vi.fn() };
});

// react-resizable-panels 在 jsdom 下与 mock ResizeObserver 同步回调不兼容,
// 渲染静态面板保留 children(与 CodeEditor.test.tsx 同策略)。
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// mock 文件对话框与保存命令(工作台打开/保存链路 import 期即绑定)
vi.mock('./fileOps', () => ({
  openTextFileDialog: vi.fn(),
  saveToPath: vi.fn(),
  saveToPathEncoded: vi.fn(),
  readTextFileChecked: vi.fn(),
  readTextFileEncoded: vi.fn(),
  saveWithDialog: vi.fn(),
  saveWithDialogEncoded: vi.fn(),
  encodeTextToBase64: vi.fn((t: string) => `b64:${t}`),
  windowCloseReady: vi.fn(),
  fileMtimeMs: vi.fn().mockResolvedValue(1234),
  watchOpenFiles: vi.fn().mockResolvedValue(undefined),
  largeFileInfo: vi.fn(),
  readFileLines: vi.fn(),
  forceOpenFile: vi.fn(),
  openFolderDialog: vi.fn(),
  revealInExplorer: vi.fn(),
}));

// mock sonner,避免 toast 在 jsdom 中产生副作用
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// MarkdownEditorPane 依赖 markdown Worker,jsdom 无法加载;本文件只用 .txt Tab,
// 替身仅为模块 import 期安全。
vi.mock('@/tools/markdown-editor-pane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/markdown-editor-pane')>();
  return {
    ...actual,
    MarkdownEditorPane: ({ source }: { source: string }) => (
      <div data-testid="editor-md-preview">{source}</div>
    ),
  };
});

import { safeInvoke } from '@/lib/ipc';
import { EditorWorkbench } from './EditorWorkbench';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import { DEFAULT_WORKSPACE, type EditorTab } from './schema';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const safeInvokeMock = safeInvoke as unknown as Mock;

const TAB_A: EditorTab = {
  id: 'tab-a',
  title: 'a.txt',
  path: null,
  language: 'plaintext',
  content: 'a',
  savedContent: 'a',
  pinned: false,
  indentOverride: { insertSpaces: false, tabSize: 4 },
};

const TAB_B: EditorTab = {
  id: 'tab-b',
  title: 'b.txt',
  path: null,
  language: 'plaintext',
  content: 'b',
  savedContent: 'b',
  pinned: false,
};

function seedWorkspace(activeTabId: string): void {
  useEditorWorkspaceStore.setState({
    // hydrate 幂等:ready=true 时挂载期的 hydrate() 直接返回,不覆盖预置
    workspace: { ...DEFAULT_WORKSPACE, tabs: [TAB_A, TAB_B], activeTabId },
    ready: true,
    userTouched: false,
    error: null,
    recentlyClosed: [],
  });
}

/** 改全局缩进宽度(设置 → 文本编辑器),insertSpaces 保持空格 */
function setGlobalTabSize(tabSize: number): void {
  const current = useConfigStore.getState().config ?? DEFAULT_USER_CONFIG;
  act(() => {
    useConfigStore.setState({
      config: {
        ...current,
        editor: {
          ...current.editor,
          display: { ...current.editor?.display, tabSize },
        },
      },
    });
  });
}

function badgeText(): string {
  return screen.getByTestId('editor-status-indent').textContent ?? '';
}

beforeEach(() => {
  safeInvokeMock.mockReset();
  safeInvokeMock.mockResolvedValue({ ok: true, value: null });
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
});

describe('EditorWorkbench 缩进接线', () => {
  it('TabA(override 制表符)/TabB(跟随空格 2)徽章各自正确', () => {
    seedWorkspace('tab-a');
    render(<EditorWorkbench toolId="text_editor" metadata={null as never} />);
    expect(badgeText()).toBe('制表符');

    act(() => useEditorWorkspaceStore.getState().switchTab('tab-b'));
    expect(badgeText()).toBe('空格:2');
  });

  it('改全局 tabSize 后仅跟随的 B 变化、A 保持制表符', () => {
    seedWorkspace('tab-b');
    render(<EditorWorkbench toolId="text_editor" metadata={null as never} />);
    expect(badgeText()).toBe('空格:2');

    setGlobalTabSize(4);
    expect(badgeText()).toBe('空格:4');

    act(() => useEditorWorkspaceStore.getState().switchTab('tab-a'));
    expect(badgeText()).toBe('制表符');
  });

  it('B 上选制表符落为 override(再改全局不动),跟随设置清除后重新跟随', async () => {
    seedWorkspace('tab-b');
    render(<EditorWorkbench toolId="text_editor" metadata={null as never} />);
    expect(badgeText()).toBe('空格:2');

    // 用户经缩进菜单切制表符 → 写到 B 的 override
    fireEvent.click(screen.getByTestId('editor-status-indent'));
    fireEvent.click(await screen.findByTestId('editor-indent-picker-use-tabs'));
    expect(useEditorWorkspaceStore.getState().workspace.tabs[1]?.indentOverride).toEqual({
      insertSpaces: false,
      tabSize: 2,
    });
    expect(badgeText()).toBe('制表符');

    // 全局改到 8:已自定义的 B 不动
    setGlobalTabSize(8);
    expect(badgeText()).toBe('制表符');

    // 「跟随设置」清除 override → B 重新跟随全局(空格 8)
    fireEvent.click(screen.getByTestId('editor-status-indent'));
    const follow = await screen.findByTestId('editor-indent-picker-follow');
    expect(follow).toHaveTextContent('空格:8');
    fireEvent.click(follow);
    expect(useEditorWorkspaceStore.getState().workspace.tabs[1]?.indentOverride).toBeUndefined();
    expect(badgeText()).toBe('空格:8');
  });
});
