/**
 * 编辑器工作区 —— VSCode 风格多文件工作区主组件(布局与 Tab 编排)
 *
 * 布局(自上而下 / 自左而右):
 * - 顶部操作区:原工具栏已迁移到 Titlebar 菜单栏(File / View 菜单)
 * - Tab 栏:多文件切换(标题 + 未保存圆点 + 关闭按钮)
 * - 主体:左栏「打开的编辑器」列表 + 中央 Monaco 编辑器
 * - 编辑器自带底部状态栏(行/列/字符数),右侧追加可点击的语言徽章
 *
 * 本组件只做「装配」:状态来自 useEditorWorkspaceStore,行为来自同目录
 * 的内聚 hook —— 持久化 useWorkspacePersistence、Monaco 实例登记
 * useEditorInstanceRegistry、菜单栏 useEditorWorkbenchMenus、外部变更提示
 * useExternalChangeHint、打开 useFileOpenActions、保存与冲突 useFileSaveActions、
 * 对比 useFileCompare、历史版本 useFileHistoryActions、文件树操作 useFileTreeOperations。
 * 留在本文件的是与布局/快捷键/未保存确认直接相关的编排逻辑。
 *
 * 生命周期:
 * - 挂载时 hydrate(从 Rust config 还原工作区),workspace 变更后防抖落盘
 * - 保存:已绑定路径按 Tab 编码写回(带 mtime 乐观校验);untitled 弹「另存为」
 * - 卸载时清空 Titlebar 菜单栏(由 useToolMenus effect cleanup 自动处理)
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type JSX } from 'react';
import { Columns2, Eye, FilePlus2, Folder, FolderOpen, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/ui/code-editor';
import { Button } from '@/components/ui/button';
import { RenameDialog } from '@/components/RenameDialog';
import { cycleNamingCaseShortcutHandler, toggleCaseShortcutHandler } from './namingCaseCommand';
import { getTabEditor } from '@/lib/editor-search-registry';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MonacoMenuSection } from '@/components/ui/monaco-context-menu';
import { useToolShortcut } from '@/hooks/useShortcut';
import { useEditorDisplay } from '@/hooks/useEditorDisplay';
import { writeClipboardText } from '@/lib/clipboard';
import type { ToolProps } from '@/tools/registry';
import { MarkdownEditorPane, isMarkdownDocument } from '@/tools/markdown-editor-pane';
import { useMarkdownEditorStore, type MdViewMode } from '@/tools/markdownEditorStore';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import { useLargeFileScan } from './useLargeFileScan';
import { useExternalChangeHint } from './useExternalChangeHint';
import { useWorkspacePersistence } from './useWorkspacePersistence';
import { useEditorInstanceRegistry } from './useEditorInstanceRegistry';
import { useEditorWorkbenchMenus } from './useEditorWorkbenchMenus';
import { useFileCompare } from './useFileCompare';
import { useFileHistoryActions } from './useFileHistoryActions';
import { useFileTreeOperations } from './useFileTreeOperations';
import { useFileSaveActions } from './useFileSaveActions';
import { useFileOpenActions } from './useFileOpenActions';
import {
  goBackEditLocation,
  goForwardEditLocation,
  type EditLocation,
} from './editLocationHistory';
import { LargeFileViewer } from './LargeFileViewer';
import { EditorTabsBar } from './EditorTabsBar';
import { EditorLeftSidebar } from './EditorLeftSidebar';
import { FileCompareView } from './FileCompareView';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { TreeOperationDialogs } from './TreeOperationDialogs';
import { PathBreadcrumb } from './PathBreadcrumb';
import { FileModifiedDialog } from './FileModifiedDialog';
import { type UnsavedMode, type UnsavedSource } from './UnsavedPopover';
import { EditorLanguagePicker } from './EditorLanguagePicker';
import { LANGUAGE_LABELS } from './languageMap';
import { LanguageIcon } from './languageIcons';
import { revealInExplorer } from './fileOps';
import { FileHistoryDialog } from './FileHistoryDialog';

// Monaco loader 路径配置(import 即执行,保证任何 DiffEditor 挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/** 位置恢复重试间隔与上限(对齐 useSearchJump:跨 Tab 切换后实例可能未就绪) */
const LOCATION_RETRY_INTERVAL_MS = 120;
const LOCATION_MAX_RETRIES = 20;

/**
 * 恢复一个历史编辑位置:定位目标 Tab 的编辑器实例,
 * 设置光标(行/列)并滚动到视野中央。跨 Tab 后退时切换激活先于本调用,
 * 实例经 tabId→编辑器注册表获取;模型池化下切 Tab 不重挂,通常首次即中。
 */
