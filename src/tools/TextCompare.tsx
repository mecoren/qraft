/**
 * 文本比较工具 —— JsonFormatter 同款布局的多 Tab 对比工作区
 *
 * 结构(与 JSON 格式化器逐点对齐):
 * - 外层圆角卡片(rounded-lg + border + shadow)+ 多文档 Tab 栏(h-9,
 *   VSCode 风格全高 Tab:激活态顶部 2px 主色条、关闭确认小 Popover、
 *   右键菜单、中键关闭、固定/重命名)。
 * - 主区域:ResizablePanelGroup(gap-0.5 + 4px 圆角高亮分隔条)内放两个
 *   独立 CodeEditor(原始 / 修改后),各自带工具栏与状态栏。
 * - 差异:放弃 Monaco DiffEditor 单体,用 jsdiff 自算(text-compare-utils),
 *   以装饰渲染 —— 行级红绿背景 + 配对行行内词级高亮;统计口径与旧版一致。
 * - 滚动:左右编辑器竖向镜像同步(onDidScrollChange 互写 + 重入防护),
 *   工具栏可开关。
 * - 全屏弹窗:保留 DiffEditor 只读快照(词级差异/对齐连线等原生能力),
 *   行内模式(renderSideBySide)开关随弹窗局部化 —— 双独立编辑器布局
 *   无法复刻该模式,能力收敛到全屏。
 *
 * 设计说明:
 * - 编辑器为受控模式(value/onChange,与 JsonFormatter 输入侧一致);
 *   旧版「非受控 + setValue」策略随 DiffEditor 一并废弃。
 * - 差异计算用 useDeferredValue 缓冲:输入高频变化时装饰延迟到低优先级
 *   渲染再刷新,避免每次按键重算 diff 卡输入;装饰行号/列号按当前模型
 *   夹取,deferred 值短暂滞后时不越界。
 * - 大文档降级:任一侧超过 WORD_DIFF_MAX_CHARS 停用词级 diff(仅行级),
 *   行级 diff 超编辑距离上限时整体替换展示(见 text-compare-utils)。
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { DiffEditor, type DiffBeforeMount, type DiffOnMount, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Check, FileDiff, Link2, Link2Off, Pin, Plus, Rows3, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { RenameDialog } from '@/components/RenameDialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeEditor } from '@/components/ui/code-editor';
import { defineThemeFor, getThemeName, useMonacoTheme } from '@/components/ui/monaco-theme';
import type { MonacoEditor } from '@/components/ui/monaco-context-menu';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import { cn } from '@/lib/utils';
import {
  buildDiffDecorations,
  computeLineDiff,
  WORD_DIFF_MAX_CHARS,
  type DiffRulerColors,
} from './text-compare-utils';
import { useTextCompareStore, type CompareDoc } from './textCompareStore';
import type { ToolProps } from './registry';

// Monaco loader 路径配置(import 即执行,保证任何编辑器挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/**
 * 持久化防抖窗口按载荷规模自适应(ms):载荷越大合并越久,降低全量重写的 IO 放大。
 * 差异装饰构建见 text-compare-utils.ts 的 buildDiffDecorations。
 */
function persistDelayFor(totalChars: number): number {
  if (totalChars > 1024 * 1024) return 5000;
  if (totalChars > 256 * 1024) return 2000;
  return 500;
}

