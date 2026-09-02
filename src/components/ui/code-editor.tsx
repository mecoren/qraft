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
 * - Monaco 走本地 `public/monaco/vs`(由 scripts/copy-monaco.mjs 在 dev/build 前同步)。
 *   这样既符合 local-first 语义,又不会被生产 CSP script-src 'self' 拦掉跨域 CDN。
 *   loader.config() 在 main.tsx 启动阶段调用,这里无需关心加载路径。
 * - automaticLayout 自适应父容器尺寸变化(配合 ResizablePanel 拖拽)。
 * - 主题在 beforeMount 时定义,并在 data-palette 变化时重新定义并切换,
 *   因此切换主题无需重挂载编辑器。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Editor, { type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { readClipboardText } from '@/lib/clipboard';
import { readFileAsText, formatBytes } from '@/lib/file-utils';
import { openExternal } from '@/lib/open-external';
import { TEXT_ENCODINGS, type TextEncodingOption } from '@/lib/text-encodings';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import { defineThemeFor, defineVsCodeTheme, getThemeName, useMonacoTheme } from './monaco-theme';
import {
  MonacoContextMenu,
  type MonacoEditor,
  type MonacoMenuSection,
} from './monaco-context-menu';
import { attachFoldSummary, type FoldSummaryHandle } from './monaco-fold-summary';
import { attachFindCloseTooltip, type FindCloseTooltipHandle } from './monaco-find-close-tooltip';
import { findHttpUrlAtPosition } from './editor-url';
import {
  EolQuickPick,
  EncodingQuickPick,
  GotoLineQuickPick,
  IndentQuickPick,
} from './code-editor-quick-picks';
import {
  convertIndentation,
  detectIndentation,
  trimTrailingWhitespace,
  type IndentStyle,
} from '@/lib/indentation';

// Monaco loader 路径配置(import 即执行,保证任何 Editor 挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/**
 * Monaco 本地样式表注入(仅编辑器类工具需要)。
 *
 * 背景:index.html 曾以 <link rel="stylesheet"> 阻塞式加载 editor.main.css
 * (~342KB),但它只有编辑器工具用到,白白拖慢首屏。现改为:
 * - index.html 用 rel="preload" as="style" 尽早预取(不应用、不阻塞);
 * - 本模块初始化时在此注入真正的 stylesheet —— 早于任何 Monaco 组件挂载,
 *   且命中 preload 缓存,编辑器首帧即为有样式状态。
 *
 * 覆盖两份资源:
 * - editor.main.css:Monaco 全部内置 UI 样式。Tauri 的 AMD loader
 *   (public/monaco/loader.js)只动态注入 <script>,从不创建 <style>/<link>,
 *   editor.main.js 也未引用 .css,因此必须自行注入(prod 缺失则编辑器完全无样式)。
 * - codicon.css:Monaco 0.56 min 构建缺 .codicon 基础类(font-family/图标 content,
 *   min 版 css 只含 @font-face data URI),缺失时 gutter 折叠按钮显示为方框叉。
 *   copy-monaco.mjs 已把它拷到 public/monaco/vs/base/browser/ui/codicons/...。
 *
 * 幂等:已存在同 href(先前注入)则跳过;浏览器自动复用 HTTP 缓存。
 * typeof document 守卫兼容 jsdom 之外的极端环境。
 */
const MONACO_STYLE_SUFFIXES = [
  'monaco/vs/editor/editor.main.css',
  'monaco/vs/base/browser/ui/codicons/codicon/codicon.css',
] as const;

function ensureMonacoStyles(): void {
  if (typeof document === 'undefined') return;
  for (const suffix of MONACO_STYLE_SUFFIXES) {
    const existing = document.querySelector(`link[rel="stylesheet"][href*="${suffix}"]`);
    if (existing) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${import.meta.env.BASE_URL}${suffix}`;
    document.head.appendChild(link);
  }
}
ensureMonacoStyles();

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
  | 'diff'
  | 'rust'
  | 'go'
  | 'python'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'dart'
  | 'ruby'
  | 'lua'
  | 'r'
  | 'perl'
  | 'scala'
  | 'objective-c'
  | 'powershell'
  | 'dockerfile'
  | 'graphql'
  | 'hcl'
  | 'bat'
  | 'fsharp'
  | 'julia'
  | 'proto'
  | 'pascal'
  | 'vb'
  | 'clojure'
  | 'elixir';

export interface CodeEditorProps {
  /** 当前文本值 */
  value: string;
  /** 文本变化回调 */
  onChange?: (value: string) => void;
  /** 语言模式,默认 plaintext */
  language?: EditorLanguage;
  /** 是否只读 */
  readOnly?: boolean;
  /**
   * 是否启用代码折叠(gutter 单击折叠/展开 + 右键菜单折叠组),默认 true。
   * 关闭时同时从右键菜单移除「折叠 / 展开」菜单组(折叠动作依赖
   * options.folding 的 CONTEXT_FOLDING_ENABLED 前置条件)。
   */
  folding?: boolean;
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
  /**
   * 文件大小(字节数)。提供时在状态栏右下角展示(B/KB/MB/GB),
   * 位于语言徽章左侧;缺省时不展示。字节口径由宿主决定
   * (典型:当前内容按 UTF-8 编码的字节长度,随编辑实时更新)。
   */
  sizeBytes?: number;
  /** 是否在状态栏右侧显示字符统计(仅在未提供 statusBarRight 时生效),默认 true */
  showCharCount?: boolean;
  /**
   * 是否显示行号(默认 true)。合成文档(如搜索结果汇总)自带行号前缀时
   * 可关闭,避免 Monaco gutter 行号与内容行号双重显示。
   */
  lineNumbers?: boolean;
  /** 测试用 data-testid */
  'data-testid'?: string;
  /**
   * 概览标尺泳道数(0-3)。默认 0:隐藏右缘标尺,装饰的 overviewRuler
   * 刻度不渲染;提供 >0 时装饰可绘制右缘刻度(典型:文本比较的
   * VSCode 风格红/绿差异刻度)。
   */
  overviewRulerLanes?: number;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
  /** Monaco 编辑器挂载回调 */
  onMount?: (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
  /**
   * 固定 Monaco 主题名(如 monaco-theme 的 VSCODE_THEME_NAME)。
   * 提供时编辑器使用该固定主题,不随 data-palette 变化;缺省时保持
   * 原有跟随调色板的行为不变。向后兼容的可选扩展。
   */
  fixedTheme?: string;
  /**
   * 是否自动换行(受控模式)。缺省时组件内部维护开关状态(默认开启),
   * 经右键菜单「自动换行」切换时只影响当前编辑器实例,互不干扰。
   */
  wordWrap?: boolean;
  /**
   * 切换自动换行回调(受控模式)。提供时由宿主持久化/管理状态;
   * 缺省时组件自行翻转内部状态。
   */
  onToggleWordWrap?: () => void;
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
  /**
   * 文件编码标识(utf-8 / gb18030 等,见 lib/text-encodings.ts)。
   * 提供时状态栏显示编码徽章(仿 VSCode 右下角),配合 onEncodingChange 可点击切换。
   */
  encoding?: string;
  /**
   * 编码切换回调。提供时编码徽章可点击弹出「选择编码」快选弹窗;
   * 缺省时仅展示不可交互(由宿主决定是否开放切换)。
   */
  onEncodingChange?: (encodingId: string) => void;
  /**
   * 通过编码重新打开(仿 VSCode,需宿主有磁盘文件)。
   * 提供时编码弹窗显示该动作项;配合 encodingReopenAvailable 控制可用性。
   */
  onEncodingReopen?: (encodingId: string) => void;
  /**
   * 通过编码保存(仿 VSCode:设置编码并立即写盘)。
   * 提供时编码弹窗显示该动作项。
   */
  onEncodingSave?: (encodingId: string) => void;
  /**
   * 「通过编码重新打开」是否可用(典型:当前 Tab 是否有磁盘路径)。
   * 缺省 false:动作项展示为禁用态。
   */
  encodingReopenAvailable?: boolean;
  /**
   * 行尾序列设置回调(带目标值,替代原 onToggleEol)。提供时状态栏 EOL
   * 徽章点击弹出「选择行尾序列」快选弹窗,内容转换由宿主完成;
   * 缺省时徽章仅展示。
   */
  onEolChange?: (eol: 'LF' | 'CRLF') => void;
  /**
   * 自定义右键菜单分组(按宿主页面定制):追加在内置菜单与折叠组之后,
   * 每组前有分隔线。典型用法:JSON 工具注入「格式化/排序」,工作台注入命名风格切换。
   */
  contextMenuSections?: MonacoMenuSection[];
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
  folding = true,
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
  sizeBytes,
  showCharCount = true,
  'data-testid': dataTestId,
  searchAnchor,
  fixedTheme,
  wordWrap,
  onToggleWordWrap,
  embedded = false,
  onMount,
  encoding,
  onEncodingChange,
  onEncodingReopen,
  onEncodingSave,
  encodingReopenAvailable = false,
  onEolChange,
  contextMenuSections,
  lineNumbers = true,
  overviewRulerLanes = 0,
}: CodeEditorProps): ReactNode {
  const { t } = useTranslation();
  /** 编码展示名:带 labelKey 的条目随语言翻译,其余用静态 label */
  const encodingDisplay = (opt: TextEncodingOption): string =>
    opt.labelKey ? t(opt.labelKey) : opt.label;
  const encodingBadge = (): string => {
    const opt = TEXT_ENCODINGS.find((e) => e.id === encoding);
    return opt ? encodingDisplay(opt) : 'UTF-8';
  };
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用于在渲染期把已挂载的 editor 实例传给右键菜单,避免在 render 中直接读 editorRef.current
  const [editorInstance, setEditorInstance] = useState<MonacoEditor | null>(null);
  // 折叠摘要 handle(JSON 语言启用,生命周期与 editor 绑定;卸载时 dispose)
  const foldSummaryRef = useRef<FoldSummaryHandle | null>(null);
  // 查找组件关闭按钮自绘提示 handle(移除原生 title 防止窗口边缘裁剪,生命周期同 editor)
  const findCloseHintRef = useRef<FindCloseTooltipHandle | null>(null);
  // Ctrl/Cmd+点击编辑器内 URL 的监听清理函数(生命周期同 editor)
  const urlClickRef = useRef<(() => void) | null>(null);
  // 中文右键菜单:open + 鼠标坐标(受控 Radix ContextMenu)
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });
  // 自动换行开关:受控(wordWrap prop)优先,否则组件内自管(默认开启)。
  // 右键菜单「自动换行」切换只作用于当前编辑器实例。
  const [innerWordWrap, setInnerWordWrap] = useState(true);
  const wordWrapOn = wordWrap ?? innerWordWrap;
  const toggleWordWrap = useCallback((): void => {
    if (onToggleWordWrap) {
      onToggleWordWrap();
      return;
    }
    setInnerWordWrap((v) => !v);
  }, [onToggleWordWrap]);
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

  // —— 状态栏:全部交互入口均使用「全局搜索」式快选弹窗(仿 VSCode Quick Pick)——
  const [gotoOpen, setGotoOpen] = useState(false);
  const [indentOpen, setIndentOpen] = useState(false);
  const [encodingOpen, setEncodingOpen] = useState(false);
  const [eolOpen, setEolOpen] = useState(false);

  // —— 缩进方式(作用于当前编辑器模型;状态栏徽章展示值)——
  const [indent, setIndent] = useState<IndentStyle>({ insertSpaces: true, tabSize: 2 });

  // 行尾序列:由内容推导(CRLF 存在即视为 CRLF),与 VSCode 展示一致
  const eolLabel = value.includes('\r\n') ? 'CRLF' : 'LF';

  // 编辑器字号:跟随设置中的字号档位等比缩放(标准档 13px,见 theme.ts)。
  // options 对象随渲染重建,@monaco-editor/react 检测到变化后会自动
  // updateOptions 热更新已挂载实例,无需重挂载编辑器
  const editorFontSize = useEditorFontSize();

  // 总行数(转到行/列弹窗的范围提示与夹取);getLineCount 为 O(1),
  // 渲染期直接读取(渲染随 value 变化触发,无需 useMemo 缓存)
  const maxLine = editorInstance?.getModel()?.getLineCount() ?? 1;

  /** 应用跳转:夹取到有效范围后 setPosition + 居中显示 */
  const handleGotoJump = useCallback((line: number, column?: number): void => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const clampedLine = Math.min(Math.max(Math.floor(line) || 1, 1), model.getLineCount());
    const maxCol = model.getLineMaxColumn(clampedLine);
    const clampedColumn = Math.min(Math.max(Math.floor(column ?? 1) || 1, 1), maxCol);
    ed.setPosition({ lineNumber: clampedLine, column: clampedColumn });
    ed.revealLineInCenter(clampedLine);
    ed.focus();
  }, []);

  /** 应用缩进方式/宽度:仅更新提供的字段,同步 Monaco model 与徽章展示 */
  const applyIndent = useCallback((style: { insertSpaces?: boolean; tabSize?: number }): void => {
    const model = editorRef.current?.getModel();
    if (model) {
      model.updateOptions({
        ...(style.insertSpaces !== undefined ? { insertSpaces: style.insertSpaces } : {}),
        ...(style.tabSize !== undefined ? { tabSize: style.tabSize } : {}),
      });
    }
    setIndent((prev) => ({
      insertSpaces: style.insertSpaces ?? prev.insertSpaces,
      tabSize: style.tabSize ?? prev.tabSize,
    }));
  }, []);

  /** 从内容检测缩进方式并应用;无缩进行时提示保持现状 */
  const detectIndent = useCallback((): void => {
    const style = detectIndentation(value);
    if (!style) {
      toast.info(t('chrome.code_editor.indent_pick_detect_none'));
      return;
    }
    applyIndent(style);
    toast.success(
      t(
        style.insertSpaces
          ? 'chrome.code_editor.indent_pick_use_spaces'
          : 'chrome.code_editor.indent_pick_use_tabs',
        {
          size: style.tabSize,
        },
      ),
    );
  }, [value, applyIndent, t]);

  /** 缩进互转:全文前导空白按当前宽度转换,经 onChange 写回宿主 */
  const convertIndent = useCallback(
    (to: 'spaces' | 'tabs'): void => {
      const next = convertIndentation(value, {
        useSpaces: to === 'spaces',
        tabSize: indent.tabSize,
      });
      if (next !== value) onChange?.(next);
    },
    [value, indent.tabSize, onChange],
  );

  /** 裁剪尾随空格:经 onChange 写回宿主 */
  const trimTrailing = useCallback((): void => {
    const next = trimTrailingWhitespace(value);
    if (next !== value) onChange?.(next);
  }, [value, onChange]);

  // 按 Unicode 码点统计字符数(emoji / 生僻字等代理对计 1 个),与 TextAnalyzer 口径一致。
  // useMemo 隔离重算:大输入下 Array.from 会物化百万级码点数组,
  // 若在函数体每轮渲染执行,将成为输入卡顿的直接来源
  const charCount = useMemo(() => Array.from(value).length, [value]);

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
    urlClickRef.current?.();
    const urlClick = editor.onMouseDown((event) => {
      const native = event.event.browserEvent;
      if (
        native.button !== 0 ||
        native.shiftKey ||
        native.altKey ||
        (!native.ctrlKey && !native.metaKey)
      ) {
        return;
      }
      const position = event.target.position;
      const model = editor.getModel();
      if (!position || !model) return;
      const line = model.getLineContent(position.lineNumber);
      const url = findHttpUrlAtPosition(line, position.column);
      if (!url) return;
      native.preventDefault();
      event.event.stopPropagation();
      void openExternal(url);
    });
    urlClickRef.current = urlClick.dispose;
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
    // JSON 语言启用折叠摘要:object 显示 `{ N 个键 }`、array 显示 `[ N 个元素 ]`,
    // 通过 afterContentClassName + 动态 CSS ::after 注入虚拟文本(不修改模型,
    // Monaco 0.56 的 InjectedTextOptions.after.content 未实现)。
    // 切换语言/locale/重新挂载时由 foldSummaryRef 在 effect cleanup 中释放旧 handle。
    if (language === 'json') {
      foldSummaryRef.current?.dispose();
      foldSummaryRef.current = attachFoldSummary(editor);
    }
    // 初始化状态栏缩进展示(模型默认 tabSize / insertSpaces)
    const opts = editor.getModel()?.getOptions();
    setIndent({ insertSpaces: opts?.insertSpaces ?? true, tabSize: opts?.tabSize ?? 2 });
    updateStatus();
    // monaco 实例在 beforeMount 时注入;极端加载顺序下可能为 null,
    // 此时仍要触发 onMount(调用方可能依赖 editor 实例做全局注册)。
    onMount?.(editor, monacoRef.current ?? (window as unknown as { monaco?: Monaco }).monaco);
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

  // 折叠摘要生命周期管理(依赖 language):
  // - 语言切到非 JSON 时立即清理 handle(避免给非 JSON 内容也注入字段/元素数)
  // - 语言从非 JSON 切回 JSON 时补 attach(editor 不会因 language 变化重新
  //   mount,handleMount 只在首次挂载执行一次,必须在此 effect 补偿)
  // - 卸载时释放 handle(事件订阅 + 装饰集合),避免 Monaco 编辑器销毁后回调触发崩溃
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && language === 'json' && !foldSummaryRef.current) {
      foldSummaryRef.current = attachFoldSummary(editor);
    } else if (language !== 'json') {
      foldSummaryRef.current?.dispose();
      foldSummaryRef.current = null;
    }
    return () => {
      foldSummaryRef.current?.dispose();
      foldSummaryRef.current = null;
    };
  }, [language]);

  // 查找组件悬停提示统一样式:抑制 Monaco HoverService 浮层(位置不可控,
  // 在窗口右上角边缘会被裁剪),改用应用内浮层并覆盖组件内全部可悬停控件。
  // 以 editorInstance 为依赖的对称 effect:编辑器实例就绪后挂载,卸载/热更新
  // 重跑时 dispose 后重建 —— handleMount 只触发一次,HMR 后会留下"已断开"
  // 的观察器(真实事故),必须由 effect 保证任意一次提交后都恰好存活一个。
  useEffect(() => {
    const editorDom = editorInstance?.getDomNode();
    if (!editorDom) return;
    findCloseHintRef.current?.dispose();
    findCloseHintRef.current = attachFindCloseTooltip(editorDom);
    return () => {
      urlClickRef.current?.();
      urlClickRef.current = null;
      findCloseHintRef.current?.dispose();
      findCloseHintRef.current = null;
    };
  }, [editorInstance]);

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
      toast.info(t('chrome.code_editor.clipboard_empty'));
    }
  };

  const handleFileChange = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      onChange?.(text);
    } catch {
      toast.error(t('chrome.code_editor.read_file_failed'));
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
      data-search-anchor={searchAnchor}
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
                label={t('chrome.code_editor.paste')}
                testId={dataTestId ? `${dataTestId}-paste` : undefined}
                onClick={() => void handlePaste()}
              >
                <ClipboardPaste aria-hidden className="size-3.5" />
                {t('chrome.code_editor.paste')}
              </ToolbarButton>
            )}
            {!readOnly && showOpenFile && (
              <ToolbarButton
                label={t('chrome.code_editor.open_file')}
                testId={dataTestId ? `${dataTestId}-open` : undefined}
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen aria-hidden className="size-3.5" />
              </ToolbarButton>
            )}
            {!readOnly && showClear && (
              <ToolbarButton
                label={t('chrome.code_editor.clear')}
                testId={dataTestId ? `${dataTestId}-clear` : undefined}
                onClick={() => onChange?.('')}
              >
                <X aria-hidden className="size-3.5" />
                {t('chrome.code_editor.clear')}
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
              {t('chrome.code_editor.loading')}
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
            fontSize: editorFontSize.fontSize,
            lineHeight: editorFontSize.lineHeight,
            lineNumbers: lineNumbers ? 'on' : 'off',
            glyphMargin: false,
            // 代码折叠:gutter 单击折叠/展开 + 右键菜单折叠组(经 folding prop 可关)
            folding,
            minimap: { enabled: minimap },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            // 自动换行:默认开启,可经右键菜单「自动换行」按当前编辑器切换
            wordWrap: wordWrapOn ? 'on' : 'off',
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
            // 默认 0 隐藏右缘标尺;文本比较等场景经 prop 开启以显示差异刻度
            overviewRulerLanes,
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
          wordWrapOn={wordWrapOn}
          onToggleWordWrap={toggleWordWrap}
          sections={contextMenuSections}
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
                title={t('chrome.code_editor.char_count_title', { count: charCount })}
                aria-label={t('chrome.code_editor.char_count_title', { count: charCount })}
                className="whitespace-nowrap tabular-nums"
              >
                {t('chrome.code_editor.char_count', { count: charCount })}
              </span>
            )}
            {selected > 0 && (
              <span
                data-testid={dataTestId ? `${dataTestId}-status-sel` : undefined}
                aria-label={t('chrome.code_editor.selected_title', { count: selected })}
              >
                {t('chrome.code_editor.selected', { count: selected })}
              </span>
            )}
            {/* 行列跳转(仿 VSCode):点击弹出「转到行/列」快选弹窗 */}
            <button
              type="button"
              data-testid={dataTestId ? `${dataTestId}-status-pos` : undefined}
              title={t('chrome.code_editor.goto_title')}
              aria-label={t('chrome.code_editor.goto_aria', {
                line: cursor.line,
                column: cursor.column,
              })}
              onClick={() => setGotoOpen(true)}
              className="whitespace-nowrap rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t('chrome.code_editor.status_pos', {
                line: cursor.line,
                column: cursor.column,
              })}
            </button>
            {/* 缩进方式:点击弹出「选择缩进操作」快选弹窗(VSCode「空格:N」徽章) */}
            <button
              type="button"
              data-testid={dataTestId ? `${dataTestId}-status-indent` : undefined}
              title={t('chrome.code_editor.indent_title', { size: indent.tabSize })}
              onClick={() => setIndentOpen(true)}
              className="whitespace-nowrap rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {indent.insertSpaces
                ? t('chrome.code_editor.indent_label', { size: indent.tabSize })
                : t('chrome.code_editor.indent_label_tabs')}
            </button>
            {/* 文件编码:点击弹出「选择编码」快选弹窗(仿 VSCode 编码徽章) */}
            {encoding !== undefined &&
              (onEncodingChange ? (
                <button
                  type="button"
                  data-testid={dataTestId ? `${dataTestId}-status-encoding` : undefined}
                  title={t('chrome.code_editor.encoding_pick_title')}
                  onClick={() => setEncodingOpen(true)}
                  className="whitespace-nowrap rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {encodingBadge()}
                </button>
              ) : (
                <span
                  data-testid={dataTestId ? `${dataTestId}-status-encoding` : undefined}
                  title={t('chrome.code_editor.encoding_title')}
                  className="whitespace-nowrap px-1.5 py-0.5"
                >
                  {encodingBadge()}
                </span>
              ))}
            {/* 行尾序列:CRLF/LF 展示,提供回调时点击弹出「选择行尾序列」弹窗 */}
            <button
              type="button"
              data-testid={dataTestId ? `${dataTestId}-status-eol` : undefined}
              title={
                onEolChange
                  ? t('chrome.code_editor.eol_switch_title', { eol: eolLabel })
                  : t('chrome.code_editor.eol_title', { eol: eolLabel })
              }
              onClick={onEolChange ? () => setEolOpen(true) : undefined}
              disabled={!onEolChange}
              className={cn(
                'whitespace-nowrap rounded-sm px-1.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                onEolChange && 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {eolLabel}
            </button>
            {/* 文件大小(右下角,语言徽章左侧):B/KB/MB/GB,随内容实时更新 */}
            {sizeBytes !== undefined && (
              <span
                data-testid={dataTestId ? `${dataTestId}-status-size` : undefined}
                title={t('chrome.code_editor.size_title')}
                aria-label={t('chrome.code_editor.size_aria', { size: formatBytes(sizeBytes) })}
                className="whitespace-nowrap tabular-nums"
              >
                {formatBytes(sizeBytes)}
              </span>
            )}
            {statusBarRight && <span className="ml-1 flex items-center">{statusBarRight}</span>}
          </span>
        </div>
      )}

      {/* —— 状态栏快选弹窗(「全局搜索」式 CommandDialog,按需挂载)—— */}
      <GotoLineQuickPick
        open={gotoOpen}
        onOpenChange={setGotoOpen}
        cursor={cursor}
        maxLine={maxLine}
        onJump={handleGotoJump}
        data-testid={`${dataTestId ?? 'editor'}-goto`}
      />
      <IndentQuickPick
        open={indentOpen}
        onOpenChange={setIndentOpen}
        insertSpaces={indent.insertSpaces}
        tabSize={indent.tabSize}
        onApply={applyIndent}
        onDetect={detectIndent}
        onConvert={convertIndent}
        onTrim={trimTrailing}
        data-testid={`${dataTestId ?? 'editor'}-indent-picker`}
      />
      {encoding !== undefined && onEncodingChange && (
        <EncodingQuickPick
          open={encodingOpen}
          onOpenChange={setEncodingOpen}
          currentEncoding={encoding}
          onEncodingChange={onEncodingChange}
          onEncodingReopen={onEncodingReopen}
          onEncodingSave={onEncodingSave}
          reopenAvailable={encodingReopenAvailable}
          data-testid={`${dataTestId ?? 'editor'}-encoding-picker`}
        />
      )}
      {onEolChange && (
        <EolQuickPick
          open={eolOpen}
          onOpenChange={setEolOpen}
          currentEol={eolLabel}
          onSelect={onEolChange}
          data-testid={`${dataTestId ?? 'editor'}-eol-picker`}
        />
      )}
    </div>
  );
}
