/**
 * CodeEditor —— 统一的 Monaco 编辑器封装(展示优化版)
 *
 * 职责:
 * - 封装 @monaco-editor/react,对外提供简洁、一致的 API。
 * - 跟随应用调色板(data-palette)动态生成 Monaco 主题,使编辑器背景 /
 *   前景 / 行号 / 光标等精确贴合当前主题 CSS 变量(daylight 用亮色基底,
 *   其余深色调色板用对应的深色基底),视觉上与界面融为一体。
 * - 提供可选的工具栏(标题 + 粘贴 / 打开文件 / 清除 + 自定义 actions),
 *   以无缝替换原 LineEditor 的全部能力。
 * - 默认开启一系列展示优化:等宽连字字体、行高亮、吸顶滚动、括号配对着色、
 *   细滚动条、平滑滚动、光标平滑动画等。
 *
 * 设计说明:
 * - Monaco 通过 CDN 加载,避免 vite 打包体积膨胀。
 * - automaticLayout 自适应父容器尺寸变化(配合 ResizablePanel 拖拽)。
 * - 主题在 beforeMount 时定义,并在 data-palette 变化时重新定义并切换,
 *   因此切换主题无需重挂载编辑器。
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Editor, { type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import { ClipboardPaste, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { readClipboardText } from '@/lib/clipboard';
import { readFileAsText } from '@/lib/file-utils';
import { defineThemeFor, getThemeName, useMonacoTheme } from './monaco-theme';

/** 编辑器支持的语言(未列出的语言会回退为 plaintext,不会报错) */
export type EditorLanguage =
  | 'plaintext'
  | 'json'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'xml'
  | 'yaml'
  | 'markdown'
  | 'sql'
  | 'ini'
  | 'shell'
  | 'diff';

export interface CodeEditorProps {
  /** 当前文本值 */
  value: string;
  /** 文本变化回调 */
  onChange?: (value: string) => void;
  /** 语言模式,默认 plaintext */
  language?: EditorLanguage;
  /** 是否只读 */
  readOnly?: boolean;
  /** 占位符文本(空值时显示) */
  placeholder?: string;
  /** 自定义容器类名 */
  className?: string;
  /** 是否显示缩略图(minimap),默认 false */
  minimap?: boolean;
  /** 工具栏标题;提供时才渲染顶部标题栏(也可与 actions 连用) */
  title?: string;
  /** 追加到工具栏右侧的自定义按钮(如复制按钮) */
  actions?: ReactNode;
  /** 是否显示「粘贴」按钮(仅非只读时生效),默认 true */
  showPaste?: boolean;
  /** 是否显示「打开文件」按钮(仅非只读时生效),默认 true */
  showOpenFile?: boolean;
  /** 是否显示「清除」按钮(仅非只读时生效),默认 true */
  showClear?: boolean;
  /** 是否显示底部状态栏(行/列/选区数),默认 true */
  showStatusBar?: boolean;
  /** 追加到状态栏右侧的自定义内容;未提供时默认显示内置字符统计 */
  statusBarRight?: ReactNode;
  /** 是否在状态栏右侧显示字符统计(仅在未提供 statusBarRight 时生效),默认 true */
  showCharCount?: boolean;
  /** 测试用 data-testid */
  'data-testid'?: string;
}

function ToolbarButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

