/**
 * Markdown 预览(参考 Typora 设计的增强型分栏工具)
 *
 * 能力:
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
} from 'react';
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
  Italic,
  Link2,
  List,
  ListTree,
  ListTodo,
  PenLine,
  Quote,
  Strikethrough,
  Table,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { CodeEditor } from '@/components/ui/code-editor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
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
import { cn } from '@/lib/utils';
import { computeDocStats, renderMarkdown, type DocStats, type OutlineItem } from './markdown-render';
import {
  applyInlineWrap,
  toggleLinePrefixes,
  type LinePrefixMode,
} from './markdown-edit';
import { htmlToMarkdown } from './markdown-paste';
import {
  MarkdownPreviewPane,
  useIsDarkTheme,
} from './markdown-preview-pane';
import { buildSyncAnchors, mapAcrossAnchors } from './markdown-scroll';
import { buildStandaloneHtml, saveStandaloneHtml } from './markdown-export';
import {
  DRAFT_STORAGE_KEY,
  SAMPLE_MARKDOWN,
  THEME_ITEMS,
  mdLiveStore,
  setMdActiveHeading,
  setMdCursor,
  setMdSelection,
  useMarkdownPreviewStore,
  type MdViewMode,
} from './markdownPreviewStore';
import type { ToolProps } from './registry';

/** 草稿保存防抖间隔(ms) */
const DRAFT_DEBOUNCE_MS = 500;

/** CSS.escape 安全封装(旧 WebView / 测试环境兜底) */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/** 读取初始草稿:无历史草稿时返回示例文档 */
function loadInitialDraft(): string {
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) ?? SAMPLE_MARKDOWN;
  } catch {
    return SAMPLE_MARKDOWN;
  }
}

// ============================================================
// 子组件:状态栏 / 大纲面板 / 格式按钮(高频信号局部订阅)
// ============================================================

function MdStatusBar({ stats }: { stats: DocStats }): JSX.Element {
  const cursor = useStore(mdLiveStore, (s) => s.cursor);
  const selection = useStore(mdLiveStore, (s) => s.selection);
  return (
    <footer
      className="flex items-center justify-between border-t border-border px-3 py-1 text-[11px] text-muted-foreground print:hidden"
      data-testid="md-statusbar"
    >
      <span data-testid="md-cursor">
        行 {cursor.line}, 列 {cursor.column}
      </span>
      <span data-testid="md-stats">
        {selection && (
          <span data-testid="md-selection-stats">
            已选 {selection.words} 词 / {selection.chars} 字符 ·{' '}
          </span>
        )}
        {stats.words} 词 · {stats.chars} 字符 · {stats.lines} 行
        {stats.readingMinutes > 0 ? ` · 约 ${stats.readingMinutes} 分钟` : ''}
      </span>
    </footer>
  );
}

interface MdOutlinePanelProps {
  outline: OutlineItem[];
  onJump: (item: OutlineItem) => void;
}

