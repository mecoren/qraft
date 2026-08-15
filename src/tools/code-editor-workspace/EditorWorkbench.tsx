/**
 * 编辑器工作区 —— VSCode 风格多文件工作区主组件
 *
 * 布局(自上而下 / 自左而右):
 * - 顶栏操作区:打开文件 / 新建 / 保存 / 全部关闭 / 切换左栏
 * - Tab 栏:多文件切换(标题 + 未保存圆点 + 关闭按钮)
 * - 主体:左栏「打开的编辑器」列表 + 中央 Monaco 编辑器
 * - 编辑器自带底部状态栏(行/列/字符数),右侧追加可点击的语言徽章
 *
 * 生命周期:
 * - 挂载时 hydrate(从 Rust config 还原工作区)
 * - workspace 变更后 400ms 防抖持久化(config_set),仅 ready 后生效
 * - 保存:已绑定路径直接 fs_write_file;untitled 弹「另存为」对话框
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { FilePlus2, FolderOpen, GripVertical, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/ui/code-editor';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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

/** 批量关闭意图:用于未保存确认通过后执行对应 store 动作 */
type BatchCloseAction = 'close-others' | 'close-right' | 'close-all';

/** workspace 变更后持久化防抖间隔(ms) */
const PERSIST_DEBOUNCE_MS = 400;

