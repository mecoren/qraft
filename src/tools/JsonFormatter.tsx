import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CopyAction } from '@/components/copy-action';
import { invokeCommand, CommandError } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
import { cn } from '@/lib/utils';
import {
  ArrowDownAZ,
  ArrowUpDown,
  ChevronDown,
  FileCode2,
  FileJson,
  FileText,
  History,
  ListTree,
  Minimize2,
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

/** 排序菜单项定义(与 Json Assistant 风格一致的三组排序) */
const SORT_MENU_GROUPS: ReadonlyArray<{
  label: string;
  items: Array<{ label: string; mode: JsonKeySortMode; descending: boolean }>;
}> = [
  {
    label: '基础排序',
    items: [
      { label: '大小写敏感正序 A-Z', mode: 'alpha', descending: false },
      { label: '大小写敏感逆序 Z-A', mode: 'alpha', descending: true },
      { label: '忽略大小写正序 A-Z', mode: 'alpha-insensitive', descending: false },
      { label: '忽略大小写逆序 Z-A', mode: 'alpha-insensitive', descending: true },
    ],
  },
  {
    label: '自然排序',
    items: [
      { label: '自然排序 A-Z(数字按值)', mode: 'natural', descending: false },
      { label: '自然排序 Z-A(数字按值)', mode: 'natural', descending: true },
    ],
  },
  {
    label: '特殊排序',
    items: [
      { label: '长度升序', mode: 'length', descending: false },
      { label: '长度降序', mode: 'length', descending: true },
      { label: '十六进制正序', mode: 'hex', descending: false },
      { label: '十六进制逆序', mode: 'hex', descending: true },
      { label: '反转(原顺序倒置)', mode: 'reverse', descending: false },
      { label: '随机', mode: 'random', descending: false },
    ],
  },
];

/** 标题栏内的操作按钮,与编辑器工具栏(粘贴/打开/清除)风格完全一致 */
function ActionButton({
  onClick,
  disabled,
  children,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Rust ToolError 的 Display 前缀,与 code 语义重复,展示时剥离避免冗余 */
const RUST_ERROR_PREFIXES = [
  'parse failed: ',
  'invalid input: ',
  'internal error: ',
  'input too large: ',
  'tool not found: ',
  'timeout after ',
  'out of memory: ',
];

/** 把任意异常格式化为右侧输出框可显示的错误文本 */
function formatError(e: unknown, prefix?: string): string {
  let body: string;
  if (e instanceof CommandError) {
    let message = e.message;
    for (const p of RUST_ERROR_PREFIXES) {
      if (message.startsWith(p)) {
        message = message.slice(p.length);
        break;
      }
    }
    body = e.code ? `${e.code}: ${message}` : message;
  } else if (e instanceof Error) {
    body = e.message;
  } else {
    body = String(e);
  }
  return prefix ? `${prefix}${body}` : body;
}

/** 输出视图切换(文本/树形),文本与树形两种输出形态的标题栏共用 */
function OutputViewToggle({
  mode,
  onChange,
}: {
  mode: OutputViewMode;
  onChange: (mode: OutputViewMode) => void;
}) {
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
      aria-label="输出视图切换"
      className="flex overflow-hidden rounded border border-border"
    >
      <button
        type="button"
        data-testid="view-text"
        aria-pressed={mode === 'text'}
        title="文本视图"
        onClick={() => onChange('text')}
        className={itemClass(mode === 'text')}
      >
        <FileText aria-hidden className="size-3.5" />
        文本
      </button>
      <button
        type="button"
        data-testid="view-tree"
        aria-pressed={mode === 'tree'}
        title="树结构视图"
        onClick={() => onChange('tree')}
        className={itemClass(mode === 'tree')}
      >
        <ListTree aria-hidden className="size-3.5" />
        树形
      </button>
    </div>
  );
}

export function JsonFormatter({ toolId }: ToolProps) {
  // —— 多 Tab 工作区(store 为模块级单例,状态跨挂载保留)——
  const docs = useJsonFormatterStore((s) => s.docs);
  const activeDocId = useJsonFormatterStore((s) => s.activeDocId);
  const history = useJsonFormatterStore((s) => s.history);
  const ready = useJsonFormatterStore((s) => s.ready);
  const userTouched = useJsonFormatterStore((s) => s.userTouched);
  const newDoc = useJsonFormatterStore((s) => s.newDoc);
  const closeDoc = useJsonFormatterStore((s) => s.closeDoc);
  const switchDoc = useJsonFormatterStore((s) => s.switchDoc);
  const setDocContent = useJsonFormatterStore((s) => s.setDocContent);
  const recordHistory = useJsonFormatterStore((s) => s.recordHistory);

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );
  const text = activeDoc?.content ?? '';
  const setText = useCallback(
    (value: string) => {
      if (activeDoc) setDocContent(activeDoc.id, value);
    },
    [activeDoc, setDocContent],
  );

  const [indent, setIndent] = useState(2);
  const [output, setOutput] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<EditorLanguage>('json');
  const [meta, setMeta] = useState<OutputMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<OutputViewMode>('text');
  const [historyOpen, setHistoryOpen] = useState(false);

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

  /** 关闭文档:先把非空内容快照进历史(最近文档语义),再关闭 */
  function handleCloseDoc(id: string) {
    const target = docs.find((d) => d.id === id);
    if (target && target.content.trim()) recordHistory(target.content);
    closeDoc(id);
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
        setOutput(formatError(e, '格式化失败: '));
        setMeta(null);
        setOutputLanguage('plaintext');
      } finally {
        if (!auto) setLoading(false);
      }
    },
    // formatOnFrontend 为组件内纯函数,仅依赖 indent(已含于依赖数组)
    [toolId, text, indent, recordHistory],
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

  // 「发送到…」接收端:成为激活工具时注入当前文档
  useToolHandoff(toolId, (incoming) => {
    if (activeDocId) setDocContent(activeDocId, incoming);
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
      setOutput(formatError(e, '解析失败: '));
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
      setOutput(formatError(e, '排序失败: '));
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
      setOutput(formatError(e, `转换失败(${language}): `));
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
          throw new Error(`不支持的格式: ${String(exhaustive)}`);
        }
      }
      setOutput(converted);
      setOutputLanguage(DATA_OUTPUT_LANGUAGE[format]);
      setMeta(null);
      recordHistory(text);
    } catch (e) {
      setOutput(formatError(e, `转换失败(${format}): `));
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
        { id: 'format', label: '格式化 JSON', onSelect: () => void runFormat() },
        { id: 'minify', label: '压缩 JSON', onSelect: () => handleQuickAction('minify') },
        { id: 'sort-asc', label: '键排序 A-Z', onSelect: () => handleSort('alpha', false) },
        { id: 'sort-desc', label: '键排序 Z-A', onSelect: () => handleSort('alpha', true) },
        {
          id: 'to-typescript',
          label: '转换为 TypeScript 类型',
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
    <div className="flex h-full flex-col" data-testid="json-formatter">
      {/* —— 多文档 Tab 栏 —— */}
      <div
        className="flex items-center gap-0.5 border-b border-border px-1 py-0.5"
        data-testid="doc-tabs"
      >
        <div
          role="tablist"
          aria-label="JSON 文档"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {docs.map((doc) => {
            const active = doc.id === activeDocId;
            return (
              <div
                key={doc.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                data-testid="doc-tab"
                onClick={() => switchDoc(doc.id)}
                onKeyDown={(e) => handleTabKeyDown(e, doc.id)}
                onMouseDown={(e) => {
                  // 中键关闭(仿 VSCode):preventDefault 抑制浏览器自动滚动
                  if (e.button === 1) {
                    e.preventDefault();
                    handleCloseDoc(doc.id);
                  }
                }}
                className={cn(
                  'group flex min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded border border-transparent px-2 py-1 text-xs outline-none transition-colors',
                  'focus-visible:ring-1 focus-visible:ring-ring',
                  active
                    ? 'border-border bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                <FileJson aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{doc.title}</span>
                <button
                  type="button"
                  aria-label={`关闭 ${doc.title}`}
                  title="关闭"
                  data-testid="doc-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseDoc(doc.id);
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            data-testid="doc-add"
            title="新建 JSON 文档"
            aria-label="新建 JSON 文档"
            onClick={() => newDoc()}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入(JSON / XML)"
            language={isXmlInput ? 'xml' : 'json'}
            value={text}
            onChange={setText}
            className="h-full"
            data-testid="input"
            searchAnchor="json_formatter:input"
            contextMenuSections={jsonMenuSections}
            actions={
              <>
                <Select value={String(indent)} onValueChange={(v) => setIndent(Number(v))}>
                  <SelectTrigger id="indent-select" className="h-7 w-16 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="6">6</SelectItem>
                    <SelectItem value="8">8</SelectItem>
                  </SelectContent>
                </Select>
                <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                <ActionButton
                  testId="btn-format"
                  onClick={() => void runFormat()}
                  disabled={disabled}
                >
                  <Wand2 aria-hidden className="size-3.5" />
                  {loading ? '格式化中' : '格式化'}
                </ActionButton>
                <ActionButton
                  testId="btn-minify"
                  onClick={() => handleQuickAction('minify')}
                  disabled={disabled}
                >
                  <Minimize2 aria-hidden className="size-3.5" />
                  压缩
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
                      排序
                      <ChevronDown aria-hidden className="size-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-[420px] w-52 overflow-y-auto">
                    {SORT_MENU_GROUPS.map((group, gi) => (
                      <div key={group.label} data-testid={gi === 0 ? 'sort-menu' : undefined}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {group.label}
                        </DropdownMenuLabel>
                        {group.items.map((item) => (
                          <DropdownMenuItem
                            key={item.label}
                            data-testid={`sort-${item.mode}-${item.descending ? 'desc' : 'asc'}`}
                            disabled={disabled}
                            onSelect={() => handleSort(item.mode, item.descending)}
                          >
                            {item.mode === 'reverse' || item.mode === 'random' ? (
                              <ArrowDownAZ aria-hidden className="mr-2 size-3.5 opacity-50" />
                            ) : null}
                            {item.label}
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
                      转换为
                      <ChevronDown aria-hidden className="size-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-[460px] overflow-y-auto">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      实体类
                    </DropdownMenuLabel>
                    {ENTITY_LANGUAGE_ITEMS.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        data-testid={`convert-${item.id}`}
                        disabled={disabled}
                        onSelect={() => handleConvert(item.id)}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      数据格式
                    </DropdownMenuLabel>
                    {DATA_FORMAT_ITEMS.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        data-testid={`convert-${item.id}`}
                        disabled={disabled}
                        onSelect={() => handleConvertFormat(item.id)}
                      >
                        {item.label}
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
                      历史
                      {history.length > 0 && (
                        <span className="rounded bg-muted px-1 text-[10px]">
                          {Math.min(history.length, MAX_HISTORY_ITEMS)}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-96 p-0" data-testid="history-popover">
                    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                      <span className="flex-1 text-xs font-semibold">历史记录</span>
                      <ActionButton
                        testId="history-save-current"
                        onClick={() => {
                          if (text.trim()) recordHistory(text);
                        }}
                      >
                        <Save aria-hidden className="size-3.5" />
                        保存当前
                      </ActionButton>
                      <ActionButton
                        testId="history-clear"
                        onClick={() => useJsonFormatterStore.getState().clearHistory()}
                        disabled={history.length === 0}
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                        清空
                      </ActionButton>
                    </div>
                    {history.length === 0 ? (
                      <div
                        className="flex h-24 items-center justify-center text-xs text-muted-foreground"
                        data-testid="history-empty"
                      >
                        暂无历史记录 · 输入合法 JSON 后自动保存,关闭文档时快照
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
                                {item.content.length} 字符
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label="删除该条历史"
                              data-testid="history-item-remove"
                              onClick={() =>
                                useJsonFormatterStore.getState().removeHistory(item.id)
                              }
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <X aria-hidden className="size-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </PopoverContent>
                </Popover>
                {isXmlInput && (
                  <span className="text-xs text-muted-foreground">
                    已识别 XML,将自动转换为 JSON
                  </span>
                )}
              </>
            }
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          {viewMode === 'tree' ? (
            <div className="flex h-full flex-col bg-background-layer">
              <div className="flex items-center gap-2 border-b border-border px-2 py-1">
                <span className="flex-1 text-xs font-medium text-muted-foreground">输出</span>
                {meta && (
                  <span className="text-xs text-muted-foreground">
                    {meta.input_bytes} → {meta.output_bytes} 字节 · {meta.duration_ms}ms
                  </span>
                )}
                <OutputViewToggle mode={viewMode} onChange={setViewMode} />
                <CopyAction text={output} testId="output-copy-tree" />
                <SendToMenu text={output} currentToolId={toolId} testId="output-send-tree" />
              </div>
              {!output.trim() ? (
                <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                  暂无输出内容
                </div>
              ) : treeParsing ? (
                <div
                  className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
                  role="status"
                >
                  正在构建树视图…
                </div>
              ) : treeValue.ok ? (
                <JsonTreeView
                  value={treeValue.value}
                  className="flex-1 bg-background-layer"
                  data-testid="output-tree"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                  当前输出不是有效的 JSON / XML,无法生成树结构
                </div>
              )}
            </div>
          ) : (
            <CodeEditor
              readOnly
              title="输出"
              language={outputLanguage}
              value={output}
              className="h-full"
              data-testid="output"
              searchAnchor="json_formatter:output"
              actions={
                <>
                  <OutputViewToggle mode={viewMode} onChange={setViewMode} />
                  {meta && (
                    <span className="text-xs text-muted-foreground">
                      {meta.input_bytes} → {meta.output_bytes} 字节 · {meta.duration_ms}ms
                    </span>
                  )}
                  <CopyAction text={output} testId="output-copy" />
                  <SendToMenu text={output} currentToolId={toolId} testId="output-send" />
                </>
              }
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
