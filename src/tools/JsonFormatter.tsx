import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import { formatError } from '@/lib/format-error';
import { useTranslation } from 'react-i18next';
import { CodeEditor, type EditorLanguage } from '@/components/ui/code-editor';
import type { MonacoMenuSection } from '@/components/ui/monaco-context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { CopyAction } from '@/components/copy-action';
import { invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
import { cn } from '@/lib/utils';
import {
  ArrowDownAZ,
  ArrowUpDown,
  Check,
  ChevronDown,
  FileCode2,
  FileJson,
  FileText,
  History,
  ListTree,
  Minimize2,
  Pin,
  Plus,
  Save,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { ToolProps } from './registry';
import type { OutputMeta, ToolOutput } from '@/types/tool';
import { parseSmart, sortJsonKeysBy, type JsonKeySortMode } from './json-utils';
import { ENTITY_LANGUAGE_ITEMS, generateEntityCode, type EntityLanguage } from './json-entity';
import {
  DATA_FORMAT_ITEMS,
  jsonToProperties,
  jsonToToml,
  jsonToUrlParams,
  jsonToXml,
  jsonToYaml,
  toJson5,
  type DataFormatId,
} from './json-formats';
import {
  MAX_HISTORY_ITEMS,
  useJsonFormatterStore,
  type JsonDoc,
  type JsonHistoryItem,
} from './jsonFormatterStore';
import { JsonTreeView } from './JsonTreeView';

type QuickAction = 'minify' | 'entity';
type OutputViewMode = 'text' | 'tree';

/** 按载荷规模自适应的持久化防抖窗口(ms):载荷越大合并越久,降低全量重写的 IO 放大 */
function persistDelayFor(totalChars: number): number {
  if (totalChars > 1024 * 1024) return 5000;
  if (totalChars > 256 * 1024) return 2000;
  return 500;
}

/** 输出语言映射:实体类生成后输出编辑器切换到对应语言高亮 */
const ENTITY_OUTPUT_LANGUAGE: Record<EntityLanguage, EditorLanguage> = {
  typescript: 'typescript',
  java: 'java',
  go: 'go',
  rust: 'rust',
  python: 'python',
  csharp: 'csharp',
};

/** 数据格式转换后的高亮语言(Monaco 无 TOML/JSON5/Properties 专属 id,就近映射) */
const DATA_OUTPUT_LANGUAGE: Record<DataFormatId, EditorLanguage> = {
  xml: 'xml',
  yaml: 'yaml',
  toml: 'ini',
  json5: 'javascript',
  properties: 'ini',
  urlparams: 'plaintext',
};

/** 排序菜单项定义(与 Json Assistant 风格一致的三组排序);label 存 i18n 键,渲染时经 t() 解析 */
const SORT_MENU_GROUPS: ReadonlyArray<{
  labelKey: string;
  items: Array<{ labelKey: string; mode: JsonKeySortMode; descending: boolean }>;
}> = [
  {
    labelKey: 'tools.json_formatter.sort_group_basic',
    items: [
      {
        labelKey: 'tools.json_formatter.sort_alpha_asc',
        mode: 'alpha',
        descending: false,
      },
      {
        labelKey: 'tools.json_formatter.sort_alpha_desc',
        mode: 'alpha',
        descending: true,
      },
      {
        labelKey: 'tools.json_formatter.sort_alpha_insensitive_asc',
        mode: 'alpha-insensitive',
        descending: false,
      },
      {
        labelKey: 'tools.json_formatter.sort_alpha_insensitive_desc',
        mode: 'alpha-insensitive',
        descending: true,
      },
    ],
  },
  {
    labelKey: 'tools.json_formatter.sort_group_natural',
    items: [
      {
        labelKey: 'tools.json_formatter.sort_natural_asc',
        mode: 'natural',
        descending: false,
      },
      {
        labelKey: 'tools.json_formatter.sort_natural_desc',
        mode: 'natural',
        descending: true,
      },
    ],
  },
  {
    labelKey: 'tools.json_formatter.sort_group_special',
    items: [
      { labelKey: 'tools.json_formatter.sort_length_asc', mode: 'length', descending: false },
      { labelKey: 'tools.json_formatter.sort_length_desc', mode: 'length', descending: true },
      { labelKey: 'tools.json_formatter.sort_hex_asc', mode: 'hex', descending: false },
      { labelKey: 'tools.json_formatter.sort_hex_desc', mode: 'hex', descending: true },
      { labelKey: 'tools.json_formatter.sort_reverse', mode: 'reverse', descending: false },
      { labelKey: 'tools.json_formatter.sort_random', mode: 'random', descending: false },
    ],
  },
];

/** 标题栏内的操作按钮,与编辑器工具栏(粘贴/打开/清除)风格完全一致;
 *  forwardRef + rest 透传:供 Radix TooltipTrigger/PopoverTrigger asChild
 *  挂载悬浮提示与注入打开处理器(Slot 会把 onClick/aria 等并入子组件 props) */
const ActionButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { testId?: string }
>(function ActionButton({ disabled, children, testId, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      disabled={disabled}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      {...rest}
    >
      {children}
    </button>
  );
});

/** 输出视图切换(文本/树形),文本与树形两种输出形态的标题栏共用 */
function OutputViewToggle({
  mode,
  onChange,
}: {
  mode: OutputViewMode;
  onChange: (mode: OutputViewMode) => void;
}) {
  const { t } = useTranslation();
  const itemClass = (active: boolean): string =>
    cn(
      'flex items-center gap-1 px-2 py-0.5 text-xs transition-colors',
      active
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
    );
  return (
    <div
      role="group"
      aria-label={t('tools.json_formatter.output_view_toggle_aria')}
      className="flex overflow-hidden rounded border border-border"
    >
      <button
        type="button"
        data-testid="view-text"
        aria-pressed={mode === 'text'}
        title={t('tools.json_formatter.text_view_title')}
        onClick={() => onChange('text')}
        className={itemClass(mode === 'text')}
      >
        <FileText aria-hidden className="size-3.5" />
        {t('tools.json_formatter.text_view_label')}
      </button>
      <button
        type="button"
        data-testid="view-tree"
        aria-pressed={mode === 'tree'}
        title={t('tools.json_formatter.tree_view_title')}
        onClick={() => onChange('tree')}
        className={itemClass(mode === 'tree')}
      >
        <ListTree aria-hidden className="size-3.5" />
        {t('tools.json_formatter.tree_view_label')}
      </button>
    </div>
  );
}

export function JsonFormatter({ toolId }: ToolProps) {
  const { t } = useTranslation();
  // —— 多 Tab 工作区(store 为模块级单例,状态跨挂载保留)——
  const docs = useJsonFormatterStore((s) => s.docs);
  const activeDocId = useJsonFormatterStore((s) => s.activeDocId);
  const history = useJsonFormatterStore((s) => s.history);
  const ready = useJsonFormatterStore((s) => s.ready);
  const userTouched = useJsonFormatterStore((s) => s.userTouched);
  const newDoc = useJsonFormatterStore((s) => s.newDoc);
  const closeDoc = useJsonFormatterStore((s) => s.closeDoc);
  const switchDoc = useJsonFormatterStore((s) => s.switchDoc);
  const renameDoc = useJsonFormatterStore((s) => s.renameDoc);
  const togglePinDoc = useJsonFormatterStore((s) => s.togglePinDoc);
  const setDocContent = useJsonFormatterStore((s) => s.setDocContent);
  const recordHistory = useJsonFormatterStore((s) => s.recordHistory);

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
  const text = activeDoc?.content ?? '';
  const setText = useCallback(
    (value: string) => {
      if (activeDoc) setDocContent(activeDoc.id, value);
    },
    [activeDoc, setDocContent],
  );

  // 格式化输出缩进:固定 2 空格(工具栏缩进下拉框已移除,
  // 编辑器状态栏的「空格:N」仅作用于编辑显示,不参与输出格式化)
  const indent = 2;
  const [output, setOutput] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<EditorLanguage>('json');
  const [meta, setMeta] = useState<OutputMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<OutputViewMode>('text');
  const [historyOpen, setHistoryOpen] = useState(false);
  /** 待确认关闭的文档(null = 无);仅非空内容文档关闭前弹确认 */
  const [closeTarget, setCloseTarget] = useState<JsonDoc | null>(null);
  /** 待重命名的文档(null = 关闭重命名对话框) */
  const [renameTarget, setRenameTarget] = useState<JsonDoc | null>(null);
  /** 「清空全部历史」确认 Popover 开关(清空不可恢复,防误触) */
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  /** 待确认删除的历史条目 id(null = 关闭;受控单开,同时只允许一个确认框) */
  const [historyRemoveId, setHistoryRemoveId] = useState<string | null>(null);

  const isXmlInput = useMemo(() => text.trim().startsWith('<'), [text]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 前端格式化阈值:低于该字节数直接在前端用 JSON.stringify 格式化(秒级响应,省 IPC 往返);
   * 超过阈值才走后端 Rust(保留其对超大输入的资源隔离与 10MB 拦截)。
   */
  const FRONTEND_FORMAT_LIMIT = 200 * 1024; // 200KB  // 启动时从 Rust config 还原文档与历史(hydrate 内部幂等)
  useEffect(() => {
    void useJsonFormatterStore.getState().hydrate();
  }, []);

  // hydrate 完成后确保至少有一个文档且激活态有效(首次使用 / 数据损坏兜底)
  useEffect(() => {
    if (!ready) return;
    const s = useJsonFormatterStore.getState();
    if (s.docs.length === 0) {
      s.newDoc('');
    } else if (!s.docs.some((d) => d.id === s.activeDocId)) {
      switchDoc(s.docs[0].id);
    }
  }, [ready, switchDoc]);

  // 文档/历史变更防抖持久化(hydrate 前不写,避免用默认空态覆盖已存数据)。
  // 防抖窗口按总载荷自适应:文档区为全量重写,KB 级 500ms 快速落盘,
  // MB 级拉长到 5s 把连续编辑合并为一次磁盘写,显著降低大文档的写放大
  // (代价是极端情况下最多丢失一个窗口内的编辑,对工具输入可接受)。
  useEffect(() => {
    if (!ready || !userTouched) return;
    let total = 0;
    for (const d of docs) total += d.content.length;
    const t = setTimeout(
      () => void useJsonFormatterStore.getState().persistDocs(),
      persistDelayFor(total),
    );
    return () => clearTimeout(t);
  }, [docs, ready, userTouched]);

  // 历史变更防抖持久化(单条上限 256K × 50 条,同样按载荷自适应)
  useEffect(() => {
    if (!ready || !userTouched) return;
    let total = 0;
    for (const h of history) total += h.content.length;
    const t = setTimeout(
      () => void useJsonFormatterStore.getState().persistHistory(),
      persistDelayFor(total),
    );
    return () => clearTimeout(t);
  }, [history, ready, userTouched]);

  // 切换 Tab:立即清空上一文档的输出并回到文本视图,防抖后自动为新文档重新格式化。
  // 用「渲染期比较激活文档 id 并重置 state」的官方模式,避免在 effect 同步体内
  // setState 触发级联渲染(react-x/no-set-state-in-effect)。
  const [renderedDocId, setRenderedDocId] = useState<string | null>(activeDocId);
  if (renderedDocId !== activeDocId) {
    setRenderedDocId(activeDocId);
    setOutput('');
    setMeta(null);
    setViewMode('text');
  }

  /**
   * 请求关闭文档:一律先弹确认框防误关(非空内容确认后会快照进历史,
   * 可从「历史」恢复),用户确认后才真正关闭。
   */
  function requestCloseDoc(id: string) {
    const target = docs.find((d) => d.id === id);
    if (!target) return;
    setCloseTarget(target);
  }

  /** 确认关闭:先把非空内容快照进历史(最近文档语义),再关闭 */
  function confirmCloseDoc() {
    if (!closeTarget) return;
    if (closeTarget.content.trim()) recordHistory(closeTarget.content);
    closeDoc(closeTarget.id);
    setCloseTarget(null);
  }

  /** 从历史还原:当前文档为空则填入当前文档,否则新开 Tab 承载,避免覆盖未保存内容 */
  function handleRestoreHistory(item: JsonHistoryItem) {
    const current = docs.find((d) => d.id === activeDocId);
    if (!current || !current.content.trim()) {
      if (current) setDocContent(current.id, item.content);
      else newDoc(item.content);
    } else {
      newDoc(item.content);
    }
    setHistoryOpen(false);
  }

  /** 前端快速格式化:解析(含 XML 自动转 JSON)后按缩进美化输出 */
  function formatOnFrontend(textToFormat: string): string {
    const value = parseSmart(textToFormat);
    return JSON.stringify(value, null, indent);
  }

  /**
   * 执行格式化(主按钮与自动防抖共用)。
   * 中小数据走前端纯函数,超过阈值走后端 Rust 格式化(auto=true 时不显示加载态)。
   * 成功即记录历史(含自动防抖路径):仅解析成功才走到这里,天然过滤非法输入;
   * 打字期间的连续快照由 store 的合并窗口收敛为一条,无需在此区分手动/自动。
   */
  const runFormat = useCallback(
    async (auto = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!text.trim()) return;
      if (!auto) setLoading(true);
      try {
        // 中小数据直接在前端格式化,避免无谓的 IPC 往返
        if (text.length <= FRONTEND_FORMAT_LIMIT) {
          setOutput(formatOnFrontend(text));
          setMeta(null);
          setOutputLanguage('json');
        } else {
          const result = await invokeCommand<ToolOutput>('tool_execute', {
            toolId,
            input: { text, params: { indent } },
          });
          setOutput(result.text ?? '');
          setMeta(result.meta ?? null);
          setOutputLanguage('json');
        }
        recordHistory(text);
      } catch (e) {
        // 报错直接写入右侧输出框
        setOutput(formatError(e, t('tools.json_formatter.format_failed')));
        setMeta(null);
        setOutputLanguage('plaintext');
      } finally {
        if (!auto) setLoading(false);
      }
    },
    // formatOnFrontend 为组件内纯函数,仅依赖 indent(已含于依赖数组)
    [toolId, text, indent, recordHistory, t],
  );

  // 全局快捷键契约:Ctrl+Enter 执行 / Ctrl+L 清空当前文档 / Ctrl+Shift+C 复制输出。
  // 输入为空时不注册 execute(避免空跑);输出非空才注册复制,保证降级提示准确。
  useToolShortcutActions(toolId, {
    execute: text.trim() ? () => void runFormat(false) : undefined,
    clearInput: () => {
      if (activeDocId) setDocContent(activeDocId, '');
    },
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  // 「发送到…」接收端:成为激活工具时注入当前文档。
  // 必须走 injectDocFromTool 而非 setDocContent:本工具首次懒加载时,该 effect
  // 会在 hydrate() 这个 Promise 落地之前同步执行,置位 userTouched 会让 hydrate
  // 丢弃持久化数据,随后防抖 persist 把上次的文档与整份本地历史永久覆盖。
  useToolHandoff(toolId, (incoming) => {
    useJsonFormatterStore.getState().injectDocFromTool(incoming);
  });

  // 输入或缩进变化后自动格式化到右侧输出(防抖,避免每次按键都调用)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!text.trim()) {
        // 空输入:在异步回调内清空,避免在 effect 同步体内 setState 触发的级联渲染
        setOutput('');
        setMeta(null);
      } else {
        void runFormat(true);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, indent, runFormat]);

  /**
   * 纯前端快速操作:压缩 / 生成实体类(支持 XML 输入自动转 JSON)。
   * 排序由 handleSort 单独处理(模式更多)。
   */
  function handleQuickAction(action: QuickAction) {
    if (!text.trim()) return;
    try {
      const value = parseSmart(text);
      switch (action) {
        case 'minify':
          setOutput(JSON.stringify(value));
          setOutputLanguage('json');
          break;
        case 'entity':
          setOutput(generateEntityCode(value, 'typescript'));
          setOutputLanguage('typescript');
          break;
      }
      setMeta(null);
      recordHistory(text);
    } catch (e) {
      setOutput(formatError(e, t('tools.json_formatter.parse_failed')));
      setOutputLanguage('plaintext');
      setMeta(null);
    }
  }

  /** 按指定模式对全部对象的键递归排序(数组顺序保持不变) */
  function handleSort(mode: JsonKeySortMode, descending: boolean) {
    if (!text.trim()) return;
    try {
      const value = parseSmart(text);
      setOutput(JSON.stringify(sortJsonKeysBy(value, { mode, descending }), null, indent));
      setOutputLanguage('json');
      setMeta(null);
      recordHistory(text);
    } catch (e) {
      setOutput(formatError(e, t('tools.json_formatter.sort_failed')));
      setOutputLanguage('plaintext');
      setMeta(null);
    }
  }

  /** 转换为指定语言的实体类(TypeScript / Java / Go / Rust / Python / C#) */
  function handleConvert(language: EntityLanguage) {
    if (!text.trim()) return;
    try {
      const value = parseSmart(text);
      setOutput(generateEntityCode(value, language));
      setOutputLanguage(ENTITY_OUTPUT_LANGUAGE[language]);
      setMeta(null);
      recordHistory(text);
    } catch (e) {
      setOutput(formatError(e, t('tools.json_formatter.convert_failed', { language })));
      setOutputLanguage('plaintext');
      setMeta(null);
    }
  }

  /**
   * 转换为指定数据格式(XML / YAML / TOML / JSON5 / Properties / URL 参数)。
   * 输入支持 XML 自动转 JSON(parseSmart),即「XML → YAML」等链式转换天然可用。
   */
  function handleConvertFormat(format: DataFormatId) {
    if (!text.trim()) return;
    try {
      const value = parseSmart(text);
      let converted: string;
      switch (format) {
        case 'xml':
          converted = jsonToXml(value);
          break;
        case 'yaml':
          converted = jsonToYaml(value);
          break;
        case 'toml':
          converted = jsonToToml(value);
          break;
        case 'json5':
          converted = toJson5(value);
          break;
        case 'properties':
          converted = jsonToProperties(value);
          break;
        case 'urlparams':
          converted = jsonToUrlParams(value);
          break;
        default: {
          const exhaustive: never = format;
          throw new Error(
            t('tools.json_formatter.unsupported_format', { format: String(exhaustive) }),
          );
        }
      }
      setOutput(converted);
      setOutputLanguage(DATA_OUTPUT_LANGUAGE[format]);
      setMeta(null);
      recordHistory(text);
    } catch (e) {
      setOutput(formatError(e, t('tools.json_formatter.convert_failed', { format })));
      setOutputLanguage('plaintext');
      setMeta(null);
    }
  }

  /**
   * 树结构视图数据:仅在树视图激活时解析输出,并经 useDeferredValue 降优先级。
   * 此前 useMemo 依赖 output,文本视图下每次输出变化也会同步 parseSmart 整个
   * 输出(10MB 级阻塞主线程数百 ms 至秒级);现在非树视图不解析,切到树视图时
   * 先渲染「正在构建」提示,解析在低优先级渲染中完成后再展示。
   */
  const wantsTreeParse = viewMode === 'tree';
  const deferredTreeOutput = useDeferredValue(wantsTreeParse ? output : '');
  const treeParsing = wantsTreeParse && deferredTreeOutput !== output;
  const treeValue = useMemo<{ ok: boolean; value: unknown }>(() => {
    if (!deferredTreeOutput.trim()) return { ok: false, value: undefined };
    try {
      return { ok: true, value: parseSmart(deferredTreeOutput) };
    } catch {
      return { ok: false, value: undefined };
    }
  }, [deferredTreeOutput]);

  const disabled = loading || !text;

  /**
   * 右键菜单自定义分组(按页面定制显示):JSON 工具页在输入编辑器的
   * 右键菜单中注入「格式化 / 压缩 / 键排序 / 转换为 TypeScript」,
   * 与标题栏按钮能力一致;其他工具页不注入,保持各自默认菜单。
   */
  const jsonMenuSections: MonacoMenuSection[] = [
    {
      id: 'json',
      items: [
        {
          id: 'format',
          label: t('tools.json_formatter.ctx_format_json'),
          onSelect: () => void runFormat(),
        },
        {
          id: 'minify',
          label: t('tools.json_formatter.ctx_minify_json'),
          onSelect: () => handleQuickAction('minify'),
        },
        {
          id: 'sort-asc',
          label: t('tools.json_formatter.ctx_sort_az'),
          onSelect: () => handleSort('alpha', false),
        },
        {
          id: 'sort-desc',
          label: t('tools.json_formatter.ctx_sort_za'),
          onSelect: () => handleSort('alpha', true),
        },
        {
          id: 'to-typescript',
          label: t('tools.json_formatter.ctx_to_typescript'),
          onSelect: () => handleConvert('typescript'),
        },
      ],
    },
  ];

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  return (
    // 外层圆角卡片(与文本编辑器 EditorWorkbench 右侧主页面卡片同款):
    // rounded-lg + border + shadow,overflow-hidden 让 Tab 栏顶角与卡片圆角对齐
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="json-formatter"
    >
      {/* —— 多文档 Tab 栏(样式对齐文本编辑器 EditorTabsBar:VSCode 风格全高 Tab) —— */}
      <div
        className="flex h-9 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="doc-tabs"
      >
        <div
          role="tablist"
          aria-label={t('tools.json_formatter.tabs_aria')}
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
                {/* 关闭确认:锚定在 Tab 旁的小 Popover(与历史清空/删除确认同款),
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
                    {/* 固定 Tab 用 Pin 图标替代 JSON 图标(与编辑器 Tab 语义一致) */}
                    {doc.pinned ? (
                      <Pin
                        aria-label={t('tools.json_formatter.pinned_aria')}
                        data-testid="doc-tab-pin"
                        className={cn(
                          'size-3.5 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                    ) : (
                      <FileJson
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
                    {/* 关闭按钮槽位:与 EditorTabsBar 一致,悬停 Tab 时在右侧槽位淡入 */}
                    <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                      <button
                        type="button"
                        aria-label={t('tools.json_formatter.close_tab_aria', { title: doc.title })}
                        title={t('tools.json_formatter.close')}
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
                  {/* 关闭确认内容:与历史清空/删除确认同款小框,锚定 Tab 下方 */}
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-56 p-3"
                    data-testid="doc-close-dialog"
                  >
                    <p className="text-xs font-semibold">
                      {t('tools.json_formatter.close_confirm_title', { title: doc.title })}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {doc.content.trim()
                        ? t('tools.json_formatter.close_confirm_snapshot_desc')
                        : t('tools.json_formatter.close_confirm_empty_desc')}
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
                        {t('tools.json_formatter.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => confirmCloseDoc()}
                        data-testid="doc-close-dialog-confirm"
                      >
                        {t('tools.json_formatter.close')}
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
                    {t('tools.json_formatter.rename')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => togglePinDoc(doc.id)}
                    data-testid="ctx-doc-toggle-pin"
                  >
                    {t('tools.json_formatter.pin')}
                    {doc.pinned && (
                      <Check
                        aria-label={t('tools.json_formatter.pinned_aria')}
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
                    {t('tools.json_formatter.close')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          <button
            type="button"
            data-testid="doc-add"
            title={t('tools.json_formatter.new_doc')}
            aria-label={t('tools.json_formatter.new_doc')}
            onClick={() => newDoc()}
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.json_formatter.input_title')}
            language={isXmlInput ? 'xml' : 'json'}
            value={text}
            onChange={setText}
            // 只保留右侧边框(朝向中间分隔缝),去掉外三边:外层卡片已提供
            // rounded-lg 框体,编辑器自带 rounded-md 边框会在卡片左右两边
            // 叠出双线/双圆角;去掉后边缘单线、四角圆角干净
            className="h-full rounded-none border-0 border-r"
            data-testid="input"
            searchAnchor="json_formatter:input"
            contextMenuSections={jsonMenuSections}
            // 输入侧支持打开本地文件(readFileAsText 读取后整体替换当前文档内容)
            showOpenFile
            actions={
              <>
                <ActionButton
                  testId="btn-format"
                  onClick={() => void runFormat()}
                  disabled={disabled}
                >
                  <Wand2 aria-hidden className="size-3.5" />
                  {loading
                    ? t('tools.json_formatter.formatting')
                    : t('tools.json_formatter.format')}
                </ActionButton>
                <ActionButton
                  testId="btn-minify"
                  onClick={() => handleQuickAction('minify')}
                  disabled={disabled}
                >
                  <Minimize2 aria-hidden className="size-3.5" />
                  {t('tools.json_formatter.minify')}
                </ActionButton>
                {/* —— 多模式键排序(仿 Json Assistant:基础/自然/特殊三组) —— */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="btn-sort"
                      disabled={disabled}
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <ArrowUpDown aria-hidden className="size-3.5" />
                      {t('tools.json_formatter.sort')}
                      <ChevronDown aria-hidden className="size-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-[420px] w-52 overflow-y-auto">
                    {SORT_MENU_GROUPS.map((group, gi) => (
                      <div key={group.labelKey} data-testid={gi === 0 ? 'sort-menu' : undefined}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t(group.labelKey)}
                        </DropdownMenuLabel>
                        {group.items.map((item) => (
                          <DropdownMenuItem
                            key={item.labelKey}
                            data-testid={`sort-${item.mode}-${item.descending ? 'desc' : 'asc'}`}
                            disabled={disabled}
                            onSelect={() => handleSort(item.mode, item.descending)}
                          >
                            {item.mode === 'reverse' || item.mode === 'random' ? (
                              <ArrowDownAZ aria-hidden className="mr-2 size-3.5 opacity-50" />
                            ) : null}
                            {t(item.labelKey)}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* —— 转换为:多语言实体类 + 数据格式(XML/YAML/TOML/JSON5/Properties/URL 参数) —— */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="btn-convert"
                      disabled={disabled}
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <FileCode2 aria-hidden className="size-3.5" />
                      {t('tools.json_formatter.convert_to')}
                      <ChevronDown aria-hidden className="size-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-[460px] overflow-y-auto">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {t('tools.json_formatter.entity_class')}
                    </DropdownMenuLabel>
                    {ENTITY_LANGUAGE_ITEMS.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        data-testid={`convert-${item.id}`}
                        disabled={disabled}
                        onSelect={() => handleConvert(item.id)}
                      >
                        {item.labelKey ? t(item.labelKey) : item.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {t('tools.json_formatter.data_format')}
                    </DropdownMenuLabel>
                    {DATA_FORMAT_ITEMS.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        data-testid={`convert-${item.id}`}
                        disabled={disabled}
                        onSelect={() => handleConvertFormat(item.id)}
                      >
                        {item.labelKey ? t(item.labelKey) : item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* —— 工具本地历史(完整内容,可还原;全局历史仅存预览不可复用) —— */}
                <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                  <PopoverTrigger asChild>
                    {/* 原生 button:Radix Slot 需要向子元素转发 ref(定位锚定) */}
                    <button
                      type="button"
                      data-testid="btn-history"
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <History aria-hidden className="size-3.5" />
                      {t('tools.json_formatter.history')}
                      {history.length > 0 && (
                        <span className="rounded bg-muted px-1 text-[10px]">
                          {Math.min(history.length, MAX_HISTORY_ITEMS)}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-96 p-0" data-testid="history-popover">
                    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                      <span className="flex-1 text-xs font-semibold">
                        {t('tools.json_formatter.history_title')}
                      </span>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <ActionButton
                              testId="history-save-current"
                              onClick={() => {
                                if (text.trim()) recordHistory(text);
                              }}
                            >
                              <Save aria-hidden className="size-3.5" />
                              {t('tools.json_formatter.save_current')}
                            </ActionButton>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {t('tools.json_formatter.history_save_tip')}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* 确认框用 Popover 锚定在按钮旁(参考 shadcn Popover),
                                不用居中 modal:轻量防误触不打断浏览 */}
                            <Popover open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
                              <PopoverTrigger asChild>
                                <ActionButton
                                  testId="history-clear"
                                  disabled={history.length === 0}
                                >
                                  <Trash2 aria-hidden className="size-3.5" />
                                  {t('tools.json_formatter.clear')}
                                </ActionButton>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                side="bottom"
                                className="w-56 p-3"
                                data-testid="history-clear-confirm"
                              >
                                <p className="text-xs font-semibold">
                                  {t('tools.json_formatter.history_clear_confirm_title')}
                                </p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {t('tools.json_formatter.history_clear_confirm_desc', {
                                    count: history.length,
                                  })}
                                </p>
                                <div className="mt-2.5 flex justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => setClearHistoryOpen(false)}
                                    data-testid="history-clear-confirm-cancel"
                                  >
                                    {t('tools.json_formatter.cancel')}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => {
                                      useJsonFormatterStore.getState().clearHistory();
                                      setClearHistoryOpen(false);
                                    }}
                                    data-testid="history-clear-confirm-ok"
                                  >
                                    {t('tools.json_formatter.clear')}
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {t('tools.json_formatter.history_clear_tip')}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              data-testid="history-close"
                              aria-label={t('tools.json_formatter.history_close_aria')}
                              onClick={() => setHistoryOpen(false)}
                              className="flex items-center rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <X aria-hidden className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {t('tools.json_formatter.history_close_tip')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    {history.length === 0 ? (
                      <div
                        className="flex h-24 items-center justify-center text-xs text-muted-foreground"
                        data-testid="history-empty"
                      >
                        {t('tools.json_formatter.history_empty')}
                      </div>
                    ) : (
                      <ul className="max-h-72 overflow-y-auto py-1" data-testid="history-list">
                        {history.map((item) => (
                          <li key={item.id} className="group relative">
                            <button
                              type="button"
                              data-testid="history-item"
                              title={item.title}
                              onClick={() => handleRestoreHistory(item)}
                              className="flex w-full flex-col gap-0.5 px-3 py-1.5 pr-8 text-left transition-colors hover:bg-accent"
                            >
                              <span className="truncate font-mono text-xs text-foreground">
                                {item.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {item.timestamp > 0
                                  ? formatDistanceToNow(new Date(item.timestamp), {
                                      addSuffix: true,
                                    })
                                  : ''}
                                {' · '}
                                {t('tools.json_formatter.chars_unit', {
                                  count: item.content.length,
                                })}
                              </span>
                            </button>
                            {/* 单条删除确认:同样锚定在 X 旁的 Popover;
                                受控 open 按 item.id 单开,避免多条确认框同屏 */}
                            <Popover
                              open={historyRemoveId === item.id}
                              onOpenChange={(o) => setHistoryRemoveId(o ? item.id : null)}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={t('tools.json_formatter.delete_history_item_aria')}
                                  data-testid="history-item-remove"
                                  onClick={() => setHistoryRemoveId(item.id)}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                                >
                                  <X aria-hidden className="size-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                side="bottom"
                                className="w-56 p-3"
                                data-testid="history-remove-confirm"
                              >
                                <p className="text-xs font-semibold">
                                  {t('tools.json_formatter.history_remove_confirm_title')}
                                </p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {t('tools.json_formatter.history_remove_confirm_desc')}
                                </p>
                                <div className="mt-2.5 flex justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => setHistoryRemoveId(null)}
                                    data-testid="history-remove-confirm-cancel"
                                  >
                                    {t('tools.json_formatter.cancel')}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => {
                                      useJsonFormatterStore.getState().removeHistory(item.id);
                                      setHistoryRemoveId(null);
                                    }}
                                    data-testid="history-remove-confirm-ok"
                                  >
                                    {t('tools.json_formatter.delete')}
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </li>
                        ))}
                      </ul>
                    )}
                  </PopoverContent>
                </Popover>
                {isXmlInput && (
                  <span className="text-xs text-muted-foreground">
                    {t('tools.json_formatter.xml_hint')}
                  </span>
                )}
              </>
            }
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          {viewMode === 'tree' ? (
            <div className="flex h-full flex-col overflow-hidden rounded-none border-0 border-l border-input bg-background-layer">
              {/* 与 CodeEditor 工具栏(文本模式)严格同高同色:py-0.5 + border-input,
                  保证切换 文本/树形 时两条工具栏分隔线完全对齐 */}
              <div className="flex items-center gap-2 border-b border-input px-2 py-0.5">
                <span className="flex-1 text-xs font-medium text-muted-foreground">
                  {t('tools.json_formatter.output_title')}
                </span>
                {meta && (
                  <span className="text-xs text-muted-foreground">
                    {t('tools.json_formatter.bytes_meta', {
                      input: meta.input_bytes,
                      output: meta.output_bytes,
                      ms: meta.duration_ms,
                    })}
                  </span>
                )}
                {/* 与输入侧工具栏自然同高(控件均为 py-1 text-xs ≈ 24px 行高) */}
                <span className="flex items-center">
                  <OutputViewToggle mode={viewMode} onChange={setViewMode} />
                  <CopyAction text={output} testId="output-copy-tree" />
                  <SendToMenu text={output} currentToolId={toolId} testId="output-send-tree" />
                </span>
              </div>
              {!output.trim() ? (
                <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                  {t('tools.json_formatter.empty_output')}
                </div>
              ) : treeParsing ? (
                <div
                  className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
                  role="status"
                >
                  {t('tools.json_formatter.building_tree')}
                </div>
              ) : treeValue.ok ? (
                <JsonTreeView
                  value={treeValue.value}
                  className="flex-1 bg-background-layer"
                  data-testid="output-tree"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                  {t('tools.json_formatter.invalid_tree_output')}
                </div>
              )}
            </div>
          ) : (
            <CodeEditor
              readOnly
              title={t('tools.json_formatter.output_title')}
              language={outputLanguage}
              value={output}
              // 对称:只保留左侧边框(朝向中间分隔缝),理由同输入侧
              className="h-full rounded-none border-0 border-l"
              data-testid="output"
              searchAnchor="json_formatter:output"
              actions={
                <>
                  {meta && (
                    <span className="text-xs text-muted-foreground">
                      {t('tools.json_formatter.bytes_meta', {
                        input: meta.input_bytes,
                        output: meta.output_bytes,
                        ms: meta.duration_ms,
                      })}
                    </span>
                  )}
                  {/* 与输入侧工具栏自然同高:缩进下拉框移除后,两侧控件均为
                      py-1 text-xs(≈24px 行高),无需再强制 h-7 对齐 */}
                  <span className="flex items-center">
                    <OutputViewToggle mode={viewMode} onChange={setViewMode} />
                    <CopyAction text={output} testId="output-copy" />
                    <SendToMenu text={output} currentToolId={toolId} testId="output-send" />
                  </span>
                </>
              }
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* —— 重命名对话框(条件渲染:关闭即卸载,每次打开取最新标题) —— */}
      {renameTarget && (
        <RenameDialog
          open
          title={t('tools.json_formatter.rename_dialog_title')}
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