export function TextCompare(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();

  // —— 多 Tab 工作区状态(模式对齐 JsonFormatter)——
  const docs = useTextCompareStore((s) => s.docs);
  const activeDocId = useTextCompareStore((s) => s.activeDocId);
  const ready = useTextCompareStore((s) => s.ready);
  const userTouched = useTextCompareStore((s) => s.userTouched);
  const newDoc = useTextCompareStore((s) => s.newDoc);
  const closeDoc = useTextCompareStore((s) => s.closeDoc);
  const switchDoc = useTextCompareStore((s) => s.switchDoc);
  const renameDoc = useTextCompareStore((s) => s.renameDoc);
  const togglePinDoc = useTextCompareStore((s) => s.togglePinDoc);
  const setDocContent = useTextCompareStore((s) => s.setDocContent);

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );
  /** Tab 栏展示顺序:固定 Tab 恒排最前(稳定排序,不改变同组内相对顺序) */
  const sortedDocs = useMemo(
    () =>
      docs.some((d) => d.pinned)
        ? [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned))
        : docs,
    [docs],
  );
  const original = activeDoc?.original ?? '';
  const modified = activeDoc?.modified ?? '';
  const setOriginal = useCallback(
    (text: string) => {
      if (activeDocId) setDocContent(activeDocId, 'original', text);
    },
    [activeDocId, setDocContent],
  );
  const setModified = useCallback(
    (text: string) => {
      if (activeDocId) setDocContent(activeDocId, 'modified', text);
    },
    [activeDocId, setDocContent],
  );

  // 启动时从 Rust config 还原文档(hydrate 内部幂等)
  useEffect(() => {
    void useTextCompareStore.getState().hydrate();
  }, []);

  // hydrate 完成后确保至少有一个文档且激活态有效(首次使用 / 数据损坏兜底)
  useEffect(() => {
    if (!ready) return;
    const s = useTextCompareStore.getState();
    if (s.docs.length === 0) {
      s.newDoc();
    } else if (!s.docs.some((d) => d.id === s.activeDocId)) {
      switchDoc(s.docs[0].id);
    }
  }, [ready, switchDoc]);

  // 文档变更防抖持久化(hydrate 前不写,避免用默认空态覆盖已存数据);
  // 防抖窗口按双内容总载荷自适应,大文档合并为一次磁盘写
  useEffect(() => {
    if (!ready || !userTouched) return;
    let total = 0;
    for (const d of docs) total += d.original.length + d.modified.length;
    const timer = setTimeout(
      () => void useTextCompareStore.getState().persistDocs(),
      persistDelayFor(total),
    );
    return () => clearTimeout(timer);
  }, [docs, ready, userTouched]);

  // 关闭确认(锚定 Tab 的小 Popover)与重命名对话框
  const [closeTarget, setCloseTarget] = useState<CompareDoc | null>(null);
  const [renameTarget, setRenameTarget] = useState<CompareDoc | null>(null);

  function requestCloseDoc(id: string) {
    const target = docs.find((d) => d.id === id);
    if (!target) return;
    setCloseTarget(target);
  }

  function confirmCloseDoc() {
    if (!closeTarget) return;
    closeDoc(closeTarget.id);
    setCloseTarget(null);
  }

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  // —— 差异计算(deferred 缓冲 + 大文档词级降级)——
  const deferredOriginal = useDeferredValue(original);
  const deferredModified = useDeferredValue(modified);
  const includeWordDiff =
    deferredOriginal.length <= WORD_DIFF_MAX_CHARS && deferredModified.length <= WORD_DIFF_MAX_CHARS;
  const diffResult = useMemo(
    () => computeLineDiff(deferredOriginal, deferredModified, { includeWordDiff }),
    [deferredOriginal, deferredModified, includeWordDiff],
  );
  const stats = diffResult.stats;
  const hasDiff = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  // —— 编辑器实例与装饰注入 ——
  const [origEditor, setOrigEditor] = useState<MonacoEditor | null>(null);
  const [modEditor, setModEditor] = useState<MonacoEditor | null>(null);
  const origDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const modDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // 装饰集合生命周期:随编辑器实例创建/销毁(实例复用于多个 Tab)
  useEffect(() => {
    if (!origEditor) return;
    origDecoRef.current?.clear();
    origDecoRef.current = origEditor.createDecorationsCollection([]);
    return () => {
      origDecoRef.current?.clear();
      origDecoRef.current = null;
    };
  }, [origEditor]);
  useEffect(() => {
    if (!modEditor) return;
    modDecoRef.current?.clear();
    modDecoRef.current = modEditor.createDecorationsCollection([]);
    return () => {
      modDecoRef.current?.clear();
      modDecoRef.current = null;
    };
  }, [modEditor]);

  const themeName = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);

  /**
   * VSCode 对齐:差异行在右缘概览标尺绘制红/绿刻度。Monaco 标尺经
   * canvas 绘制,不接受 CSS var(),须经 getComputedStyle 解析成具体
   * 色值;主题/调色板切换时随 themeName 重算,装饰 effect 依赖本值
   * 联动刷新。
   */
  const rulerColors = useMemo<DiffRulerColors>(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      added: style.getPropertyValue('--diff-add-emph').trim(),
      removed: style.getPropertyValue('--diff-remove-emph').trim(),
    };
    // themeName 不在闭包内:仅作为「主题/调色板已切换」的重算信号,
    // 使标尺刻度色随当前调色板的 --diff-*-emph 值刷新
    // eslint-disable-next-line react-x/exhaustive-deps, react-hooks/exhaustive-deps
  }, [themeName]);

  // 差异结果变化时刷新两侧装饰(deferred 值滞后时越界装饰在构建处跳过)
  useEffect(() => {
    if (origDecoRef.current && origEditor) {
      origDecoRef.current.set(
        buildDiffDecorations(origEditor, diffResult.originalDecos, 'original', rulerColors),
      );
    }
  }, [diffResult, origEditor, rulerColors]);
  useEffect(() => {
    if (modDecoRef.current && modEditor) {
      modDecoRef.current.set(
        buildDiffDecorations(modEditor, diffResult.modifiedDecos, 'modified', rulerColors),
      );
    }
  }, [diffResult, modEditor, rulerColors]);

  // —— 主视图行内/并排布局开关(行内 = 单体 DiffEditor,修改侧可编辑)——
  const [inlineMode, setInlineMode] = useState(false);

  /**
   * 切换到行内时并排侧 CodeEditor 卸载,但 onMount 设置的实例 state 不会自动
   * 清空(CodeEditor 无 onUnmount 回调)—— 在切换事件里同步置 null(与
   * setInlineMode 同批更新),防止滚动同步监听挂在已销毁实例上;切回并排时
   * CodeEditor 重新挂载并经 onMount 回填实例
   */
  const handleToggleInline = useCallback(() => {
    const next = !inlineMode;
    setInlineMode(next);
    if (next) {
      setOrigEditor(null);
      setModEditor(null);
    }
  }, [inlineMode]);

  // —— 左右竖向滚动镜像同步(可开关;等值判断自收敛,防事件回环)——
  const [syncScroll, setSyncScroll] = useState(true);
  const syncingRef = useRef(false);
  useEffect(() => {
    if (!origEditor || !modEditor) return;
    const mirror = (from: MonacoEditor, to: MonacoEditor) => {
      if (!syncScroll || syncingRef.current) return;
      const top = from.getScrollTop();
      if (to.getScrollTop() !== top) {
        syncingRef.current = true;
        to.setScrollTop(top);
        syncingRef.current = false;
      }
    };
    const d1 = origEditor.onDidScrollChange(() => mirror(origEditor, modEditor));
    const d2 = modEditor.onDidScrollChange(() => mirror(modEditor, origEditor));
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [origEditor, modEditor, syncScroll]);

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  }, []);

  /**
   * 行内模式挂载:修改侧可编辑,内容变化写回当前文档(与并排模式右侧
   * 编辑器同源)。onMount 只触发一次,监听内经 getState 直读当前激活
   * 文档,避免闭包滞留切换前的 Tab;受控 prop 同步更新模型时监听同样
   * 触发,getValue 与文档现值相等,写回为幂等 no-op,不会形成循环。
   */
  const handleInlineMount: DiffOnMount = useCallback((instance) => {
    const mod = instance.getModifiedEditor();
    mod.onDidChangeModelContent(() => {
      const { activeDocId, setDocContent } = useTextCompareStore.getState();
      if (activeDocId) setDocContent(activeDocId, 'modified', mod.getValue());
    });
  }, []);

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  /** 与 CodeEditor 展示优化对齐的 DiffEditor 公共选项(字号随设置档位缩放) */
  const editorFontSize = useEditorFontSize();
  const baseDiffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      // Monaco 默认 useShadowDOM: true,编辑器与分隔条(sash)渲染在 Shadow DOM 内,
      // 应用样式无法穿透覆盖;关闭后由 globals.css 统一分隔条悬浮高亮样式
      useShadowDOM: false,
      fontFamily:
        "var(--app-mono-font-family, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontLigatures: true,
      fontSize: editorFontSize.fontSize,
      lineHeight: editorFontSize.lineHeight,
      lineNumbers: 'on',
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      diffWordWrap: 'on',
      tabSize: 2,
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10, bottom: 10 },
      scrollbar: {
        // 与全局滚动条美化一致:轨道 10px、滑块可见 6px
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
      // VSCode 对齐:行内 DiffEditor 由原生逻辑绘制右缘差异刻度
      overviewRulerLanes: 3,
      scrollBeyondLastColumn: 0,
      contextmenu: true,
      fixedOverflowWidgets: true,
      // 不折叠未变更区域,保持与旧版一致的"全量并排"观感
      hideUnchangedRegions: { enabled: false },
    }),
    [editorFontSize],
  );

  /** 主视图行内模式:修改侧可编辑(onChange 写回文档),原始侧只读 */
  const inlineOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      ...baseDiffOptions,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: false,
    }),
    [baseDiffOptions],
  );

  // —— 工具栏公共小件:统计徽标 / 行内开关 / 同步滚动开关 ——
  const statsBadge = (
    <span
      className="flex items-center gap-1 whitespace-nowrap tabular-nums text-xs text-muted-foreground"
      data-testid="diff-stats"
    >
      {hasDiff ? (
        <>
          <span className="text-success">+{stats.added}</span>
          <span className="text-destructive">−{stats.removed}</span>
          <span>~{stats.modified}</span>
        </>
      ) : (
        t('tools.text_compare.diff_none')
      )}
    </span>
  );

  const inlineToggle = (
    <button
      type="button"
      data-testid="inline-toggle"
      aria-pressed={inlineMode}
      title={t('tools.text_compare.inline_mode')}
      aria-label={t('tools.text_compare.inline_mode')}
      onClick={handleToggleInline}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inlineMode ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Rows3 aria-hidden className="size-3.5" />
    </button>
  );

  const syncScrollButton = (
    <button
      type="button"
      data-testid="sync-scroll"
      aria-pressed={syncScroll}
      title={syncScroll ? t('tools.text_compare.sync_scroll_on') : t('tools.text_compare.sync_scroll_off')}
      aria-label={t('tools.text_compare.sync_scroll_aria')}
      onClick={() => setSyncScroll((v) => !v)}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        syncScroll ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {syncScroll ? <Link2 aria-hidden className="size-3.5" /> : <Link2Off aria-hidden className="size-3.5" />}
    </button>
  );

  // 并排模式:修改侧编辑器 actions(统计 + 行内开关 + 同步滚动)
  const diffActions = (
    <>
      {statsBadge}
      {inlineToggle}
      {syncScrollButton}
    </>
  );

  return (
    // 外层圆角卡片(与 JSON 格式化器同款):rounded-lg + border + shadow,
    // overflow-hidden 让 Tab 栏顶角与卡片圆角对齐
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="text-compare"
    >
      {/* —— 多文档 Tab 栏(样式/交互对齐 JsonFormatter:VSCode 风格全高 Tab) —— */}
      <div
        className="flex h-9 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="doc-tabs"
      >
        <div
          role="tablist"
          aria-label={t('tools.text_compare.tabs_aria')}
          // overflow-y-hidden:overflow-x:auto 会把 overflow-y 强制计算为 auto,
          // Tab(h-9)比容器内容盒(36px - 1px border-b = 35px)高 1px 即触发
          // 纵向滚动条(WebView2 经典滚动条下在窗口右缘显形为一条竖条),
          // 显式 hidden 裁掉这 1px 溢出
          className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
        >
          {sortedDocs.map((doc) => {
            const active = doc.id === activeDocId;
            return (
              <ContextMenu key={doc.id}>
                {/* 关闭确认:锚定在 Tab 旁的小 Popover(与 JsonFormatter 同款),
                    居中 modal 过重;受控 open 挂 closeTarget,三条关闭路径
                    (X 按钮/中键/右键菜单)统一落到该 Tab 的确认框上 */}
                <Popover
                  open={closeTarget?.id === doc.id}
                  onOpenChange={(o) => {
                    if (!o) setCloseTarget(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <ContextMenuTrigger asChild>
                      <div
                        role="tab"
                        aria-selected={active}
                        tabIndex={0}
                        data-testid="doc-tab"
                        data-doc-id={doc.id}
                        data-pinned={doc.pinned ? 'true' : undefined}
                        onClick={() => switchDoc(doc.id)}
                        onKeyDown={(e) => handleTabKeyDown(e, doc.id)}
                        onMouseDown={(e) => {
                          // 中键关闭(仿 VSCode):preventDefault 抑制浏览器自动滚动
                          if (e.button === 1) {
                            e.preventDefault();
                            requestCloseDoc(doc.id);
                          }
                        }}
                        className={cn(
                          // 与 EditorTabsBar 一致:全高 36px 热区、右分隔线、
                          // 激活态顶部 2px 主色条 + bg-card(仿 VSCode 当前 Tab)
                          'group relative flex h-9 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs outline-none',
                          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                          active
                            ? 'border-t-2 border-t-primary bg-card text-foreground'
                            : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                      >
                        {/* 固定 Tab 用 Pin 图标替代对比图标(与编辑器 Tab 语义一致) */}
                        {doc.pinned ? (
                          <Pin
                            aria-label={t('tools.text_compare.pinned_aria')}
                            data-testid="doc-tab-pin"
                            className={cn(
                              'size-3.5 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/70',
                            )}
                          />
                        ) : (
                          <FileDiff
                            aria-hidden
                            className={cn(
                              'size-3.5 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/70',
                            )}
                          />
                        )}
                        <span className="min-w-0 truncate" title={doc.title}>
                          {doc.title}
                        </span>
                        {/* 关闭按钮槽位:悬停 Tab 时在右侧槽位淡入 */}
                        <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                          <button
                            type="button"
                            aria-label={t('tools.text_compare.close_tab_aria', { title: doc.title })}
                            title={t('tools.text_compare.close')}
                            data-testid="doc-tab-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCloseDoc(doc.id);
                            }}
                            className="absolute inset-0 z-10 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                          >
                            <X aria-hidden className="size-3" />
                          </button>
                        </span>
                      </div>
                    </ContextMenuTrigger>
                  </PopoverTrigger>
                  {/* 关闭确认内容:与 JsonFormatter 同款小框,锚定 Tab 下方 */}
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-56 p-3"
                    data-testid="doc-close-dialog"
                  >
                    <p className="text-xs font-semibold">
                      {t('tools.text_compare.close_confirm_title', { title: doc.title })}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {doc.original.trim() || doc.modified.trim()
                        ? t('tools.text_compare.close_confirm_desc')
                        : t('tools.text_compare.close_confirm_empty_desc')}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setCloseTarget(null)}
                        data-testid="doc-close-dialog-cancel"
                      >
                        {t('tools.text_compare.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={confirmCloseDoc}
                        data-testid="doc-close-dialog-confirm"
                      >
                        {t('tools.text_compare.close')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Tab 右键菜单:重命名 / 固定 / 关闭 */}
                <ContextMenuContent className="w-48" data-testid="doc-tab-context-menu">
                  <ContextMenuItem
                    onSelect={() => setRenameTarget(doc)}
                    data-testid="ctx-doc-rename"
                  >
                    {t('tools.text_compare.rename')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => togglePinDoc(doc.id)}
                    data-testid="ctx-doc-toggle-pin"
                  >
                    {t('tools.text_compare.pin')}
                    {doc.pinned && (
                      <Check
                        aria-label={t('tools.text_compare.pinned_aria')}
                        data-testid="ctx-doc-pin-check"
                        className="ml-auto size-3.5 text-primary"
                      />
                    )}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => requestCloseDoc(doc.id)}
                    data-testid="ctx-doc-close"
                  >
                    {t('tools.text_compare.close')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          <button
            type="button"
            data-testid="doc-add"
            title={t('tools.text_compare.new_doc')}
            aria-label={t('tools.text_compare.new_doc')}
            onClick={() => newDoc()}
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {/* —— 主区域:并排(双 CodeEditor + 可拖分隔条)/ 行内(单体 DiffEditor) —— */}
      {inlineMode ? (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-search-anchor="text_compare:diff"
          data-testid="inline-diff"
        >
          {/* 工具栏:与 CodeEditor 标题栏同款样式(行内模式无同步滚动按钮);
            * 统计/开关紧跟标题(VSCode 风格),不贴工具栏右缘 */}
          <div className="flex min-w-0 shrink-0 items-center border-b border-input px-2 py-0.5">
            <span className="flex min-w-0 items-center gap-2 pl-1 text-xs font-medium text-foreground">
              <span className="truncate">{t('tools.text_compare.inline_diff_title')}</span>
              {statsBadge}
              {inlineToggle}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              language="plaintext"
              theme={themeName}
              beforeMount={handleBeforeMount}
              original={original}
              modified={modified}
              // 行内模式修改侧可编辑:onMount 挂载内容监听写回当前文档
              onMount={handleInlineMount}
              options={inlineOptions}
              className="h-full"
              loading={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t('tools.text_compare.loading_editor')}
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          data-search-anchor="text_compare:diff"
        >
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
            <CodeEditor
              title={t('tools.text_compare.original_title')}
              value={original}
              onChange={setOriginal}
              placeholder={t('tools.text_compare.placeholder_original')}
              // 只保留右侧边框(朝向中间分隔缝),去掉外三边:外层卡片已提供
              // rounded-lg 框体,避免双线/双圆角叠加(与 JsonFormatter 输入侧一致)
              className="h-full rounded-none border-0 border-r"
              data-testid="original"
              searchAnchor="text_compare:original"
              folding={false}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste
              showOpenFile
              showClear
              onMount={(instance) => setOrigEditor(instance)}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
            <CodeEditor
              title={t('tools.text_compare.modified_title')}
              // VSCode 风格:差异统计与布局操作紧跟标题展示,而非贴工具栏
              // 最右缘(header 复用 CodeEditor 的自定义标题区插槽);
              // 粘贴/打开/清除仍由 CodeEditor 常规放在右侧
              header={
                <span className="flex min-w-0 items-center gap-2" data-testid="modified-header">
                  <span className="truncate">{t('tools.text_compare.modified_title')}</span>
                  {diffActions}
                </span>
              }
              value={modified}
              onChange={setModified}
              placeholder={t('tools.text_compare.placeholder_modified')}
              // 对称:只保留左侧边框(朝向中间分隔缝),理由同原始侧
              className="h-full rounded-none border-0 border-l"
              data-testid="modified"
              searchAnchor="text_compare:modified"
              folding={false}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste
              showOpenFile
              showClear
              onMount={(instance) => setModEditor(instance)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* —— 重命名对话框(条件渲染:关闭即卸载,每次打开取最新标题) —— */}
      {renameTarget && (
        <RenameDialog
          open
          title={t('tools.text_compare.rename_dialog_title')}
          initialValue={renameTarget.title}
          onConfirm={(name) => {
            renameDoc(renameTarget.id, name);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
          data-testid="doc-rename-dialog"
        />
      )}
    </div>
  );
}
