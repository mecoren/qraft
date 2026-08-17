/**
 * 文本编辑器工作区 —— 数据模型
 *
 * 定义单个 Tab(EditorTab)与整体工作区(Workspace)的结构。
 * 工作区经 Tauri `config_set` 持久化到 Rust 端 JsonConfigStore 的
 * `tool_prefs.editor_workspace_v1` 键下,重启应用后自动还原。
 *
 * 设计说明:
 * - `savedContent` 记录上次成功保存/打开时的内容快照,
 *   `content !== savedContent` 即为未保存(dirty),不单独维护布尔字段。
 * - `path` 为本地文件绝对路径;未保存过的新建 Tab 为 null,
 *   由「另存为」绑定路径后变为非 null。
 */
import type { EditorLanguage } from '@/components/ui/code-editor';

export type { EditorLanguage };

/** 单个编辑器 Tab */
export interface EditorTab {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** 顶栏 / 左栏显示名(文件名或 untitled-N) */
  title: string;
  /** 本地文件绝对路径;新建未保存的 Tab 为 null */
  path: string | null;
  /** Monaco 语言 id */
  language: EditorLanguage;
  /** 当前文本(含未保存改动) */
  content: string;
  /** 上次保存/打开时的内容快照,用于判定 dirty */
  savedContent: string;
  /** 固定 Tab:不被批量关闭,始终排在 Tab 栏最前 */
  pinned: boolean;
}

/**
 * 一次文件对比(左栏「对比差异」分组中的一条)
 *
 * 只存 Tab id,不存内容快照:渲染时从当前 workspace 的 tabs 实时取内容,
 * 保证对比双方在编辑后的 diff 是最新的;引用的 Tab 被关闭时由
 * EditorWorkbench 自动清理对应对比项。
 */
export interface ComparePair {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** 左侧(原文件)Tab id */
  leftTabId: string;
  /** 右侧(目标文件)Tab id */
  rightTabId: string;
}

/** 工作区状态(整体持久化单元) */
export interface Workspace {
  tabs: EditorTab[];
  /** 当前激活 Tab;空工作区时为 null */
  activeTabId: string | null;
  /** 左侧「打开的编辑器」面板是否可见 */
  leftSidebarVisible: boolean;
  /** 左侧文件列表宽度(px),持久化记忆 */
  sidebarWidth: number;
}

export const DEFAULT_WORKSPACE: Workspace = {
  tabs: [],
  activeTabId: null,
  leftSidebarVisible: true,
  sidebarWidth: 288,
};

/** 工作区在 Rust 配置存储中的键(点分路径,挂在 tool_prefs 下) */
export const WORKSPACE_CONFIG_KEY = 'tool_prefs.editor_workspace_v1';

/** 校验一条反序列化出的 Tab 是否结构合法,合法则返回规整后的副本 */
function sanitizeTab(raw: unknown): EditorTab | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title) return null;
  const path = typeof t.path === 'string' ? t.path : null;
  const language = typeof t.language === 'string' ? (t.language as EditorLanguage) : 'plaintext';
  const content = typeof t.content === 'string' ? t.content : '';
  const savedContent = typeof t.savedContent === 'string' ? t.savedContent : content;
  // 旧版本持久化数据无 pinned 字段,回退 false 保证兼容
  const pinned = t.pinned === true;
  return { id: t.id, title: t.title, path, language, content, savedContent, pinned };
}

/**
 * 将任意反序列化值规整为合法 Workspace。
 *
 * 旧版本 / 损坏数据会缺失字段或类型不符,逐字段回退到默认值,
 * 保证 store 初始化不抛错、UI 不崩溃。
 */
export function normalizeWorkspace(raw: unknown): Workspace {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_WORKSPACE };
  const w = raw as Record<string, unknown>;
  const tabs = Array.isArray(w.tabs)
    ? w.tabs.map(sanitizeTab).filter((t): t is EditorTab => t !== null)
    : [];
  // 仅当 activeTabId 仍存在于 tabs 中时保留,否则置 null
  const activeTabId =
    typeof w.activeTabId === 'string' && tabs.some((t) => t.id === w.activeTabId)
      ? w.activeTabId
      : null;
  return {
    tabs,
    activeTabId,
    leftSidebarVisible: typeof w.leftSidebarVisible === 'boolean' ? w.leftSidebarVisible : true,
    sidebarWidth:
      typeof w.sidebarWidth === 'number' && w.sidebarWidth >= 180 ? w.sidebarWidth : 288,
  };
}
