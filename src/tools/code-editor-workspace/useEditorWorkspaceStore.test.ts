import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useEditorWorkspaceStore,
  folderNameFromPath,
} from './useEditorWorkspaceStore';
import { DEFAULT_WORKSPACE, WORKSPACE_CONFIG_KEY } from './schema';

// mock IPC 层:store 的 hydrate/persist 通过 safeInvoke 走 config_get/config_set
vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(),
}));

import { safeInvoke } from '@/lib/ipc';
const safeInvokeMock = safeInvoke as unknown as ReturnType<typeof vi.fn>;

function resetStore(): void {
  useEditorWorkspaceStore.setState({
    workspace: { ...DEFAULT_WORKSPACE, tabs: [], activeTabId: null, leftSidebarVisible: true },
    ready: false,
    userTouched: false,
    error: null,
  });
}

beforeEach(() => {
  safeInvokeMock.mockReset();
  resetStore();
});

describe('useEditorWorkspaceStore.hydrate', () => {
  it('restores workspace from config_get when data exists', async () => {
    const saved = {
      tabs: [
        {
          id: 't1',
          title: 'a.json',
          path: '/a.json',
          language: 'json',
          content: '{"a":1}',
          savedContent: '{"a":1}',
        },
      ],
      activeTabId: 't1',
      leftSidebarVisible: false,
    };
    safeInvokeMock.mockResolvedValueOnce({ ok: true, value: saved });

    await useEditorWorkspaceStore.getState().hydrate();

    const s = useEditorWorkspaceStore.getState();
    expect(s.ready).toBe(true);
    expect(s.workspace.tabs).toHaveLength(1);
    expect(s.workspace.tabs[0].title).toBe('a.json');
    expect(s.workspace.activeTabId).toBe('t1');
    expect(s.workspace.leftSidebarVisible).toBe(false);
    expect(safeInvokeMock).toHaveBeenCalledWith('config_get', { key: WORKSPACE_CONFIG_KEY });
  });

  it('falls back to empty workspace when config_get returns null', async () => {
    safeInvokeMock.mockResolvedValueOnce({ ok: true, value: null });
    await useEditorWorkspaceStore.getState().hydrate();
    const s = useEditorWorkspaceStore.getState();
    expect(s.ready).toBe(true);
    expect(s.workspace.tabs).toEqual([]);
    expect(s.workspace.activeTabId).toBeNull();
  });

  it('handles malformed workspace data without crashing', async () => {
    safeInvokeMock.mockResolvedValueOnce({
      ok: true,
      value: { tabs: [{ id: 'x', title: 42 }], activeTabId: 'nope' },
    });
    await useEditorWorkspaceStore.getState().hydrate();
    const s = useEditorWorkspaceStore.getState();
    // 非法 title(数字)被过滤掉,activeTabId 不存在的值被置 null
    expect(s.workspace.tabs).toEqual([]);
    expect(s.workspace.activeTabId).toBeNull();
    expect(s.ready).toBe(true);
  });

  it('preserves user actions (e.g. closeAllTabs) taken before hydrate finishes', async () => {
    const saved = {
      tabs: [
        {
          id: 't1',
          title: 'old.txt',
          path: '/old.txt',
          language: 'plaintext',
          content: 'old',
          savedContent: 'old',
        },
      ],
      activeTabId: 't1',
      leftSidebarVisible: true,
    };
    safeInvokeMock.mockResolvedValueOnce({ ok: true, value: saved });

    // 用户先全部关闭(清空工作区),再触发 hydrate
    useEditorWorkspaceStore.getState().closeAllTabs();
    await useEditorWorkspaceStore.getState().hydrate();

    const s = useEditorWorkspaceStore.getState();
    // 用户意图(空工作区)被保留,不会被持久化数据覆盖
    expect(s.workspace.tabs).toEqual([]);
    expect(s.workspace.activeTabId).toBeNull();
    expect(s.ready).toBe(true);
  });

  it('is a no-op after already hydrated', async () => {
    useEditorWorkspaceStore.setState({ ready: true });
    await useEditorWorkspaceStore.getState().hydrate();
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});

describe('useEditorWorkspaceStore.openLocalFile', () => {
  it('opens a new file with inferred language and marks it active', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openLocalFile('/project/readme.md', '# hello');

    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(1);
    const tab = state.workspace.tabs[0];
    expect(tab.title).toBe('readme.md');
    expect(tab.path).toBe('/project/readme.md');
    expect(tab.language).toBe('markdown');
    expect(tab.content).toBe('# hello');
    expect(tab.savedContent).toBe('# hello');
    expect(state.workspace.activeTabId).toBe(tab.id);
  });

  it('activates an existing tab when the same path is opened again', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openLocalFile('/a.json', '{"a":1}');
    const firstId = useEditorWorkspaceStore.getState().workspace.tabs[0].id;
    // 打开另一个文件,再打开同路径
    s.openLocalFile('/b.json', '{}');
    s.openLocalFile('/a.json', '{"a":1}');

    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(2);
    expect(state.workspace.activeTabId).toBe(firstId);
  });
});

