/**
 * 编辑器工作区 Store —— zustand 状态 + Rust config 持久化
 *
 * 设计说明:
 * - 不挂 persist 中间件:工作区经 `config_get` / `config_set` IPC 持久化到
 *   Rust 端 JsonConfigStore(`tool_prefs.editor_workspace_v1`),重启后由
 *   `hydrate()` 还原。持久化写入由组件层的防抖 effect 触发(见 EditorWorkbench)。
 * - `ready` 标志:hydrate 完成后才为 true,组件据此决定是否开始持久化,
 *   避免"启动时用默认空工作区覆盖已存数据"。
 * - `userTouched` 标志:hydrate 完成前用户已主动操作(新建/打开/关闭/编辑)时
 *   置位;hydrate 据此保留用户操作,不覆盖(即使操作结果是空工作区)。
 * - dirty 判定:`content !== savedContent`,由编辑器层读取比较,store 不存布尔。
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { EditorLanguage } from '@/components/ui/code-editor';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_CONFIG_KEY,
  normalizeWorkspace,
  type EditorTab,
  type Workspace,
} from './schema';
import { fileNameFromPath, inferLanguageFromPath } from './languageMap';

/** 生成稳定唯一 id(Node 22 的 crypto.randomUUID,降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 扫描现有 tabs 中最大的 `untitled-N` 序号,返回下一个可用序号 */
function nextUntitledNumber(tabs: readonly EditorTab[]): number {
  let max = 0;
  for (const t of tabs) {
    const m = /^untitled-(\d+)$/.exec(t.title);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

interface WorkspaceState {
  workspace: Workspace;
  /** 是否已完成 hydrate(从 Rust config 还原);false 时禁止持久化 */
  ready: boolean;
  /** hydrate 完成前用户是否已主动操作(保留用户操作,不覆盖) */
  userTouched: boolean;
  /** 最近一次持久化错误(仅用于诊断,不影响使用) */
  error: string | null;

  /** 从 Rust config 还原工作区;已还原时再次调用为 no-op */
  hydrate: () => Promise<void>;
  /** 打开本地文件:存在同路径 Tab 则激活,否则新建 */
  openLocalFile: (path: string, content: string) => void;
  /** 新建 untitled Tab 并激活 */
  newBlankTab: () => void;
  /** 关闭 Tab,激活态自动跳到相邻 */
  closeTab: (id: string) => void;
  /** 切换 Tab 固定状态(固定 Tab 不被批量关闭) */
  togglePinTab: (id: string) => void;
  /** 关闭除目标 Tab 以外的全部非固定 Tab */
  closeOtherTabs: (id: string) => void;
  /** 关闭目标 Tab 右侧的全部非固定 Tab(按打开顺序) */
  closeRightTabs: (id: string) => void;
  /** 关闭全部已保存(非 dirty)的非固定 Tab */
  closeSavedTabs: () => void;
  /** 关闭全部非固定 Tab;固定 Tab 保留并激活其一 */
  closeAllTabs: () => void;
  /** 切换激活 Tab */
  switchTab: (id: string) => void;
  /** 更新 Tab 内容(编辑器 onChange 调用) */
  setTabContent: (id: string, content: string) => void;
  /** 更新 Tab 语言(语言选择器调用) */
  setTabLanguage: (id: string, language: EditorLanguage) => void;
  /** 保存成功后绑定路径并固化内容快照(清 dirty) */
  markSaved: (id: string, path: string) => void;
  /** 切换左栏显隐 */
  toggleLeftSidebar: () => void;
  /** 显式设置左栏可见性(拖拽收起/展开时同步) */
  setLeftSidebarVisible: (visible: boolean) => void;
  /** 更新左栏宽度(px,拖拽分栏时调用,持久化记忆) */
  setSidebarWidth: (width: number) => void;
  /** 将当前工作区写入 Rust config(组件防抖后调用) */
  persist: () => Promise<void>;
}

export const useEditorWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: { ...DEFAULT_WORKSPACE },
  ready: false,
  userTouched: false,
  error: null,

  hydrate: async () => {
    // 已还原则不重复读取,防止多次挂载时竞态覆盖用户正在编辑的内容
    if (get().ready) return;
    const r = await safeInvoke<unknown>('config_get', { key: WORKSPACE_CONFIG_KEY });
    if (r.ok) {
      set((s) => {
        // 若 hydrate 完成前用户已主动操作(含 closeAllTabs 等清空操作),
        // 保留用户操作,避免异步恢复覆盖用户意图;否则用持久化数据还原
        const workspace = s.userTouched ? s.workspace : normalizeWorkspace(r.value);
        return { workspace, ready: true, error: null };
      });
    } else {
      set({ ready: true, error: r.error.message });
    }
  },

  openLocalFile: (path, content) => {
    const { workspace } = get();
    const existing = workspace.tabs.find((t) => t.path === path);
    if (existing) {
      set({
        workspace: { ...workspace, activeTabId: existing.id },
        userTouched: true,
      });
      return;
    }
    const tab: EditorTab = {
      id: createId(),
      title: fileNameFromPath(path),
      path,
      language: inferLanguageFromPath(path),
      content,
      savedContent: content,
      pinned: false,
    };
    set({
      workspace: {
        ...workspace,
        tabs: [...workspace.tabs, tab],
        activeTabId: tab.id,
      },
      userTouched: true,
    });
  },

  newBlankTab: () => {
    const { workspace } = get();
    const tab: EditorTab = {
      id: createId(),
      title: `untitled-${nextUntitledNumber(workspace.tabs)}`,
      path: null,
      language: 'plaintext',
      content: '',
      savedContent: '',
      pinned: false,
    };
    set({
      workspace: {
        ...workspace,
        tabs: [...workspace.tabs, tab],
        activeTabId: tab.id,
      },
      userTouched: true,
    });
  },

  closeTab: (id) => {
    const { workspace } = get();
    const index = workspace.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tabs = workspace.tabs.filter((t) => t.id !== id);
    let activeTabId = workspace.activeTabId;
    if (activeTabId === id) {
      // 激活的是被关闭的 Tab:优先右邻,没有则左邻,全部关闭则 null
      activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    }
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  switchTab: (id) => {
    const { workspace } = get();
    if (!workspace.tabs.some((t) => t.id === id)) return;
    set({ workspace: { ...workspace, activeTabId: id } });
  },

  togglePinTab: (id) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  closeOtherTabs: (id) => {
    const { workspace } = get();
    // 保留全部固定 Tab 与目标 Tab;其余关闭
    const tabs = workspace.tabs.filter((t) => t.pinned || t.id === id);
    const activeTabId = workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
      ? workspace.activeTabId
      : tabs[0]?.id ?? null;
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  closeRightTabs: (id) => {
    const { workspace } = get();
    const index = workspace.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tabs = workspace.tabs.filter(
      (t) => t.pinned || workspace.tabs.indexOf(t) <= index,
    );
    const activeTabId = workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
      ? workspace.activeTabId
      : tabs[0]?.id ?? null;
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  closeSavedTabs: () => {
    const { workspace } = get();
    const tabs = workspace.tabs.filter((t) => t.pinned || t.content !== t.savedContent);
    const activeTabId = workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
      ? workspace.activeTabId
      : tabs[0]?.id ?? null;
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  closeAllTabs: () => {
    const { workspace } = get();
    const tabs = workspace.tabs.filter((t) => t.pinned);
    set({
      workspace: { ...workspace, tabs, activeTabId: tabs[0]?.id ?? null },
      userTouched: true,
    });
  },

  setTabContent: (id, content) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, content } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  setTabLanguage: (id, language) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, language } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  markSaved: (id, path) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) =>
      t.id === id ? { ...t, path, savedContent: t.content, title: fileNameFromPath(path) } : t,
    );
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  toggleLeftSidebar: () => {
    const { workspace } = get();
    set({
      workspace: { ...workspace, leftSidebarVisible: !workspace.leftSidebarVisible },
      userTouched: true,
    });
  },

  setLeftSidebarVisible: (visible) => {
    const { workspace } = get();
    if (workspace.leftSidebarVisible === visible) return;
    set({
      workspace: { ...workspace, leftSidebarVisible: visible },
      userTouched: true,
    });
  },

  setSidebarWidth: (width) => {
    const { workspace } = get();
    set({
      workspace: { ...workspace, sidebarWidth: width },
      userTouched: true,
    });
  },

  persist: async () => {
    // hydrate 完成前不写,避免覆盖已存数据
    if (!get().ready) return;
    const r = await safeInvoke<boolean>('config_set', {
      key: WORKSPACE_CONFIG_KEY,
      value: get().workspace,
    });
    if (!r.ok) set({ error: r.error.message });
  },
}));