function revealEditLocation(loc: EditLocation, attempts = 0): void {
  const ed = getTabEditor(loc.tabId);
  const model = ed?.getModel();
  if (ed && model) {
    const line = Math.min(Math.max(1, loc.line), model.getLineCount());
    const column = Math.min(Math.max(1, loc.column), model.getLineMaxColumn(line));
    ed.setPosition({ lineNumber: line, column });
    ed.revealLineInCenter(line);
    ed.focus();
    return;
  }
  if (attempts >= LOCATION_MAX_RETRIES) return;
  window.setTimeout(() => revealEditLocation(loc, attempts + 1), LOCATION_RETRY_INTERVAL_MS);
}

/** 批量关闭意图:用于未保存确认通过后执行对应 store 动作 */
type BatchCloseAction = 'close-others' | 'close-right' | 'close-all';

/** 超过该字符数的 Tab 不渲染 minimap(超大内容下缩略图无导航价值且渲染开销大) */
const MINIMAP_DISABLE_CONTENT_CHARS = 200_000;

export function EditorWorkbench({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const workspace = useEditorWorkspaceStore((s) => s.workspace);
  const ready = useEditorWorkspaceStore((s) => s.ready);
  const hydrate = useEditorWorkspaceStore((s) => s.hydrate);
  // 编辑器展示设置:当前仅消费 minimap 全局开关(bracket/sticky/guides 等
  // 由 CodeEditor 内部直接订阅)
  const display = useEditorDisplay();
  /** 未保存确认状态(null = 关闭);batchAction 记录批量关闭意图,
   * source 记录发起区域(确认 Popover 锚定在对应区域的条目上) */
  const [unsaved, setUnsaved] = useState<{
    mode: UnsavedMode;
    tabId?: string;
    batchAction?: BatchCloseAction;
    source: UnsavedSource;
  } | null>(null);
  /** 重命名对话框目标(null = 关闭);打开时预填该 Tab 当前显示名 */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  // —— 文件对比(左栏多选 → 组成对比 → 差异视图)——
  const {
    selectedTabIds,
    compares,
    activeCompareId,
    compareLeft,
    compareRight,
    showCompare,
    clearActiveCompare,
    handleSelectTab,
    handleSelectMany,
    handleCompareSelected,
    handleSelectCompare,
    handleCloseCompare,
    handleCloseAllCompares,
    swapCompareSides,
    compareWithLatestTab,
    exportComparePatch,
    compareSnapRef,
  } = useFileCompare({ tabs: workspace.tabs, activeTabId: workspace.activeTabId });

  // —— 保存链路(写盘 / 编码另存 / 外部修改冲突三选)——
  const {
    modifiedConflict,
    closeConflict,
    conflictTab,
    saveTabById,
    handleSave,
    handleSaveAll,
    reopenWithEncoding,
    saveWithEncoding,
    handleConflictOverwrite,
    handleConflictReload,
    handleConflictCompare,
  } = useFileSaveActions({ compareWithLatestTab });

  // —— 打开链路(文件对话框 / 文件夹树节点 / 失败分流)——
  const { handleOpen, handleOpenFolder, handleOpenTreeFile } = useFileOpenActions({
    clearActiveCompare,
  });

  /** 语言模式选择对话框(右下角语言徽章触发) */
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  // —— 「历史版本」对话框(列表 / 对比 / 恢复 / 清空)——
  const {
    historyTabId,
    historySnapshots,
    historySelectedId,
    setHistorySelectedId,
    handleOpenHistory,
    handleHistoryCancel,
    handleHistoryCompare,
    handleHistoryRestore,
    handleHistoryClear,
  } = useFileHistoryActions({ compareWithLatestTab });

  // —— 文件树三操作(新建 / 重命名 / 删除;右键菜单发起)——
  const {
    treeRefreshKey,
    treeOp,
    treeDelete,
    openTreeCreate,
    openTreeRename,
    openTreeDelete,
    closeTreeOp,
    closeTreeDelete,
    handleTreeCreate,
    handleTreeRename,
    handleTreeDeleteConfirmed,
  } = useFileTreeOperations();

  // —— Markdown 视图模式(编辑/分屏/预览;仅 md 文档生效,与工具页共享偏好)——
  const mdViewMode = useMarkdownEditorStore((s) => s.viewMode);
  const setMdViewMode = useMarkdownEditorStore((s) => s.setViewMode);

  /**
   * 分隔条 hover / 拖拽中状态:
   * 拖拽分隔条时鼠标会移出侧栏面板,导致侧栏悬浮态丢失、按钮/徽章闪烁;
   * 这两个状态同步给 EditorLeftSidebar(actionsForced)保持按钮稳定显示。
   */
  const [handleHovered, setHandleHovered] = useState(false);
  const [handleActive, setHandleActive] = useState(false);

  // —— 工作区持久化(hydrate 还原 / 防抖落盘 / 关闭与卸载冲刷)——
  useWorkspacePersistence({ workspace, ready, hydrate });

  const activeTab = workspace.tabs.find((t) => t.id === workspace.activeTabId) ?? null;

  // —— Monaco 实例与 model 登记(onMount / 切 Tab / 关 Tab / 卸载)——
  const { handleEditorMount } = useEditorInstanceRegistry({
    tabs: workspace.tabs,
    activeTabId: workspace.activeTabId,
  });

  // —— 外部变更提示(watcher 推送 + 激活比对)——
  // 打开的文件被其它程序改写/删除时 toast 提示;不打断用户,也不自动弹窗,
  // 覆盖/重新加载仍由保存时的 ERR_FILE_MODIFIED 三选对话框决定。
  useExternalChangeHint({ ready, activeTab });

  // 大文件 Tab:激活时自动触发行索引扫描(进度事件订阅在 hook 内)
  useLargeFileScan(activeTab);

  // 状态栏文件大小:当前内容按 UTF-8 编码的字节长度。全文编码是 O(n)
  // 开销,经 deferred 值降为低优先级渲染,大文档快速输入时不抢占输入帧
  const statContent = useDeferredValue(activeTab?.content);
  const activeContentSizeBytes = useMemo(() => {
    if (statContent === undefined) return undefined;
    return new TextEncoder().encode(statContent).length;
  }, [statContent]);

  // —— Markdown 分屏预览:md 文档(路径后缀或 untitled 切语言)显示视图切换 ——
  const isMarkdownTab = activeTab
    ? isMarkdownDocument(activeTab.path ?? '', activeTab.language)
    : false;
  const showMdPreview = isMarkdownTab && mdViewMode !== 'edit';

  // 右上角视图切换按钮组(编辑/分屏/预览),仅 md 文档渲染
  const mdViewActions = isMarkdownTab ? (
    <div className="flex items-center gap-0.5" data-testid="editor-md-actions">
      {(
        [
          ['edit', PenLine, t('tools.text_editor.md_view_edit')],
          ['split', Columns2, t('tools.text_editor.md_view_split')],
          ['preview', Eye, t('tools.text_editor.md_view_preview')],
        ] as ReadonlyArray<[MdViewMode, typeof PenLine, string]>
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setMdViewMode(mode)}
          aria-pressed={mdViewMode === mode}
          title={t('tools.text_editor.md_view_title', { label })}
          data-testid={`editor-md-${mode}${mode === 'preview' ? '-btn' : ''}`}
          className={cn(
            'rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            mdViewMode === mode && 'bg-accent text-accent-foreground',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  ) : undefined;

  // Ctrl+S(Cmd+S)保存当前 Tab,阻止浏览器默认的「保存页面」行为。
  // 快捷键字符串可到设置里自定义;无激活 Tab 时是安全的 no-op。
  useToolShortcut(toolId, 'save_file', handleSave, [handleSave]);

  /**
   * 请求关闭单个 Tab:
   * - 未保存 → 弹「保存 / 不保存 / 取消」
   * - 固定 Tab(无论是否未保存)→ 弹「关闭 / 取消」确认
   * - 其余干净 Tab → 直接关闭
   */
  const requestCloseTab = useCallback((id: string, source: UnsavedSource = 'tabs') => {
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.pinned) {
      // 固定 Tab 关闭一律确认,避免误关用户特意保留的 Tab
      setUnsaved({ mode: 'close-pinned', tabId: id, source });
    } else if (tab.content !== tab.savedContent) {
      setUnsaved({ mode: 'close-tab', tabId: id, source });
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
  const requestCloseAll = useCallback((source: UnsavedSource = 'tabs') => {
    const state = useEditorWorkspaceStore.getState();
    const hasDirty = state.workspace.tabs.some((t) => !t.pinned && t.content !== t.savedContent);
    if (hasDirty) {
      // 确认 Popover 需要锚点条目:优先当前激活 Tab,否则退回第一个 Tab
      const anchorId = state.workspace.activeTabId ?? state.workspace.tabs[0]?.id;
      if (!anchorId) return;
      setUnsaved({ mode: 'close-all', tabId: anchorId, source });
    } else {
      state.closeAllTabs();
    }
  }, []);

  /**
   * 请求批量关闭(关闭其他 / 关闭右侧):
   * 将要被关闭的 Tab 中存在未保存时先弹确认,干净则直接执行。
   */
  const requestCloseBatch = useCallback(
    (action: BatchCloseAction, targetId: string, source: UnsavedSource = 'tabs') => {
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
        setUnsaved({ mode: 'close-batch', tabId: targetId, batchAction: action, source });
      } else if (action === 'close-others') {
        state.closeOtherTabs(targetId);
      } else {
        state.closeRightTabs(targetId);
      }
    },
    [],
  );

  /** 关闭已保存:只关干净的非固定 Tab,无需确认 */
  const requestCloseSaved = useCallback(() => {
    useEditorWorkspaceStore.getState().closeSavedTabs();
  }, []);

  /** 切换固定状态 */
  const handleTogglePin = useCallback((id: string) => {
    useEditorWorkspaceStore.getState().togglePinTab(id);
  }, []);

  /** 请求重命名 Tab:打开预填当前显示名的重命名对话框 */
  const handleRenameRequest = useCallback((id: string) => {
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    setRenaming({ id: tab.id, title: tab.title });
  }, []);

  /** 复制 Tab 路径到剪贴板 */
  const handleCopyPath = useCallback(
    (id: string) => {
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id);
      if (!tab?.path) return;
      void writeClipboardText(tab.path).then((ok) => {
        if (ok) toast.success(t('tools.text_editor.toast_path_copied', { path: tab.path }));
        else toast.error(t('tools.text_editor.err_copy_path'));
      });
    },
    [t],
  );

  /** 在系统文件管理器中显示目标文件 */
  const handleRevealInExplorer = useCallback(
    (id: string) => {
      const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === id);
      if (!tab?.path) return;
      void revealInExplorer(tab.path).catch((e) => {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_reveal'));
      });
    },
    [t],
  );

  const handleNewTab = useCallback(() => {
    useEditorWorkspaceStore.getState().newBlankTab();
    clearActiveCompare();
  }, [clearActiveCompare]);

  /** 切换左栏显隐(菜单「视图」) */
  const handleToggleSidebar = useCallback(() => {
    useEditorWorkspaceStore.getState().toggleLeftSidebar();
  }, []);

  /**
   * 恢复最近关闭的 Tab(Ctrl+Shift+T):栈空时静默 no-op;
   * 恢复成功后退出对比视图(与打开/切换文件的行为一致)。
   */
  const reopenClosedTab = useCallback(() => {
    if (useEditorWorkspaceStore.getState().reopenClosedTab()) {
      clearActiveCompare();
    }
  }, [clearActiveCompare]);

  /**
   * 循环切换激活 Tab(Ctrl+Tab / Ctrl+Shift+Tab):跨 Tab 循环导航。
   */
  const cycleActiveTab = useCallback((direction: 'next' | 'previous') => {
    useEditorWorkspaceStore.getState().cycleActiveTab(direction);
  }, []);

  /**
   * 位置历史导航(Alt+Left / Alt+Right,浏览器后退-前进心智):
   * - 目标 Tab 与当前不同 → 先切换激活(复用 handleEditorMount 注册的
   *   tabId→实例表,等待重试由位置恢复统一处理);
   * - 激活后经注册表定位编辑器实例,setPosition + revealLineInCenter;
   * - 目标 Tab 已被关闭 → 丢弃该条并继续弹栈取下一条;
   * - 空栈静默 no-op(与 reopenClosedTab 行为一致)。
   */
  const navigateEditHistory = useCallback((direction: 'back' | 'forward') => {
    const state = useEditorWorkspaceStore.getState();
    for (;;) {
      const target = direction === 'back' ? goBackEditLocation() : goForwardEditLocation();
      if (!target) return;
      const exists = state.workspace.tabs.some((t) => t.id === target.tabId);
      if (!exists) continue; // 目标 Tab 已关闭:丢弃,继续弹下一条
      if (state.workspace.activeTabId !== target.tabId) state.switchTab(target.tabId);
      revealEditLocation(target);
      return;
    }
  }, []);

  /**
   * 文本编辑器工作区快捷键全套(菜单 File/View 项的键盘入口):
   * 全部经 useToolShortcut 读取用户可自定义的绑定,菜单标签经 shortcutLabel
   * 同源渲染,保证「标签显示的 = 实际生效的」。守卫保证 keepalive 下其它
   * 常驻工具(如 Markdown 预览)激活时按键不误进本工作区。卸载(切换
   * 工具)自动解除监听,不影响其它工具。
   */
  useToolShortcut(toolId, 'new_file', handleNewTab, [handleNewTab]);
  useToolShortcut(toolId, 'open_file', () => void handleOpen(), [handleOpen]);
  useToolShortcut(toolId, 'save_all', () => void handleSaveAll(), [handleSaveAll]);
  useToolShortcut(toolId, 'close_editor', handleCloseCurrent, [handleCloseCurrent]);
  useToolShortcut(toolId, 'close_all_editors', () => requestCloseAll('tabs'), [requestCloseAll]);
  useToolShortcut(toolId, 'toggle_editor_sidebar', handleToggleSidebar, [handleToggleSidebar]);
  useToolShortcut(toolId, 'next_tab', () => cycleActiveTab('next'), []);
  useToolShortcut(toolId, 'previous_tab', () => cycleActiveTab('previous'), []);
  useToolShortcut(toolId, 'reopen_closed_tab', reopenClosedTab, [reopenClosedTab]);
  useToolShortcut(toolId, 'navigate_edit_back', () => navigateEditHistory('back'), []);
  useToolShortcut(toolId, 'navigate_edit_forward', () => navigateEditHistory('forward'), []);
  // Alt+1..9 直达第 N 个 Tab:固定映射不进 ShortcutBinding(九个键位
  // 挤占设置页且录制繁琐,VSCode/浏览器同样固定);超出 Tab 数夹到末尾
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const { tabs } = useEditorWorkspaceStore.getState().workspace;
      if (tabs.length === 0) return;
      e.preventDefault();
      useEditorWorkspaceStore.getState().selectTabIndex(Math.min(n, tabs.length) - 1);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // —— Titlebar 菜单栏:工具挂载即注册,卸载自动清空(声明见 hook 内注释)——
  useEditorWorkbenchMenus({
    toolId,
    activeTab,
    tabs: workspace.tabs,
    leftSidebarVisible: workspace.leftSidebarVisible,
    actions: {
      newTab: handleNewTab,
      open: handleOpen,
      openFolder: handleOpenFolder,
      save: handleSave,
      saveAll: handleSaveAll,
      closeCurrent: handleCloseCurrent,
      closeAll: requestCloseAll,
      toggleSidebar: handleToggleSidebar,
    },
  });

  /**
   * 右键菜单自定义分组(按页面定制显示):文本编辑器页注入
   * 「切换字符命名风格 / 切换大小写」。动作复用全局快捷键处理器,
   * 其内部作用于当前激活编辑器的选区(handleEditorMount 已注册)。
   */
  const editorMenuSections = useMemo<MonacoMenuSection[]>(
    () => [
      {
        id: 'naming',
        items: [
          {
            id: 'cycle-naming-case',
            label: t('tools.text_editor.ctx_naming_case'),
            shortcut: 'Ctrl+Shift+U',
            onSelect: cycleNamingCaseShortcutHandler,
          },
          {
            id: 'toggle-case',
            label: t('tools.text_editor.ctx_toggle_case'),
            shortcut: 'Ctrl+Shift+L',
            onSelect: toggleCaseShortcutHandler,
          },
        ],
      },
    ],
    [t],
  );

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

  /** 未保存对话框:不保存关闭 / 确认关闭固定 Tab */
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
    }
    setUnsaved(null);
  }, [unsaved]);

  /** 未保存对话框:取消(保持打开) */
  const handleUnsavedCancel = useCallback(() => {
    setUnsaved(null);
  }, [unsaved]);

  const dirtyCount = workspace.tabs.filter((t) => t.content !== t.savedContent).length;
  /** 未保存关闭确认:按发起区域(source)分发,同一确认框只锚定在对应区域的条目上 */
  const unsavedConfirm = unsaved
    ? {
        tabId: unsaved.tabId ?? '',
        mode: unsaved.mode,
        dirtyCount,
        canSave: unsaved.mode === 'close-tab',
        source: unsaved.source,
      }
    : null;

  // 移除原顶部工具栏:打开/新建/保存/关闭等操作已迁入 Titlebar 菜单栏。
  // 空状态仍保留「打开文件 / 新建」快捷按钮(无 Tab 时无菜单可用,作为兜底入口)。

  // 主编辑器(单一实例定义,普通/分屏/预览布局按需复用)。
  // model 池化:不再用 key={tabId} 重挂载整个 CodeEditor——modelKey 传 tabId,
  // @monaco-editor/react 按 path 缓存 Monaco model,切 Tab 仅 setModel:
  // undo 栈与 viewState(滚动/选区)跨切换存活,切换也不再整编辑器重建
  const editorPane = activeTab ? (
    <CodeEditor
      data-testid="editor"
      searchAnchor="text_editor:editor"
      modelKey={activeTab.id}
      // 本地文件:工具栏展示路径面包屑(分段,末段为当前页);
      // untitled 文件:仍展示文件名(untitled-1)纯文本
      {...(activeTab.path
        ? {
            header: <PathBreadcrumb path={activeTab.path} data-testid="editor-path" />,
          }
        : { title: activeTab.title })}
      language={activeTab.language}
      value={activeTab.content}
      onChange={(v) => useEditorWorkspaceStore.getState().setTabContent(activeTab.id, v)}
      // 自动换行按 Tab 独立记忆(右键菜单「自动换行」切换),
      // 只作用于当前编辑器;随工作区持久化
      wordWrap={activeTab.wordWrap ?? true}
      onToggleWordWrap={() => {
        useEditorWorkspaceStore.getState().toggleTabWordWrap(activeTab.id);
      }}
      // 文件编码:状态栏展示并可切换,保存时按该编码写回(仿 VSCode)
      encoding={activeTab.encoding ?? 'utf-8'}
      // 「通过编码重新打开」仅在 Tab 已绑定磁盘路径时可用
      encodingReopenAvailable={Boolean(activeTab.path)}
      onEncodingReopen={(enc) => void reopenWithEncoding(enc)}
      onEncodingSave={(enc) => void saveWithEncoding(enc)}
      // 状态栏右下角文件大小(UTF-8 字节,B/KB/MB/GB)
      sizeBytes={activeContentSizeBytes}
      onEncodingChange={(enc) =>
        useEditorWorkspaceStore.getState().setTabEncoding(activeTab.id, enc)
      }
      // 行尾序列设置(快选弹窗选择目标值):内容转换后标记未保存,由用户手动保存
      onEolChange={(eol) => {
        const cur = useEditorWorkspaceStore.getState();
        const tab = cur.workspace.tabs.find((t) => t.id === activeTab.id);
        if (!tab) return;
        const next =
          eol === 'CRLF'
            ? tab.content.replace(/(?<!\r)\n/g, '\r\n')
            : tab.content.replace(/\r\n/g, '\n');
        if (next !== tab.content) cur.setTabContent(activeTab.id, next);
      }}
      // 右键菜单按页面定制:命名风格切换 / 大小写转换(作用于当前编辑器选区)
      contextMenuSections={editorMenuSections}
      // 缩略图:全局设置(设置 → 文本编辑器)默认开关,叠加超大内容防护——
      // 超大 Tab(如强制打开的二进制转储)下 minimap 渲染开销显著且无导航
      // 价值,无视设置直接关闭
      minimap={(activeTab.content?.length ?? 0) <= MINIMAP_DISABLE_CONTENT_CHARS && display.minimap}
      onMount={handleEditorMount}
      // 右上角 Markdown 视图切换(编辑/分屏/预览),仅 md 文档渲染
      actions={mdViewActions}
      // 右下角语言徽章(仿 VSCode):带语言图标 + 中文名,
      // 点击弹出「选择语言模式」对话框,切换该 Tab 的 Monaco 高亮
      statusBarRight={
        <button
          type="button"
          onClick={() => setLanguagePickerOpen(true)}
          title={t('tools.text_editor.select_language_mode')}
          data-testid="editor-language-badge"
          className="flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LanguageIcon language={activeTab.language} />
          {activeTab.language === 'plaintext'
            ? t('tools.text_editor.lang_plaintext')
            : LANGUAGE_LABELS[activeTab.language]}
        </button>
      }
      // 嵌入模式:外层右侧主页面卡片已自带 rounded-lg + border,
      // 此处关闭 CodeEditor 自身的圆角/边框,避免双层圆角嵌套与
      // --border/--input 颜色不一致导致的"双线"视觉
      embedded
      className="h-full"
    />
  ) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background-layer" data-testid="editor-workbench">
        <div
          className="flex h-full min-h-0 w-full min-w-0 flex-1 gap-0.5 overflow-hidden"
          data-testid="editor-split"
        >
          {/* 左栏卡片:固定像素宽度,由 sidebarWidth(持久化)控制,收起时宽度 0。
            @container/sidebar:注册命名容器,侧栏缩窄时内部标题栏可按容器宽度
            压缩间距(padding/gap),保证徽章与悬浮按钮组都能完整显示不被裁切。 */}
          <div
            className="h-full shrink-0 overflow-hidden rounded-lg border border-border bg-sidebar shadow-sm transition-shadow @container/sidebar"
            style={{ width: workspace.leftSidebarVisible ? `${workspace.sidebarWidth}px` : 0 }}
            data-search-anchor="text_editor:sidebar"
          >
            <EditorLeftSidebar
              tabs={workspace.tabs}
              activeTabId={workspace.activeTabId}
              dirtyCount={workspace.tabs.filter((t) => t.content !== t.savedContent).length}
              selectedTabIds={selectedTabIds}
              // 「文件夹」树分组:已打开根文件夹的懒加载目录树(展开状态持久化)
              folders={workspace.folders}
              expandedDirs={workspace.expandedDirs}
              onToggleDir={(dirPath) =>
                useEditorWorkspaceStore.getState().toggleDirExpanded(dirPath)
              }
              onCloseFolder={(rootPath) => useEditorWorkspaceStore.getState().closeFolder(rootPath)}
              onOpenTreeFile={(path) => void handleOpenTreeFile(path)}
              // 文件树右键三操作:新建 / 重命名 / 删除(树内右键菜单发起,
              // hook 内做 IPC + Tab/展开状态同步 + 树刷新)
              treeRefreshKey={treeRefreshKey}
              onCreateTreeEntry={openTreeCreate}
              onRenameTreeEntry={openTreeRename}
              onDeleteTreeEntry={openTreeDelete}
              onRevealTreeEntry={(entry) => {
                void revealInExplorer(entry.path).catch((e) => {
                  toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_reveal'));
                });
              }}
              onCopyTreeEntryPath={(entry) => {
                void writeClipboardText(entry.path).then((ok) => {
                  if (ok)
                    toast.success(t('tools.text_editor.toast_path_copied', { path: entry.path }));
                  else toast.error(t('tools.text_editor.err_copy_path'));
                });
              }}
              onSelect={handleSelectTab}
              onSelectMany={handleSelectMany}
              onCompareSelected={handleCompareSelected}
              compares={compares}
              activeCompareId={activeCompareId}
              onSelectCompare={handleSelectCompare}
              onCloseCompare={handleCloseCompare}
              onCloseAllCompares={handleCloseAllCompares}
              // 左栏发起的关闭:确认框锚定在左栏列表项上(source='sidebar')
              onClose={(id) => requestCloseTab(id, 'sidebar')}
              onCloseOthers={(id) => requestCloseBatch('close-others', id, 'sidebar')}
              onCloseRight={(id) => requestCloseBatch('close-right', id, 'sidebar')}
              onCloseSaved={requestCloseSaved}
              onTogglePin={handleTogglePin}
              onRename={handleRenameRequest}
              onSave={(id) => void saveTabById(id)}
              onHistory={handleOpenHistory}
              onRevealInExplorer={handleRevealInExplorer}
              onCopyPath={handleCopyPath}
              // 文件列表拖拽排序:与 Tab 栏共用同一 store 动作,实现双向同步
              onReorder={(dragId, beforeTabId) =>
                useEditorWorkspaceStore.getState().reorderTabs(dragId, beforeTabId)
              }
              onNewTab={handleNewTab}
              onSaveAll={() => void handleSaveAll()}
              onCloseAll={() => requestCloseAll('sidebar')}
              // 左栏发起的关闭确认:锚定在对应列表项下方
              unsavedConfirm={unsavedConfirm?.source === 'sidebar' ? unsavedConfirm : null}
              onUnsavedSave={handleUnsavedSave}
              onUnsavedDiscard={handleUnsavedDiscard}
              onUnsavedCancel={handleUnsavedCancel}
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
              onRename={handleRenameRequest}
              onReorder={(dragId, beforeTabId) =>
                useEditorWorkspaceStore.getState().reorderTabs(dragId, beforeTabId)
              }
              onSave={(id) => void saveTabById(id)}
              onHistory={handleOpenHistory}
              onRevealInExplorer={handleRevealInExplorer}
              onCopyPath={handleCopyPath}
              // 未保存/固定 Tab 关闭确认:锚定在目标 Tab 下方的小 Popover
              // (仅本区域发起时显示;左栏发起的锚到左栏列表项)
              unsavedConfirm={unsavedConfirm?.source === 'tabs' ? unsavedConfirm : null}
              onUnsavedSave={handleUnsavedSave}
              onUnsavedDiscard={handleUnsavedDiscard}
              onUnsavedCancel={handleUnsavedCancel}
              data-testid="editor-tabs"
            />

            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              data-search-anchor={showCompare ? 'text_editor:compare' : undefined}
            >
              {showCompare && compareLeft && compareRight ? (
                /* 对比差异视图:直接在页面中显示,两侧均可直接编辑;
                 * toolbar 注入「交换两侧 / 导出补丁」动作(能力与文本比较工具
                 * 同源,共享 TextDiffView 与 diff-utils) */
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
                  onSwap={() => {
                    if (activeCompareId) swapCompareSides(activeCompareId);
                  }}
                  onExportPatch={() => void exportComparePatch(compareLeft, compareRight)}
                  onDiffSnapshot={(snap) => {
                    compareSnapRef.current = snap;
                  }}
                  data-testid="compare-view"
                />
              ) : activeTab ? (
                activeTab.largeFile ? (
                  /* 大文件只读视图:超过编辑器整读上限的文件流式查看
                   * (虚拟滚动 + 行窗口按需读取,内容不进内存) */
                  <LargeFileViewer
                    key={activeTab.id}
                    tab={activeTab}
                    data-testid="large-file-viewer"
                  />
                ) : showMdPreview ? (
                  // Markdown 分屏/预览:左侧编辑器(预览模式下隐藏)+ 右侧渲染面板。
                  // 预览模式下编辑器(连同其工具栏按钮)已卸载,
                  // 故在面板右上角以浮层渲染同一组视图切换按钮,保证始终可切回
                  <div className="flex h-full min-h-0" data-testid="editor-md-layout">
                    {mdViewMode !== 'preview' && <div className="min-w-0 flex-1">{editorPane}</div>}
                    <div className="relative min-w-0 flex-1 overflow-hidden border-l border-border">
                      <MarkdownEditorPane source={activeTab.content} className="h-full" />
                      {mdViewMode === 'preview' && (
                        <div className="absolute right-3 top-2 z-10 rounded-md border border-border bg-background/80 p-0.5 backdrop-blur-sm">
                          {mdViewActions}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  editorPane
                )
              ) : (
                <div
                  data-testid="editor-empty"
                  // 最小高度避免主容器高度不足时「居中」退化为「贴顶」;
                  // py-16 给标题/按钮上下均匀留白,视觉上「靠下」而非紧贴 Tab 栏
                  className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground"
                >
                  <FilePlus2 aria-hidden className="size-10 opacity-40" />
                  <p>{t('tools.text_editor.no_open_editors')}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleOpen()}
                      data-testid="empty-open"
                    >
                      <FolderOpen aria-hidden className="size-4" />
                      {t('tools.text_editor.action_open_file')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleOpenFolder()}
                      data-testid="empty-open-folder"
                    >
                      <Folder aria-hidden className="size-4" />
                      {t('tools.text_editor.action_open_folder')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleNewTab}
                      data-testid="empty-new"
                    >
                      <FilePlus2 aria-hidden className="size-4" />
                      {t('tools.text_editor.menu_new')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 重命名对话框(条件渲染:关闭即卸载,每次打开预填当前显示名) */}
        {renaming && (
          <RenameDialog
            open
            title={t('tools.text_editor.rename')}
            initialValue={renaming.title}
            onConfirm={(name) => {
              useEditorWorkspaceStore.getState().renameTab(renaming.id, name);
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
            data-testid="tab-rename-dialog"
          />
        )}

        {/* 文件树操作:名称输入(新建/重命名)+ 删除确认 */}
        <TreeOperationDialogs
          treeOp={treeOp}
          treeDelete={treeDelete}
          onCreateConfirm={handleTreeCreate}
          onRenameConfirm={handleTreeRename}
          onDeleteConfirm={handleTreeDeleteConfirmed}
          onCloseOp={closeTreeOp}
          onCloseDelete={closeTreeDelete}
        />

        {/* 保存冲突三选(磁盘文件已被外部修改):覆盖 / 对比 / 重新加载 */}
        {modifiedConflict && (
          <FileModifiedDialog
            open
            fileName={conflictTab?.title ?? ''}
            onOverwrite={handleConflictOverwrite}
            onCompare={() => void handleConflictCompare()}
            onReload={handleConflictReload}
            onCancel={closeConflict}
            data-testid="file-modified-dialog"
          />
        )}

        {/* 历史版本对话框(Tab 右键「历史版本」):列表 + 对比/恢复/清空 */}
        {historyTabId && (
          <FileHistoryDialog
            open
            fileName={
              useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === historyTabId)
                ?.title ?? ''
            }
            snapshots={historySnapshots ?? []}
            loading={historySnapshots === null}
            selectedId={historySelectedId}
            onSelect={setHistorySelectedId}
            onCompare={handleHistoryCompare}
            onRestore={handleHistoryRestore}
            onClear={handleHistoryClear}
            onCancel={handleHistoryCancel}
            data-testid="file-history-dialog"
          />
        )}

        {/* 语言模式选择对话框(右下角语言徽章触发):切换当前 Tab 的 Monaco 高亮语言 */}
        {activeTab && (
          <EditorLanguagePicker
            open={languagePickerOpen}
            onOpenChange={setLanguagePickerOpen}
            currentLanguage={activeTab.language}
            onSelect={(language) => {
              useEditorWorkspaceStore.getState().setTabLanguage(activeTab.id, language);
              setLanguagePickerOpen(false);
            }}
            onSelectAuto={() => {
              useEditorWorkspaceStore.getState().setTabLanguageAuto(activeTab.id);
              setLanguagePickerOpen(false);
            }}
            data-testid="editor-language-picker"
          />
        )}
      </div>
    </TooltipProvider>
  );
}
