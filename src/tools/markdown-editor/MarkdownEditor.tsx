/**
 * Markdown 编辑器(Typora 式无缝所见即所得,TipTap/ProseMirror 内核)。
 *
 * 与旧 MarkdownPreview 分栏的关系:
 * - 真相源翻转:旧版以源码字符串为真相(Monaco 编辑 + marked 渲染);
 *   本页以 ProseMirror doc 为真相,Markdown 只做落盘/打开/导出的序列化格式。
 * - 外围复用(行为不变):多 Tab 文档 store(`markdownEditorDocsStore`,
 *   持久化 key 不变,旧 Tab 无缝继承)、文件存盘/mtime 冲突三选、导出基建、
 *   排版主题(`.markdown-body .md-theme-*` 同套 CSS 变量)、字数统计口径。
 * - 旧只读垫片(`markdown-editor-pane`,文本编辑器分屏预览用)保留不动。
 *
 * 数据安全红线:tiptap-markdown 默认会吃掉 front matter(实测)、转义 alert
 * marker —— 前者进出包 strip/restore,后者有 AlertBlock 自定义节点。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Placeholder } from '@tiptap/extension-placeholder';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  ChevronDown,
  Code,
  Columns3,
  Download,
  FileCode,
  FileCode2,
  FileText,
  FolderOpen,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  PenLine,
  Plus,
  Quote,
  Save,
  Strikethrough,
  X,
  Pin,
} from 'lucide-react';
import { toast } from 'sonner';
import 'katex/dist/katex.min.css';
import './tiptap.css';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/file-utils';
import { writeClipboardRichText, writeClipboardText } from '@/lib/clipboard';
import { persistDelayFor } from '@/lib/persist-debounce';
import { showAlert } from '@/lib/toast-alert';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { useToolShortcut } from '@/hooks/useShortcut';
import { useToolMenus } from '@/store/toolMenubarStore';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_SHORTCUTS, type ShortcutBinding } from '@/types/config';
import type { ToolMenu } from '@/types/tool-menu';
import type { ToolProps } from '../registry';
import type { OutlineItem } from '../markdown-render';
import { renderMarkdown, sanitizeMarkdownHtml } from '../markdown-render';
import { useMdEditorDocsStore, type MdDoc } from '../markdownEditorDocsStore';
import {
  getSampleMarkdown,
  mdLiveStore,
  setMdCursor,
  setMdSelection,
  useMarkdownEditorStore,
  type MdEditorMode,
} from '../markdownEditorStore';
import { splitFrontMatter, joinFrontMatter } from './markdown-doc';
import {
  AlertBlock,
  MathBlock,
  MathInline,
  MdImage,
  MermaidBlock,
  slugifyHeading,
} from './extensions';
import { savePastedImage } from '../markdown-image-assets';
import { buildStandaloneHtml, saveStandaloneHtml, saveTextFile } from '../markdown-export';
import {
  fileMtimeMs,
  forceOpenFile,
  openTextFileDialog,
  readTextFileEncoded,
  saveToPathEncoded,
  saveWithDialogEncoded,
  OPEN_REASON_BINARY,
  OPEN_REASON_TOO_LARGE,
} from '../code-editor-workspace/fileOps';
import {
  resolveSidebarResize,
  SIDEBAR_HIDE_DELTA,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../code-editor-workspace/schema';
import { fileNameFromPath } from '../code-editor-workspace/languageMap';
import { FileModifiedDialog } from '../code-editor-workspace/FileModifiedDialog';
import { RenameDialog } from '@/components/RenameDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { CodeEditor } from '@/components/ui/code-editor';
import { UnsavedPopover, type UnsavedMode } from '../code-editor-workspace/UnsavedPopover';
import { PathBreadcrumb } from '../code-editor-workspace/PathBreadcrumb';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CommandError } from '@/lib/ipc';

const lowlight = createLowlight(common);

/** tiptap-markdown 未类型化的 storage 读写(TipTap v3 官方类型尚未覆盖) */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } };
  return storage.markdown.getMarkdown();
}

/** 字数统计口径与旧状态栏一致(CJK 逐字,拉丁记词,250 词/分钟) */
function computeStats(source: string): {
  words: number;
  chars: number;
  lines: number;
  minutes: number;
} {
  const chars = [...source].length;
  const lines = source.length === 0 ? 1 : source.split('\n').length;
  if (!source.trim()) return { words: 0, chars: 0, lines, minutes: 0 };
  const cjk = (source.match(/[一-鿿぀-ヿ가-힯]/g) ?? []).length;
  const latin = (source.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) ?? []).length;
  const words = cjk + latin;
  return { words, chars, lines, minutes: Math.max(1, Math.ceil(words / 250)) };
}

/** CSS.escape 兜底(旧 WebView / 测试环境) */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * 文档是否有未保存改动(与文本编辑器同语义:content !== savedContent)。
 * 纯草稿(无 path)savedContent 缺省视为空串,故有内容即未保存;
 * 有 path 的文档以打开/上次保存快照为基准。
 */
function isDocDirty(doc: MdDoc): boolean {
  return doc.content !== (doc.savedContent ?? '');
}

/** 导出 HTML 的标题注入 slug id(旧预览锚点语义,保证目录跳转不断) */
function assignHeadingIds(html: string): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const seen = new Map<string, number>();
  for (const h of Array.from(box.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const base = slugifyHeading(h.textContent ?? '') || 'heading';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    h.id = count === 0 ? base : `${base}-${count}`;
  }
  return box.innerHTML;
}

/** 从编辑器文档提取大纲(line 字段复用为 doc 内位置,供跳转滚动用) */
function extractOutline(editor: Editor): OutlineItem[] {
  const items: Array<{ text: string; level: number; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      items.push({ text: node.textContent, level: node.attrs.level as number, pos });
    }
    return true;
  });
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = slugifyHeading(item.text) || 'heading';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      id: count === 0 ? base : `${base}-${count}`,
      text: item.text,
      level: item.level,
      line: item.pos,
    };
  });
}

/**
 * 状态栏(文本编辑器底部同款容器样式;内容不变)。
 * 左:源码光标行列 / 所见当前章节;右:选区统计 + 字数汇总 + 大小 + 编码。
 * 光标/选区经 mdLiveStore 局部订阅(高频信号不重渲染整页)。
 */