export function EditorWorkbench(_props: ToolProps): JSX.Element {
  const workspace = useEditorWorkspaceStore((s) => s.workspace);
  const ready = useEditorWorkspaceStore((s) => s.ready);
  const hydrate = useEditorWorkspaceStore((s) => s.hydrate);
  /** 未保存确认对话框状态(null = 关闭);batchAction 记录批量关闭意图 */
  const [unsaved, setUnsaved] = useState<
    { mode: UnsavedMode; tabId?: string; batchAction?: BatchCloseAction } | null
  >(null);

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

  /** 打开本地文件对话框并载入(或激活已打开的同路径 Tab) */
  const handleOpen = useCallback(async () => {
    try {
      const result = await openTextFileDialog();
      if (result) {
        useEditorWorkspaceStore.getState().openLocalFile(result.path, result.content);
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

  /** 保存激活 Tab(工具栏「保存」按钮 / Ctrl+S 快捷键) */
  const handleSave = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    if (!state.workspace.activeTabId) return;
    void saveTabById(state.workspace.activeTabId);
  }, [saveTabById]);

  // Ctrl+S(Cmd+S)保存当前 Tab,阻止浏览器默认的「保存页面」行为。
  // 快捷键字符串可到设置里自定义;无激活 Tab 时是安全的 no-op。
  useShortcut('save_file', handleSave, [handleSave]);

  /** 请求关闭单个 Tab:未保存时先弹确认,干净则直接关闭 */
  const requestCloseTab = useCallback((id: string) => {
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.content !== tab.savedContent) {
      setUnsaved({ mode: 'close-tab', tabId: id });
    } else {
      state.closeTab(id);
    }
  }, []);

  /** 请求全部关闭:存在未保存的非固定 Tab 时先弹确认,干净则直接关闭 */
  const requestCloseAll = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    const hasDirty = state.workspace.tabs.some(
      (t) => !t.pinned && t.content !== t.savedContent,
    );
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
  }, []);

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

  /** 未保存对话框:不保存关闭 / 放弃并退出 */
  const handleUnsavedDiscard = useCallback(() => {
    if (!unsaved) return;
    const state = useEditorWorkspaceStore.getState();
    if (unsaved.mode === 'close-tab' && unsaved.tabId) {
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
    unsaved?.mode === 'close-tab' && unsaved.tabId
      ? workspace.tabs.find((t) => t.id === unsaved.tabId)?.title
      : undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background-layer" data-testid="editor-workbench">
      {/* 顶栏操作区 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" onClick={() => void handleOpen()} data-testid="toolbar-open">
              <FolderOpen aria-hidden className="size-4" />
              打开
            </Button>
          </TooltipTrigger>
          <TooltipContent>打开本地文本文件</TooltipContent>
        </Tooltip>
        <Button size="sm" variant="ghost" onClick={handleNewTab} data-testid="toolbar-new">
          <FilePlus2 aria-hidden className="size-4" />
          新建
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleSave()}
          disabled={!activeTab}
          data-testid="toolbar-save"
        >
          <Save aria-hidden className="size-4" />
          保存
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useEditorWorkspaceStore.getState().toggleLeftSidebar()}
          aria-pressed={workspace.leftSidebarVisible}
          data-testid="toolbar-toggle-sidebar"
        >
          {workspace.leftSidebarVisible ? '隐藏左栏' : '显示左栏'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={requestCloseAll}
          disabled={workspace.tabs.length === 0}
          data-testid="toolbar-close-all"
        >
          <X aria-hidden className="size-4" />
          全部关闭
        </Button>
      </div>

      {/* 主体:左栏(可拖拽调宽) + 右侧主页面(含 Tab 栏与编辑器)。
          使用普通 flex 布局 + 自管理拖拽 handle,避免 react-resizable-panels
          在窄容器下百分比 layout 压缩左 Panel 的问题。
          左栏宽度经 setSidebarWidth 持久化,重启后还原。
          两个面板(打开的编辑器 / 编辑器主区)被设计为彼此独立的「卡片」:
          - 各自带圆角 + 边框 + 背景层
          - 中间保留 4px 窄间距(gap-1),默认没有分割线
          - 拖拽手柄恰好填满分割空间:悬浮/聚焦时才显示一条与分割空间同宽的
            蓝色高亮线 + grip 图标,视觉上明确暗示「此处可拖动」 */}
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 gap-1 overflow-hidden bg-muted/30 p-2" data-testid="editor-split">
        {/* 左栏卡片:固定像素宽度,由 sidebarWidth(持久化)控制,收起时宽度 0 */}
        <div
          className="h-full shrink-0 overflow-hidden rounded-lg border border-border bg-sidebar shadow-sm transition-shadow"
          style={{ width: workspace.leftSidebarVisible ? `${workspace.sidebarWidth}px` : 0 }}
        >
          <EditorLeftSidebar
            tabs={workspace.tabs}
            activeTabId={workspace.activeTabId}
            dirtyCount={workspace.tabs.filter((t) => t.content !== t.savedContent).length}
            onSelect={(id) => useEditorWorkspaceStore.getState().switchTab(id)}
            onClose={requestCloseTab}
            onCloseOthers={(id) => requestCloseBatch('close-others', id)}
            onCloseRight={(id) => requestCloseBatch('close-right', id)}
            onCloseSaved={requestCloseSaved}
            onTogglePin={handleTogglePin}
            onSave={(id) => void saveTabById(id)}
            onRevealInExplorer={handleRevealInExplorer}
            onCopyPath={handleCopyPath}
            onNewTab={handleNewTab}
            onSaveAll={() => void handleSaveAll()}
            onCloseAll={requestCloseAll}
            saveAllDisabled={workspace.tabs.length === 0}
            closeAllDisabled={workspace.tabs.length === 0}
            data-testid="editor-sidebar"
          />
        </div>
        {/* 自定义拖拽分隔条:位于两卡片中间,hover/聚焦时高亮 */}
        <SidebarResizeHandle />
        {/* 右侧主页面卡片:含 Tab 栏与编辑器。
          编辑器直接撑满整个卡片内容区(去掉内边距与上下间距),与设计图一致。 */}
        <div className="flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <EditorTabsBar
            tabs={workspace.tabs}
            activeTabId={workspace.activeTabId}
            onSelect={(id) => useEditorWorkspaceStore.getState().switchTab(id)}
            onClose={requestCloseTab}
            onCloseOthers={(id) => requestCloseBatch('close-others', id)}
            onCloseRight={(id) => requestCloseBatch('close-right', id)}
            onCloseSaved={requestCloseSaved}
            onCloseAll={requestCloseAll}
            onTogglePin={handleTogglePin}
            onSave={(id) => void saveTabById(id)}
            onRevealInExplorer={handleRevealInExplorer}
            onCopyPath={handleCopyPath}
            data-testid="editor-tabs"
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeTab ? (
            <CodeEditor
              key={activeTab.id}
              data-testid="editor"
              // 本地文件:工具栏展示路径面包屑(分段,末段为当前页);
              // untitled 文件:仍展示文件名(untitled-1)纯文本
              {...(activeTab.path
                ? {
                    header: (
                      <PathBreadcrumb
                        path={activeTab.path}
                        data-testid="editor-path"
                      />
                    ),
                  }
                : { title: activeTab.title })}
              language={activeTab.language}
              value={activeTab.content}
              onChange={(v) => useEditorWorkspaceStore.getState().setTabContent(activeTab.id, v)}
              minimap
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
                <Button size="sm" variant="outline" onClick={() => void handleOpen()} data-testid="empty-open">
                  <FolderOpen aria-hidden className="size-4" />
                  打开文件
                </Button>
                <Button size="sm" variant="outline" onClick={handleNewTab} data-testid="empty-new">
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
function SidebarResizeHandle(): JSX.Element {
  const startWidthRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  /** 订阅当前左栏宽度,用于可访问性 aria-valuenow 实时跟随拖拽更新 */
  const sidebarWidth = useEditorWorkspaceStore((s) => s.workspace.sidebarWidth);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    startWidthRef.current = useEditorWorkspaceStore.getState().workspace.sidebarWidth;
    startXRef.current = e.clientX;
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = 'col-resize';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = 'none';
    setActive(true);
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
    setActive(false);
  }

  const highlighted = hovered || active;

  return (
    <div
      data-testid="editor-split-handle"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      {/* grip 图标:hover/focus/active 时浮在中心,作为「可拖动」 affordance */}
      <GripVertical
        aria-hidden
        className={cn(
          'absolute z-10 size-3.5 rounded text-muted-foreground transition-opacity duration-150',
          highlighted ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
