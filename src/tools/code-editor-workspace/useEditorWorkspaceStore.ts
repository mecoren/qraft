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
 *   注意"用户主动"不含系统自动打开:文件关联 / 命令行启动时走
 *   `openLocalFileFromSystem`,它不置位该标志,hydrate 会把历史 Tab 合并回来。
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

/**
 * 从路径中提取末段作为文件夹显示名。
 * 兼容 Windows(`\`)与 POSIX(`/`)分隔符;根盘符(如 `C:\`)原样返回。
 */
export function folderNameFromPath(rootPath: string): string {
  const trimmed = rootPath.replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/]/).pop() ?? '';
  return last || rootPath;
}

/** 判断某路径是否位于指定目录子树内(含自身;组件级比较,兼容两种分隔符) */
function isUnderDir(path: string, dir: string): boolean {
  if (path === dir) return true;
  const prefix = dir.endsWith('\\') || dir.endsWith('/') ? dir : `${dir}\\`;
  return path.startsWith(prefix) || path.startsWith(`${dir}/`);
}

/** 生成稳定唯一 id(Node 22 的 crypto.randomUUID,降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 未命名 Tab 标题的最大显示长度(超出截断加省略号) */
const UNTITLED_TITLE_MAX = 32;
/**
 * 内容派生标题的门槛:首个非空行需超过 3 个字符才会放到 Tab 名位置。
 * 按首行而非全文判断,避免「{ + 多行内容」这类输入把单个 `{` 变成 Tab 名。
 */
const UNTITLED_TITLE_MIN_CHARS = 3;

/**
 * 由未命名 Tab 的内容推导标题(参考 VSCode:未命名缓冲区以首行文字
 * 作为保存建议名,此处实时用于 Tab 显示名):
 * - 取首个非空行并去除首尾空白(跳过开头的空行)
 * - 超长截断加省略号,避免超长首行撑爆 Tab / 列表
 * - 首行为空、全空白或未超过 3 个字符时返回 null(回退到自动命名占位)
 */
function deriveTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      // 首行未超过 3 个字符不派生:避免输入一两个字符就把 Tab 名从 untitled-N 换成碎片文本
      if (trimmed.length <= UNTITLED_TITLE_MIN_CHARS) return null;
      return trimmed.length > UNTITLED_TITLE_MAX
        ? `${trimmed.slice(0, UNTITLED_TITLE_MAX)}…`
        : trimmed;
    }
  }
  return null;
}