function MdOutlinePanel({ outline, onJump }: MdOutlinePanelProps): JSX.Element {
  const activeHeadingId = useStore(mdLiveStore, (s) => s.activeHeadingId);
  return (
    <aside
      className="w-52 shrink-0 overflow-y-auto border-r border-border bg-sidebar/60 py-2 print:hidden"
      data-testid="outline-panel"
      data-search-anchor="markdown_preview:outline"
    >
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        大纲
      </p>
      {outline.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="outline-empty">
          暂无标题 · 使用 # 编写标题后展示
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

export function MarkdownPreview(_props: ToolProps): JSX.Element {
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

  const [initialDraft] = useState(loadInitialDraft);
  const [input, setInput] = useState(initialDraft);
  /** 渲染结果中的大纲(由共享面板回调推送;首帧为空,挂载即达) */
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  const isDark = useIsDarkTheme();
  /** Night 主题固定深色:导出外观需叠加判定 */
  const effectiveDark = useMemo(() => isDark || themeId === 'night', [isDark, themeId]);

  const articleRef = useRef<HTMLElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  /** 滚动同步方向锁:'editor' | 'preview' | null,防止联动回环 */
  const syncingRef = useRef<{ source: 'editor' | 'preview'; until: number } | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stats = useMemo(() => computeDocStats(input), [input]);

  // —— 草稿持久化(防抖;渲染管线由共享面板承担)——
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, input);
      } catch {
        // 存储满/隐私模式等异常静默忽略
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [input]);

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
    ed.executeEdits('md-format', [{ range: selection, text: result.insert, forceMoveMarkers: true }]);
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
    ed.executeEdits('md-format', [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: eol,
          endLineNumber: position.lineNumber,
          endColumn: eol,
        },
        text: '\n| 列 A | 列 B |\n| --- | --- |\n| 内容 | 内容 |\n',
        forceMoveMarkers: true,
      },
    ]);
  }, []);

  /** 插入链接:[选中文字](https://),并选中 URL 段便于直接输入 */
  const insertLink = useCallback((): void => {
    const ed = monacoRef.current;
    const model = ed?.getModel();
    const selection = ed?.getSelection();
    if (!ed || !model || !selection) return;
    ed.focus();
    const selected = model.getValueInRange(selection);
    const label = selected || '链接文字';
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
  }, []);

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
      showAlert({ variant: 'success', title: '已粘贴为 Markdown' });
      return;
    }
    // 无 HTML 可转:回退纯文本直接插入
    const text = await readClipboardText().catch(() => '');
    if (!text.trim()) {
      showAlert({ variant: 'info', title: '剪贴板没有可粘贴的内容' });
      return;
    }
    insertRawText(text);
  }, [insertRawText]);

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
      const KeyMod = monacoNs.KeyMod;
      const KeyCode = monacoNs.KeyCode;
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyB, () => applyInline('**', '**', '加粗文字'));
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyI, () => applyInline('*', '*', '斜体文字'));
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyE, () => applyInline('`', '`', '代码'));
      instance.addCommand(
        KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX,
        () => applyInline('~~', '~~', '删除线'),
      );
      instance.addCommand(
        KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit1,
        () => applyLinePrefix('h1'),
      );
      instance.addCommand(
        KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit2,
        () => applyLinePrefix('h2'),
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

  /** 复制为富文本(粘贴到邮件 / Word 保留排版) */
  const handleCopyRichText = useCallback(() => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    void writeClipboardRichText(html).then((ok) => {
      showAlert(
        ok
          ? { variant: 'success', title: '已复制富文本', description: '可直接粘贴到邮件或文档编辑器' }
          : { variant: 'destructive', title: '复制失败' },
      );
    });
  }, []);

  /** 复制 HTML 源码 */
  const handleCopyHtmlSource = useCallback(() => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    void writeClipboardText(html).then((ok) => {
      showAlert(ok ? { variant: 'success', title: '已复制 HTML 源码' } : { variant: 'destructive', title: '复制失败' });
    });
  }, []);

  /** 另存为独立 HTML 文件(内嵌排版样式与公式字体;Night 固定深色外观) */
  const handleExportHtml = useCallback(async () => {
    const html = articleRef.current?.innerHTML ?? '';
    if (!html) return;
    const firstHeading = outline[0]?.text ?? '未命名文档';
    const standalone = await buildStandaloneHtml(html, firstHeading, effectiveDark);
    const fileName = `${firstHeading.slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'document'}.html`;
    const ok = await saveStandaloneHtml(standalone, fileName);
    if (ok) showAlert({ variant: 'success', title: `已导出 ${fileName}` });
  }, [effectiveDark, outline]);

  const showEditor = viewMode !== 'preview';
  const showPreview = viewMode !== 'edit';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="markdown-preview">
      {/* —— 顶部工具条:视图模式 / 大纲开关 / 打字机 / 同步滚动(打印隐藏)—— */}
      <div
        className="flex items-center gap-2 border-b border-border px-1.5 py-1 print:hidden"
        data-testid="md-toolbar"
      >
        <div
          role="group"
          aria-label="视图模式"
          className="flex overflow-hidden rounded border border-border"
        >
          {(
            [
              { id: 'edit', label: '编辑', icon: PenLine, testId: 'mode-edit' },
              { id: 'split', label: '分屏', icon: Columns2, testId: 'mode-split' },
              { id: 'preview', label: '预览', icon: Eye, testId: 'mode-preview' },
            ] as ReadonlyArray<{ id: MdViewMode; label: string; icon: typeof Eye; testId: string }>
          ).map(({ id, label, icon: Icon, testId }) => (
            <button
              key={id}
              type="button"
              data-testid={testId}
              aria-pressed={viewMode === id}
              title={`${label}模式`}
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
          ))}
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
          大纲
        </button>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          打字机
          <Switch
            checked={typewriterMode}
            onCheckedChange={setTypewriterMode}
            aria-label="打字机模式"
            data-testid="md-typewriter"
          />
        </label>

        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          同步滚动
          <Switch
            checked={syncScroll}
            onCheckedChange={setSyncScroll}
            aria-label="滚动同步"
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
                <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
                  <CodeEditor
                    title="Markdown"
                    language="markdown"
                    value={input}
                    onChange={setInput}
                    placeholder="# 开始编写 Markdown…"
                    data-testid="md-input"
                    className="h-full"
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
                          title="加粗 (Ctrl+B)"
                          testId="fmt-bold"
                          onClick={() => applyInline('**', '**', '加粗文字')}
                        />
                        <MdFormatButton
                          icon={Italic}
                          title="斜体 (Ctrl+I)"
                          testId="fmt-italic"
                          onClick={() => applyInline('*', '*', '斜体文字')}
                        />
                        <MdFormatButton
                          icon={Strikethrough}
                          title="删除线 (Ctrl+Shift+X)"
                          testId="fmt-strike"
                          onClick={() => applyInline('~~', '~~', '删除线')}
                        />
                        <MdFormatButton
                          icon={Code}
                          title="行内代码 (Ctrl+E)"
                          testId="fmt-code"
                          onClick={() => applyInline('`', '`', '代码')}
                        />
                        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                        <MdFormatButton
                          text="H1"
                          title="一级标题 (Ctrl+Alt+1)"
                          testId="fmt-h1"
                          onClick={() => applyLinePrefix('h1')}
                        />
                        <MdFormatButton
                          text="H2"
                          title="二级标题 (Ctrl+Alt+2)"
                          testId="fmt-h2"
                          onClick={() => applyLinePrefix('h2')}
                        />
                        <MdFormatButton
                          icon={Quote}
                          title="引用"
                          testId="fmt-quote"
                          onClick={() => applyLinePrefix('quote')}
                        />
                        <MdFormatButton
                          icon={List}
                          title="无序列表"
                          testId="fmt-bullet"
                          onClick={() => applyLinePrefix('bullet')}
                        />
                        <MdFormatButton
                          icon={ListTodo}
                          title="任务列表"
                          testId="fmt-task"
                          onClick={() => applyLinePrefix('task')}
                        />
                        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                        <MdFormatButton
                          icon={Table}
                          title="插入表格"
                          testId="fmt-table"
                          onClick={insertTableTemplate}
                        />
                        <MdFormatButton
                          icon={Link2}
                          title="插入链接"
                          testId="fmt-link"
                          onClick={insertLink}
                        />
                        <MdFormatButton
                          icon={ClipboardPaste}
                          title="粘贴为 Markdown (Ctrl+Shift+V)"
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
              <ResizablePanel defaultSize={showEditor ? 50 : 100} minSize={20} className="min-h-0 min-w-0">
                <section
                  className="flex h-full min-h-0 flex-col"
                  data-search-anchor="markdown_preview:preview"
                >
                  {/* 预览工具条:主题 / 复制 / 导出(打印隐藏) */}
                  <div className="flex items-center gap-1.5 border-b border-border px-2 py-1 print:hidden">
                    <span className="text-xs font-medium text-muted-foreground">预览</span>
                    <Select value={themeId} onValueChange={(v) => setThemeId(v as typeof themeId)}>
                      <SelectTrigger
                        aria-label="排版主题"
                        data-testid="md-theme-select"
                        className="h-7 w-28 px-2 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {THEME_ITEMS.map((item) => (
                          <SelectItem key={item.id} value={item.id} data-testid={`theme-${item.id}`}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        data-testid="btn-copy-rich"
                        onClick={handleCopyRichText}
                        className="rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        复制富文本
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            data-testid="btn-export"
                            title="导出"
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <Download aria-hidden className="size-3.5" />
                            导出
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid="export-html-file" onSelect={() => void handleExportHtml()}>
                            <Download aria-hidden className="mr-2 size-3.5 opacity-60" />
                            另存为 HTML 文件
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid="copy-html-source" onSelect={handleCopyHtmlSource}>
                            <FileCode2 aria-hidden className="mr-2 size-3.5 opacity-60" />
                            复制 HTML 源码
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
    </div>
  );
}