describe('useEditorWorkspaceStore.openDroppedText', () => {
  it('opens dropped content as an unbound tab with the file name', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openDroppedText('notes.md', '# dropped');

    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(1);
    const tab = state.workspace.tabs[0];
    expect(tab.title).toBe('notes.md');
    expect(tab.path).toBeNull();
    expect(tab.language).toBe('markdown');
    expect(tab.content).toBe('# dropped');
    // 无路径快照:视为未保存,提示用户另存为
    expect(tab.savedContent).toBe('');
    expect(state.workspace.activeTabId).toBe(tab.id);
  });

  it('reactivates the same-named unbound tab instead of duplicating', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openDroppedText('a.txt', 'first');
    const firstId = useEditorWorkspaceStore.getState().workspace.tabs[0].id;
    // 再次拖入同名文件:激活已存在的 Tab
    s.openDroppedText('a.txt', 'second');

    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(1);
    expect(state.workspace.activeTabId).toBe(firstId);
  });
});

describe('useEditorWorkspaceStore.newBlankTab', () => {
  it('creates untitled tabs with increasing sequence', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(2);
    expect(state.workspace.tabs[0].title).toBe('untitled-1');
    expect(state.workspace.tabs[1].title).toBe('untitled-2');
    expect(state.workspace.tabs[1].path).toBeNull();
    expect(state.workspace.activeTabId).toBe(state.workspace.tabs[1].id);
  });

  it('skips to the next free sequence when untitled titles already exist', () => {
    // 模拟重启后从持久化还原出的 tabs,已有 untitled-1 / untitled-3
    useEditorWorkspaceStore.setState({
      ready: true,
      workspace: {
        tabs: [
          {
            id: 'a',
            title: 'untitled-1',
            path: null,
            language: 'plaintext',
            content: '',
            savedContent: '',
            pinned: false,
          },
          {
            id: 'b',
            title: 'untitled-3',
            path: null,
            language: 'plaintext',
            content: '',
            savedContent: '',
            pinned: false,
          },
        ],
        activeTabId: 'a',
        leftSidebarVisible: true,
        sidebarWidth: 288,
        folders: [],
        expandedDirs: [],
      },
    });
    useEditorWorkspaceStore.getState().newBlankTab();

    const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
    expect(tabs.map((t) => t.title)).toEqual(['untitled-1', 'untitled-3', 'untitled-4']);
  });
});

describe('useEditorWorkspaceStore.closeTab', () => {
  it('moves activation to the right neighbor when closing active tab', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2 (active)
    s.newBlankTab(); // t3 (active)
    const t2 = useEditorWorkspaceStore.getState().workspace.tabs[1];
    s.switchTab(t2.id);

    s.closeTab(t2.id);
    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs).toHaveLength(2);
    // 右邻 t3 成为激活
    expect(state.workspace.activeTabId).toBe(state.workspace.tabs[1].id);
  });

  it('falls back to left neighbor when closing the last tab', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    const last = useEditorWorkspaceStore.getState().workspace.tabs[1];
    s.closeTab(last.id);
    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.activeTabId).toBe(state.workspace.tabs[0].id);
  });

  it('sets activeTabId to null when closing the only tab', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const only = useEditorWorkspaceStore.getState().workspace.tabs[0];
    s.closeTab(only.id);
    expect(useEditorWorkspaceStore.getState().workspace.activeTabId).toBeNull();
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toEqual([]);
  });
});

