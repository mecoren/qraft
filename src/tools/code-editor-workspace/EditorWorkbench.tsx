/**
 * 编辑器工作区 —— VSCode 风格多文件工作区主组件
 *
 * 布局(自上而下 / 自左而右):
 * - 顶部操作区:原工具栏已迁移到 Titlebar 菜单栏(File / View 菜单)
 * - Tab 栏:多文件切换(标题 + 未保存圆点 + 关闭按钮)
 * - 主体:左栏「打开的编辑器」列表 + 中央 Monaco 编辑器
 * - 编辑器自带底部状态栏(行/列/字符数),右侧追加可点击的语言徽章
 *
 * 菜单栏(由 Titlebar 渲染):
 * - File:新建 / 打开 / 保存 / 全部保存 / 关闭 / 全部关闭
 * - View:切换左栏显隐
 *
 * 生命周期:
 * - 挂载时 hydrate(从 Rust config 还原工作区)
 * - workspace 变更后 400ms 防抖持久化(config_set),仅 ready 后生效
 * - 保存:已绑定路径直接 fs_write_file;untitled 弹「另存为」对话框
 * - 卸载时清空 Titlebar 菜单栏(由 useToolMenus effect cleanup 自动处理)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { DiffEditor, type Monaco, type MonacoDiffEditor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FilePlus2, FolderOpen, GitCompareArrows } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/ui/code-editor';
import { Button } from '@/components/ui/button';
import { registerActiveEditor, unregisterActiveEditor } from './namingCaseCommand';
import { TooltipProvider } from '@/components/ui/tooltip';
import { defineThemeFor, getThemeName, useMonacoTheme } from '@/components/ui/monaco-theme';
import { useShortcut } from '@/hooks/useShortcut';
import { listen, safeInvoke } from '@/lib/ipc';
import { writeClipboardText } from '@/lib/clipboard';
import type { ToolProps } from '@/tools/registry';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import { EditorTabsBar } from './EditorTabsBar';
import { EditorLeftSidebar } from './EditorLeftSidebar';
import { PathBreadcrumb } from './PathBreadcrumb';
import { UnsavedDialog, type UnsavedMode } from './UnsavedDialog';
import {
  openTextFileDialog,
  revealInExplorer,
  saveToPath,
  saveWithDialog,
  windowCloseCancel,
  windowCloseReady,
} from './fileOps';
import { useToolMenus } from '@/store/toolMenubarStore';
import type { ToolMenu } from '@/types/tool-menu';
import type { ComparePair, EditorTab } from './schema';

/** 批量关闭意图:用于未保存确认通过后执行对应 store 动作 */
type BatchCloseAction = 'close-others' | 'close-right' | 'close-all';

/** workspace 变更后持久化防抖间隔(ms) */
const PERSIST_DEBOUNCE_MS = 400;

