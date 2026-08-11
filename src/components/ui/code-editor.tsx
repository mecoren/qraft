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
import Editor, { type BeforeMount, type Monaco } from '@monaco-editor/react';
import { ClipboardPaste, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { readClipboardText } from '@/lib/clipboard';
import { readFileAsText } from '@/lib/file-utils';

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
  /** 测试用 data-testid */
  'data-testid'?: string;
}

/** 深色调色板集合,其余视为亮色 */
const DARK_PALETTES = new Set([
  'obsidian',
  'deep-sea',
  'twilight',
  'emerald-night',
  'custom',
]);

/**
 * 读取 :root 上的 CSS 变量,并将其规范化为 Monaco 可接受的 hex 颜色。
 *
 * 重要:Monaco 主题(无论 colors 还是语法高亮 token)只接受 hex
 * (#rgb / #rgba / #rrggbb / #rrggbbaa),不接受 oklch()/oklab()/hsl()/rgb()
 * 等格式。本应用的调色板变量大量使用 oklch(),若直接传入会导致
 * "Illegal value for token color" 错误。
 *
 * 因此这里借助浏览器把变量值解析为 rgb():把变量作为临时元素的 color,
 * 再读取 getComputedStyle(...).color(始终返回 rgb()/rgba()),最后转回 hex。
 * 这样无论变量采用何种颜色函数,最终都能得到 Monaco 兼容的 hex。
 *
 * @param name CSS 变量名(含前导 --)
 * @param fallback 变量缺失或解析失败时的回退 hex
 */
function resolveColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 已是 hex 直接返回
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
    return raw;
  }
  // 借助浏览器把任意格式解析为 rgb()
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.color = raw || fallback;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  return rgbToHex(computed) ?? fallback;
}

/** 把 'rgb()' / 'rgba()' 转为 '#rrggbb' 或 '#rrggbbaa' */
function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return null;
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  const a = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : 255;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a === 255 ? '' : toHex(a)}`;
}

/** 根据当前 data-palette 返回 Monaco 主题名 */
function getThemeName(): string {
  const palette = document.documentElement.dataset.palette ?? 'daylight';
  return `qraft-${palette}`;
}

/**
 * 根据当前调色板的 CSS 变量,定义一套与界面一体的 Monaco 主题。
 * 语法高亮配色继承 vs / vs-dark 基线,仅覆盖背景、前景、行号、光标等。
 */
function defineThemeFor(monaco: Monaco, name: string): void {
  const palette = name.replace(/^qraft-/, '') || 'daylight';
  const isDark = DARK_PALETTES.has(palette);

  monaco.editor.defineTheme(name, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editor.foreground': resolveColor('--card-foreground', isDark ? '#e8e8ea' : '#1a1a1e'),
      'editorLineNumber.foreground': resolveColor('--editor-gutter-fg', isDark ? '#888888' : '#888888'),
      'editorLineNumber.activeForeground': resolveColor(
        '--card-foreground',
        isDark ? '#ffffff' : '#1a1a1e',
      ),
      'editorGutter.background': resolveColor('--editor-gutter-bg', isDark ? '#1a1a1e' : '#f5f5f5'),
      // 编辑器选择/高亮/滚动条色读取专用 token,主题切换时自动同步
      // 选中文本背景:柔和淡蓝色(VS Code 同款),硬编码 hex 避免 OKLCH alpha 解析异常
      // - 浅色:#add6ff(淡蓝,VS Code vs 主题默认 selection 背景)
      // - 深色:#264f78(深蓝,VS Code vs-dark 主题默认)
      'editor.selectionBackground': isDark ? '#264f78' : '#add6ff',
      'editor.inactiveSelectionBackground': isDark ? '#1e3a5c' : '#c8dcf2',
      // 当前行高亮：使用 VS Code 同款的柔和浅灰背景(纯 hex,避免 OKLCH alpha
      // 在 Monaco 渲染管线中被解释成刺眼的暖/红色覆盖层)。
      // 浅色主题:#f3f3f3(非常淡的灰,VS Code 默认行高亮背景)
      // 深色主题:#2f2f2f(与 --card 接近的深灰)
      // 边框用 8 位全透明 hex(#00000000),不用 'transparent' 字符串,
      // 避免 Monaco 颜色解析差异导致边框渲染出异常颜色。
      'editor.lineHighlightBackground': isDark ? '#2f2f2f' : '#f3f3f3',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': resolveColor('--primary', isDark ? '#4f7cff' : '#4f7cff'),
      'editorIndentGuide.background': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorIndentGuide.activeBackground': resolveColor('--primary', isDark ? '#4f7cff' : '#4f7cff'),
      'editorWidget.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editorWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorSuggestWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      'editorSuggestWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorHoverWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      'editorBracketMatch.background': resolveColor('--editor-bracket-match-bg', '#4f7cff22'),
      'editorBracketMatch.border': 'transparent',
      'scrollbarSlider.background': resolveColor('--scrollbar-slider-bg', isDark ? '#ffffff1f' : '#0000001f'),
      'scrollbarSlider.hoverBackground': resolveColor('--scrollbar-slider-hover-bg', isDark ? '#ffffff33' : '#00000033'),
      'scrollbarSlider.activeBackground': resolveColor('--scrollbar-slider-active-bg', isDark ? '#ffffff44' : '#00000044'),
      'editorError.foreground': resolveColor('--destructive', isDark ? '#ff6b6b' : '#d11'),
      'editorWarning.foreground': resolveColor('--chart-1', isDark ? '#ffa64d' : '#b9770e'),
    },
  });
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
  'data-testid': dataTestId,
}: CodeEditorProps): ReactNode {
  const monacoRef = useRef<Monaco | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 主题名 state:data-palette 变化时更新,触发 Editor 重新应用主题
  const [themeName, setThemeName] = useState<string>(() => getThemeName());

  // 监听 <html> 的 data-palette 属性变化,同步主题
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeName(getThemeName()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
    return () => observer.disconnect();
  }, []);

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
    </div>
  );
}
