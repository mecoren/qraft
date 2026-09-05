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
import type { editor } from 'monaco-editor';
import { Columns2, Eye, FilePlus2, Folder, FolderOpen, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/ui/code-editor';
import { TextDiffView } from '@/components/text-diff/TextDiffView';
import { Button } from '@/components/ui/button';
import { RenameDialog } from '@/components/RenameDialog';
import {
  registerActiveEditor,
  unregisterActiveEditor,
  cycleNamingCaseShortcutHandler,
  toggleCaseShortcutHandler,
} from './namingCaseCommand';
import { registerTabEditor, clearTabEditors } from '@/lib/editor-search-registry';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MonacoMenuSection } from '@/components/ui/monaco-context-menu';
import { useShortcut } from '@/hooks/useShortcut';
import { listen, safeInvoke, CommandError } from '@/lib/ipc';
import { writeClipboardText } from '@/lib/clipboard';
import type { ToolProps } from '@/tools/registry';
import { MarkdownPreviewPane, isMarkdownDocument } from '@/tools/markdown-preview-pane';
import { useMarkdownPreviewStore, type MdViewMode } from '@/tools/markdownPreviewStore';
import { useEditorWorkspaceStore, folderNameFromPath } from './useEditorWorkspaceStore';
import { EditorTabsBar } from './EditorTabsBar';
import { EditorLeftSidebar } from './EditorLeftSidebar';
import { PathBreadcrumb } from './PathBreadcrumb';
import { type UnsavedMode, type UnsavedSource } from './UnsavedPopover';
import { EditorLanguagePicker } from './EditorLanguagePicker';
import { LANGUAGE_LABELS, fileNameFromPath, inferLanguageFromPath } from './languageMap';
import { LanguageIcon } from './languageIcons';
import {
  OPEN_REASON_BINARY,
  OPEN_REASON_TOO_LARGE,
  forceOpenFile,
  openTextFileDialog,
  openFolderDialog,
  readTextFileEncoded,
  revealInExplorer,
  saveToPathEncoded,
  saveWithDialog,
  saveWithDialogEncoded,
  windowCloseReady,
  type OpenFileFailure,
} from './fileOps';
import { formatBytes } from '@/lib/file-utils';
import { useToolMenus } from '@/store/toolMenubarStore';
import type { ToolMenu } from '@/types/tool-menu';
import {
  resolveSidebarResize,
  SIDEBAR_HIDE_DELTA,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type ComparePair,
  type EditorTab,
} from './schema';

// Monaco loader 路径配置(import 即执行,保证任何 DiffEditor 挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/** 批量关闭意图:用于未保存确认通过后执行对应 store 动作 */
type BatchCloseAction = 'close-others' | 'close-right' | 'close-all';

/** workspace 变更后持久化防抖间隔(ms) */
const PERSIST_DEBOUNCE_MS = 400;

/** 超过该字符数的 Tab 不渲染 minimap(超大内容下缩略图无导航价值且渲染开销大) */
const MINIMAP_DISABLE_CONTENT_CHARS = 200_000;