describe('useEditorWorkspaceStore content & dirty', () => {
  it('setTabContent updates content but keeps savedContent (dirty)', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

    s.setTabContent(id, 'hello');
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((t) => t.id === id)!;
    expect(tab.content).toBe('hello');
    expect(tab.savedContent).toBe('');
  });

  describe('untitled tab title derived from content', () => {
    it('uses the first non-empty line of typed text as the title', () => {
      const s = useEditorWorkspaceStore.getState();
      s.newBlankTab();
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      s.setTabContent(id, '\n  \nhello world\nsecond line');
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      // 跳过开头空行,取首个非空行(参考 VSCode 未命名缓冲区的命名建议)
      expect(tab.title).toBe('hello world');
      // 原始自动名保留在 autoTitle
      expect(tab.autoTitle).toBe('untitled-1');
    });

    it('truncates a long first line with an ellipsis', () => {
      const s = useEditorWorkspaceStore.getState();
      s.newBlankTab();
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      const longLine = 'a'.repeat(40);
      s.setTabContent(id, longLine);
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      expect(tab.title).toBe(`${'a'.repeat(32)}…`);
    });

    it('falls back to the original auto name when content is cleared', () => {
      const s = useEditorWorkspaceStore.getState();
      s.newBlankTab();
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      s.setTabContent(id, 'temporary');
      s.setTabContent(id, '');
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      expect(tab.title).toBe('untitled-1');
    });

    it('does not rename tabs bound to a file path', () => {
      const s = useEditorWorkspaceStore.getState();
      s.openLocalFile('/dev/app.ts', 'const x = 1');
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      s.setTabContent(id, 'const y = 2');
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      expect(tab.title).toBe('app.ts');
      expect(tab.autoTitle).toBeUndefined();
    });

    it('does not rename dropped-text tabs that already have a title', () => {
      const s = useEditorWorkspaceStore.getState();
      s.openDroppedText('snippet.txt', '');
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      s.setTabContent(id, 'pasted body');
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      expect(tab.title).toBe('snippet.txt');
    });

    it('stops deriving after the tab is saved to a path', () => {
      const s = useEditorWorkspaceStore.getState();
      s.newBlankTab();
      const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

      s.setTabContent(id, 'draft line');
      s.markSaved(id, '/notes/draft line.md');
      s.setTabContent(id, 'new content');

      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
      expect(tab.title).toBe('draft line.md');
    });

    it('keeps untitled numbering unique after content-derived renames', () => {
      const s = useEditorWorkspaceStore.getState();
      s.newBlankTab();
      const firstId = useEditorWorkspaceStore.getState().workspace.activeTabId as string;
      s.setTabContent(firstId, 'my notes');

      // untitled-1 已改名为 my notes:新 Tab 序号应基于 autoTitle 继续递增
      s.newBlankTab();
      const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
      expect(tabs.map((t) => t.title)).toEqual(['my notes', 'untitled-2']);
    });
  });

  it('markSaved binds path and clears dirty', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;
    s.setTabContent(id, 'hello');
    s.markSaved(id, '/saved/untitled-1.txt');

    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
    expect(tab.path).toBe('/saved/untitled-1.txt');
    expect(tab.savedContent).toBe('hello');
    expect(tab.title).toBe('untitled-1.txt');
  });

  it('markSaved re-infers language when path changes (save as .py)', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;
    s.setTabContent(id, 'print(1)');
    s.markSaved(id, '/saved/app.py');

    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
    expect(tab.path).toBe('/saved/app.py');
    expect(tab.language).toBe('python');
  });

  it('markSaved keeps language when re-saving to the same path', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openLocalFile('/app.ts', 'const x = 1');
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;
    // 用户手动改语言后覆盖保存:语言应保留用户选择
    s.setTabLanguage(id, 'javascript');
    s.markSaved(id, '/app.ts');

    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
    expect(tab.language).toBe('javascript');
  });

  it('setTabLanguage updates the language', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;
    s.setTabLanguage(id, 'json');
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!;
    expect(tab.language).toBe('json');
  });
});

