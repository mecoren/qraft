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
import { defineThemeFor, defineVsCodeTheme, getThemeName, useMonacoTheme } from './monaco-theme';
import { MonacoContextMenu, type MonacoEditor } from './monaco-context-menu';

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
  /**
   * 自定义工具栏标题区内容;提供时替换默认的 title 文本展示。
   * 用于以面包屑(路径分段)等自定义 UI 取代纯文本标题,
   * 仍受 `title` 的「非空才显示工具栏」逻辑控制。
   */
  header?: ReactNode;
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
  /**
   * 固定 Monaco 主题名(如 monaco-theme 的 VSCODE_THEME_NAME)。
   * 提供时编辑器使用该固定主题,不随 data-palette 变化;缺省时保持
   * 原有跟随调色板的行为不变。向后兼容的可选扩展。
   */
  fixedTheme?: string;
  /**
   * 嵌入模式:去除容器自身的圆角与边框,由父容器统一提供外框。
   *
   * 适用于编辑器已被装入已带边框/圆角的卡片场景(典型:code-editor-workspace
   * 的 EditorWorkbench 把 CodeEditor 放进 `rounded-lg border border-border`
   * 的右侧主页面卡片)。若不开启此模式,会出现:
   * 1) 外层 rounded-lg(8px) 与内层 rounded-md(6px) 双层圆角嵌套
   * 2) 外层 --border 与内层 --input 边框颜色不一致(暗色主题下分别
   *    是 10% / 15% 白色),形成双重边框的"双线"观感
   * 3) 父容器顶部圆角处,子容器直角内容直接露出
   *
   * 开启后容器不再画 `rounded-md border border-input`,完全由父容器
   * 控制外框;内部工具栏的 `border-b` / 状态栏的 `border-t` 仍保留,
   * 用于编辑器内部各区域的水平分隔(此时颜色跟随父容器的 --border)。
   *
   * 默认 false,保持独立使用时的卡片外观(向后兼容)。
   */
  embedded?: boolean;
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
  header,
  actions,
  showPaste = false,
  showOpenFile = false,
  showClear = false,
  showStatusBar = true,
  statusBarRight,
  showCharCount = true,
  'data-testid': dataTestId,
  fixedTheme,
  embedded = false,
}: CodeEditorProps): ReactNode {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用于在渲染期把已挂载的 editor 实例传给右键菜单,避免在 render 中直接读 editorRef.current
  const [editorInstance, setEditorInstance] = useState<MonacoEditor | null>(null);
  // 中文右键菜单:open + 鼠标坐标(受控 Radix ContextMenu)
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });
  // 主题名随 data-palette 变化,触发 Editor 重新应用主题;
  // 提供 fixedTheme 时使用固定主题(hook 无条件调用,再合并取优)
  const paletteThemeName = useMonacoTheme();
  const themeName = fixedTheme ?? paletteThemeName;

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
    setEditorInstance(editor);
    editor.onDidChangeCursorPosition(updateStatus);
    editor.onDidChangeCursorSelection(updateStatus);
    // 拦截 Monaco 原生右键菜单:Monaco 0.56 ESM 包无本地化 API,原生菜单恒为英文。
    // preventDefault 后由 MonacoContextMenu(受控 Radix ContextMenu)在鼠标位置
    // 弹出中文菜单,菜单项通过 editor.getAction(id).run() 执行相同动作。
    editor.onContextMenu((e) => {
      // e.event 是 Monaco 封装的 IMouseEvent;e.event.browserEvent 才是原生 MouseEvent,
      // 其 clientX/clientY 为视口坐标,供 fixed 定位的菜单使用。
      const native = e.event.browserEvent;
      native.preventDefault();
      setCtxPos({ x: native.clientX, y: native.clientY });
      setCtxOpen(true);
    });
    updateStatus();
  };

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器);
  // 使用 fixedTheme 时主题为常量,只需确保应用,不随 data-palette 重定义
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    if (fixedTheme) {
      monaco.editor.setTheme(fixedTheme);
    } else {
      defineThemeFor(monaco, themeName);
      monaco.editor.setTheme(themeName);
    }
  }, [themeName, fixedTheme]);

  // 在 monaco 实例就绪时定义初始主题
  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    if (fixedTheme) {
      defineVsCodeTheme(monaco);
    } else {
      defineThemeFor(monaco, getThemeName());
    }
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
    Boolean(header) ||
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
        'relative flex min-h-[200px] h-full w-full flex-col',
        // 非嵌入模式:独立使用时自带圆角 + 边框,作为自包含的"卡片"
        // 嵌入模式:由父容器统一提供外框,避免双层圆角 / 双重边框
        !embedded && 'overflow-hidden rounded-md border border-input',
        className,
      )}
    >
      {showHeader && (
        // 工具栏:
        // - flex(不 wrap):窄屏下右侧按钮区保持一行,标题区单行 truncate,
        //   避免换行后与 Tab 栏错位重叠
        // - min-w-0:让子项的 truncate 在 flex 容器中真正生效(默认 min-width: auto 会让
        //   truncate 失效,文字会把容器撑爆溢出)
        // - shrink-0 在右侧动作区:保证"粘贴/打开/清除"按钮永远不被挤压消失
        <div className="flex min-w-0 items-center justify-between gap-x-2 border-b border-input px-2 py-0.5">
          <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
            {header ?? title}
          </span>
          <span className="flex shrink-0 items-center">
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
            // Monaco 默认 useShadowDOM: true,编辑器(含右键菜单)渲染在 Shadow DOM 内,
            // 应用样式无法穿透 shadow 边界覆盖菜单。关闭后菜单回到普通 DOM,
            // 由 monaco-menu-style.ts 注入的 shadcn 化覆盖样式即可生效。
            useShadowDOM: false,
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
              // 滚动条尺寸与全局美化一致:轨道 10px、滑块可见 6px
              // (全局 thumb = 10px - 2px×2 透明 border 内缩)
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
            stickyScroll: { enabled: true },
            bracketPairColorization: { enabled: true },
            roundedSelection: true,
            overviewRulerLanes: 0,
            scrollBeyondLastColumn: 0,
            // 禁用 Monaco 自带的英文右键菜单,改用 MonacoContextMenu 中文菜单
            contextmenu: false,
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
        {/* 中文右键菜单:拦截 Monaco 原生英文菜单后在鼠标位置弹出 */}
        <MonacoContextMenu
          editor={editorInstance}
          readOnly={readOnly}
          open={ctxOpen}
          position={ctxPos}
          onClose={() => setCtxOpen(false)}
          data-testid={dataTestId ? `${dataTestId}-context-menu` : undefined}
        />
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
          className="flex items-center justify-between gap-1 border-t border-input px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
        >
          {/* 左侧扩展区(预留:Git branch / errors / warnings),与 VSCode 底部左对齐 */
          /* 目前留空,后续可扩展 */}
          <span className="flex min-w-0 items-center gap-2" />
          {/* 右侧主信息区,模仿 VSCode 右对齐细节;语言模式(statusBarRight)固定在最右 */}
          <span className="flex items-center gap-2">
            {showCharCount && (
              <span
                data-testid={dataTestId ? `${dataTestId}-char-count` : undefined}
                title={`${charCount} 个字符`}
                aria-label={`${charCount} 个字符`}
                className="whitespace-nowrap tabular-nums"
              >
                {charCount} 字符
              </span>
            )}
            {selected > 0 && (
              <span
                data-testid={dataTestId ? `${dataTestId}-status-sel` : undefined}
                aria-label={`已选择 ${selected}`}
              >
                (已选择{selected})
              </span>
            )}
            <span
              data-testid={dataTestId ? `${dataTestId}-status-pos` : undefined}
              aria-label={`行 ${cursor.line}, 列 ${cursor.column}`}
            >
              行 {cursor.line}, 列 {cursor.column}
            </span>
            {statusBarRight && (
              <span className="ml-1 flex items-center">{statusBarRight}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