/** 生成稳定唯一对比 id */
function createCompareId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `compare-${crypto.randomUUID()}`;
  }
  return `compare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function EditorWorkbench({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const workspace = useEditorWorkspaceStore((s) => s.workspace);
  const ready = useEditorWorkspaceStore((s) => s.ready);
  const hydrate = useEditorWorkspaceStore((s) => s.hydrate);
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
  /**
   * 左栏 Ctrl+多选选中的文件(id 集合,不含激活 Tab 自身)。
   * 存储层不落盘(纯会话内 UI 状态),关闭文件时同步剔除失效 id。
   */
  const [selectedTabIds, setSelectedTabIds] = useState<string[]>([]);
  /** 已创建的对比项列表(不落盘,纯会话内 UI 状态) */
  const [compares, setCompares] = useState<ComparePair[]>([]);
  /** 当前激活的对比项 id(主区域显示其 diff) */
  const [activeCompareId, setActiveCompareId] = useState<string | null>(null);
  /** 语言模式选择对话框(右下角语言徽章触发) */
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  // —— Markdown 视图模式(编辑/分屏/预览;仅 md 文档生效,与工具页共享偏好)——
  const mdViewMode = useMarkdownPreviewStore((s) => s.viewMode);
  const setMdViewMode = useMarkdownPreviewStore((s) => s.setViewMode);

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

  /** workspace 变更防抖持久化的定时器句柄;同时给窗口关闭守卫复用 */
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 窗口关闭守卫:工作区内容已通过防抖 effect 实时写入 Rust config 缓存
   * (`tool_prefs.editor_workspace_v1`),再次启动会自动还原,因此不再弹
   * 「未保存更改」确认框。后端拦截关闭后,前端只需立即冲刷待落盘数据
   * 并退出,避免 400ms 防抖窗口内的最后改动丢失。
   *
   * 仅在 Tauri 运行时生效(浏览器 dev / 测试环境跳过)。
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    void windowCloseReady();
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen('app:close-requested', async () => {
          // 取消待执行的防抖 persist,立即写一次最新工作区到缓存
          if (persistTimer.current) {
            clearTimeout(persistTimer.current);
            persistTimer.current = null;
          }
          try {
            await useEditorWorkspaceStore.getState().persist();
          } catch {
            // 持久化异常不影响退出,避免阻塞关闭流程
          }
          void safeInvoke('app_quit');
        });
      } catch {
        // 非 Tauri 环境或事件系统不可用:不拦截窗口关闭
      }
    })();
    return () => unlisten?.();
  }, []);

  // workspace 变更 → 防抖持久化(ready 前 persist 为 no-op,不会覆盖已存数据)
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

  // 状态栏文件大小:当前内容按 UTF-8 编码的字节长度,随编辑实时更新
  // (非磁盘文件实际大小:编码为 GBK 等时与磁盘字节数有差异)
  const activeContentSizeBytes = useMemo(() => {
    if (!activeTab) return undefined;
    return new TextEncoder().encode(activeTab.content).length;
  }, [activeTab]);

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

  // 挂载时把编辑器实例注册到全局「激活编辑器」注册表,供 cycle_naming_case
  // 全局快捷键(useShortcut)使用;并按当前 tab 注册到 tabId→实例注册表,
  // 供全局搜索文本跳转定位高亮;卸载时同时注销。
  const handleEditorMount = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    activeEditorRef.current = editorInstance;
    registerActiveEditor(editorInstance);
    const tabId = useEditorWorkspaceStore.getState().workspace.activeTabId;
    if (tabId) registerTabEditor(tabId, editorInstance);
  }, []);

  useEffect(() => {
    return () => {
      const ed = activeEditorRef.current;
      if (ed) unregisterActiveEditor(ed);
      activeEditorRef.current = null;
      // 工作台卸载 = 全部 tab 的编辑器实例均已销毁,清空整个 tabId→实例注册表,
      // 避免残留已销毁实例引用(跳转重试时 getModel() 返回 null 会误判)。
      clearTabEditors();
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

  /**
   * 打开文件失败的统一提示(仿 VSCode 二进制文件占位编辑器):
   * - `binary`:可恢复,toast 带「仍要打开」动作按钮,点击经 `forceOpenFile`
   *   按探测编码有损解码打开(VSCode Open Anyway)
   * - `too-large`:不可恢复,仅提示文件大小与上限
   * - 其余读取错误:展示后端真实错误消息
   */
  const showOpenFailure = useCallback(
    (failure: OpenFileFailure | { path: string; reason?: undefined; message?: string }) => {
      const name = fileNameFromPath(failure.path);
      if ('reason' in failure && failure.reason === OPEN_REASON_TOO_LARGE) {
        toast.error(
          t('tools.text_editor.err_file_too_large', {
            name,
            size: formatBytes(failure.size ?? 0),
          }),
        );
        return;
      }
      if ('reason' in failure && failure.reason === OPEN_REASON_BINARY) {
        toast.error(t('tools.text_editor.err_file_binary', { name }), {
          duration: 10_000,
          action: {
            label: t('tools.text_editor.open_anyway'),
            onClick: () => {
              void forceOpenFile(failure.path)
                .then((result) => {
                  useEditorWorkspaceStore
                    .getState()
                    .openLocalFile(result.path, result.content, result.encoding);
                  setActiveCompareId(null);
                })
                .catch((e) => {
                  toast.error(
                    e instanceof Error ? e.message : t('tools.text_editor.err_open_file'),
                  );
                });
            },
          },
        });
        return;
      }
      toast.error(t('tools.text_editor.err_open_file'));
    },
    [t],
  );

  /** 打开本地文件对话框并载入(或激活已打开的同路径 Tab);编码随文件探测结果记录 */
  const handleOpen = useCallback(async () => {
    try {
      const result = await openTextFileDialog();
      if (result?.file) {
        useEditorWorkspaceStore
          .getState()
          .openLocalFile(result.file.path, result.file.content, result.file.encoding);
        setActiveCompareId(null);
      } else if (result?.failed) {
        showOpenFailure(result.failed);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
    }
  }, [showOpenFailure, t]);

  /** 打开文件夹:加入左栏「文件夹」树(多根并存),默认展开根 */
  const handleOpenFolder = useCallback(async () => {
    try {
      const rootPath = await openFolderDialog();
      if (!rootPath) return; // 用户取消:静默
      useEditorWorkspaceStore.getState().openFolder(rootPath);
      toast.success(
        t('tools.text_editor.toast_folder_opened', { name: folderNameFromPath(rootPath) }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_folder'));
    }
  }, [t]);

  /**
   * 点击文件夹树中的文件:
   * - 已有同路径 Tab → 直接激活(不重复读取)
   * - 否则经 `fs_read_text_file_encoded` 读取并载入(编码自动探测);
   *   二进制(ERR_FILE_UNSUPPORTED)→ 弹「仍要打开」提示(仿 VSCode),
   *   超大(ERR_FILE_TOO_LARGE)→ 提示文件过大,
   *   文件节点保留在树中(组件层不做剔除)
   */
  const handleOpenTreeFile = useCallback(
    async (path: string) => {
      const state = useEditorWorkspaceStore.getState();
      const existing = state.workspace.tabs.find((t) => t.path === path);
      if (existing) {
        state.switchTab(existing.id);
        setActiveCompareId(null);
        return;
      }
      try {
        const result = await readTextFileEncoded(path);
        state.openLocalFile(result.path, result.content, result.encoding);
        setActiveCompareId(null);
      } catch (e) {
        const name = fileNameFromPath(path);
        if (e instanceof CommandError && e.code === 'ERR_FILE_UNSUPPORTED') {
          showOpenFailure({ path, reason: OPEN_REASON_BINARY });
        } else if (e instanceof CommandError && e.code === 'ERR_FILE_TOO_LARGE') {
          // details 形如 { size, max }(AppError::FileTooLarge 序列化载荷)
          const detail = e.details as { size?: number; max?: number } | undefined;
          showOpenFailure({
            path,
            reason: OPEN_REASON_TOO_LARGE,
            size: detail?.size,
          });
        } else {
          // 其余失败(未授权/不存在等):展示后端返回的真实错误信息
          toast.error(
            t('tools.text_editor.err_open_named', {
              name,
              reason: e instanceof Error ? e.message : t('tools.text_editor.err_unknown'),
            }),
          );
        }
      }
    },
    [showOpenFailure, t],
  );

  /**
   * 保存指定 Tab:已绑定路径直接写回(按 Tab 记录的编码),untitled 弹「另存为」。
   * 返回是否成功(用户取消另存为 / 保存失败返回 false,供「保存并关闭」判断)。
   */
  const saveTabById = useCallback(
    async (id: string): Promise<boolean> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === id);
      if (!tab) return false;
      try {
        if (tab.path) {
          // 按 Tab 记录的编码写回(状态栏可切换;缺省 UTF-8)
          await saveToPathEncoded(tab.path, tab.content, tab.encoding ?? 'utf-8');
          state.markSaved(id, tab.path);
          toast.success(t('tools.text_editor.toast_saved', { name: tab.title }));
          return true;
        }
        // 未绑定路径:文件名缺扩展名时补 .txt,供保存对话框使用
        const fileName = tab.title.endsWith('.txt') ? tab.title : `${tab.title}.txt`;
        const path = await saveWithDialog(fileName, tab.content);
        if (path) {
          state.markSaved(id, path);
          toast.success(t('tools.text_editor.toast_saved', { name: fileName }));
          return true;
        }
        // 用户取消保存对话框:保持 dirty 状态
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_save'));
        return false;
      }
    },
    [t],
  );

  /** 保存激活 Tab(菜单「保存」/ Ctrl+S 快捷键) */
  const handleSave = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    if (!state.workspace.activeTabId) return;
    void saveTabById(state.workspace.activeTabId);
  }, [saveTabById]);

  /**
   * 通过编码重新打开(仿 VSCode):按所选编码重读磁盘文件并覆盖当前 Tab 内容,
   * 顺带更新 Tab 编码记录并标记已保存(以磁盘为准)。无磁盘路径时为 no-op。
   */
  const reopenWithEncoding = useCallback(
    async (encodingId: string): Promise<void> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === state.workspace.activeTabId);
      if (!tab?.path) return;
      // 有未保存改动时先确认:重新打开将以磁盘内容覆盖,当前改动会丢失
      if (tab.content !== tab.savedContent) {
        const ok = window.confirm(
          t('tools.text_editor.reopen_discard_confirm', { title: tab.title }),
        );
        if (!ok) return;
      }
      try {
        const result = await readTextFileEncoded(tab.path, encodingId);
        state.setTabContent(tab.id, result.content);
        // 指定编码重读时后端按所选编码解码,编码标识回退用户所选
        state.setTabEncoding(tab.id, result.encoding ?? encodingId);
        state.markSaved(tab.id, tab.path);
        toast.success(t('tools.text_editor.toast_reopened', { encoding: result.encoding }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
      }
    },
    [t],
  );

  /**
   * 通过编码保存(仿 VSCode):记录所选编码后立即写盘。
   * 有路径直接按该编码写回;untitled 弹「另存为」并以该编码写入。
   */
  const saveWithEncoding = useCallback(
    async (encodingId: string): Promise<void> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === state.workspace.activeTabId);
      if (!tab) return;
      state.setTabEncoding(tab.id, encodingId);
      try {
        if (tab.path) {
          await saveToPathEncoded(tab.path, tab.content, encodingId);
          state.markSaved(tab.id, tab.path);
        } else {
          const fileName = tab.title.endsWith('.txt') ? tab.title : `${tab.title}.txt`;
          const path = await saveWithDialogEncoded(fileName, tab.content, encodingId);
          // 用户取消另存为:编码已记录,内容保持 dirty
          if (!path) return;
          state.markSaved(tab.id, path);
        }
        toast.success(t('tools.text_editor.toast_saved', { name: tab.title }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_save'));
      }
    },
    [t],
  );

  // Ctrl+S(Cmd+S)保存当前 Tab,阻止浏览器默认的「保存页面」行为。
  // 快捷键字符串可到设置里自定义;无激活 Tab 时是安全的 no-op。
  useShortcut('save_file', handleSave, [handleSave]);

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
          toast.error(t('tools.text_editor.err_max_two_compare'));
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
    [selectedTabIds, workspace.activeTabId, t],
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
      toast.info(t('tools.text_editor.info_select_two'));
      return;
    }
    if (chosen.length > 2) {
      toast.error(t('tools.text_editor.err_only_two_compare'));
      return;
    }
    const pair: ComparePair = {
      id: createCompareId(),
      leftTabId: chosen[0].id,
      rightTabId: chosen[1].id,
    };
    setCompares((prev) => [...prev, pair]);
    setActiveCompareId(pair.id);
  }, [selectedTabIds, t]);

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
   *   - 打开...(快捷键 Ctrl+O)      → toolbar-open
   *   - 打开文件夹...                    → toolbar-open-folder
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
        label: t('tools.text_editor.menu_file'),
        groups: [
          {
            items: [
              {
                id: 'new',
                label: t('tools.text_editor.menu_new'),
                shortcut: 'Ctrl+N',
                icon: FilePlus2,
                onSelect: handleNewTab,
                testId: 'toolbar-new',
              },
              {
                id: 'open',
                label: t('tools.text_editor.menu_open'),
                shortcut: 'Ctrl+O',
                icon: FolderOpen,
                onSelect: () => void handleOpen(),
                testId: 'toolbar-open',
              },
              {
                id: 'open-folder',
                label: t('tools.text_editor.menu_open_folder'),
                icon: Folder,
                onSelect: () => void handleOpenFolder(),
                testId: 'toolbar-open-folder',
              },
            ],
          },
          {
            items: [
              {
                id: 'save',
                label: t('tools.text_editor.save'),
                shortcut: 'Ctrl+S',
                onSelect: handleSave,
                disabled: !activeTab,
                testId: 'toolbar-save',
              },
              {
                id: 'save-all',
                label: t('tools.text_editor.save_all'),
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
                label: t('tools.text_editor.close'),
                shortcut: 'Ctrl+W',
                onSelect: handleCloseCurrent,
                disabled: !activeTab,
              },
              {
                id: 'close-all',
                label: t('tools.text_editor.close_all'),
                shortcut: 'Ctrl+Shift+W',
                // 显式传 'tabs':菜单 onSelect 会带首个参数,不能让它误当 source
                onSelect: () => requestCloseAll('tabs'),
                disabled: workspace.tabs.length === 0,
                testId: 'toolbar-close-all',
              },
            ],
          },
        ],
      },
      {
        id: 'view',
        label: t('tools.text_editor.menu_view'),
        groups: [
          {
            items: [
              {
                id: 'toggle-sidebar',
                label: workspace.leftSidebarVisible
                  ? t('tools.text_editor.menu_hide_sidebar')
                  : t('tools.text_editor.menu_show_sidebar'),
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
      handleOpenFolder,
      handleSave,
      handleSaveAll,
      handleToggleSidebar,
      requestCloseAll,
      t,
    ],
  );
  useToolMenus(toolId, menus);

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

  // 主编辑器(单一实例定义,普通/分屏/预览布局按需复用)
  const editorPane = activeTab ? (
    <CodeEditor
      key={activeTab.id}
      data-testid="editor"
      searchAnchor="text_editor:editor"
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
      // 缩略图:超大内容(如强制打开的二进制转储)下 minimap 渲染开销
      // 显著且无导航价值,直接关闭(普通文件保持开启)
      minimap={(activeTab.content?.length ?? 0) <= MINIMAP_DISABLE_CONTENT_CHARS}
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
                showMdPreview ? (
                  // Markdown 分屏/预览:左侧编辑器(预览模式下隐藏)+ 右侧渲染面板。
                  // 预览模式下编辑器(连同其工具栏按钮)已卸载,
                  // 故在面板右上角以浮层渲染同一组视图切换按钮,保证始终可切回
                  <div className="flex h-full min-h-0" data-testid="editor-md-layout">
                    {mdViewMode !== 'preview' && <div className="min-w-0 flex-1">{editorPane}</div>}
                    <div className="relative min-w-0 flex-1 overflow-hidden border-l border-border">
                      <MarkdownPreviewPane source={activeTab.content} className="h-full" />
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

/**
 * 文件对比差异视图 —— 两个已打开文件的内容并排 Diff(直接嵌入主区域)
 *
 * - 渲染复用共享组件 TextDiffView(components/text-diff),与文本比较工具
 *   同一套观感:行级红绿背景 + 词级高亮 + gutter 色条 + 右缘标尺刻度 +
 *   差异统计 / 行内切换 / 滚动同步。
 * - 两侧均可直接编辑,编辑内容实时写回对应文件 Tab(onChangeLeft/Right)。
 * - 语言按各文件扩展名分别推断(旧实现写死 plaintext,此处顺带修复),
 *   未识别扩展名回退纯文本。
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
  return (
    <div data-testid={dataTestId} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <TextDiffView
        original={left.content}
        modified={right.content}
        onOriginalChange={onChangeLeft}
        onModifiedChange={onChangeRight}
        originalTitle={left.title}
        modifiedTitle={right.title}
        originalLanguage={inferLanguageFromPath(left.path ?? left.title)}
        modifiedLanguage={inferLanguageFromPath(right.path ?? right.title)}
        folding
        testIdPrefix={dataTestId ?? 'compare-view'}
      />
    </div>
  );
}

/**
 * 左栏拖拽分隔条 —— 自管理拖拽 handle
 *
 * 替代 react-resizable-panels 的 ResizablePanelGroup:
 * - mousedown 记录拖拽基准:可见时为「当前宽度+光标X」;隐藏时以侧栏
 *   左缘为零点锚定(startWidth=0)
 * - mousemove 经 resolveSidebarResize 推导动作:夹在 MIN~MAX 之间调宽;
 *   越过「MIN - 隐藏阈值」继续左移 → 隐藏左栏;隐藏中右移 → 先以最小
 *   宽度展示,光标越过「左缘 + MIN」才跟手放宽
 * - hide 时把基准重锚为 -滞回带,防止在阈值附近震荡;show 不动基准
 * - mouseup 结束并隐藏全局光标样式
 * - 拖拽中通过 setSidebarWidth / setLeftSidebarVisible 写入 store,
 *   经 persist 防抖持久化
 *
 * 优势:不受容器宽度百分比 layout 限制,左栏始终有明确的像素宽度。
 *
 * 视觉反馈:
 * - 默认:完全透明 — 两卡片之间只有窄间距,没有分割线
 * - hover/focus/active:显示一条与分割空间同宽(4px)的主色蓝线,
 *   同时出现 grip 图标,用户一眼即可识别「此处可拖动调整宽度」;
 *   左栏隐藏后该反馈保留,提示「右拖可恢复显示」
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
  const { t } = useTranslation();
  const startWidthRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  /** 最小宽度钉住阶段:隐藏态按下,或刚由拖拽恢复、尚未越过最小宽度边界。
   * 此阶段隐藏判定改用左缘零点规则,避免钉住区误触标准隐藏阈值 */
  const pinnedRef = useRef<boolean>(false);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  /** 订阅当前左栏宽度,用于可访问性 aria-valuenow 实时跟随拖拽更新 */
  const sidebarWidth = useEditorWorkspaceStore((s) => s.workspace.sidebarWidth);
  /** 订阅可见性:决定 mousedown 基准宽度与 handle 的提示文案 */
  const sidebarVisible = useEditorWorkspaceStore((s) => s.workspace.leftSidebarVisible);

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
    const { sidebarWidth: width, leftSidebarVisible } =
      useEditorWorkspaceStore.getState().workspace;
    if (leftSidebarVisible) {
      // 可见:从当前宽度起算(夹取防越界),分隔条即侧栏右缘
      startWidthRef.current = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
      startXRef.current = e.clientX;
      pinnedRef.current = false;
    } else {
      // 隐藏:以侧栏左缘为零点锚定(startWidth=0),raw = 光标到左缘距离,
      // 并进入钉住阶段。恢复后光标越过「左缘 + 最小宽度」前 clamp 恒为
      // 最小宽度,越过该边界才跟手放宽
      startWidthRef.current = 0;
      startXRef.current = e.clientX;
      pinnedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = 'col-resize';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = 'none';
    updateActive(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  function handleMouseMove(ev: MouseEvent): void {
    const st = useEditorWorkspaceStore.getState();
    const next = resolveSidebarResize(
      startWidthRef.current,
      ev.clientX,
      startXRef.current,
      st.workspace.leftSidebarVisible,
      pinnedRef.current,
    );
    if (next.action === 'resize') {
      st.setSidebarWidth(next.width);
      // 越过最小宽度边界后离开钉住阶段,回归标准隐藏判定
      if (next.width > SIDEBAR_MIN_WIDTH) pinnedRef.current = false;
    } else if (next.action === 'hide') {
      // 仅切换可见性,不覆盖已存宽度:菜单/Ctrl+B 恢复时仍回原宽度。
      // 同时把基准重锚为「-滞回带」:同手势需右移回该带宽(越过零点)
      // 才允许恢复显示,避免在隐藏阈值附近来回震荡
      st.setLeftSidebarVisible(false);
      startWidthRef.current = -SIDEBAR_HIDE_DELTA;
      startXRef.current = ev.clientX;
    } else if (next.action === 'show') {
      // 以最小宽度恢复显示并进入钉住阶段;基准已在按下/hide 时锚定到
      // 侧栏左缘零点,无需重置
      st.setLeftSidebarVisible(true);
      st.setSidebarWidth(SIDEBAR_MIN_WIDTH);
      pinnedRef.current = true;
    }
    // idle:隐藏期间继续左移,不做任何写入
  }

  function handleMouseUp(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    pinnedRef.current = false;
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
      aria-valuenow={sidebarVisible ? sidebarWidth : SIDEBAR_MIN_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title={
        sidebarVisible ? t('tools.text_editor.resize_hint') : t('tools.text_editor.restore_hint')
      }
      className={cn(
        // 2px 宽点击区,恰好填满 gap-0.5 分割空间;默认完全透明,悬浮时才高亮
        'group relative flex h-full w-0.5 shrink-0 cursor-col-resize items-center justify-center self-stretch bg-transparent focus-visible:outline-none',
      )}
    >
      {/*
       * 高亮竖线:默认透明(中间无分割线);hover/focus/active 时变为 4px 主色蓝线。
       * 固定 4px 不随分割空间(gap-0.5)变窄,保持易识别的悬浮/拖拽目标;
       * shrink-0 防止被 2px 窄容器压缩,由父级 justify-center 居中向两侧各溢出 1px。
       * rounded-md 对齐项目圆角 token(--radius-md,由 globals.css 的 --radius 派生)。
       */}
      <div
        aria-hidden
        className={cn(
          'h-full w-1 shrink-0 rounded-md transition-colors duration-150 ease-out',
          highlighted ? 'bg-primary' : 'bg-transparent',
        )}
      />
    </div>
  );
}