describe('useEditorWorkspaceStore.closeAllTabs & toggle', () => {
  it('closeAllTabs empties the workspace', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    s.closeAllTabs();
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toEqual([]);
    expect(useEditorWorkspaceStore.getState().workspace.activeTabId).toBeNull();
  });

  it('toggleLeftSidebar flips visibility', () => {
    useEditorWorkspaceStore.getState().toggleLeftSidebar();
    expect(useEditorWorkspaceStore.getState().workspace.leftSidebarVisible).toBe(false);
    useEditorWorkspaceStore.getState().toggleLeftSidebar();
    expect(useEditorWorkspaceStore.getState().workspace.leftSidebarVisible).toBe(true);
  });

  it('setSidebarWidth updates and persists the left panel width', () => {
    useEditorWorkspaceStore.setState({ ready: true });
    useEditorWorkspaceStore.getState().setSidebarWidth(360);
    expect(useEditorWorkspaceStore.getState().workspace.sidebarWidth).toBe(360);
    expect(useEditorWorkspaceStore.getState().userTouched).toBe(true);
  });
});

describe('useEditorWorkspaceStore.pinned tabs', () => {
  it('hydrates legacy data without pinned field to pinned=false', async () => {
    const saved = {
      tabs: [
        {
          id: 't1',
          title: 'a.txt',
          path: '/a.txt',
          language: 'plaintext',
          content: 'x',
          savedContent: 'x',
        },
      ],
      activeTabId: 't1',
      leftSidebarVisible: true,
    };
    safeInvokeMock.mockResolvedValueOnce({ ok: true, value: saved });
    await useEditorWorkspaceStore.getState().hydrate();
    expect(useEditorWorkspaceStore.getState().workspace.tabs[0].pinned).toBe(false);
  });

  it('togglePinTab flips the pinned state', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    const id = useEditorWorkspaceStore.getState().workspace.activeTabId as string;

    useEditorWorkspaceStore.getState().togglePinTab(id);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!.pinned).toBe(
      true,
    );

    useEditorWorkspaceStore.getState().togglePinTab(id);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id)!.pinned).toBe(
      false,
    );
  });

  it('closeOtherTabs closes all unpinned tabs except the target', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().togglePinTab(tabs[0].id);

    useEditorWorkspaceStore.getState().closeOtherTabs(tabs[1].id);
    const remaining = useEditorWorkspaceStore.getState().workspace.tabs;
    // t0 固定保留,t1 为被保留目标,t2 被关闭
    expect(remaining.map((t) => t.id).sort()).toEqual([tabs[0].id, tabs[1].id].sort());
  });

  it('closeRightTabs closes tabs to the right, keeping pinned ones', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().togglePinTab(tabs[2].id);

    useEditorWorkspaceStore.getState().closeRightTabs(tabs[0].id);
    const remaining = useEditorWorkspaceStore.getState().workspace.tabs;
    // t0 保留,t1 被关闭,t2 固定保留
    expect(remaining.map((t) => t.id).sort()).toEqual([tabs[0].id, tabs[2].id].sort());
  });

  it('closeSavedTabs closes only clean unpinned tabs', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0 clean
    s.newBlankTab(); // t1
    const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().setTabContent(tabs[1].id, 'dirty');
    useEditorWorkspaceStore.getState().togglePinTab(tabs[0].id);

    useEditorWorkspaceStore.getState().closeSavedTabs();
    const remaining = useEditorWorkspaceStore.getState().workspace.tabs;
    // t0 固定保留,t1 dirty 保留
    expect(remaining.map((t) => t.id).sort()).toEqual([tabs[0].id, tabs[1].id].sort());
  });

  it('closeAllTabs keeps pinned tabs and activates one of them', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    const tabs = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().togglePinTab(tabs[0].id);

    useEditorWorkspaceStore.getState().closeAllTabs();
    const state = useEditorWorkspaceStore.getState();
    expect(state.workspace.tabs.map((t) => t.id)).toEqual([tabs[0].id]);
    expect(state.workspace.activeTabId).toBe(tabs[0].id);
  });
});