export function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  readOnly = false,
  placeholder,
  className,
  minimap = false,
  title,
  actions,
  showPaste = true,
  showOpenFile = true,
  showClear = true,
  showStatusBar = true,
  statusBarRight,
  showCharCount = true,
  'data-testid': dataTestId,
}: CodeEditorProps): ReactNode {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 主题名随 data-palette 变化,触发 Editor 重新应用主题
  const themeName = useMonacoTheme();

  // 光标位置(行/列均为 1-based)、当前选区字符数;无选区时 selected=0
  const [cursor, setCursor] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });
  const [selected, setSelected] = useState(0);

  // 按 Unicode 码点统计字符数(emoji / 生僻字等代理对计 1 个),与 TextAnalyzer 口径一致
  const charCount = Array.from(value).length;

  const updateStatus = (): void => {
    const editor = editorRef.current;
    if (!editor) return;
    const pos = editor.getPosition();
    if (pos) setCursor({ line: pos.lineNumber, column: pos.column });
    const sel = editor.getSelection();
    if (sel) {
      const model = editor.getModel();
      setSelected(sel.isEmpty() || !model ? 0 : model.getValueLengthInRange(sel));
    }
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition(updateStatus);
    editor.onDidChangeCursorSelection(updateStatus);
    updateStatus();
  };

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  // 在 monaco 实例就绪时定义初始主题
  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  };

  const handlePaste = async () => {
    const text = await readClipboardText();
    if (text) {
      onChange?.(text);
    } else {
      toast.info('剪贴板为空或不可用');
    }
  };

  const handleFileChange = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      onChange?.(text);
    } catch {
      toast.error('读取文件失败');
    }
    // 允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const showHeader =
    Boolean(title) ||
    Boolean(actions) ||
    (!readOnly && (showPaste || showOpenFile || showClear));

  // placeholder overlay 定位:Monaco 默认 lineNumbers 占据左侧约 54px
  const placeholderStyle: CSSProperties = {
    top: 10,
    left: 54,
    pointerEvents: 'none',
  };

  return (
    <div
      data-testid={dataTestId}
      data-slot="code-editor"
      className={cn(
        'relative flex min-h-[200px] h-full w-full flex-col overflow-hidden rounded-md border border-input',
        className,
      )}
    >
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-input px-2 py-0.5">
          <span className="truncate pl-1 text-xs font-medium text-foreground">{title}</span>
          <span className="flex items-center">
            {!readOnly && showPaste && (
              <ToolbarButton
                label="粘贴"
                testId={dataTestId ? `${dataTestId}-paste` : undefined}
                onClick={() => void handlePaste()}
              >
                <ClipboardPaste aria-hidden className="size-3.5" />
                粘贴
              </ToolbarButton>
            )}
            {!readOnly && showOpenFile && (
              <ToolbarButton
                label="打开文件"
                testId={dataTestId ? `${dataTestId}-open` : undefined}
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen aria-hidden className="size-3.5" />
              </ToolbarButton>
            )}
            {!readOnly && showClear && (
              <ToolbarButton
                label="清除"
                testId={dataTestId ? `${dataTestId}-clear` : undefined}
                onClick={() => onChange?.('')}
              >
                <X aria-hidden className="size-3.5" />
                清除
              </ToolbarButton>
            )}
            {actions}
          </span>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <Editor
          height="100%"
          language={language}
          theme={themeName}
          value={value}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          onChange={(v) => onChange?.(v ?? '')}
          loading={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              加载编辑器…
            </div>
          }
          options={{
            readOnly,
            // 通过 CSS 变量 --app-mono-font-family 跟随用户在设置中选择的代码字体
            // (由 theme.ts 的 applyMonoFontFamily 注入,未设置时回退到 JetBrains Mono 栈)
            fontFamily:
              "var(--app-mono-font-family, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace)",
            fontLigatures: true,
            fontSize: 13,
            lineHeight: 20,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            minimap: { enabled: minimap },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            tabSize: 2,
            // 当前行高亮:'all' 覆盖整行(含 gutter),类似 VS Code。
            // 背景色使用柔和浅灰(#f3f3f3 / #2f2f2f,见 defineThemeFor),
            // 边框为全透明,视觉温和不刺眼。
            renderLineHighlight: 'all',
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            padding: { top: 10, bottom: 10 },
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
            },
            guides: {
              indentation: true,
              highlightActiveIndentation: true,
            },
            stickyScroll: { enabled: true },
            bracketPairColorization: { enabled: true },
            roundedSelection: true,
            overviewRulerLanes: 0,
            scrollBeyondLastColumn: 0,
            contextmenu: true,
            fixedOverflowWidgets: true,
          }}
        />
        {/* Placeholder overlay:空值时显示提示文本 */}
        {placeholder && !value && (
          <div
            aria-hidden
            className="absolute pointer-events-none font-mono text-body-sm leading-5 text-muted-foreground/70"
            style={placeholderStyle}
          >
            {placeholder}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        aria-hidden
        className="hidden"
        onChange={(e) => void handleFileChange(e.target.files)}
      />

      {showStatusBar && (
        <div
          data-testid={dataTestId ? `${dataTestId}-status` : undefined}
          className="flex items-center justify-end gap-2 border-t border-input px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
        >
          <span
            data-testid={dataTestId ? `${dataTestId}-status-pos` : undefined}
            aria-label={`行 ${cursor.line}, 列 ${cursor.column}`}
          >
            行 {cursor.line}, 列 {cursor.column}
          </span>
          {selected > 0 && (
            <span
              data-testid={dataTestId ? `${dataTestId}-status-sel` : undefined}
              aria-label={`已选择 ${selected}`}
            >
              (已选择{selected})
            </span>
          )}
          {statusBarRight ? (
            <span className="ml-1 flex items-center gap-2">{statusBarRight}</span>
          ) : (
            showCharCount && (
              <span
                data-testid={dataTestId ? `${dataTestId}-char-count` : undefined}
                title={`${charCount} 个字符`}
                aria-label={`${charCount} 个字符`}
                className="whitespace-nowrap tabular-nums"
              >
                {charCount} 字符
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