function MdStatusBar({
  markdown,
  section,
  encoding,
  mode,
}: {
  markdown: string;
  /** 所见模式当前章节(源码模式传 null,改看光标) */
  section: string | null;
  encoding?: string;
  mode: MdEditorMode;
}): JSX.Element {
  const { t } = useTranslation();
  const cursor = useStore(mdLiveStore, (s) => s.cursor);
  const selection = useStore(mdLiveStore, (s) => s.selection);
  const stats = useMemo(() => computeStats(markdown), [markdown]);
  const sizeBytes = useMemo(() => new TextEncoder().encode(markdown).length, [markdown]);
  return (
    <footer
      className="flex items-center justify-between gap-1 border-t border-input px-2 py-0.5 text-xs tabular-nums text-muted-foreground print:hidden"
      data-testid="md-statusbar"
    >
      <span className="flex min-w-0 items-center gap-2">
        {mode === 'source' ? (
          <span data-testid="md-status-cursor" className="whitespace-nowrap">
            {t('tools.markdown_editor.status_cursor', {
              line: cursor.line,
              column: cursor.column,
            })}
          </span>
        ) : (
          section && (
            <span data-testid="md-status-section" className="min-w-0 truncate">
              {section}
            </span>
          )
        )}
      </span>
      <span className="flex items-center gap-2">
        {selection && (
          <span data-testid="md-status-selection" className="whitespace-nowrap">
            {t('tools.markdown_editor.status_selection', {
              words: selection.words,
              chars: selection.chars,
            })}
          </span>
        )}
        <span data-testid="md-stats-words" className="whitespace-nowrap">
          {t('tools.markdown_editor.status_summary', {
            words: stats.words,
            chars: stats.chars,
            lines: stats.lines,
          })}
          {stats.minutes > 0
            ? ` · ${t('tools.markdown_editor.reading_time', { minutes: stats.minutes })}`
            : ''}
        </span>
        <span
          data-testid="md-status-encoding"
          className="whitespace-nowrap px-1.5 py-0.5"
          title={t('tools.markdown_editor.status_encoding_title')}
        >
          {(encoding ?? 'utf-8').toUpperCase()}
        </span>
        <span
          data-testid="md-status-size"
          className="whitespace-nowrap"
          title={t('tools.markdown_editor.status_size_title')}
        >
          {formatBytes(sizeBytes)}
        </span>
      </span>
    </footer>
  );
}

/**
 * 单文档所见编辑区(按 key={doc.id} 挂载:切 Tab 即旧实例卸载落盘、
 * 新实例以正文直装,无跨文档 setContent,不存在切换 effect)。
 *
 * 与父组件的契约:
 * - body:已剥离 front matter 的正文(装载唯一输入)
 * - onSnapshot:挂载即时 + 输入防抖 400ms 回报(序列化正文 + 大纲),
 *   父组件据此写 store/刷大纲/状态栏 —— 均为事件路径 setState
 * - onTick:选区/内容变化的轻量重渲染信号(工具条 isActive 用)
 * - registerFlush:注册同步落盘函数(保存/导出前父组件先调用,
 *   store 写是同步的,随后读 store 即最新)
 * - 卸载自动落盘(弹窗关闭回写依赖持久层,见 popout-sync)
 */
function WysiwygDoc({
  body,
  themeId,
  placeholder,
  onSnapshot,
  onTick,
  onReady,
  registerFlush,
}: {
  body: string;
  themeId: string;
  placeholder: string;
  onSnapshot: (bodyMd: string, outline: OutlineItem[]) => void;
  onTick: () => void;
  onReady: (editor: Editor | null) => void;
  registerFlush: (flush: () => void) => void;
}): JSX.Element {
  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef(onSnapshot);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 回调最新值同步(挂载 effect 内写 ref,渲染期不碰 ref)
  useEffect(() => {
    snapshotRef.current = onSnapshot;
  });

  const snapshot = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    snapshotRef.current(getMarkdown(editor), extractOutline(editor));
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlockLowlight.configure({ lowlight }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        MdImage,
        Placeholder.configure({ placeholder }),
        AlertBlock,
        MathInline,
        MathBlock,
        MermaidBlock,
        Markdown,
      ],
      content: body,
      editorProps: {
        attributes: { 'data-testid': 'md-wysiwyg', class: 'tiptap-md-body' },
        handlePaste(_view, event) {
          const files = event.clipboardData?.files;
          if (!files || files.length === 0) return false;
          const image = Array.from(files).find((f) => f.type.startsWith('image/'));
          if (!image) return false;
          event.preventDefault();
          void savePastedImage(image).then((result) => {
            if (!result || !editorRef.current) return;
            const m = /^!\[(.*?)\]\((.*)\)$/.exec(result.markdown);
            editorRef.current
              .chain()
              .focus()
              .setImage({ src: m?.[2] ?? result.markdown, alt: m?.[1] ?? 'image' })
              .run();
          });
          return true;
        },
        handleDrop(_view, event) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          const image = Array.from(files).find((f) => f.type.startsWith('image/'));
          if (!image) return false;
          event.preventDefault();
          void savePastedImage(image).then((result) => {
            if (!result || !editorRef.current) return;
            const m = /^!\[(.*?)\]\((.*)\)$/.exec(result.markdown);
            editorRef.current
              .chain()
              .focus()
              .setImage({ src: m?.[2] ?? result.markdown, alt: m?.[1] ?? 'image' })
              .run();
          });
          return true;
        },
      },
      onUpdate: () => {
        onTick();
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(snapshot, 400);
      },
      onSelectionUpdate: ({ editor: selEditor }) => {
        onTick();
        // 选区字数进 live store(状态栏局部订阅,父页不重渲染)
        const { from, to } = selEditor.state.selection;
        if (from === to) {
          setMdSelection(null);
          return;
        }
        const text = selEditor.state.doc.textBetween(from, to);
        const s = computeStats(text);
        setMdSelection({ words: s.words, chars: s.chars });
      },
    },
    [],
  );

  // 挂载:注册实例与落盘函数并即时快照(大纲/状态栏首帧即有);
  // 卸载:清防抖并落盘(切 Tab/关弹窗不丢字)
  useEffect(() => {
    editorRef.current = editor;
    onReady(editor);
    registerFlush(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      snapshot();
    });
    if (editor) {
      snapshot();
      // 默认光标:挂载即聚焦(切文档/切模式/首次打开均有可输入光标),同文本编辑器;
      // 关滚动跟随:挂载聚焦不应抢滚动(也避开 jsdom 无布局时的坐标计算)
      if (editor.isEditable) editor.commands.focus(null, { scrollIntoView: false });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      snapshot();
      // 旧文档选区不带到新文档
      setMdSelection(null);
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps -- 挂载/卸载一次性语义
  }, [editor]);

  return <EditorContent editor={editor} className={cn('markdown-body', `md-theme-${themeId}`)} />;
}

/**
 * 大纲拖拽分隔条(文本编辑器 SidebarResizeHandle 同款):
 * 2px 透明点击区填 gap,hover/拖拽时亮主色线;拖拽语义(夹取/隐藏滞回/
 * 隐藏态右拖恢复)复用 resolveSidebarResize,写入本工具的 outlineWidth。
 */