describe('useEditorWorkspaceStore.reorderTabs', () => {
  it('moves a tab before another tab', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const [t0, t1, t2] = useEditorWorkspaceStore.getState().workspace.tabs;

    useEditorWorkspaceStore.getState().reorderTabs(t2.id, t0.id);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id)).toEqual([
      t2.id,
      t0.id,
      t1.id,
    ]);
  });

  it('moves a tab to the end when beforeTabId is null', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const [t0] = useEditorWorkspaceStore.getState().workspace.tabs;

    useEditorWorkspaceStore.getState().reorderTabs(t0.id, null);
    const ids = useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id);
    expect(ids[ids.length - 1]).toBe(t0.id);
  });

  it('keeps pinned tabs first: unpinned tab cannot be inserted before pinned ones', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const [t0, t1, t2] = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().togglePinTab(t0.id);

    // 把非固定 t2 拖到固定 t0 之前 → 被钳制到固定区之后
    useEditorWorkspaceStore.getState().reorderTabs(t2.id, t0.id);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id)).toEqual([
      t0.id,
      t2.id,
      t1.id,
    ]);
  });

  it('lets pinned tabs move within the pinned group', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab(); // t0
    s.newBlankTab(); // t1
    s.newBlankTab(); // t2
    const [t0, t1, t2] = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().togglePinTab(t0.id);
    useEditorWorkspaceStore.getState().togglePinTab(t2.id);

    // 固定 t2 拖到固定 t0 之前 → [t2, t0, t1](t1 非固定保持原位)
    useEditorWorkspaceStore.getState().reorderTabs(t2.id, t0.id);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id)).toEqual([
      t2.id,
      t0.id,
      t1.id,
    ]);
  });

  it('ignores unknown drag id', () => {
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    const before = useEditorWorkspaceStore.getState().workspace.tabs;
    useEditorWorkspaceStore.getState().reorderTabs('nope', null);
    expect(useEditorWorkspaceStore.getState().workspace.tabs).toEqual(before);
  });

  it('does not mark userTouched when order is unchanged', () => {
    useEditorWorkspaceStore.setState({ userTouched: false });
    const s = useEditorWorkspaceStore.getState();
    s.newBlankTab();
    s.newBlankTab();
    const [t0, t1] = useEditorWorkspaceStore.getState().workspace.tabs;

    // newBlankTab 会置 userTouched=true,先还原为 false 再验证 reorderTabs 本身是 no-op
    useEditorWorkspaceStore.setState({ userTouched: false });
    // t0 本来就应排在 t1 前面,顺序未变化 → 不触发持久化标记
    useEditorWorkspaceStore.getState().reorderTabs(t0.id, t1.id);
    expect(useEditorWorkspaceStore.getState().userTouched).toBe(false);
    expect(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id)).toEqual([
      t0.id,
      t1.id,
    ]);
  });
});