/** 扫描现有 tabs 中最大的 `untitled-N` 序号,返回下一个可用序号 */
function nextUntitledNumber(tabs: readonly EditorTab[]): number {
  let max = 0;
  for (const t of tabs) {
    // 已按内容改名的未命名 Tab 原始自动名存于 autoTitle,同样计入,
    // 避免「新建 untitled-1 → 输入文字改名 → 再新建」时序号重复
    for (const name of [t.title, t.autoTitle]) {
      const m = /^untitled-(\d+)$/.exec(name ?? '');
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

/**
 * 把一个本地文件打开到工作区并激活:同路径 Tab 已存在则仅激活,否则追加新 Tab。
 * 抽为纯函数供「用户主动打开」与「系统自动打开」两个入口共用,
 * 二者唯一差别是是否置位 `userTouched`(见 openLocalFileFromSystem 的说明)。
 */
function openFileIntoWorkspace(
  workspace: Workspace,
  path: string,
  content: string,
  encoding?: string,
): Workspace {
  const existing = workspace.tabs.find((t) => t.path === path);
  if (existing) return { ...workspace, activeTabId: existing.id };

  const tab: EditorTab = {
    id: createId(),
    title: fileNameFromPath(path),
    path,
    language: inferLanguageFromPath(path),
    content,
    savedContent: content,
    pinned: false,
    ...(encoding ? { encoding } : {}),
  };
  return { ...workspace, tabs: [...workspace.tabs, tab], activeTabId: tab.id };
}

/**
 * 把 hydrate 前已自动打开的 Tab 合并进从 config 还原出的工作区。
 *
 * 背景:通过文件关联 / 命令行参数启动时,App 会在 `EditorWorkbench` 挂载
 * (即 hydrate)之前就调用 `openLocalFile` 打开目标文件。若此时直接以任一
 * 侧为准,另一侧就会丢失 —— 历史 Tab 被清空正是由此而来。
 *
 * 合并规则(以持久化列表为基底,保持原有顺序与固定状态):
 * - 同路径已在持久化列表中:复用还原出的 Tab(保留 pinned / 未保存草稿 /
 *   编码等状态),仅在其内容与磁盘一致(无未保存修改)时同步为磁盘最新内容,
 *   避免用磁盘内容顶掉用户上次退出时未保存的编辑
 * - 新路径:追加到列表末尾
 * - 激活项:以本次自动打开的文件为准(用户的直接意图是查看它)
 */
function mergeAutoOpenedTabs(restored: Workspace, current: Workspace): Workspace {
  if (current.tabs.length === 0) return restored;

  const tabs = [...restored.tabs];
  // 记录最后一个自动打开文件对应的 Tab id,作为合并后的激活项
  let activeTabId: string | null = null;

  for (const opened of current.tabs) {
    const index = tabs.findIndex((t) => t.path !== null && t.path === opened.path);
    if (index < 0) {
      tabs.push(opened);
      activeTabId = opened.id;
      continue;
    }
    const existing = tabs[index];
    // 持久化快照中存在未保存修改时保留草稿;否则用刚读出的磁盘内容刷新
    const isDirty = existing.content !== existing.savedContent;
    tabs[index] = isDirty
      ? existing
      : { ...existing, content: opened.content, savedContent: opened.savedContent };
    activeTabId = existing.id;
  }

  return {
    ...restored,
    tabs,
    activeTabId: activeTabId ?? restored.activeTabId,
  };
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
  /** 打开本地文件:存在同路径 Tab 则激活,否则新建(encoding 为探测到的编码标识) */
  openLocalFile: (path: string, content: string, encoding?: string) => void;
  /**
   * 由系统触发打开本地文件(文件关联双击 / 命令行参数),行为同 `openLocalFile`
   * 但**不**置位 `userTouched`。
   *
   * 原因:这类调用发生在 `EditorWorkbench` 懒加载挂载(即 hydrate)之前,
   * 若按"用户主动操作"处理会让 hydrate 直接放弃持久化数据,上次打开的
   * Tab 列表随即被防抖 persist 永久覆盖。不置位后由 hydrate 走合并分支。
   */
  openLocalFileFromSystem: (path: string, content: string, encoding?: string) => void;
  /** 打开拖入/粘贴的文本内容:以无路径 Tab 打开(标题为文件名,保存时另存为) */
  openDroppedText: (title: string, content: string) => void;
  /** 新建 untitled Tab 并激活 */
  newBlankTab: () => void;
  /** 关闭 Tab,激活态自动跳到相邻 */
  closeTab: (id: string) => void;
  /** 切换 Tab 固定状态(固定 Tab 不被批量关闭) */
  togglePinTab: (id: string) => void;
  /**
   * 重命名 Tab(仅改显示名):untitled Tab 同时清除自动名,
   * 后续输入不再派生标题;已绑定路径的 Tab 保存后仍会同步为真实文件名。
   */
  renameTab: (id: string, title: string) => void;
  /** 拖拽排序:将 dragId 的 Tab 移到 beforeTabId 之前(null 表示移到末尾);固定 Tab 恒在最前 */
  reorderTabs: (dragId: string, beforeTabId: string | null) => void;
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
  /** 打开根文件夹:加入左栏「文件夹」树并默认展开根;重复打开同一根仅确保展开 */
  openFolder: (rootPath: string) => void;
  /** 关闭根文件夹:移除该根并清理其子树的展开状态(不影响其中已打开的 Tab) */
  closeFolder: (rootPath: string) => void;
  /** 切换目录的展开/折叠状态(懒加载由组件层触发,store 只记状态) */
  toggleDirExpanded: (dirPath: string) => void;
  /** 更新 Tab 内容(编辑器 onChange 调用) */
  setTabContent: (id: string, content: string) => void;
  /** 更新 Tab 语言(语言选择器调用) */
  setTabLanguage: (id: string, language: EditorLanguage) => void;
  /** 更新 Tab 文件编码(编码选择器调用;保存时按该编码写回) */
  setTabEncoding: (id: string, encoding: string) => void;
  /**
   * 切换 Tab 的自动换行开关(右键菜单「自动换行」调用)。
   * 仅作用于该 Tab 对应的编辑器实例;缺省视为开启,切换后随工作区持久化。
   */
  toggleTabWordWrap: (id: string) => void;
  /**
   * 保存成功后绑定路径并固化内容快照(清 dirty)。
   * 路径变化(首次另存为/另存为到新扩展名)时按新路径重新推断语言,
   * 让 Monaco 高亮与文件类型保持同步;覆盖保存保留当前语言。
   */
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
        if (s.userTouched) return { workspace: s.workspace, ready: true, error: null };
        // userTouched 为 false 但已有 Tab:只可能来自文件关联/命令行的自动打开
        // (其余增删 Tab 的 action 都会置位 userTouched),需与持久化列表合并而非互相覆盖
        const workspace = mergeAutoOpenedTabs(normalizeWorkspace(r.value), s.workspace);
        return { workspace, ready: true, error: null };
      });
    } else {
      set({ ready: true, error: r.error.message });
    }
  },

  openLocalFile: (path, content, encoding) => {
    set({
      workspace: openFileIntoWorkspace(get().workspace, path, content, encoding),
      userTouched: true,
    });
  },

  // 系统自动打开:刻意不置位 userTouched,让 hydrate 走合并分支保住历史 Tab
  openLocalFileFromSystem: (path, content, encoding) => {
    set({ workspace: openFileIntoWorkspace(get().workspace, path, content, encoding) });
  },

  openDroppedText: (title, content) => {
    const { workspace } = get();
    // 同名且无路径的已打开 Tab:激活复用,避免反复拖入同文件堆积
    const existing = workspace.tabs.find((t) => t.path === null && t.title === title);
    if (existing) {
      set({
        workspace: { ...workspace, activeTabId: existing.id },
        userTouched: true,
      });
      return;
    }
    const tab: EditorTab = {
      id: createId(),
      title,
      path: null,
      language: inferLanguageFromPath(title),
      content,
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

  openFolder: (rootPath) => {
    const { workspace } = get();
    if (workspace.folders.some((f) => f.rootPath === rootPath)) {
      // 已打开:仅确保根处于展开状态(用户可能之前手动折叠过)
      if (!workspace.expandedDirs.includes(rootPath)) {
        set({
          workspace: { ...workspace, expandedDirs: [...workspace.expandedDirs, rootPath] },
          userTouched: true,
        });
      }
      return;
    }
    set({
      workspace: {
        ...workspace,
        folders: [...workspace.folders, { rootPath }],
        expandedDirs: [...new Set([...workspace.expandedDirs, rootPath])],
      },
      userTouched: true,
    });
  },

  closeFolder: (rootPath) => {
    const { workspace } = get();
    const folders = workspace.folders.filter((f) => f.rootPath !== rootPath);
    // 根不存在(已关闭):no-op
    if (folders.length === workspace.folders.length) return;
    // 同步清理该子树内的展开状态;已打开的 Tab 不受影响(VSCode 行为)
    const expandedDirs = workspace.expandedDirs.filter((d) => !isUnderDir(d, rootPath));
    set({ workspace: { ...workspace, folders, expandedDirs }, userTouched: true });
  },

  toggleDirExpanded: (dirPath) => {
    const { workspace } = get();
    const expandedDirs = workspace.expandedDirs.includes(dirPath)
      ? workspace.expandedDirs.filter((d) => d !== dirPath)
      : [...workspace.expandedDirs, dirPath];
    set({ workspace: { ...workspace, expandedDirs }, userTouched: true });
  },

  togglePinTab: (id) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  renameTab: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) =>
      t.id === id ? { ...t, title: trimmed, autoTitle: undefined } : t,
    );
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  reorderTabs: (dragId, beforeTabId) => {
    const { workspace } = get();
    const from = workspace.tabs.findIndex((t) => t.id === dragId);
    if (from < 0) return;
    const tab = workspace.tabs[from];
    // 以「固定 Tab 恒在最前」的视觉顺序为基准,与 Tab 栏 sortedTabs / 左栏列表保持一致
    const ordered = [...workspace.tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const rest = ordered.filter((t) => t.id !== dragId);
    let to = beforeTabId ? rest.findIndex((t) => t.id === beforeTabId) : rest.length;
    if (to < 0) to = rest.length;
    // 固定约束:固定 Tab 只能在固定区(0..pinnedCount)内移动;非固定 Tab 不能插入固定区
    const pinnedCount = rest.filter((t) => t.pinned).length;
    if (tab.pinned) {
      to = Math.max(0, Math.min(to, pinnedCount));
    } else {
      to = Math.max(pinnedCount, Math.min(to, rest.length));
    }
    const tabs = [...rest.slice(0, to), tab, ...rest.slice(to)];
    // 顺序未变化时不触发持久化
    const unchanged =
      tabs.length === workspace.tabs.length && tabs.every((t, i) => t.id === workspace.tabs[i]?.id);
    if (unchanged) return;
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  closeOtherTabs: (id) => {
    const { workspace } = get();
    // 保留全部固定 Tab 与目标 Tab;其余关闭
    const tabs = workspace.tabs.filter((t) => t.pinned || t.id === id);
    const activeTabId =
      workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
        ? workspace.activeTabId
        : (tabs[0]?.id ?? null);
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  closeRightTabs: (id) => {
    const { workspace } = get();
    const index = workspace.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tabs = workspace.tabs.filter((t) => t.pinned || workspace.tabs.indexOf(t) <= index);
    const activeTabId =
      workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
        ? workspace.activeTabId
        : (tabs[0]?.id ?? null);
    set({ workspace: { ...workspace, tabs, activeTabId }, userTouched: true });
  },

  closeSavedTabs: () => {
    const { workspace } = get();
    const tabs = workspace.tabs.filter((t) => t.pinned || t.content !== t.savedContent);
    const activeTabId =
      workspace.activeTabId && tabs.some((t) => t.id === workspace.activeTabId)
        ? workspace.activeTabId
        : (tabs[0]?.id ?? null);
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
    const tabs = workspace.tabs.map((t) => {
      if (t.id !== id) return t;
      // 未命名 Tab(自动命名 untitled-N 且未绑定路径):用首行文字做标题
      // (参考 VSCode 对未命名缓冲区的处理)。autoTitle 记住原始自动名:
      // 清空内容后回退,新 Tab 序号分配也不因改名而重复。
      // 已打开文件 / 拖入文本 Tab 有明确标题,不参与派生。
      // 改名后 title 不再匹配 untitled-N,故以 autoTitle 标记延续派生生命周期。
      if (t.path === null && (t.autoTitle !== undefined || /^untitled-\d+$/.test(t.title))) {
        const autoTitle = t.autoTitle ?? t.title;
        return { ...t, content, autoTitle, title: deriveTitleFromContent(content) ?? autoTitle };
      }
      return { ...t, content };
    });
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  setTabLanguage: (id, language) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, language } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  setTabEncoding: (id, encoding) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => (t.id === id ? { ...t, encoding } : t));
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  toggleTabWordWrap: (id) => {
    const { workspace } = get();
    // 缺省(旧数据/新建 Tab 未写入字段)视为开启,取反得到目标状态
    const tabs = workspace.tabs.map((t) =>
      t.id === id ? { ...t, wordWrap: !(t.wordWrap ?? true) } : t,
    );
    set({ workspace: { ...workspace, tabs }, userTouched: true });
  },

  markSaved: (id, path) => {
    const { workspace } = get();
    const tabs = workspace.tabs.map((t) => {
      if (t.id !== id) return t;
      // 路径变化(首次另存为/另存为到新扩展名)时,按新路径重新推断语言,
      // 让高亮与文件类型保持同步;路径不变(覆盖保存)保留当前语言,
      // 避免覆盖用户手动选择。
      const language = t.path === path ? t.language : inferLanguageFromPath(path);
      // 保存后 title 绑定为真实文件名,内容派生标题的生命周期结束
      return {
        ...t,
        path,
        savedContent: t.content,
        title: fileNameFromPath(path),
        autoTitle: undefined,
        language,
      };
    });
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
