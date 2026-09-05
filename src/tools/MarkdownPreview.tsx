/**
 * Markdown 预览(参考 Typora 设计的增强型分栏工具)
 *
 * 能力:
 * - 多 Tab 文档:VSCode 风格 Tab 栏(新建/切换/关闭确认/重命名/固定),
 *   文档列表经 Rust config 持久化,旧版 localStorage 单草稿首次启动自动迁移
 * - 视图模式:仅编辑 / 分屏 / 仅预览(可拖拽分栏)
 * - 大纲面板:标题树导航,点击双向定位(预览滚动 + 编辑器跳转源行),
 *   预览滚动时高亮当前章节
 * - 滚动同步:基于标题锚点的分段线性插值(Typora 方案),
 *   大代码块/图片不再引发整体比例映射的漂移;无标题时自然退化为比例模式
 * - 渲染管线:核心解析/高亮/公式在 Web Worker 执行(markdown-render-client.ts,
 *   不可用时自动回退主线程同步),两阶段防抖策略由共享面板组件承担
 * - 排版主题:Qraft 默认 / GitHub / Newsprint / Pixyll / Night(globals.css .md-theme-*)
 * - 状态栏:光标行列 + 字数统计 + 选区统计(Typora 风格)
 * - 导出:复制富文本、复制 HTML 源码、另存独立 HTML 文件
 * - 格式工具栏与快捷键(Ctrl+B/I/E 等)+ 打字机模式 + 粘贴为 Markdown
 * - 草稿自动保存(localStorage 防抖持久化),重启恢复
 *
 * 结构说明:预览呈现层(滚动容器/article/Mermaid/lightbox/脚注气泡/交互代理)
 * 抽取在 markdown-preview-pane.tsx,供本页与文本编辑器工作台共用;
 * 本页保留工具级 UI(大纲/主题选择/导出/状态栏)与滚动同步编排。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { useStore } from 'zustand';
import {
  Bold,
  ClipboardPaste,
  Code,
  Columns2,
  Download,
  Eye,
  FileCode2,
  FileText,
  Italic,
  Link2,
  List,
  ListTree,
  ListTodo,
  PenLine,
  Pin,
  Plus,
  Quote,
  Strikethrough,
  Table,
  X,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { t as translate } from '@/i18n';
import { CodeEditor } from '@/components/ui/code-editor';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RenameDialog } from '@/components/RenameDialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { readClipboardText, writeClipboardRichText, writeClipboardText } from '@/lib/clipboard';
import { showAlert } from '@/lib/toast-alert';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { cn } from '@/lib/utils';
import { computeDocStats, type DocStats, type OutlineItem } from './markdown-render';
import { applyInlineWrap, toggleLinePrefixes, type LinePrefixMode } from './markdown-edit';
import { htmlToMarkdown } from './markdown-paste';
import { MarkdownPreviewPane, useIsDarkTheme } from './markdown-preview-pane';
import { buildSyncAnchors, mapAcrossAnchors } from './markdown-scroll';
import { buildStandaloneHtml, saveStandaloneHtml } from './markdown-export';
import { useMdDocsStore, type MdDoc } from './markdownPreviewDocsStore';
import {
  THEME_ITEMS,
  getSampleMarkdown,
  mdLiveStore,
  setMdActiveHeading,
  setMdCursor,
  setMdSelection,
  useMarkdownPreviewStore,
  type MdViewMode,
} from './markdownPreviewStore';
import type { ToolProps } from './registry';

/** 按载荷规模自适应的持久化防抖窗口(ms):载荷越大合并越久,降低全量重写的 IO 放大 */
function persistDelayFor(totalChars: number): number {
  if (totalChars > 1024 * 1024) return 5000;
  if (totalChars > 256 * 1024) return 2000;
  return 500;
}

/** CSS.escape 安全封装(旧 WebView / 测试环境兜底) */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ============================================================
// 子组件:状态栏 / 大纲面板 / 格式按钮(高频信号局部订阅)
// ============================================================

function MdStatusBar({ stats }: { stats: DocStats }): JSX.Element {
  const { t } = useTranslation();
  const cursor = useStore(mdLiveStore, (s) => s.cursor);
  const selection = useStore(mdLiveStore, (s) => s.selection);
  return (
    <footer
      className="flex items-center justify-between border-t border-border px-3 py-1 text-[11px] text-muted-foreground print:hidden"
      data-testid="md-statusbar"
    >
      <span data-testid="md-cursor">
        {t('tools.markdown_preview.status_cursor', {
          line: cursor.line,
          column: cursor.column,
        })}
      </span>
      <span data-testid="md-stats">
        {selection && (
          <span data-testid="md-selection-stats">
            {t('tools.markdown_preview.status_selection', {
              words: selection.words,
              chars: selection.chars,
            })}{' '}
            ·{' '}
          </span>
        )}
        {t('tools.markdown_preview.status_summary', {
          words: stats.words,
          chars: stats.chars,
          lines: stats.lines,
        })}
        {stats.readingMinutes > 0
          ? ` · ${t('tools.markdown_preview.reading_time', { minutes: stats.readingMinutes })}`
          : ''}
      </span>
    </footer>
  );
}