describe('useEditorWorkspaceStore.persist', () => {
  it('writes workspace via config_set', async () => {
    useEditorWorkspaceStore.setState({ ready: true });
    safeInvokeMock.mockResolvedValueOnce({ ok: true, value: true });
    await useEditorWorkspaceStore.getState().persist();

    expect(safeInvokeMock).toHaveBeenCalledWith('config_set', {
      key: WORKSPACE_CONFIG_KEY,
      value: expect.objectContaining({ tabs: expect.any(Array) }),
    });
  });

  it('does nothing before hydrate (ready=false) to avoid overwriting stored data', async () => {
    await useEditorWorkspaceStore.getState().persist();
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});

describe('useEditorWorkspaceStore.openFolder / closeFolder / toggleDirExpanded', () => {
  it('openFolder 追加根并默认展开;重复打开为 no-op(仅确保展开)', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openFolder('C:\\work\\proj');
    let ws = useEditorWorkspaceStore.getState().workspace;
    expect(ws.folders).toEqual([{ rootPath: 'C:\\work\\proj' }]);
    expect(ws.expandedDirs).toContain('C:\\work\\proj');

    // 用户手动折叠根后再次 openFolder:不重复追加,仅恢复展开
    useEditorWorkspaceStore.getState().toggleDirExpanded('C:\\work\\proj');
    useEditorWorkspaceStore.getState().openFolder('C:\\work\\proj');
    ws = useEditorWorkspaceStore.getState().workspace;
    expect(ws.folders).toEqual([{ rootPath: 'C:\\work\\proj' }]);
    expect(ws.expandedDirs).toContain('C:\\work\\proj');
  });

  it('支持多根并列打开,展示顺序即打开顺序', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openFolder('C:\\a');
    s.openFolder('C:\\b');
    expect(
      useEditorWorkspaceStore.getState().workspace.folders.map((f) => f.rootPath),
    ).toEqual(['C:\\a', 'C:\\b']);
  });

  it('closeFolder 移除该根并清理其子树的展开状态', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openFolder('C:\\a');
    s.toggleDirExpanded('C:\\a\\sub');
    s.toggleDirExpanded('D:\\other\\keep');
    expect(useEditorWorkspaceStore.getState().workspace.expandedDirs).toEqual([
      'C:\\a',
      'C:\\a\\sub',
      'D:\\other\\keep',
    ]);

    s.closeFolder('C:\\a');
    const ws = useEditorWorkspaceStore.getState().workspace;
    expect(ws.folders).toEqual([]);
    // 子树内(C:\a、C:\a\sub)被清理,其它根(D:)保留
    expect(ws.expandedDirs).toEqual(['D:\\other\\keep']);
  });

  it('closeFolder 对未打开的根为 no-op', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openFolder('C:\\a');
    s.closeFolder('C:\\not-open');
    const ws = useEditorWorkspaceStore.getState().workspace;
    expect(ws.folders).toEqual([{ rootPath: 'C:\\a' }]);
    expect(ws.expandedDirs).toEqual(['C:\\a']);
  });

  it('closeFolder 不影响其中已打开的文件 Tab(VSCode 行为)', () => {
    const s = useEditorWorkspaceStore.getState();
    s.openLocalFile('C:\\a\\file.txt', 'hello');
    s.openFolder('C:\\a');
    useEditorWorkspaceStore.getState().closeFolder('C:\\a');
    const ws = useEditorWorkspaceStore.getState().workspace;
    expect(ws.folders).toEqual([]);
    expect(ws.tabs.map((t) => t.path)).toEqual(['C:\\a\\file.txt']);
  });

  it('toggleDirExpanded 切换目录展开/折叠', () => {
    const s = useEditorWorkspaceStore.getState();
    s.toggleDirExpanded('C:\\x\\sub');
    expect(useEditorWorkspaceStore.getState().workspace.expandedDirs).toEqual(['C:\\x\\sub']);
    useEditorWorkspaceStore.getState().toggleDirExpanded('C:\\x\\sub');
    expect(useEditorWorkspaceStore.getState().workspace.expandedDirs).toEqual([]);
  });

  it('folderNameFromPath 提取末段作为显示名(兼容两种分隔符)', () => {
    expect(folderNameFromPath('C:\\work\\proj')).toBe('proj');
    expect(folderNameFromPath('/home/user/proj')).toBe('proj');
    expect(folderNameFromPath('C:\\proj\\')).toBe('proj');
    expect(folderNameFromPath('C:\\')).toBe('C:');
  });
});