function OutlineResizeHandle(): JSX.Element {
  const { t } = useTranslation();
  const startWidthRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const pinnedRef = useRef<boolean>(false);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const width = useMarkdownEditorStore((s) => s.outlineWidth);
  const visible = useMarkdownEditorStore((s) => s.outlineOpen);

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const st = useMarkdownEditorStore.getState();
    if (st.outlineOpen) {
      startWidthRef.current = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, st.outlineWidth),
      );
      startXRef.current = e.clientX;
      pinnedRef.current = false;
    } else {
      startWidthRef.current = 0;
      startXRef.current = e.clientX;
      pinnedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = 'col-resize';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = 'none';
    setActive(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  function handleMouseMove(ev: MouseEvent): void {
    const st = useMarkdownEditorStore.getState();
    const next = resolveSidebarResize(
      startWidthRef.current,
      ev.clientX,
      startXRef.current,
      st.outlineOpen,
      pinnedRef.current,
    );
    if (next.action === 'resize') {
      st.setOutlineWidth(next.width);
      if (next.width > SIDEBAR_MIN_WIDTH) pinnedRef.current = false;
    } else if (next.action === 'hide') {
      // 仅切换可见性,不覆盖已存宽度:重开仍回原宽度
      st.setOutlineOpen(false);
      startWidthRef.current = -SIDEBAR_HIDE_DELTA;
      startXRef.current = ev.clientX;
    } else if (next.action === 'show') {
      st.setOutlineOpen(true);
      st.setOutlineWidth(SIDEBAR_MIN_WIDTH);
      pinnedRef.current = true;
    }
  }

  function handleMouseUp(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    pinnedRef.current = false;
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = '';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = '';
    setActive(false);
  }

  const highlighted = hovered || active;
  return (
    <div
      data-testid="md-outline-resize"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={visible ? width : SIDEBAR_MIN_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title={visible ? t('tools.text_editor.resize_hint') : t('tools.text_editor.restore_hint')}
      className="group relative flex h-full w-0.5 shrink-0 cursor-col-resize items-center justify-center self-stretch bg-transparent focus-visible:outline-none"
    >
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

export function MarkdownEditor({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const themeId = useMarkdownEditorStore((s) => s.themeId);
  const setThemeId = useMarkdownEditorStore((s) => s.setThemeId);
  const outlineOpen = useMarkdownEditorStore((s) => s.outlineOpen);
  const toggleOutline = useMarkdownEditorStore((s) => s.toggleOutline);
  const outlineListOpen = useMarkdownEditorStore((s) => s.outlineListOpen);
  const toggleOutlineList = useMarkdownEditorStore((s) => s.toggleOutlineList);
  const outlineWidth = useMarkdownEditorStore((s) => s.outlineWidth);
  const editorMode = useMarkdownEditorStore((s) => s.editorMode) ?? 'wysiwyg';
  const setEditorMode = useMarkdownEditorStore((s) => s.setEditorMode);

  const docs = useMdEditorDocsStore((s) => s.docs);
  const activeDocId = useMdEditorDocsStore((s) => s.activeDocId);
  const mdReady = useMdEditorDocsStore((s) => s.ready);
  const userTouched = useMdEditorDocsStore((s) => s.userTouched);
  const newDoc = useMdEditorDocsStore((s) => s.newDoc);
  const closeDoc = useMdEditorDocsStore((s) => s.closeDoc);
  const switchDoc = useMdEditorDocsStore((s) => s.switchDoc);
  const renameDoc = useMdEditorDocsStore((s) => s.renameDoc);
  const togglePinDoc = useMdEditorDocsStore((s) => s.togglePinDoc);
  const setDocContent = useMdEditorDocsStore((s) => s.setDocContent);

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );
  const sortedDocs = useMemo(
    () =>
      docs.some((d) => d.pinned)
        ? [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned))
        : docs,
    [docs],
  );

  const [outline, setOutline] = useState<OutlineItem[]>([]);
  /**
   * 未保存关闭确认(与文本编辑器同语义):
   * - 干净非固定 Tab 直接关闭,不进此状态
   * - 未保存 → close-tab(保存/不保存/取消);固定 → close-pinned(关闭/取消)
   */
  const [unsaved, setUnsaved] = useState<{ docId: string; mode: UnsavedMode } | null>(null);
  const [renameTarget, setRenameTarget] = useState<MdDoc | null>(null);
  const [modifiedConflict, setModifiedConflict] = useState<string | null>(null);
  /** 当前编辑器实例(state 而非 ref:工具条渲染期读 isActive,ref 读会犯规) */
  const [ed, setEd] = useState<Editor | null>(null);
  /** 选区/内容变化的重渲染节拍(工具条 isActive 与当前章节派生用,事件路径自增) */
  const [tick, setTick] = useState(0);
  const docTabsScrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const flushRef = useRef<() => void>(() => undefined);

  // 派生装载态(body/fence):render 内按 docId + 模式刷新(官方认可的 derived-state
  // 模式,非 effect 内 setState)。fence 在编辑期间恒定,切换文档/模式时随内容重取。
  const [view, setView] = useState({
    docId: '',
    mode: 'wysiwyg' as MdEditorMode,
    body: '',
    fence: null as string | null,
  });
  if (view.docId !== (activeDocId ?? '') || view.mode !== editorMode) {
    const { body, fence } = splitFrontMatter(activeDoc?.content ?? '');
    setView({ docId: activeDocId ?? '', mode: editorMode, body, fence });
  }

  const handleTick = useCallback(() => setTick((n) => n + 1), []);
  /** 子编辑器快照:拼 fence 写 store(同步) + 刷大纲(事件路径) */
  const handleSnapshot = useCallback(
    (bodyMd: string, nextOutline: OutlineItem[]) => {
      const full = joinFrontMatter(view.fence, bodyMd);
      const doc = useMdEditorDocsStore.getState().docs.find((d) => d.id === view.docId);
      if (doc && full !== doc.content) setDocContent(doc.id, full);
      setOutline(nextOutline);
    },
    [setDocContent, view.docId, view.fence],
  );
  const handleReady = useCallback((next: Editor | null) => {
    editorRef.current = next;
    setEd(next);
  }, []);
  const handleRegisterFlush = useCallback((flush: () => void) => {
    flushRef.current = flush;
  }, []);
  /** 保存/导出前同步落盘(store 写同步,随后读即最新) */
  const flushEditor = useCallback(() => flushRef.current(), []);

  /** Monaco 源码窗最小操作面(大纲跳转 + 聚焦用,不直引 monaco 类型) */
  interface SourceHandle {
    setPosition(p: { lineNumber: number; column: number }): void;
    revealLineInCenter(line: number): void;
    focus(): void;
  }
  const sourceRef = useRef<SourceHandle | null>(null);

  /** 源码模式大纲:标题正则直扫(行号即跳转目标,类型与所见复用) */
  const sourceOutline = useMemo((): OutlineItem[] => {
    if (editorMode !== 'source' || !activeDoc) return [];
    const items: OutlineItem[] = [];
    const seen = new Map<string, number>();
    activeDoc.content.split('\n').forEach((raw, index) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(raw.trim());
      if (!m) return;
      const text = (m[2] ?? '').trim();
      if (!text) return;
      const base = slugifyHeading(text) || 'heading';
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      items.push({
        id: count === 0 ? base : `${base}-${count}`,
        text,
        level: m[1].length,
        line: index + 1,
      });
    });
    return items;
  }, [editorMode, activeDoc]);
  const visibleOutline = editorMode === 'source' ? sourceOutline : outline;

  /** 所见 ↔ 源码切换:进源码先落盘所见态;回所见经 view 派生重装正文 */
  const switchEditorMode = useCallback(
    (mode: MdEditorMode) => {
      if (mode === editorMode) return;
      if (mode === 'source') flushEditor();
      // 跨模式不带光标/选区信号,各模式挂载后重建
      setMdSelection(null);
      setMdCursor(1, 1);
      setEditorMode(mode);
    },
    [editorMode, flushEditor, setEditorMode],
  );

  /** 当前选区所属章节(渲染期由实例派生;tick 自增保证选区变化后重算) */
  const activeHeadingId = ((): string | null => {
    void tick;
    if (!ed) return null;
    try {
      const { $from } = ed.state.selection;
      for (let d = $from.depth; d >= 0; d -= 1) {
        const n = $from.node(d);
        if (n.type.name === 'heading') {
          const hit = extractOutline(ed).find((o) => o.line === $from.before(d));
          return hit?.id ?? null;
        }
      }
    } catch {
      // 并发编辑导致位置过期:无高亮
    }
    return null;
  })();

  // 启动还原 + 首用示例 + 变更防抖持久化(与旧页同语义)
  useEffect(() => {
    void useMdEditorDocsStore.getState().hydrate();
  }, []);
  useEffect(() => {
    if (!mdReady) return;
    const s = useMdEditorDocsStore.getState();
    if (s.docs.length === 0) {
      s.newDoc(s.firstUse ? getSampleMarkdown() : '');
    } else if (!s.docs.some((d) => d.id === s.activeDocId)) {
      switchDoc(s.docs[0].id);
    }
  }, [mdReady, switchDoc]);
  useEffect(() => {
    if (!mdReady || !userTouched) return;
    let total = 0;
    for (const d of docs) total += d.content.length;
    const timer = setTimeout(
      () => void useMdEditorDocsStore.getState().persistDocs(),
      persistDelayFor(total),
    );
    return () => clearTimeout(timer);
  }, [docs, mdReady, userTouched]);

  // 子编辑器按文档 key 挂载/卸载(落盘由其卸载兜底),此处无切换 effect

  // 外部修改提示(切 Tab 即比对 mtime,与旧页一致)
  const mtimeNotifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mdReady || !activeDoc) return;
    const { path, mtimeMs, title } = activeDoc;
    if (path === undefined || mtimeMs === undefined) return;
    const key = `${path}:${mtimeMs}`;
    if (mtimeNotifiedRef.current.has(key)) return;
    mtimeNotifiedRef.current.add(key);
    let cancelled = false;
    void fileMtimeMs(path)
      .then((current) => {
        if (!cancelled && current !== mtimeMs) {
          toast.warning(t('tools.markdown_editor.external_modified_hint', { title }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mdReady, activeDoc, t]);

  // 激活 Tab 滚入视野
  useEffect(() => {
    if (!activeDocId) return;
    const container = docTabsScrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-doc-id="${escapeSelector(activeDocId)}"]`,
    );
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const tRect = active.getBoundingClientRect();
    if (tRect.left < cRect.left)
      container.scrollTo({ left: active.offsetLeft - 8, behavior: 'smooth' });
    else if (tRect.right > cRect.right) {
      container.scrollTo({
        left: active.offsetLeft + active.offsetWidth - container.clientWidth + 8,
        behavior: 'smooth',
      });
    }
  }, [activeDocId, sortedDocs]);

  useToolHandoff(toolId, (incoming) => {
    useMdEditorDocsStore.getState().injectDocFromTool(incoming);
  });

  const input = activeDoc?.content ?? '';

  // —— 文件操作(打开/保存/另存为/冲突三选,与旧页同语义)——
  const handleOpenFile = useCallback(async (): Promise<void> => {
    let outcome: Awaited<ReturnType<typeof openTextFileDialog>>;
    try {
      outcome = await openTextFileDialog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.markdown_editor.err_open_file'));
      return;
    }
    if (!outcome) return;
    if (outcome.file) {
      useMdEditorDocsStore.getState().openFileAsDoc(outcome.file);
      return;
    }
    const failure = outcome.failed;
    if (!failure) return;
    const name = fileNameFromPath(failure.path);
    if (failure.reason === OPEN_REASON_BINARY) {
      toast.error(t('tools.markdown_editor.err_file_binary', { name }), {
        duration: 10_000,
        action: {
          label: t('tools.markdown_editor.open_anyway'),
          onClick: () => {
            void forceOpenFile(failure.path)
              .then((r) => useMdEditorDocsStore.getState().openFileAsDoc(r))
              .catch(() => undefined);
          },
        },
      });
    } else if (failure.reason === OPEN_REASON_TOO_LARGE) {
      toast.error(t('tools.markdown_editor.err_file_too_large', { name }));
    } else {
      toast.error(t('tools.markdown_editor.err_open_file'));
    }
  }, [t]);

  type SaveDocResult = 'saved' | 'cancelled' | 'conflict' | 'failed';
  const saveDocById = useCallback(
    async (id: string, overwrite = false): Promise<SaveDocResult> => {
      flushEditor();
      const doc = useMdEditorDocsStore.getState().docs.find((d) => d.id === id);
      if (!doc) return 'failed';
      try {
        if (doc.path) {
          const expect = overwrite || doc.mtimeMs === undefined ? undefined : doc.mtimeMs;
          await saveToPathEncoded(doc.path, doc.content, doc.encoding ?? 'utf-8', expect);
          try {
            useMdEditorDocsStore.getState().markSaved(id, doc.content, await fileMtimeMs(doc.path));
          } catch {
            useMdEditorDocsStore.getState().markSaved(id, doc.content);
          }
          toast.success(t('tools.markdown_editor.toast_saved', { name: doc.title }));
          return 'saved';
        }
        const base = doc.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'document';
        const fileName = /\.md$/i.test(base) ? base : `${base}.md`;
        const path = await saveWithDialogEncoded(fileName, doc.content, 'utf-8');
        if (!path) return 'cancelled';
        let mtime: number | undefined;
        try {
          mtime = await fileMtimeMs(path);
        } catch {
          // 新路径 mtime 读不到:下次保存不校验
        }
        useMdEditorDocsStore.getState().attachPath(id, path, 'utf-8', doc.content, mtime);
        toast.success(t('tools.markdown_editor.toast_saved', { name: fileName }));
        return 'saved';
      } catch (e) {
        if (e instanceof CommandError && e.code === 'ERR_FILE_MODIFIED') return 'conflict';
        toast.error(e instanceof Error ? e.message : t('tools.markdown_editor.err_save'));
        return 'failed';
      }
    },
    [flushEditor, t],
  );
  const saveDocWithConflict = useCallback(
    async (id: string, overwrite = false): Promise<boolean> => {
      const result = await saveDocById(id, overwrite);
      if (result === 'conflict') {
        setModifiedConflict(id);
        return false;
      }
      return result === 'saved';
    },
    [saveDocById],
  );
  const handleSaveDoc = useCallback((): void => {
    const id = useMdEditorDocsStore.getState().activeDocId;
    if (id) void saveDocWithConflict(id);
  }, [saveDocWithConflict]);
  const handleSaveAs = useCallback(async (): Promise<void> => {
    flushEditor();
    const s = useMdEditorDocsStore.getState();
    const doc = s.docs.find((d) => d.id === s.activeDocId);
    if (!doc) return;
    const base = doc.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'document';
    const fileName = /\.md$/i.test(base) ? base : `${base}.md`;
    try {
      const path = await saveWithDialogEncoded(fileName, doc.content, 'utf-8');
      if (!path) return;
      let mtime: number | undefined;
      try {
        mtime = await fileMtimeMs(path);
      } catch {
        // 忽略,下次保存不校验
      }
      s.attachPath(doc.id, path, 'utf-8', doc.content, mtime);
      toast.success(t('tools.markdown_editor.toast_saved', { name: fileName }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.markdown_editor.err_save'));
    }
  }, [flushEditor, t]);

  const conflictDoc = modifiedConflict
    ? (docs.find((d) => d.id === modifiedConflict) ?? null)
    : null;
  const handleConflictOverwrite = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (id) void saveDocWithConflict(id, true);
  }, [modifiedConflict, saveDocWithConflict]);
  const handleConflictReload = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (!id) return;
    const path = useMdEditorDocsStore.getState().docs.find((d) => d.id === id)?.path;
    if (!path) return;
    void (async () => {
      try {
        useMdEditorDocsStore.getState().openFileAsDoc(await readTextFileEncoded(path));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.markdown_editor.err_open_file'));
      }
    })();
  }, [modifiedConflict, t]);
  const handleConflictCompare = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (!id) return;
    const doc = useMdEditorDocsStore.getState().docs.find((d) => d.id === id);
    if (!doc?.path) return;
    void (async () => {
      try {
        const r = await readTextFileEncoded(doc.path as string);
        useMdEditorDocsStore
          .getState()
          .newDoc(
            `${t('tools.markdown_editor.modified_disk_copy', { name: doc.title })}\n\n${r.content}`,
          );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.markdown_editor.err_open_file'));
      }
    })();
  }, [modifiedConflict, t]);

  // —— 关闭/重命名 ——
  /**
   * 请求关闭文档(与文本编辑器 requestCloseTab 同语义):
   * - 固定 Tab(无论是否未保存)→ 弹「关闭/取消」,防误关特意保留的 Tab
   * - 未保存 → 弹「保存/不保存/取消」
   * - 干净 → 直接关闭
   * 判定前先 flushEditor():所见编辑器的 store 写有 400ms 防抖,
   * 不冲刷会把刚输入未落 store 的内容漏判为干净。
   */
  const requestCloseDoc = useCallback(
    (id: string) => {
      flushEditor();
      const target = useMdEditorDocsStore.getState().docs.find((d) => d.id === id);
      if (!target) return;
      if (target.pinned) {
        setUnsaved({ docId: id, mode: 'close-pinned' });
      } else if (isDocDirty(target)) {
        setUnsaved({ docId: id, mode: 'close-tab' });
      } else {
        closeDoc(id);
      }
    },
    [closeDoc, flushEditor],
  );
  /** 确认框「保存并关闭」:保存成功才关闭(冲突/取消对话框时保持打开) */
  const handleUnsavedSave = useCallback(() => {
    const target = unsaved;
    if (!target) return;
    setUnsaved(null);
    void saveDocWithConflict(target.docId).then((ok) => {
      if (ok) closeDoc(target.docId);
    });
  }, [unsaved, saveDocWithConflict, closeDoc]);
  /** 确认框「不保存关闭」/「关闭」(固定 Tab):丢弃改动直接关闭 */
  const handleUnsavedDiscard = useCallback(() => {
    const target = unsaved;
    if (!target) return;
    setUnsaved(null);
    closeDoc(target.docId);
  }, [unsaved, closeDoc]);
  const handleUnsavedCancel = useCallback(() => {
    setUnsaved(null);
  }, []);
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>, id: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  // —— 导出/复制/打印 ——
  const currentHtml = useCallback((): string => {
    // 源码模式:经旧渲染管线直出(与只读预览同保真:alert/公式/脚注齐全,已消毒)
    if (editorMode === 'source') {
      const content = useMdEditorDocsStore
        .getState()
        .docs.find((d) => d.id === view.docId)?.content;
      if (!content?.trim()) return '';
      return renderMarkdown(content).html;
    }
    const ed = editorRef.current;
    if (!ed) return '';
    return assignHeadingIds(sanitizeMarkdownHtml(ed.getHTML()));
  }, [editorMode, view.docId]);
  const handleCopyRichText = useCallback(() => {
    const html = currentHtml();
    if (!html) return;
    void writeClipboardRichText(html).then((ok) => {
      showAlert(
        ok
          ? {
              variant: 'success',
              title: t('tools.markdown_editor.toast_rich_ok'),
              description: t('tools.markdown_editor.toast_rich_hint'),
            }
          : { variant: 'destructive', title: t('tools.markdown_editor.toast_copy_failed') },
      );
    });
  }, [t, currentHtml]);
  const handleCopyHtmlSource = useCallback(() => {
    const html = currentHtml();
    if (!html) return;
    void writeClipboardText(html).then((ok) => {
      showAlert(
        ok
          ? { variant: 'success', title: t('tools.markdown_editor.toast_html_ok') }
          : { variant: 'destructive', title: t('tools.markdown_editor.toast_copy_failed') },
      );
    });
  }, [t, currentHtml]);
  const handleExportHtml = useCallback(async () => {
    const html = currentHtml();
    if (!html) return;
    const firstHeading = visibleOutline[0]?.text ?? t('tools.markdown_editor.untitled_doc');
    const standalone = await buildStandaloneHtml(html, firstHeading, false);
    const fileName = `${firstHeading.slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'document'}.html`;
    if (await saveStandaloneHtml(standalone, fileName)) {
      showAlert({
        variant: 'success',
        title: t('tools.markdown_editor.toast_exported', { name: fileName }),
      });
    }
  }, [currentHtml, visibleOutline, t]);
  const handleExportMarkdown = useCallback(async () => {
    flushEditor();
    if (!activeDoc || !input.trim()) return;
    const base = activeDoc.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'document';
    const fileName = `${base}.md`;
    if (await saveTextFile(activeDoc.content, fileName)) {
      showAlert({
        variant: 'success',
        title: t('tools.markdown_editor.toast_exported', { name: fileName }),
      });
    }
  }, [activeDoc, flushEditor, input, t]);
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // —— 文件菜单 + 快捷键(与旧页同绑定,归属新 toolId)——
  const menus = useMemo<ToolMenu[]>(() => {
    const shortcutLabel = (key: keyof ShortcutBinding): string | undefined => {
      const combo = useConfigStore.getState().config?.shortcuts[key] ?? DEFAULT_SHORTCUTS[key];
      return combo || undefined;
    };
    return [
      {
        id: 'file',
        label: t('tools.markdown_editor.menu_file'),
        groups: [
          {
            items: [
              {
                id: 'new',
                label: t('tools.markdown_editor.menu_new'),
                shortcut: shortcutLabel('new_file'),
                icon: Plus,
                onSelect: () => newDoc(),
                testId: 'md-toolbar-new',
              },
              {
                id: 'open',
                label: t('tools.markdown_editor.menu_open'),
                shortcut: shortcutLabel('open_file'),
                icon: FolderOpen,
                onSelect: () => void handleOpenFile(),
                testId: 'md-toolbar-open',
              },
            ],
          },
          {
            items: [
              {
                id: 'save',
                label: t('tools.markdown_editor.menu_save'),
                shortcut: shortcutLabel('save_file'),
                icon: Save,
                onSelect: handleSaveDoc,
                disabled: !activeDocId,
                testId: 'md-toolbar-save',
              },
              {
                id: 'save-as',
                label: t('tools.markdown_editor.menu_save_as'),
                shortcut: shortcutLabel('save_all'),
                onSelect: () => void handleSaveAs(),
                disabled: !activeDocId,
                testId: 'md-toolbar-save-as',
              },
            ],
          },
          {
            items: [
              {
                id: 'close',
                label: t('tools.markdown_editor.menu_close'),
                shortcut: shortcutLabel('close_editor'),
                onSelect: () => {
                  if (activeDocId) requestCloseDoc(activeDocId);
                },
                disabled: !activeDocId,
                testId: 'md-toolbar-close',
              },
            ],
          },
        ],
      },
    ];
  }, [activeDocId, handleOpenFile, handleSaveAs, handleSaveDoc, newDoc, requestCloseDoc, t]);
  useToolMenus(toolId, menus);
  useToolShortcut(toolId, 'save_file', handleSaveDoc, [handleSaveDoc]);
  useToolShortcut(toolId, 'open_file', () => void handleOpenFile(), [handleOpenFile]);
  useToolShortcut(toolId, 'save_all', () => void handleSaveAs(), [handleSaveAs]);
  useToolShortcut(toolId, 'new_file', () => newDoc(), [newDoc]);
  useToolShortcut(
    toolId,
    'close_editor',
    () => {
      const id = useMdEditorDocsStore.getState().activeDocId;
      if (id) requestCloseDoc(id);
    },
    [requestCloseDoc],
  );

  // —— 大纲跳转(所见:doc 位置滚动;源码:Monaco 行跳转,同文本编辑器) ——
  const handleOutlineJump = useCallback(
    (item: OutlineItem) => {
      if (editorMode === 'source') {
        const src = sourceRef.current;
        if (!src) return;
        src.setPosition({ lineNumber: item.line, column: 1 });
        src.revealLineInCenter(item.line);
        src.focus();
        return;
      }
      const ed = editorRef.current;
      if (!ed) return;
      try {
        const dom = ed.view.nodeDOM(item.line);
        if (dom instanceof HTMLElement) {
          // focus 触发选区更新 → tick 自增 → activeHeadingId 自动重算
          ed.chain().focus().setTextSelection(item.line).run();
          dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch {
        // 位置过期(并发编辑):忽略,下轮大纲刷新后恢复
      }
    },
    [editorMode],
  );

  // —— 格式工具栏(TipTap 命令,等价旧 Ctrl+B/I/E 语义)——
  const tb = (
    testId: string,
    title: string,
    active: boolean,
    onClick: () => void,
    label?: string,
    Icon?: typeof Bold,
  ): JSX.Element => (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={() => ed?.chain().focus().run() && onClick()}
      className={cn(
        'rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        label ? 'h-6 min-w-6 px-0.5 text-[11px] font-bold' : 'p-1',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-layer" data-testid="markdown-editor">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 gap-0.5 overflow-hidden">
        {/* —— 左大纲卡(文本编辑器左栏同款:固定像素宽,收起 snap 到 0) —— */}
        <div
          className="h-full shrink-0 overflow-hidden rounded-lg border border-border bg-sidebar shadow-sm"
          style={{ width: outlineOpen ? outlineWidth : 0 }}
          data-testid="outline-panel"
          data-search-anchor="markdown_editor:outline"
        >
          <div
            className="flex h-full min-w-0 flex-col overflow-hidden text-sidebar-foreground"
            style={{ width: outlineWidth }}
          >
            <button
              type="button"
              onClick={toggleOutlineList}
              aria-expanded={outlineListOpen}
              data-testid="md-outline-collapse"
              title={
                outlineListOpen
                  ? t('tools.markdown_editor.outline_collapse')
                  : t('tools.markdown_editor.outline_expand')
              }
              className="flex h-7 min-w-0 shrink-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-b border-sidebar-border px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/40"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  outlineListOpen ? 'rotate-0' : '-rotate-90',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {t('tools.markdown_editor.outline_title')}
              </span>
              <span className="inline-block shrink-0 rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-primary">
                {visibleOutline.length}
              </span>
            </button>
            {outlineListOpen && (
              <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {visibleOutline.length === 0 ? (
                  <p
                    className="px-3 py-2 text-xs text-muted-foreground"
                    data-testid="outline-empty"
                  >
                    {t('tools.markdown_editor.outline_empty')}
                  </p>
                ) : (
                  <ul className="space-y-0.5 px-1.5">
                    {visibleOutline.map((item) => (
                      <li key={`${item.id}-${item.line}`}>
                        <button
                          type="button"
                          data-testid="outline-item"
                          data-active={activeHeadingId === item.id}
                          onClick={() => handleOutlineJump(item)}
                          style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.625}rem` }}
                          title={item.text}
                          className={cn(
                            'block w-full truncate rounded py-1 pr-2 text-left text-xs transition-colors',
                            activeHeadingId === item.id
                              ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                              : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          {item.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        <OutlineResizeHandle />
        {/* —— 右主卡:文档 Tab + 工具条 + 编辑区 —— */}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          {/* —— 多文档 Tab 栏(与旧页同交互:固定/dirty/中键关/右键菜单/关闭确认) —— */}
          <div
            className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
            data-testid="md-doc-tabs"
          >
            <ScrollArea
              viewportRef={docTabsScrollRef}
              orientation="horizontal"
              type="hover"
              scrollbarClassName="h-1.5 p-0"
              className="h-full min-w-0 flex-1"
            >
              <div
                role="tablist"
                aria-label={t('tools.markdown_editor.tabs_aria')}
                className="flex h-full min-w-max items-stretch"
              >
                {sortedDocs.map((doc) => {
                  const active = doc.id === activeDocId;
                  const dirty = isDocDirty(doc);
                  return (
                    <ContextMenu key={doc.id}>
                      {/* 关闭确认:复用文本编辑器 UnsavedPopover(锚定 Tab 下方,
                          X / 中键 / 右键菜单统一落到该 Tab 的确认框) */}
                      <UnsavedPopover
                        open={unsaved?.docId === doc.id}
                        mode={unsaved?.mode ?? 'close-tab'}
                        tabTitle={doc.title}
                        dirtyCount={0}
                        canSave={unsaved?.mode === 'close-tab'}
                        onSave={handleUnsavedSave}
                        onDiscard={handleUnsavedDiscard}
                        onCancel={handleUnsavedCancel}
                        data-testid="md-doc-close-dialog"
                      >
                        <ContextMenuTrigger asChild>
                          <div
                            role="tab"
                            aria-selected={active}
                            tabIndex={0}
                            data-testid="md-doc-tab"
                            data-doc-id={doc.id}
                            data-pinned={doc.pinned ? 'true' : undefined}
                            data-dirty={dirty ? 'true' : undefined}
                            title={doc.path ?? doc.title}
                            onClick={() => switchDoc(doc.id)}
                            onKeyDown={(e) => handleTabKeyDown(e, doc.id)}
                            onMouseDown={(e) => {
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
                            {doc.pinned ? (
                              <Pin
                                aria-label={t('tools.markdown_editor.pinned_aria')}
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
                            <span className="min-w-0 truncate" title={doc.path ?? doc.title}>
                              {doc.title}
                            </span>
                            {/* 未保存圆点 / 关闭按钮共用槽位(文本编辑器同款):
                                平时显示圆点,悬停 Tab 时圆点淡出、× 同位淡入 */}
                            <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                              {dirty && (
                                <span
                                  aria-label={t('tools.markdown_editor.dirty_tooltip')}
                                  data-testid="md-doc-tab-dirty"
                                  className="size-2 rounded-full bg-primary transition-opacity group-hover:opacity-0"
                                />
                              )}
                              <button
                                type="button"
                                aria-label={t('tools.markdown_editor.close_tab_aria', {
                                  title: doc.title,
                                })}
                                title={t('tools.markdown_editor.close')}
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
                      </UnsavedPopover>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => switchDoc(doc.id)}>
                          {t('tools.markdown_editor.tab_activate')}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => togglePinDoc(doc.id)}>
                          {doc.pinned
                            ? t('tools.markdown_editor.tab_unpin')
                            : t('tools.markdown_editor.tab_pin')}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => setRenameTarget(doc)}>
                          {t('tools.markdown_editor.tab_rename')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => requestCloseDoc(doc.id)}>
                          {t('tools.markdown_editor.close')}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            </ScrollArea>
            <button
              type="button"
              data-testid="md-doc-new"
              title={t('tools.markdown_editor.menu_new')}
              aria-label={t('tools.markdown_editor.menu_new')}
              onClick={() => newDoc()}
              className="flex w-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
          </div>

          {/* —— 路径栏(Tab 下方、内容上方,文本编辑器 CodeEditor 标题栏同款):
              有本地路径的文档展示面包屑分段路径,纯草稿展示标题文本 —— */}
          <div
            className="flex h-[26px] shrink-0 items-center overflow-hidden border-b border-input px-2"
            data-testid="md-path-bar"
          >
            <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
              {activeDoc?.path ? (
                <PathBreadcrumb path={activeDoc.path} data-testid="md-path-breadcrumb" />
              ) : (
                <span data-testid="md-path-title">{activeDoc?.title ?? ''}</span>
              )}
            </span>
          </div>

          {/* —— 工具条:格式(TipTap) + 主题/大纲/导出 —— */}
          <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 print:hidden">
            {ed &&
              tb(
                'fmt-bold',
                t('tools.markdown_editor.fmt_bold'),
                ed.isActive('bold'),
                () => ed.chain().focus().toggleBold().run(),
                undefined,
                Bold,
              )}
            {ed &&
              tb(
                'fmt-italic',
                t('tools.markdown_editor.fmt_italic'),
                ed.isActive('italic'),
                () => ed.chain().focus().toggleItalic().run(),
                undefined,
                Italic,
              )}
            {ed &&
              tb(
                'fmt-strike',
                t('tools.markdown_editor.fmt_strike'),
                ed.isActive('strike'),
                () => ed.chain().focus().toggleStrike().run(),
                undefined,
                Strikethrough,
              )}
            {ed &&
              tb(
                'fmt-inline-code',
                t('tools.markdown_editor.fmt_inline_code'),
                ed.isActive('code'),
                () => ed.chain().focus().toggleCode().run(),
                undefined,
                Code,
              )}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            {ed &&
              tb(
                'fmt-h1',
                t('tools.markdown_editor.fmt_h1'),
                ed.isActive('heading', { level: 1 }),
                () => ed.chain().focus().toggleHeading({ level: 1 }).run(),
                'H1',
              )}
            {ed &&
              tb(
                'fmt-h2',
                t('tools.markdown_editor.fmt_h2'),
                ed.isActive('heading', { level: 2 }),
                () => ed.chain().focus().toggleHeading({ level: 2 }).run(),
                'H2',
              )}
            {ed &&
              tb(
                'fmt-quote',
                t('tools.markdown_editor.fmt_quote'),
                ed.isActive('blockquote'),
                () => ed.chain().focus().toggleBlockquote().run(),
                undefined,
                Quote,
              )}
            {ed &&
              tb(
                'fmt-bullet',
                t('tools.markdown_editor.fmt_bullet'),
                ed.isActive('bulletList'),
                () => ed.chain().focus().toggleBulletList().run(),
                undefined,
                List,
              )}
            {ed &&
              tb(
                'fmt-ordered',
                t('tools.markdown_editor.fmt_ordered'),
                ed.isActive('orderedList'),
                () => ed.chain().focus().toggleOrderedList().run(),
                undefined,
                ListOrdered,
              )}
            {ed &&
              tb(
                'fmt-task',
                t('tools.markdown_editor.fmt_task'),
                ed.isActive('taskList'),
                () => ed.chain().focus().toggleTaskList().run(),
                undefined,
                ListTodo,
              )}
            {ed &&
              tb(
                'fmt-table',
                t('tools.markdown_editor.fmt_table'),
                false,
                () =>
                  ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                undefined,
                Columns3,
              )}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            {/* —— 所见/源码切换(文本编辑器 md 视图动作同款图标按钮组) —— */}
            <div className="flex shrink-0 items-center gap-0.5" data-testid="md-mode-switch">
              {(
                [
                  ['wysiwyg', PenLine],
                  ['source', FileCode],
                ] as ReadonlyArray<[MdEditorMode, typeof PenLine]>
              ).map(([mode, Icon]) => {
                const label = t(`tools.markdown_editor.mode_${mode}`);
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => switchEditorMode(mode)}
                    aria-pressed={editorMode === mode}
                    title={t('tools.markdown_editor.view_mode_title', { label })}
                    data-testid={`md-mode-${mode}`}
                    className={cn(
                      'rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                      editorMode === mode && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <Icon aria-hidden className="size-3.5" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              data-testid="md-outline-toggle"
              title={t('tools.markdown_editor.outline_toggle')}
              aria-label={t('tools.markdown_editor.outline_toggle')}
              aria-pressed={outlineOpen}
              onClick={toggleOutline}
              className={cn(
                'rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                outlineOpen && 'bg-accent text-accent-foreground',
              )}
            >
              <List aria-hidden className="size-3.5" />
            </button>
            <Select value={themeId} onValueChange={(v) => setThemeId(v as typeof themeId)}>
              <SelectTrigger
                data-testid="md-theme-select"
                aria-label={t('tools.markdown_editor.theme_select_aria')}
                className="h-6 w-28 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['typora', 'github', 'newsprint', 'pixyll', 'night'] as const).map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`tools.markdown_editor.theme_${id === 'typora' ? 'qraft' : id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="flex-1" />
            <button
              type="button"
              data-testid="btn-copy-rich"
              onClick={handleCopyRichText}
              className="flex h-6 items-center rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t('tools.markdown_editor.copy_rich')}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="btn-export"
                  title={t('tools.markdown_editor.export')}
                  className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Download aria-hidden className="size-3.5" />
                  {t('tools.markdown_editor.export')}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="export-html-file"
                  onSelect={() => void handleExportHtml()}
                >
                  <Download aria-hidden className="mr-2 size-3.5 opacity-60" />
                  {t('tools.markdown_editor.export_html')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="export-md-file"
                  onSelect={() => void handleExportMarkdown()}
                >
                  <FileText aria-hidden className="mr-2 size-3.5 opacity-60" />
                  {t('tools.markdown_editor.export_md')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="export-print" onSelect={handlePrint}>
                  {t('tools.markdown_editor.export_print')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="copy-html-source" onSelect={handleCopyHtmlSource}>
                  <FileCode2 aria-hidden className="mr-2 size-3.5 opacity-60" />
                  {t('tools.markdown_editor.copy_html_source')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* —— 编辑区:所见 / Monaco 源码(行号 + 整行高亮同文本编辑器) —— */}
          {editorMode === 'source' ? (
            activeDoc && (
              <CodeEditor
                key={activeDoc.id}
                data-testid="md-source"
                language="markdown"
                value={activeDoc.content}
                onChange={(v) => setDocContent(activeDoc.id, v)}
                embedded
                showStatusBar={false}
                showPaste={false}
                showOpenFile={false}
                showClear={false}
                searchAnchor="markdown_editor:editor"
                className="min-h-0 flex-1"
                onMount={(inst) => {
                  sourceRef.current = inst;
                  // 默认光标 + 行列/选区进 live store(状态栏局部订阅)
                  const pos = inst.getPosition();
                  if (pos) setMdCursor(pos.lineNumber, pos.column);
                  inst.onDidChangeCursorPosition((e) =>
                    setMdCursor(e.position.lineNumber, e.position.column),
                  );
                  inst.onDidChangeCursorSelection((e) => {
                    const model = inst.getModel();
                    const sel = e.selection;
                    if (!model || sel.isEmpty()) {
                      setMdSelection(null);
                      return;
                    }
                    const s = computeStats(model.getValueInRange(sel));
                    setMdSelection({ words: s.words, chars: s.chars });
                  });
                  inst.focus();
                }}
              />
            )
          ) : (
            <div
              className="relative min-h-0 flex-1 overflow-y-auto bg-card"
              data-testid="md-editor-scroll"
              data-search-anchor="markdown_editor:editor"
            >
              <div className="px-6 py-5">
                {mdReady && activeDoc && (
                  <WysiwygDoc
                    key={activeDoc.id}
                    body={view.body}
                    themeId={themeId}
                    placeholder={t('tools.markdown_editor.editor_placeholder')}
                    onSnapshot={handleSnapshot}
                    onTick={handleTick}
                    onReady={handleReady}
                    registerFlush={handleRegisterFlush}
                  />
                )}
              </div>
            </div>
          )}

          {/* 状态栏收进右主卡内(对齐文本编辑器):被卡片 rounded-lg 裁切、
              border-t 与卡片边框连成一体,而非横跨全窗口的脱节底栏 */}
          <MdStatusBar
            markdown={activeDoc?.content ?? ''}
            mode={editorMode}
            encoding={activeDoc?.encoding}
            section={
              editorMode === 'wysiwyg'
                ? (visibleOutline.find((o) => o.id === activeHeadingId)?.text ?? null)
                : null
            }
          />
        </div>
      </div>

      {renameTarget && (
        <RenameDialog
          open
          title={t('tools.markdown_editor.rename_dialog_title')}
          initialValue={renameTarget.title}
          onConfirm={(name) => {
            renameDoc(renameTarget.id, name);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
          data-testid="md-doc-rename-dialog"
        />
      )}
      {modifiedConflict && (
        <FileModifiedDialog
          open
          fileName={conflictDoc?.title ?? ''}
          onOverwrite={handleConflictOverwrite}
          onCompare={handleConflictCompare}
          onReload={handleConflictReload}
          onCancel={() => setModifiedConflict(null)}
          data-testid="md-file-modified-dialog"
        />
      )}
    </div>
  );
}