interface MdOutlinePanelProps {
  outline: OutlineItem[];
  onJump: (item: OutlineItem) => void;
}

function MdOutlinePanel({ outline, onJump }: MdOutlinePanelProps): JSX.Element {
  const { t } = useTranslation();
  const activeHeadingId = useStore(mdLiveStore, (s) => s.activeHeadingId);
  return (
    <aside
      className="w-52 shrink-0 overflow-y-auto border-r border-border bg-sidebar/60 py-2 print:hidden"
      data-testid="outline-panel"
      data-search-anchor="markdown_preview:outline"
    >
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('tools.markdown_preview.outline_title')}
      </p>
      {outline.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="outline-empty">
          {t('tools.markdown_preview.outline_empty')}
        </p>
      ) : (
        <ul className="space-y-0.5 px-1.5">
          {outline.map((item) => (
            <li key={`${item.id}-${item.line}`}>
              <button
                type="button"
                data-testid="outline-item"
                data-active={activeHeadingId === item.id}
                onClick={() => onJump(item)}
                style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.625}rem` }}
                title={item.text}
                className={cn(
                  'block w-full truncate rounded py-1 pr-2 text-left text-xs transition-colors',
                  activeHeadingId === item.id
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** 编辑器工具栏单个格式按钮(H1/H2 以文本呈现,其余用图标) */
function MdFormatButton({
  icon: Icon,
  text,
  title,
  testId,
  onClick,
}: {
  icon?: typeof Bold;
  text?: string;
  title: string;
  testId: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        text ? 'h-6 min-w-6 px-0.5 font-mono text-[11px]' : 'p-1',
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {text}
    </button>
  );
}

// ============================================================
// 主组件
// ============================================================

export function MarkdownPreview({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const themeId = useMarkdownPreviewStore((s) => s.themeId);
  const viewMode = useMarkdownPreviewStore((s) => s.viewMode);
  const outlineOpen = useMarkdownPreviewStore((s) => s.outlineOpen);
  const syncScroll = useMarkdownPreviewStore((s) => s.syncScroll);
  const typewriterMode = useMarkdownPreviewStore((s) => s.typewriterMode);
  const setThemeId = useMarkdownPreviewStore((s) => s.setThemeId);
  const setViewMode = useMarkdownPreviewStore((s) => s.setViewMode);
  const toggleOutline = useMarkdownPreviewStore((s) => s.toggleOutline);
  const setSyncScroll = useMarkdownPreviewStore((s) => s.setSyncScroll);
  const setTypewriterMode = useMarkdownPreviewStore((s) => s.setTypewriterMode);

  // —— 多 Tab 工作区(store 为模块级单例,状态跨挂载保留)——
  const docs = useMdDocsStore((s) => s.docs);
  const activeDocId = useMdDocsStore((s) => s.activeDocId);
  const mdReady = useMdDocsStore((s) => s.ready);
  const userTouched = useMdDocsStore((s) => s.userTouched);
  const newDoc = useMdDocsStore((s) => s.newDoc);
  const closeDoc = useMdDocsStore((s) => s.closeDoc);
  const switchDoc = useMdDocsStore((s) => s.switchDoc);
  const renameDoc = useMdDocsStore((s) => s.renameDoc);
  const togglePinDoc = useMdDocsStore((s) => s.togglePinDoc);
  const setDocContent = useMdDocsStore((s) => s.setDocContent);

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

  /** Tab 栏滚动容器:指向 ScrollArea 内部 Viewport(div) */
  const docTabsScrollRef = useRef<HTMLDivElement>(null);

  /**
   * 激活 Tab 变化时自动滚入视野(对齐 EditorTabsBar / VSCode 行为):
   * - 激活 Tab 在视口左侧外 → 滚到最左;右侧外 → 滚到最右;视口内 → 不滚动
   * - Tab 横向溢出时,若切到被挤出视野的 Tab 却不滚动,用户看不到
   *   任何切换反馈,会以为没切换成功;deps 含 sortedDocs,固定/取消
   *   固定导致激活 Tab 位置变化时同样滚入视野
   */
  useEffect(() => {
    if (!activeDocId) return;
    const container = docTabsScrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-doc-id="${CSS.escape(activeDocId)}"]`,
    );
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const tRect = active.getBoundingClientRect();
    if (tRect.left < cRect.left) {
      container.scrollTo({ left: active.offsetLeft - 8, behavior: 'smooth' });
    } else if (tRect.right > cRect.right) {
      container.scrollTo({
        left: active.offsetLeft + active.offsetWidth - container.clientWidth + 8,
        behavior: 'smooth',
      });
    }
  }, [activeDocId, sortedDocs]);

  const input = activeDoc?.content ?? '';
  const setInput = useCallback(
    (value: string) => {
      if (activeDoc) setDocContent(activeDoc.id, value);
    },
    [activeDoc, setDocContent],
  );

  /** 渲染结果中的大纲(由共享面板回调推送;首帧为空,挂载即达) */
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  /** 待确认关闭的文档(null = 无);仅非空内容文档关闭前弹确认 */
  const [closeTarget, setCloseTarget] = useState<MdDoc | null>(null);
  /** 待重命名的文档(null = 关闭重命名对话框) */
  const [renameTarget, setRenameTarget] = useState<MdDoc | null>(null);

  const isDark = useIsDarkTheme();
  /** Night 主题固定深色:导出外观需叠加判定 */
  const effectiveDark = useMemo(() => isDark || themeId === 'night', [isDark, themeId]);

  const articleRef = useRef<HTMLElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  /** 滚动同步方向锁:'editor' | 'preview' | null,防止联动回环 */
  const syncingRef = useRef<{ source: 'editor' | 'preview'; until: number } | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const stats = useMemo(() => computeDocStats(input), [input]);

  // 启动时从 Rust config 还原文档(hydrate 内部幂等;旧 localStorage 草稿在此迁移)
  useEffect(() => {
    void useMdDocsStore.getState().hydrate();
  }, []);

  // hydrate 完成后确保至少有一个文档且激活态有效:
  // - 首次使用(firstUse):新建文档并填入当前语言的示例文档,展示全部排版能力
  //   (原单文档工具的首次体验保持不变)
  // - 上次主动关闭了全部文档:新建空白文档
  // - 数据损坏兜底:激活 id 失效时切到第一个文档
  useEffect(() => {
    if (!mdReady) return;
    const s = useMdDocsStore.getState();
    if (s.docs.length === 0) {
      s.newDoc(s.firstUse ? getSampleMarkdown() : '');
    } else if (!s.docs.some((d) => d.id === s.activeDocId)) {
      switchDoc(s.docs[0].id);
    }
  }, [mdReady, switchDoc]);

  // 文档变更防抖持久化(hydrate 前不写,避免用默认空态覆盖已存数据);
  // 防抖窗口按载荷自适应(同 JsonFormatter:KB 级 500ms,MB 级 5s 合并写盘)
  useEffect(() => {
    if (!mdReady || !userTouched) return;
    let total = 0;
    for (const d of docs) total += d.content.length;
    const timer = setTimeout(
      () => void useMdDocsStore.getState().persistDocs(),
      persistDelayFor(total),
    );
    return () => clearTimeout(timer);
  }, [docs, mdReady, userTouched]);

  // 「发送到…」接收端:成为激活工具时注入当前文档。
  // 必须走 injectDocFromTool 而非 setDocContent:hydrate 未落地前置位 userTouched
  // 会让 hydrate 丢弃持久化数据,随后防抖 persist 永久覆盖(语义同 JsonFormatter)。
  useToolHandoff(toolId, (incoming) => {
    useMdDocsStore.getState().injectDocFromTool(incoming);
  });

  // —— 面板回调桥接(ref 直存,避免滚动路径触发 React 更新)——
  const handlePaneScroller = useCallback((el: HTMLDivElement | null) => {
    previewScrollRef.current = el;
  }, []);
  const handlePaneArticle = useCallback((el: HTMLElement | null) => {
    articleRef.current = el;
  }, []);
  const handlePaneRendered = useCallback((result: { outline: OutlineItem[] }) => {
    setOutline(result.outline);
  }, []);

  /** 标题元素相对滚动容器的 offsetTop(scroller 为 relative 定位父级) */
  const resolveHeadingTop = useCallback((id: string): number | null => {
    const el = articleRef.current?.querySelector(`#${escapeSelector(id)}`);
    return el instanceof HTMLElement ? el.offsetTop : null;
  }, []);

  /** 构建当前文档的滚动同步锚点(含起止虚拟锚点) */
  const buildAnchors = useCallback(() => {
    const scroller = previewScrollRef.current;
    const instance = monacoRef.current;
    const model = instance?.getModel();
    if (!scroller) return null;
    return buildSyncAnchors({
      headings: outline,
      resolveTop: resolveHeadingTop,
      maxLine: model ? model.getLineCount() : 1,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    });
  }, [outline, resolveHeadingTop]);

  // —— 滚动同步:编辑器 → 预览(首行行号 → 分段插值)——
  const syncEditorToPreview = useCallback(
    (instance: MonacoEditor.IStandaloneCodeEditor) => {
      const scroller = previewScrollRef.current;
      if (!scroller || !useMarkdownPreviewStore.getState().syncScroll) return;
      const anchors = buildAnchors();
      if (!anchors) return;
      const ranges = instance.getVisibleRanges();
      const topLine = ranges.length > 0 ? ranges[0].startLineNumber : 1;
      const target = mapAcrossAnchors(anchors, topLine, 'line', 'top');
      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      syncingRef.current = { source: 'editor', until: performance.now() + 120 };
      scroller.scrollTop = Math.max(0, Math.min(target, maxScrollTop));
    },
    [buildAnchors],
  );

  // —— 滚动同步:预览 → 编辑器(scrollTop → 浮点行号 → Monaco scrollTop)——
  const syncPreviewToEditor = useCallback(() => {
    const scroller = previewScrollRef.current;
    const instance = monacoRef.current;
    const model = instance?.getModel();
    if (!scroller || !instance || !model || !useMarkdownPreviewStore.getState().syncScroll) {
      return;
    }
    const anchors = buildAnchors();
    if (!anchors) return;
    const lineFloat = mapAcrossAnchors(anchors, scroller.scrollTop, 'top', 'line');
    const baseLine = Math.max(1, Math.floor(lineFloat));
    const fraction = lineFloat - Math.floor(lineFloat);
    // 浮点行号换算像素:相邻两行的绝对 top 差作为行距(避免引入 monaco 值依赖)
    const nextLine = Math.min(model.getLineCount(), baseLine + 1);
    const step =
      nextLine > baseLine
        ? Math.max(
            instance.getTopForLineNumber(nextLine) - instance.getTopForLineNumber(baseLine),
            0,
          )
        : 0;
    syncingRef.current = { source: 'preview', until: performance.now() + 120 };
    instance.setScrollTop(Math.max(0, instance.getTopForLineNumber(baseLine) + fraction * step));
  }, [buildAnchors]);

  /** 预览滚动容器内当前可见章节(最后一个滚过容器顶部的标题) */
  const updateActiveHeading = useCallback(() => {
    const scroller = previewScrollRef.current;
    if (!scroller) return;
    const headings = scroller.querySelectorAll<HTMLElement>(
      'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
    );
    let current: string | null = null;
    for (const heading of headings) {
      if (heading.offsetTop - scroller.scrollTop <= 24) current = heading.id;
      else break;
    }
    setMdActiveHeading(current);
  }, []);

  const handlePreviewScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateActiveHeading();

      const lock = syncingRef.current;
      if (lock && lock.source === 'editor' && performance.now() < lock.until) return;
      syncPreviewToEditor();
    });
  }, [syncPreviewToEditor, updateActiveHeading]);

  // ============================================================
  // 格式化操作(工具栏按钮 / Monaco 快捷键共用)
  // 纯逻辑在 markdown-edit.ts,此处仅做 Monaco 选区/编辑适配
  // ============================================================

  /** 行内包裹(加粗/斜体/删除线/行内代码),保持原文选中 */
  const applyInline = useCallback((before: string, after: string, placeholder: string): void => {
    const ed = monacoRef.current;
    const model = ed?.getModel();
    const selection = ed?.getSelection();
    if (!ed || !model || !selection) return;
    ed.focus();
    const selected = model.getValueInRange(selection);
    const result = applyInlineWrap(selected, before, after, placeholder);
    const startOffset = model.getOffsetAt({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    ed.executeEdits('md-format', [
      { range: selection, text: result.insert, forceMoveMarkers: true },
    ]);
    const startPos = model.getPositionAt(startOffset + result.selectStart);
    const endPos = model.getPositionAt(startOffset + result.selectEnd);
    ed.setSelection({
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
    });
  }, []);

  /** 行前缀切换(标题/引用/列表/任务),作用于选区覆盖的整行 */
  const applyLinePrefix = useCallback((mode: LinePrefixMode): void => {
    const ed = monacoRef.current;
    const model = ed?.getModel();
    const selection = ed?.getSelection();
    if (!ed || !model || !selection) return;
    ed.focus();
    // 多行选择且末行未真正选中(endColumn=1)时不纳入末行
    let endLine = selection.endLineNumber;
    if (endLine !== selection.startLineNumber && selection.endColumn === 1) endLine -= 1;
    const originalLines: string[] = [];
    for (let line = selection.startLineNumber; line <= endLine; line += 1) {
      originalLines.push(model.getLineContent(line));
    }
    if (originalLines.length === 0) return;
    const { lines } = toggleLinePrefixes(originalLines, mode);
    const lastColumn = endLine >= selection.startLineNumber ? model.getLineMaxColumn(endLine) : 1;
    ed.executeEdits('md-format', [
      {
        range: {
          startLineNumber: selection.startLineNumber,
          startColumn: 1,
          endLineNumber: Math.max(endLine, selection.startLineNumber),
          endColumn: lastColumn,
        },
        text: lines.join('\n'),
        forceMoveMarkers: true,
      },
    ]);
  }, []);

  /** 在光标处插入 GFM 表格骨架 */
  const insertTableTemplate = useCallback((): void => {
    const ed = monacoRef.current;
    const model = ed?.getModel();
    const position = ed?.getPosition();
    if (!ed || !model || !position) return;
    ed.focus();
    const eol = model.getLineMaxColumn(position.lineNumber);
    const colA = t('tools.markdown_preview.table_col_a');
    const colB = t('tools.markdown_preview.table_col_b');
    const cell = t('tools.markdown_preview.table_cell');
    ed.executeEdits('md-format', [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: eol,
          endLineNumber: position.lineNumber,
          endColumn: eol,
        },
        text: `\n| ${colA} | ${colB} |\n| --- | --- |\n| ${cell} | ${cell} |\n`,
        forceMoveMarkers: true,
      },
    ]);
  }, [t]);

  /** 插入链接:[选中文字](https://),并选中 URL 段便于直接输入 */
  const insertLink = useCallback((): void => {
    const ed = monacoRef.current;
    const model = ed?.getModel();
    const selection = ed?.getSelection();
    if (!ed || !model || !selection) return;
    ed.focus();
    const selected = model.getValueInRange(selection);
    const label = selected || t('tools.markdown_preview.link_text');
    const startOffset = model.getOffsetAt({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    ed.executeEdits('md-format', [
      { range: selection, text: `[${label}](https://)`, forceMoveMarkers: true },
    ]);
    const urlStart = model.getPositionAt(startOffset + label.length + 3);
    ed.setSelection({
      startLineNumber: urlStart.lineNumber,
      startColumn: urlStart.column,
      endLineNumber: urlStart.lineNumber,
      endColumn: urlStart.column + 'https://'.length,
    });
  }, [t]);

  /** 在当前选区位置插入文本(替换选区) */
  const insertRawText = useCallback((text: string): void => {
    const ed = monacoRef.current;
    const selection = ed?.getSelection();
    if (!ed || !selection) return;
    ed.focus();
    ed.executeEdits('md-paste', [{ range: selection, text, forceMoveMarkers: true }]);
  }, []);

  /** 粘贴为 Markdown:读取剪贴板 HTML → turndown → 插入光标处 */
  const pasteAsMarkdown = useCallback(async (): Promise<void> => {
    let html = '';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) {
            html = await (await item.getType('text/html')).text();
            break;
          }
        }
      }
    } catch {
      // 权限受限或非安全上下文:回退纯文本路径
    }

    const markdown = html ? htmlToMarkdown(html) : '';
    if (markdown) {
      insertRawText(markdown);
      showAlert({ variant: 'success', title: t('tools.markdown_preview.toast_pasted') });
      return;
    }
    // 无 HTML 可转:回退纯文本直接插入
    const text = await readClipboardText().catch(() => '');
    if (!text.trim()) {
      showAlert({
        variant: 'info',
        title: t('tools.markdown_preview.toast_clipboard_empty'),
      });
      return;
    }
    insertRawText(text);
  }, [insertRawText, t]);

  /** CodeEditor onMount:捕获实例与 monaco 命名空间,挂监听并注册快捷键 */
  const handleEditorMount = useCallback(
    (instance: MonacoEditor.IStandaloneCodeEditor, monacoNs: Monaco) => {
      monacoRef.current = instance;

      // —— 滚动同步 ——
      instance.onDidScrollChange(() => {
        const lock = syncingRef.current;
        if (lock && lock.source === 'preview' && performance.now() < lock.until) return;
        syncEditorToPreview(instance);
      });

      // —— 光标 / 选区统计(live store 局部订阅)——
      instance.onDidChangeCursorPosition((e) => {
        setMdCursor(e.position.lineNumber, e.position.column);
      });
      instance.onDidChangeCursorSelection(() => {
        const model = instance.getModel();
        const selection = instance.getSelection();
        if (!model || !selection || selection.isEmpty()) {
          setMdSelection(null);
          return;
        }
        const text = model.getValueInRange(selection);
        const selected = computeDocStats(text);
        setMdSelection({ words: selected.words, chars: selected.chars });
      });

      // —— 打字机模式:内容变更后把光标行滚动到视口中央(Typora 行为)——
      instance.onDidChangeModelContent(() => {
        if (!useMarkdownPreviewStore.getState().typewriterMode) return;
        const position = instance.getPosition();
        if (position) instance.revealLineInCenter(position.lineNumber);
      });

      // —— 快捷键(KeyMod/KeyCode 取自运行时命名空间,避免引入 monaco 值包)——
      // 占位文案在触发时经全局 translate 即时翻译(命令只注册一次,
      // 捕获 hook 的 t 会固化注册时的语言)
      const KeyMod = monacoNs.KeyMod;
      const KeyCode = monacoNs.KeyCode;
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyB, () =>
        applyInline('**', '**', translate('tools.markdown_preview.ph_bold')),
      );
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyI, () =>
        applyInline('*', '*', translate('tools.markdown_preview.ph_italic')),
      );
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyE, () =>
        applyInline('`', '`', translate('tools.markdown_preview.ph_code')),
      );
      instance.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX, () =>
        applyInline('~~', '~~', translate('tools.markdown_preview.ph_strike')),
      );
      instance.addCommand(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit1, () =>
        applyLinePrefix('h1'),
      );
      instance.addCommand(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit2, () =>
        applyLinePrefix('h2'),
      );
      instance.addCommand(
        KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
        () => void pasteAsMarkdown(),
      );
    },
    [applyInline, applyLinePrefix, pasteAsMarkdown, syncEditorToPreview],
  );

  /** 大纲点击:预览平滑滚动至锚点 + 编辑器跳转对应源行 */
  const handleOutlineClick = useCallback((item: OutlineItem) => {
    const target = articleRef.current?.querySelector(`#${escapeSelector(item.id)}`);
    if (target) {
      syncingRef.current = { source: 'preview', until: performance.now() + 400 };
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMdActiveHeading(item.id);
    }
    monacoRef.current?.revealLineInCenter(item.line);
    monacoRef.current?.setPosition({ lineNumber: item.line, column: 1 });
  }, []);

  /** 请求关闭文档:一律先弹确认框防误关(非空内容确认后直接关闭,
   * Markdown 工具不设本地历史,关闭即丢,确认是唯一的挽留手段) */
  function requestCloseDoc(id: string) {
    const target = docs.find((d) => d.id === id);
    if (!target) return;
    setCloseTarget(target);
  }

  /** 确认关闭文档 */
  function confirmCloseDoc() {
    if (!closeTarget) return;
    closeDoc(closeTarget.id);
    setCloseTarget(null);
  }

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  /** 复制为富文本(粘贴到邮件 / Word 保留排版) */
  const handleCopyRichText = useCallback(() => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    void writeClipboardRichText(html).then((ok) => {
      showAlert(
        ok
          ? {
              variant: 'success',
              title: t('tools.markdown_preview.toast_rich_ok'),
              description: t('tools.markdown_preview.toast_rich_hint'),
            }
          : { variant: 'destructive', title: t('tools.markdown_preview.toast_copy_failed') },
      );
    });
  }, [t]);

  /** 复制 HTML 源码 */
  const handleCopyHtmlSource = useCallback(() => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    void writeClipboardText(html).then((ok) => {
      showAlert(
        ok
          ? { variant: 'success', title: t('tools.markdown_preview.toast_html_ok') }
          : { variant: 'destructive', title: t('tools.markdown_preview.toast_copy_failed') },
      );
    });
  }, [t]);

  /** 另存为独立 HTML 文件(内嵌排版样式与公式字体;Night 固定深色外观) */
  const handleExportHtml = useCallback(async () => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    const firstHeading = outline[0]?.text ?? t('tools.markdown_preview.untitled_doc');
    const standalone = await buildStandaloneHtml(html, firstHeading, effectiveDark);
    const fileName = `${firstHeading.slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'document'}.html`;
    const ok = await saveStandaloneHtml(standalone, fileName);
    if (ok)
      showAlert({
        variant: 'success',
        title: t('tools.markdown_preview.toast_exported', { name: fileName }),
      });
  }, [effectiveDark, outline, t]);

  const showEditor = viewMode !== 'preview';
  const showPreview = viewMode !== 'edit';

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):Tab 栏 + 顶部工具条 + 分栏工作区收进同一卡片
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="markdown-preview"
    >
      {/* —— 多文档 Tab 栏(样式对齐 JsonFormatter doc-tabs:VSCode 风格全高 Tab) —— */}
      <div
        className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="md-doc-tabs"
      >
        {/* 悬浮横向滚动条(对齐 EditorTabsBar):细滑块(h-1.5)平时完全隐藏,
            悬浮 Tab 栏时才半透明浮现;绝对定位悬浮于内容之上,不占布局、
            不遮挡 Tab 文字,滚动条取代原生 overflow-x-auto 粗条 */}
        <ScrollArea
          viewportRef={docTabsScrollRef}
          orientation="horizontal"
          type="hover"
          scrollbarClassName="h-1.5 p-0"
          className="h-full min-w-0 flex-1"
        >
          <div
            role="tablist"
            aria-label={t('tools.markdown_preview.tabs_aria')}
            // min-w-max:让 Tab 行超出视口宽度,触发 Viewport 横向滚动
            className="flex h-full min-w-max items-stretch"
          >
            {sortedDocs.map((doc) => {
              const active = doc.id === activeDocId;
              return (
                <ContextMenu key={doc.id}>
                  {/* 关闭确认:锚定在 Tab 旁的小 Popover(受控 open 挂 closeTarget,
                    三条关闭路径——X 按钮/中键/右键菜单——统一落到该 Tab 的确认框) */}
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
                          data-testid="md-doc-tab"
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
                            'group relative flex h-7 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs outline-none',
                            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                            active
                              ? 'border-b-[3px] border-b-primary bg-card text-foreground'
                              : 'border-b-[3px] border-b-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          {/* 固定 Tab 用 Pin 图标替代文档图标(与编辑器 Tab 语义一致) */}
                          {doc.pinned ? (
                            <Pin
                              aria-label={t('tools.markdown_preview.pinned_aria')}
                              data-testid="md-doc-tab-pin"
                              className={cn(
                                'size-3.5 shrink-0',
                                active ? 'text-primary' : 'text-muted-foreground/70',
                              )}
                            />
                          ) : (
                            <FileText
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
                              aria-label={t('tools.markdown_preview.close_tab_aria', {
                                title: doc.title,
                              })}
                              title={t('tools.markdown_preview.close')}
                              data-testid="md-doc-tab-close"
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
                      data-testid="md-doc-close-dialog"
                    >
                      <p className="text-xs font-semibold">
                        {t('tools.markdown_preview.close_confirm_title', { title: doc.title })}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {t('tools.markdown_preview.close_confirm_desc')}
                      </p>
                      <div className="mt-2.5 flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setCloseTarget(null)}
                          data-testid="md-doc-close-dialog-cancel"
                        >
                          {t('tools.markdown_preview.cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={confirmCloseDoc}
                          data-testid="md-doc-close-dialog-confirm"
                        >
                          {t('tools.markdown_preview.close')}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {/* Tab 右键菜单:重命名 / 固定 / 关闭 */}
                  <ContextMenuContent className="w-48" data-testid="md-doc-tab-context-menu">
                    <ContextMenuItem
                      onSelect={() => setRenameTarget(doc)}
                      data-testid="ctx-md-doc-rename"
                    >
                      {t('tools.markdown_preview.rename')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => togglePinDoc(doc.id)}
                      data-testid="ctx-md-doc-toggle-pin"
                    >
                      {t('tools.markdown_preview.pin')}
                      {doc.pinned && (
                        <Pin
                          className="ml-auto size-3.5 text-primary"
                          data-testid="ctx-md-doc-pin-check"
                        />
                      )}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => requestCloseDoc(doc.id)}
                      data-testid="ctx-md-doc-close"
                    >
                      {t('tools.markdown_preview.close')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </ScrollArea>
        {/* 「+」新建按钮固定在滚动区外右端(对齐 VSCode):Tab 溢出滚动时始终可见可点 */}
        <button
          type="button"
          data-testid="md-doc-add"
          title={t('tools.markdown_preview.new_doc')}
          aria-label={t('tools.markdown_preview.new_doc')}
          onClick={() => newDoc()}
          className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </div>

      {/* —— 顶部工具条:视图模式 / 大纲开关 / 打字机 / 同步滚动(打印隐藏)—— */}
      <div
        className="flex items-center gap-2 border-b border-border px-1.5 py-1 print:hidden"
        data-testid="md-toolbar"
      >
        <div
          role="group"
          aria-label={t('tools.markdown_preview.view_group_aria')}
          className="flex overflow-hidden rounded border border-border"
        >
          {(
            [
              {
                id: 'edit',
                labelKey: 'tools.markdown_preview.view_edit',
                icon: PenLine,
                testId: 'mode-edit',
              },
              {
                id: 'split',
                labelKey: 'tools.markdown_preview.view_split',
                icon: Columns2,
                testId: 'mode-split',
              },
              {
                id: 'preview',
                labelKey: 'tools.markdown_preview.view_preview',
                icon: Eye,
                testId: 'mode-preview',
              },
            ] as ReadonlyArray<{
              id: MdViewMode;
              labelKey: string;
              icon: typeof Eye;
              testId: string;
            }>
          ).map(({ id, labelKey, icon: Icon, testId }) => {
            const label = t(labelKey);
            return (
              <button
                key={id}
                type="button"
                data-testid={testId}
                aria-pressed={viewMode === id}
                title={t('tools.markdown_preview.view_mode_title', { label })}
                onClick={() => setViewMode(id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 text-xs transition-colors',
                  viewMode === id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-testid="btn-outline"
          aria-pressed={outlineOpen}
          onClick={toggleOutline}
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors',
            outlineOpen
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <ListTree aria-hidden className="size-3.5" />
          {t('tools.markdown_preview.outline_toggle')}
        </button>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('tools.markdown_preview.typewriter')}
          <Switch
            checked={typewriterMode}
            onCheckedChange={setTypewriterMode}
            aria-label={t('tools.markdown_preview.typewriter_aria')}
            data-testid="md-typewriter"
          />
        </label>

        {/* 主题选择(同步滚动左侧):置顶全局工具条,预览标题栏仅保留复制/导出,
            与 CodeEditor 26px 标题栏严格等高,不再被 h-7 的 Select 撑高 */}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('tools.markdown_preview.theme_select_aria')}
          <Select value={themeId} onValueChange={(v) => setThemeId(v as typeof themeId)}>
            <SelectTrigger
              aria-label={t('tools.markdown_preview.theme_select_aria')}
              data-testid="md-theme-select"
              className="h-6 w-28 px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_ITEMS.map((item) => (
                <SelectItem key={item.id} value={item.id} data-testid={`theme-${item.id}`}>
                  {t(item.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('tools.markdown_preview.sync_scroll')}
          <Switch
            checked={syncScroll}
            onCheckedChange={setSyncScroll}
            aria-label={t('tools.markdown_preview.sync_scroll_aria')}
            data-testid="md-sync-scroll"
          />
        </label>
      </div>

      {/* —— 主区域:大纲面板 + 可拖拽分栏 —— */}
      <div className="flex min-h-0 flex-1">
        {outlineOpen && <MdOutlinePanel outline={outline} onJump={handleOutlineClick} />}

        <div className="min-h-0 min-w-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {showEditor && (
              <>
                <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
                  <CodeEditor
                    // 切换 Tab 重挂编辑器:Monaco 实例与文档内容绑定(滚动同步/
                    // 光标监听/快捷键注册都以单实例为前提),复用实例会串内容
                    key={activeDocId ?? 'empty'}
                    title="Markdown"
                    language="markdown"
                    value={input}
                    onChange={setInput}
                    placeholder={t('tools.markdown_preview.editor_placeholder')}
                    data-testid="md-input"
                    // 嵌入 shell:去掉编辑器自带圆角/边框(外框由 shell 提供);
                    // 分屏时仅在朝向预览的一侧保留 border-r 作分栏分隔线,
                    // 纯编辑模式下两侧都与 shell 边缘齐平
                    className={cn('h-full rounded-none border-0', showPreview && 'border-r')}
                    searchAnchor="markdown_preview:input"
                    showPaste
                    showOpenFile
                    showClear
                    showStatusBar={false}
                    minimap={false}
                    onMount={handleEditorMount}
                    actions={
                      <>
                        {/* —— 格式工具栏(Typora 常用插入;快捷键见 addCommand)—— */}
                        <MdFormatButton
                          icon={Bold}
                          title={t('tools.markdown_preview.fmt_bold')}
                          testId="fmt-bold"
                          onClick={() =>
                            applyInline('**', '**', t('tools.markdown_preview.ph_bold'))
                          }
                        />
                        <MdFormatButton
                          icon={Italic}
                          title={t('tools.markdown_preview.fmt_italic')}
                          testId="fmt-italic"
                          onClick={() =>
                            applyInline('*', '*', t('tools.markdown_preview.ph_italic'))
                          }
                        />
                        <MdFormatButton
                          icon={Strikethrough}
                          title={t('tools.markdown_preview.fmt_strike')}
                          testId="fmt-strike"
                          onClick={() =>
                            applyInline('~~', '~~', t('tools.markdown_preview.ph_strike'))
                          }
                        />
                        <MdFormatButton
                          icon={Code}
                          title={t('tools.markdown_preview.fmt_inline_code')}
                          testId="fmt-code"
                          onClick={() => applyInline('`', '`', t('tools.markdown_preview.ph_code'))}
                        />
                        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                        <MdFormatButton
                          text="H1"
                          title={t('tools.markdown_preview.fmt_h1')}
                          testId="fmt-h1"
                          onClick={() => applyLinePrefix('h1')}
                        />
                        <MdFormatButton
                          text="H2"
                          title={t('tools.markdown_preview.fmt_h2')}
                          testId="fmt-h2"
                          onClick={() => applyLinePrefix('h2')}
                        />
                        <MdFormatButton
                          icon={Quote}
                          title={t('tools.markdown_preview.fmt_quote')}
                          testId="fmt-quote"
                          onClick={() => applyLinePrefix('quote')}
                        />
                        <MdFormatButton
                          icon={List}
                          title={t('tools.markdown_preview.fmt_bullet')}
                          testId="fmt-bullet"
                          onClick={() => applyLinePrefix('bullet')}
                        />
                        <MdFormatButton
                          icon={ListTodo}
                          title={t('tools.markdown_preview.fmt_task')}
                          testId="fmt-task"
                          onClick={() => applyLinePrefix('task')}
                        />
                        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                        <MdFormatButton
                          icon={Table}
                          title={t('tools.markdown_preview.fmt_table')}
                          testId="fmt-table"
                          onClick={insertTableTemplate}
                        />
                        <MdFormatButton
                          icon={Link2}
                          title={t('tools.markdown_preview.fmt_link')}
                          testId="fmt-link"
                          onClick={insertLink}
                        />
                        <MdFormatButton
                          icon={ClipboardPaste}
                          title={t('tools.markdown_preview.fmt_paste_md')}
                          testId="fmt-paste-md"
                          onClick={() => void pasteAsMarkdown()}
                        />
                      </>
                    }
                  />
                </ResizablePanel>
                {showPreview && <ResizableHandle withHandle />}
              </>
            )}

            {showPreview && (
              <ResizablePanel
                defaultSize={showEditor ? '50' : '100'}
                minSize="20"
                className="min-h-0 min-w-0"
              >
                {/* 分屏时补 border-l 与编辑框 border-r 对称(对齐 DuplicateDetector
                    结果面板):分隔条两侧都有边线;纯预览模式左侧已是 shell 外框
                    /大纲面板 border-r,再加会出双线,故仅 showEditor 时生效 */}
                <section
                  className={cn('flex h-full min-h-0 flex-col', showEditor && 'border-l')}
                  data-search-anchor="markdown_preview:preview"
                >
                  {/* 预览标题栏:与左侧 CodeEditor 标题栏同高(26px)、同排版,
                      复制/导出放动作区 */}
                  <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2 print:hidden">
                    <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                      {t('tools.markdown_preview.preview_label')}
                    </span>
                    <span className="flex h-[26px] shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        data-testid="btn-copy-rich"
                        onClick={handleCopyRichText}
                        className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t('tools.markdown_preview.copy_rich')}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            data-testid="btn-export"
                            title={t('tools.markdown_preview.export')}
                            className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Download aria-hidden className="size-3.5" />
                            {t('tools.markdown_preview.export')}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            data-testid="export-html-file"
                            onSelect={() => void handleExportHtml()}
                          >
                            <Download aria-hidden className="mr-2 size-3.5 opacity-60" />
                            {t('tools.markdown_preview.export_html')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-testid="copy-html-source"
                            onSelect={handleCopyHtmlSource}
                          >
                            <FileCode2 aria-hidden className="mr-2 size-3.5 opacity-60" />
                            {t('tools.markdown_preview.copy_html_source')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </div>

                  {/* 共享预览面板(渲染/lightbox/脚注气泡/交互代理内聚) */}
                  <MarkdownPreviewPane
                    source={input}
                    onScroller={handlePaneScroller}
                    onArticle={handlePaneArticle}
                    onRendered={handlePaneRendered}
                    onScroll={handlePreviewScroll}
                  />
                </section>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </div>
      </div>

      <MdStatusBar stats={stats} />

      {/* —— 重命名对话框(条件渲染:关闭即卸载,每次打开取最新标题)—— */}
      {renameTarget && (
        <RenameDialog
          open
          title={t('tools.markdown_preview.rename_dialog_title')}
          initialValue={renameTarget.title}
          onConfirm={(name) => {
            renameDoc(renameTarget.id, name);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
          data-testid="md-doc-rename-dialog"
        />
      )}
    </div>
  );
}