/** 生成稳定唯一对比 id */
function createCompareId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `compare-${crypto.randomUUID()}`;
  }
  return `compare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function EditorWorkbench({ toolId }: ToolProps): JSX.Element {
  const workspace = useEditorWorkspaceStore((s) => s.workspace);
  const ready = useEditorWorkspaceStore((s) => s.ready);
  const hydrate = useEditorWorkspaceStore((s) => s.hydrate);
  /** 未保存对话框状态(null = 关闭);batchAction 记录批量关闭意图 */
  const [unsaved, setUnsaved] = useState<{
    mode: UnsavedMode;
    tabId?: string;
    batchAction?: BatchCloseAction;
  } | null>(null);
  /**
   * 左栏 Ctrl+多选选中的文件(id 集合,不含激活 Tab 自身)。
   * 存储层不落盘(纯会话内 UI 状态),关闭文件时同步剔除失效 id。
   */
  const [selectedTabIds, setSelectedTabIds] = useState<string[]>([]);
  /** 已创建的对比项列表(不落盘,纯会话内 UI 状态) */
  const [compares, setCompares] = useState<ComparePair[]>([]);
  /** 当前激活的对比项 id(主区域显示其 diff) */
  const [activeCompareId, setActiveCompareId] = useState<string | null>(null);
  /**
   * 分隔条 hover / 拖拽中状态:
   * 拖拽分隔条时鼠标会移出侧栏面板,导致侧栏悬浮态丢失、按钮/徽章闪烁;
   * 这两个状态同步给 EditorLeftSidebar(actionsForced)保持按钮稳定显示。
   */
  const [handleHovered, setHandleHovered] = useState(false);
  const [handleActive, setHandleActive] = useState(false);

  // 首次挂载从 Rust config 还原工作区
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 窗口关闭确认:通知后端前端已就绪,并监听「用户点击关闭窗口」事件。
  // 仅在 Tauri 运行时生效(浏览器 dev / 测试环境跳过)。
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    void windowCloseReady();
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen('app:close-requested', async () => {
          // 确保工作区已还原(用户可能从未打开过编辑器工具,store 未 hydrate)
          await useEditorWorkspaceStore.getState().hydrate();
          const state = useEditorWorkspaceStore.getState();
          const dirtyTabs = state.workspace.tabs.filter((t) => t.content !== t.savedContent);
          if (dirtyTabs.length === 0) {
            // 无未保存内容:直接退出
            void safeInvoke('app_quit');
            return;
          }
          setUnsaved({ mode: 'quit-app' });
        });
      } catch {
        // 非 Tauri 环境或事件系统不可用:不拦截窗口关闭
      }
    })();
    return () => unlisten?.();
  }, []);

  // workspace 变更 → 防抖持久化(ready 前 persist 为 no-op,不会覆盖已存数据)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void useEditorWorkspaceStore.getState().persist();
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [workspace, ready]);

  // 卸载时(切换工具/关闭面板)立即写入未落盘的改动,避免防抖窗口内数据丢失;
  // 空依赖数组的 cleanup 仅在组件真正卸载时执行
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
        void useEditorWorkspaceStore.getState().persist();
      }
    };
  }, []);

  const activeTab = workspace.tabs.find((t) => t.id === workspace.activeTabId) ?? null;
  const activeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 挂载时把编辑器实例注册到全局「激活编辑器」注册表,供 cycle_naming_case
  // 全局快捷键(useShortcut)使用;卸载时注销。
  const handleEditorMount = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    activeEditorRef.current = editorInstance;
    registerActiveEditor(editorInstance);
  }, []);

  useEffect(() => {
    return () => {
      const ed = activeEditorRef.current;
      if (ed) unregisterActiveEditor(ed);
      activeEditorRef.current = null;
    };
  }, []);

  /** 当前激活的对比项及左右文件(引用失效时回退 null) */
  const activeCompare =
    (activeCompareId && compares.find((cp) => cp.id === activeCompareId)) ?? null;
  const compareLeft = activeCompare
    ? (workspace.tabs.find((t) => t.id === activeCompare.leftTabId) ?? null)
    : null;
  const compareRight = activeCompare
    ? (workspace.tabs.find((t) => t.id === activeCompare.rightTabId) ?? null)
    : null;
  const showCompare = Boolean(activeCompare && compareLeft && compareRight);

  /** 打开本地文件对话框并载入(或激活已打开的同路径 Tab) */
  const handleOpen = useCallback(async () => {
    try {
      const result = await openTextFileDialog();
      if (result) {
        useEditorWorkspaceStore.getState().openLocalFile(result.path, result.content);
        setActiveCompareId(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开文件失败');
    }
  }, []);

  /**
   * 保存指定 Tab:已绑定路径直接写回,untitled 弹「另存为」。
   * 返回是否成功(用户取消另存为 / 保存失败返回 false,供「保存并关闭」判断)。
   */
  const saveTabById = useCallback(async (id: string): Promise<boolean> => {
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((t) => t.id === id);
    if (!tab) return false;
    try {
      if (tab.path) {
        await saveToPath(tab.path, tab.content);
        state.markSaved(id, tab.path);
        toast.success(`已保存 ${tab.title}`);
        return true;
      }
      // 未绑定路径:文件名缺扩展名时补 .txt,供保存对话框使用
      const fileName = tab.title.endsWith('.txt') ? tab.title : `${tab.title}.txt`;
      const path = await saveWithDialog(fileName, tab.content);
      if (path) {
        state.markSaved(id, path);
        toast.success(`已保存 ${fileName}`);
        return true;
      }
      // 用户取消保存对话框:保持 dirty 状态
      return false;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  }, []);

  /** 保存激活 Tab(菜单「保存」/ Ctrl+S 快捷键) */
  const handleSave = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    if (!state.workspace.activeTabId) return;
    void saveTabById(state.workspace.activeTabId);
  }, [saveTabById]);

  // Ctrl+S(Cmd+S)保存当前 Tab,阻止浏览器默认的「保存页面」行为。
  // 快捷键字符串可到设置里自定义;无激活 Tab 时是安全的 no-op。
  useShortcut('save_file', handleSave, [handleSave]);

  /**
   * 请求关闭单个 Tab:
   * - 未保存 → 弹「保存 / 不保存 / 取消」
   * - 固定 Tab(无论是否未保存)→ 弹「关闭 / 取消」确认
   * - 其余干净 Tab → 直接关闭
   */
  const requestCloseTab = useCallback((id: string) => {
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.pinned) {
      // 固定 Tab 关闭一律确认,避免误关用户特意保留的 Tab
      setUnsaved({ mode: 'close-pinned', tabId: id });
    } else if (tab.content !== tab.savedContent) {
      setUnsaved({ mode: 'close-tab', tabId: id });
    } else {
      state.closeTab(id);
    }
  }, []);

  /** 请求关闭当前 Tab(菜单「关闭」) */
  const handleCloseCurrent = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    const id = state.workspace.activeTabId;
    if (!id) return;
    requestCloseTab(id);
  }, [requestCloseTab]);

  /** 请求全部关闭:存在未保存的非固定 Tab 时先弹确认,干净则直接关闭 */
  const requestCloseAll = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    const hasDirty = state.workspace.tabs.some((t) => !t.pinned && t.content !== t.savedContent);
    if (hasDirty) {
      setUnsaved({ mode: 'close-all' });
    } else {
      state.closeAllTabs();
    }
  }, []);

  /**
   * 请求批量关闭(关闭其他 / 关闭右侧):
   * 将要被关闭的 Tab 中存在未保存时先弹确认,干净则直接执行。
   */
  const requestCloseBatch = useCallback((action: BatchCloseAction, targetId: string) => {
    const state = useEditorWorkspaceStore.getState();
    const { tabs } = state.workspace;
    const targetIndex = tabs.findIndex((t) => t.id === targetId);
    const willClose = tabs.filter((t) => {
      if (t.pinned) return false;
      if (action === 'close-others') return t.id !== targetId;
      if (action === 'close-right') return targetIndex >= 0 && tabs.indexOf(t) > targetIndex;
      return false;
    });
    const hasDirty = willClose.some((t) => t.content !== t.savedContent);
    if (hasDirty) {
      setUnsaved({ mode: 'close-batch', tabId: targetId, batchAction: action });
    } else if (action === 'close-others') {
      state.closeOtherTabs(targetId);
    } else {
      state.closeRightTabs(targetId);
    }
  }, []);

  /** 关闭已保存:只关干净的非固定 Tab,无需确认 */
  const requestCloseSaved = useCallback(() => {
    useEditorWorkspaceStore.getState().closeSavedTabs();
  }, []);

  /** 切换固定状态 */
  const handleTogglePin = useCallback((id: string) => {
    useEditorWorkspaceStore.getState().togglePinTab(id);
  }, []);

  /** 复制 Tab 路径到剪贴板 */
  const handleCopyPath = useCallback((id: string) => {
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id);
    if (!tab?.path) return;
    void writeClipboardText(tab.path).then((ok) => {
      if (ok) toast.success(`已复制路径:${tab.path}`);
      else toast.error('复制路径失败');
    });
  }, []);

  /** 在系统文件管理器中显示目标文件 */
  const handleRevealInExplorer = useCallback((id: string) => {
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id);
    if (!tab?.path) return;
    void revealInExplorer(tab.path).catch((e) => {
      toast.error(e instanceof Error ? e.message : '无法在文件管理器中显示');
    });
  }, []);

  /**
   * 左栏选中处理(单击 / Ctrl+点击)。
   *
   * 「选中集合」= selectedTabIds ∪ {activeTabId}(去重),表示当前参与对比的候选文件。
   * - additive=false(普通点击):仅激活该文件,清空多选(选中集合=仅该文件)
   * - additive=true(Ctrl/Cmd+点击):**先把原先高亮(激活)的文件纳入选中集**,
   *   再切换点击的文件在选中集中的存在,避免激活文件在切 Tab 后丢失
   *
   * 选中集合最多 2 个文件:
   * - 第 3 个时**直接报错**并拒绝加入,避免选中过多后对比时静默只取前两个
   */
  const handleSelectMany = useCallback(
    (id: string, additive: boolean) => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === id);
      if (!tab) return;
      if (additive) {
        // 基准选中集:当前激活 Tab 必须计入(去重),保证"原先高亮的"不丢失
        const base = selectedTabIds.includes(workspace.activeTabId ?? '')
          ? selectedTabIds
          : [...selectedTabIds, ...(workspace.activeTabId ? [workspace.activeTabId] : [])];
        // 点击的文件已在选中集 → 取消;否则加入
        const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
        if (new Set(next).size > 2) {
          toast.error('一次最多选中两个文件进行对比');
          return;
        }
        state.switchTab(id);
        setActiveCompareId(null);
        setSelectedTabIds(next);
        return;
      }
      // 普通点击:仅激活该文件,清空多选
      state.switchTab(id);
      setActiveCompareId(null);
      setSelectedTabIds([]);
    },
    [selectedTabIds, workspace.activeTabId],
  );

  /** 点击左栏普通文件:激活该 Tab 并退出对比视图 */
  const handleSelectTab = useCallback((id: string) => {
    useEditorWorkspaceStore.getState().switchTab(id);
    setActiveCompareId(null);
  }, []);

  /** 关闭文件后,从选中集合剔除已关闭的 Tab,避免残留失效 id */
  useEffect(() => {
    const valid = new Set(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id));
    // 订阅 store.tabs 变化后清理本地选择缓存:store 即外部状态源,
    // 此处同步是「订阅外部系统变更后修正本地缓存」的必要同步,非普通渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-x/set-state-in-effect
    setSelectedTabIds((prev) => prev.filter((x) => valid.has(x)));
  }, [workspace.tabs]);

  /**
   * 比较所选内容:从多选集合中取参与对比的两个文件。
   *
   * 选择集为「恰好 2 个」时直接对比;不足 2 个提示需选中两个;
   * 超过 2 个时**直接报错**,避免静默只取前两个造成困惑。
   */
  const handleCompareSelected = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    const { tabs } = state.workspace;
    // 参与对比的候选 = 多选集合 + 激活 Tab(去重)
    const chosen: EditorTab[] = [];
    for (const id of selectedTabIds) {
      const tab = tabs.find((t) => t.id === id);
      if (tab && !chosen.some((c) => c.id === tab.id)) chosen.push(tab);
    }
    const active = tabs.find((t) => t.id === state.workspace.activeTabId);
    if (active && !chosen.some((c) => c.id === active.id)) chosen.push(active);
    if (chosen.length < 2) {
      toast.info('请先选中至少两个文件再进行对比');
      return;
    }
    if (chosen.length > 2) {
      toast.error('一次只能对比两个文件,请先取消多余的选中再试');
      return;
    }
    const pair: ComparePair = {
      id: createCompareId(),
      leftTabId: chosen[0].id,
      rightTabId: chosen[1].id,
    };
    setCompares((prev) => [...prev, pair]);
    setActiveCompareId(pair.id);
  }, [selectedTabIds]);

  /** 点击左栏对比项:切换激活该对比 */
  const handleSelectCompare = useCallback((id: string) => {
    setActiveCompareId(id);
  }, []);

  /** 关闭对比项:移除该对比,激活态自动跳到相邻(或清空) */
  const handleCloseCompare = useCallback((id: string) => {
    setCompares((prev) => {
      const next = prev.filter((cp) => cp.id !== id);
      setActiveCompareId((active) => {
        if (active !== id) return active;
        const idx = prev.findIndex((cp) => cp.id === id);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  /** 关闭整个「对比差异」分组:清空全部对比项并退出对比视图 */
  const handleCloseAllCompares = useCallback(() => {
    setCompares([]);
    setActiveCompareId(null);
  }, []);

  /** 对比项引用的 Tab 被关闭时,自动清理该对比项 */
  useEffect(() => {
    // 同上文:订阅 store.tabs 变化后清理对比缓存(外部状态源同步),非普通渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-x/set-state-in-effect
    setCompares((prev) => {
      const valid = new Set(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id));
      const next = prev.filter((cp) => valid.has(cp.leftTabId) && valid.has(cp.rightTabId));
      if (next.length !== prev.length) {
        setActiveCompareId((active) =>
          active && next.some((cp) => cp.id === active) ? active : (next[0]?.id ?? null),
        );
      }
      return next;
    });
  }, [workspace.tabs]);

  /**
   * 全部保存:遍历 dirty Tab 逐个保存。
   * - 已绑定路径 → 写回
   * - untitled → 弹另存为,用户取消则跳过该 Tab(保持 dirty 状态)
   * 全部独立执行,单 Tab 失败不影响其它
   */
  const handleSaveAll = useCallback(async () => {
    const state = useEditorWorkspaceStore.getState();
    const dirtyTabs = state.workspace.tabs.filter((t) => t.content !== t.savedContent);
    for (const tab of dirtyTabs) {
      // 跳过用户取消的另存为(返回 false),继续下一个 dirty Tab
      await saveTabById(tab.id);
    }
  }, [saveTabById]);

  const handleNewTab = useCallback(() => {
    useEditorWorkspaceStore.getState().newBlankTab();
    setActiveCompareId(null);
  }, []);

  /** 切换左栏显隐(菜单「视图」) */
  const handleToggleSidebar = useCallback(() => {
    useEditorWorkspaceStore.getState().toggleLeftSidebar();
  }, []);

  /**
   * 注册 Titlebar 菜单栏 —— 工具挂载即注册,卸载自动清空。
   *
   * 菜单结构:
   * - File:
   *   - 新建 tab(快捷键 Ctrl+N)        → toolbar-new
   *   - 打开文件...(快捷键 Ctrl+O)      → toolbar-open
   *   - 分隔线
   *   - 保存(快捷键 Ctrl+S)             → toolbar-save(disabled 无激活 tab)
   *   - 全部保存(快捷键 Ctrl+Shift+S)
   *   - 分隔线
   *   - 关闭(disabled 无激活 tab)
   *   - 全部关闭(disabled 无 tab)       → toolbar-close-all
   * - View:
   *   - 切换左栏(快捷键 Ctrl+B)         → toolbar-toggle-sidebar
   *
   * testId 沿用旧工具栏命名,保证现有测试无需修改。
   */
  const menus = useMemo<ToolMenu[]>(
    () => [
      {
        id: 'file',
        label: '文件',
        groups: [
          {
            items: [
              {
                id: 'new',
                label: '新建',
                shortcut: 'Ctrl+N',
                icon: FilePlus2,
                onSelect: handleNewTab,
                testId: 'toolbar-new',
              },
              {
                id: 'open',
                label: '打开...',
                shortcut: 'Ctrl+O',
                icon: FolderOpen,
                onSelect: () => void handleOpen(),
                testId: 'toolbar-open',
              },
            ],
          },
          {
            items: [
              {
                id: 'save',
                label: '保存',
                shortcut: 'Ctrl+S',
                onSelect: handleSave,
                disabled: !activeTab,
                testId: 'toolbar-save',
              },
              {
                id: 'save-all',
                label: '全部保存',
                shortcut: 'Ctrl+Shift+S',
                onSelect: () => void handleSaveAll(),
                disabled: workspace.tabs.every((t) => t.content === t.savedContent),
              },
            ],
          },
          {
            items: [
              {
                id: 'close',
                label: '关闭',
                shortcut: 'Ctrl+W',
                onSelect: handleCloseCurrent,
                disabled: !activeTab,
              },
              {
                id: 'close-all',
                label: '全部关闭',
                shortcut: 'Ctrl+Shift+W',
                onSelect: requestCloseAll,
                disabled: workspace.tabs.length === 0,
                testId: 'toolbar-close-all',
              },
            ],
          },
        ],
      },
      {
        id: 'view',
        label: '视图',
        groups: [
          {
            items: [
              {
                id: 'toggle-sidebar',
                label: workspace.leftSidebarVisible ? '隐藏左栏' : '显示左栏',
                shortcut: 'Ctrl+B',
                onSelect: handleToggleSidebar,
                testId: 'toolbar-toggle-sidebar',
              },
            ],
          },
        ],
      },
    ],
    [
      activeTab,
      workspace.leftSidebarVisible,
      workspace.tabs,
      handleCloseCurrent,
      handleNewTab,
      handleOpen,
      handleSave,
      handleSaveAll,
      handleToggleSidebar,
      requestCloseAll,
    ],
  );
  useToolMenus(toolId, menus);

  /** 未保存对话框:保存并关闭(仅 close-tab;另存为被取消则保持打开) */
  const handleUnsavedSave = useCallback(() => {
    if (!unsaved || unsaved.mode !== 'close-tab' || !unsaved.tabId) return;
    const { tabId } = unsaved;
    void saveTabById(tabId).then((saved) => {
      if (saved) {
        useEditorWorkspaceStore.getState().closeTab(tabId);
        setUnsaved(null);
      }
    });
  }, [unsaved, saveTabById]);

  /** 未保存对话框:不保存关闭 / 确认关闭固定 Tab / 放弃并退出 */
  const handleUnsavedDiscard = useCallback(() => {
    if (!unsaved) return;
    const state = useEditorWorkspaceStore.getState();
    if ((unsaved.mode === 'close-tab' || unsaved.mode === 'close-pinned') && unsaved.tabId) {
      state.closeTab(unsaved.tabId);
    } else if (unsaved.mode === 'close-all') {
      state.closeAllTabs();
    } else if (unsaved.mode === 'close-batch' && unsaved.tabId) {
      if (unsaved.batchAction === 'close-others') {
        state.closeOtherTabs(unsaved.tabId);
      } else {
        state.closeRightTabs(unsaved.tabId);
      }
    } else if (unsaved.mode === 'quit-app') {
      // 放弃未保存内容,直接退出应用
      void safeInvoke('app_quit');
    }
    setUnsaved(null);
  }, [unsaved]);

  /** 未保存对话框:取消(保持打开 / 留在应用) */
  const handleUnsavedCancel = useCallback(() => {
    if (unsaved?.mode === 'quit-app') {
      // 复位后端关闭确认流程,下次关闭窗口可再次确认
      void windowCloseCancel();
    }
    setUnsaved(null);
  }, [unsaved]);

  const dirtyCount = workspace.tabs.filter((t) => t.content !== t.savedContent).length;
  const unsavedTabTitle =
    (unsaved?.mode === 'close-tab' || unsaved?.mode === 'close-pinned') && unsaved.tabId
      ? workspace.tabs.find((t) => t.id === unsaved.tabId)?.title
      : undefined;

  // 移除原顶部工具栏:打开/新建/保存/关闭等操作已迁入 Titlebar 菜单栏。
  // 空状态仍保留「打开文件 / 新建」快捷按钮(无 Tab 时无菜单可用,作为兜底入口)。

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background-layer" data-testid="editor-workbench">
        <div
          className="flex h-full min-h-0 w-full min-w-0 flex-1 gap-1 overflow-hidden"
          data-testid="editor-split"
        >
          {/* 左栏卡片:固定像素宽度,由 sidebarWidth(持久化)控制,收起时宽度 0。
            @container/sidebar:注册命名容器,侧栏缩窄时内部标题栏可按容器宽度
            压缩间距(padding/gap),保证徽章与悬浮按钮组都能完整显示不被裁切。 */}
          <div
            className="h-full shrink-0 overflow-hidden rounded-lg border border-border bg-sidebar shadow-sm transition-shadow @container/sidebar"
            style={{ width: workspace.leftSidebarVisible ? `${workspace.sidebarWidth}px` : 0 }}
          >
            <EditorLeftSidebar
              tabs={workspace.tabs}
              activeTabId={workspace.activeTabId}
              dirtyCount={workspace.tabs.filter((t) => t.content !== t.savedContent).length}
              selectedTabIds={selectedTabIds}
              onSelect={handleSelectTab}
              onSelectMany={handleSelectMany}
              onCompareSelected={handleCompareSelected}
              compares={compares}
              activeCompareId={activeCompareId}
              onSelectCompare={handleSelectCompare}
              onCloseCompare={handleCloseCompare}
              onCloseAllCompares={handleCloseAllCompares}
              onClose={requestCloseTab}
              onCloseOthers={(id) => requestCloseBatch('close-others', id)}
              onCloseRight={(id) => requestCloseBatch('close-right', id)}
              onCloseSaved={requestCloseSaved}
              onTogglePin={handleTogglePin}
              onSave={(id) => void saveTabById(id)}
              onRevealInExplorer={handleRevealInExplorer}
              onCopyPath={handleCopyPath}
              // 文件列表拖拽排序:与 Tab 栏共用同一 store 动作,实现双向同步
              onReorder={(dragId, beforeTabId) =>
                useEditorWorkspaceStore.getState().reorderTabs(dragId, beforeTabId)
              }
              onNewTab={handleNewTab}
              onSaveAll={() => void handleSaveAll()}
              onCloseAll={requestCloseAll}
              saveAllDisabled={workspace.tabs.length === 0}
              closeAllDisabled={workspace.tabs.length === 0}
              // 拖拽分隔条期间强制按钮/徽章保持显示(避免鼠标移出面板导致闪烁)
              actionsForced={handleHovered || handleActive}
              data-testid="editor-sidebar"
            />
          </div>
          {/* 自定义拖拽分隔条:位于两卡片中间,hover/聚焦时高亮 */}
          <SidebarResizeHandle onHoverChange={setHandleHovered} onActiveChange={setHandleActive} />
          {/* 右侧主页面卡片:含 Tab 栏与编辑器。
          编辑器直接撑满整个卡片内容区(去掉内边距与上下间距),与设计图一致。 */}
          <div className="flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <EditorTabsBar
              tabs={workspace.tabs}
              activeTabId={workspace.activeTabId}
              onSelect={handleSelectTab}
              onClose={requestCloseTab}
              compares={compares}
              activeCompareId={activeCompareId}
              onSelectCompare={handleSelectCompare}
              onCloseCompare={handleCloseCompare}
              onCloseOthers={(id) => requestCloseBatch('close-others', id)}
              onCloseRight={(id) => requestCloseBatch('close-right', id)}
              onCloseSaved={requestCloseSaved}
              onCloseAll={requestCloseAll}
              onTogglePin={handleTogglePin}
              onReorder={(dragId, beforeTabId) =>
                useEditorWorkspaceStore.getState().reorderTabs(dragId, beforeTabId)
              }
              onSave={(id) => void saveTabById(id)}
              onRevealInExplorer={handleRevealInExplorer}
              onCopyPath={handleCopyPath}
              data-testid="editor-tabs"
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showCompare && compareLeft && compareRight ? (
                /* 对比差异视图:直接在页面中显示,两侧均可直接编辑 */
                <FileCompareView
                  key={activeCompareId ?? 'compare'}
                  left={compareLeft}
                  right={compareRight}
                  onChangeLeft={(v) =>
                    useEditorWorkspaceStore.getState().setTabContent(compareLeft.id, v)
                  }
                  onChangeRight={(v) =>
                    useEditorWorkspaceStore.getState().setTabContent(compareRight.id, v)
                  }
                  data-testid="compare-view"
                />
              ) : activeTab ? (
                <CodeEditor
                  key={activeTab.id}
                  data-testid="editor"
                  // 本地文件:工具栏展示路径面包屑(分段,末段为当前页);
                  // untitled 文件:仍展示文件名(untitled-1)纯文本
                  {...(activeTab.path
                    ? {
                        header: <PathBreadcrumb path={activeTab.path} data-testid="editor-path" />,
                      }
                    : { title: activeTab.title })}
                  language={activeTab.language}
                  value={activeTab.content}
                  onChange={(v) =>
                    useEditorWorkspaceStore.getState().setTabContent(activeTab.id, v)
                  }
                  minimap
                  onMount={handleEditorMount}
                  // 嵌入模式:外层右侧主页面卡片已自带 rounded-lg + border,
                  // 此处关闭 CodeEditor 自身的圆角/边框,避免双层圆角嵌套与
                  // --border/--input 颜色不一致导致的"双线"视觉
                  embedded
                  className="h-full"
                />
              ) : (
                <div
                  data-testid="editor-empty"
                  className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
                >
                  <p>无打开的编辑器</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleOpen()}
                      data-testid="empty-open"
                    >
                      <FolderOpen aria-hidden className="size-4" />
                      打开文件
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleNewTab}
                      data-testid="empty-new"
                    >
                      <FilePlus2 aria-hidden className="size-4" />
                      新建
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 未保存更改确认对话框(关闭 Tab / 全部关闭 / 退出应用) */}
        <UnsavedDialog
          open={unsaved !== null}
          mode={unsaved?.mode ?? 'close-tab'}
          tabTitle={unsavedTabTitle}
          dirtyCount={dirtyCount}
          canSave={unsaved?.mode === 'close-tab'}
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
          data-testid="unsaved-dialog"
        />
      </div>
    </TooltipProvider>
  );
}

/** 对比差异视图的 Monaco DiffEditor 配置(与文本比较工具一致,两侧均可编辑) */
const diffOptions: editor.IDiffEditorConstructionOptions = {
  originalEditable: true,
  readOnly: false,
  renderSideBySide: true,
  useShadowDOM: false,
  fontFamily:
    "var(--app-mono-font-family, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontLigatures: true,
  fontSize: 13,
  lineHeight: 20,
  lineNumbers: 'on',
  glyphMargin: false,
  folding: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: 'on',
  diffWordWrap: 'on',
  renderLineHighlight: 'all',
  renderWhitespace: 'selection',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 10, bottom: 10 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
    useShadows: false,
  },
  guides: {
    indentation: true,
    highlightActiveIndentation: true,
  },
  bracketPairColorization: { enabled: true },
  roundedSelection: true,
  overviewRulerLanes: 0,
  scrollBeyondLastColumn: 0,
  contextmenu: false,
  fixedOverflowWidgets: true,
  hideUnchangedRegions: { enabled: false },
};

/**
 * 文件对比差异视图 —— 两个已打开文件的内容并排 Diff(直接嵌入主区域)
 *
 * - 左侧为「原文件」,右侧为「目标文件」,由 Monaco DiffEditor 渲染,
 *   差异行高亮,差异区域可折叠。
 * - 与文本比较工具一致:**两侧均可直接编辑**,编辑内容实时写回对应
 *   文件 Tab(通过 onChangeLeft / onChangeRight 回调),diff 差异实时重算。
 * - 非受控策略(参考 TextCompare):挂载时用初始值 setValue 一次,
 *   之后内容保存在 Monaco model 内,不通过 props 重建,避免每次按键重建 diff。
 * - 顶部以「左 文件 A ↔ 右 文件 B」的形式展示对比双方文件名。
 */
function FileCompareView({
  left,
  right,
  onChangeLeft,
  onChangeRight,
  'data-testid': dataTestId,
}: {
  left: EditorTab;
  right: EditorTab;
  /** 左侧(原文件)内容变化回调(写回对应 Tab) */
  onChangeLeft: (value: string) => void;
  /** 右侧(目标文件)内容变化回调(写回对应 Tab) */
  onChangeRight: (value: string) => void;
  'data-testid'?: string;
}): JSX.Element {
  const themeName = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);
  // 挂载时的初始内容快照(仅在首次挂载时写入编辑器)
  const initialRef = useRef({ left: left.content, right: right.content });

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  }, []);

  // 主题变化时重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  /** 挂载 DiffEditor:写入初始内容,并订阅两侧内容变化写回 */
  const handleMount = useCallback(
    (diff: MonacoDiffEditor, monaco: Monaco) => {
      monacoRef.current = monaco;
      const originalEditor = diff.getOriginalEditor();
      const modifiedEditor = diff.getModifiedEditor();
      originalEditor.setValue(initialRef.current.left);
      modifiedEditor.setValue(initialRef.current.right);
      originalEditor.onDidChangeModelContent(() => {
        onChangeLeft(originalEditor.getValue());
      });
      modifiedEditor.onDidChangeModelContent(() => {
        onChangeRight(modifiedEditor.getValue());
      });
    },
    [onChangeLeft, onChangeRight],
  );

  return (
    <div data-testid={dataTestId} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {/* 对比双方文件名头 */}
      <div
        data-testid={`${dataTestId}-headers`}
        className="flex shrink-0 items-center gap-2 border-b border-input px-2 py-1 text-xs"
      >
        <span
          data-testid={`${dataTestId}-left-title`}
          className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 bg-muted text-muted-foreground"
          title={left.path ?? left.title}
        >
          {left.title}
        </span>
        <GitCompareArrows aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          data-testid={`${dataTestId}-right-title`}
          className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 bg-muted text-muted-foreground"
          title={right.path ?? right.title}
        >
          {right.title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffEditor
          language="plaintext"
          theme={themeName}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={diffOptions}
          className="h-full"
          loading={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              加载编辑器…
            </div>
          }
        />
      </div>
    </div>
  );
}

/**
 * 左栏拖拽分隔条 —— 自管理拖拽 handle
 *
 * 替代 react-resizable-panels 的 ResizablePanelGroup:
 * - mousedown 记录起始位置与初始宽度
 * - mousemove 计算新宽度(夹在 180~600px 之间)
 * - mouseup 结束并隐藏全局光标样式
 * - 拖拽中通过 setSidebarWidth 写入 store,经 persist 防抖持久化
 *
 * 优势:不受容器宽度百分比 layout 限制,左栏始终有明确的像素宽度。
 *
 * 视觉反馈:
 * - 默认:完全透明 — 两卡片之间只有窄间距,没有分割线
 * - hover/focus/active:显示一条与分割空间同宽(4px)的主色蓝线,
 *   同时出现 grip 图标,用户一眼即可识别「此处可拖动调整宽度」
 */
function SidebarResizeHandle({
  onHoverChange,
  onActiveChange,
}: {
  /** hover 状态变化回调(父组件用于联动侧栏动作按钮显隐) */
  onHoverChange?: (v: boolean) => void;
  /** 拖拽中状态变化回调(同上) */
  onActiveChange?: (v: boolean) => void;
}): JSX.Element {
  const startWidthRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  /** 订阅当前左栏宽度,用于可访问性 aria-valuenow 实时跟随拖拽更新 */
  const sidebarWidth = useEditorWorkspaceStore((s) => s.workspace.sidebarWidth);

  /** 统一的 hover 状态更新:内部 state + 外部回调保持同步 */
  const updateHovered = (v: boolean): void => {
    setHovered(v);
    onHoverChange?.(v);
  };
  /** 统一的拖拽中状态更新:内部 state + 外部回调保持同步 */
  const updateActive = (v: boolean): void => {
    setActive(v);
    onActiveChange?.(v);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    startWidthRef.current = useEditorWorkspaceStore.getState().workspace.sidebarWidth;
    startXRef.current = e.clientX;
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = 'col-resize';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = 'none';
    updateActive(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  function handleMouseMove(ev: MouseEvent): void {
    const delta = ev.clientX - startXRef.current;
    const next = Math.min(600, Math.max(180, startWidthRef.current + delta));
    useEditorWorkspaceStore.getState().setSidebarWidth(next);
  }

  function handleMouseUp(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = '';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = '';
    updateActive(false);
  }

  const highlighted = hovered || active;

  return (
    <div
      data-testid="editor-split-handle"
      onMouseDown={onMouseDown}
      onMouseEnter={() => updateHovered(true)}
      onMouseLeave={() => updateHovered(false)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={sidebarWidth}
      aria-valuemin={180}
      aria-valuemax={600}
      tabIndex={0}
      title="拖动调整文件列表宽度"
      className={cn(
        // 4px 宽点击区,恰好填满 gap-1 分割空间;默认完全透明,悬浮时才高亮
        'group relative flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center self-stretch bg-transparent focus-visible:outline-none',
      )}
    >
      {/*
       * 高亮竖线:默认透明(中间无分割线);hover/focus/active 时变为
       * 与分割空间同宽的 4px 主色蓝线,明确指示「此处可拖动」。
       */}
      <div
        aria-hidden
        className={cn(
          'h-full w-full transition-colors duration-150 ease-out',
          highlighted ? 'bg-primary' : 'bg-transparent',
        )}
      />
    </div>
  );
}
