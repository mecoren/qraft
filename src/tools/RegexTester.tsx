/**
 * 正则表达式测试工具(Regex Lab)—— regex101 风格实时工作区
 *
 * 对 regex101.com 的复刻(本地引擎为 Rust regex,无回溯断言/后向引用):
 * - 顶部正则输入条:`/pattern/flags` 形态,flags 点击切换;实时编译,
 *   错误内联展示于输入条下方(含列号)。
 * - 模式页签(对齐 regex101 的 Editor 页签):
 *   · 匹配 Match:测试文本编辑器(命中区间高亮装饰)+ 匹配信息列表
 *   · 替换 Substitution:替换模板编辑器 + 实时替换结果
 *   · 单元测试 Unit Tests:用例集(文本 + 期望)一键运行
 *   · 工具 Tools:调试器(匹配步骤回放)与代码生成器(6 语言)
 * - 右侧面板:逐 token 解释树(自动生成)+ 快速参考(可搜索,点击插入)
 *
 * 工程要点:
 * - 实时性:输入防抖 200ms + useDeferredValue,一次 regex_live 往返返回
 *   全量数据(匹配/解释/替换/分组),不做多次 IPC。
 * - 高亮:Monaco decorations 按匹配区间着色;hover 匹配条目/分组时
 *   叠加醒目装饰。区间来自 Rust 端字节偏移,这里换算为编辑器字符偏移。
 * - 持久化:工作区(pattern/flags/文本/模板/用例)经 localStorage 记忆,
 *   与 JsonFormatter 的会话恢复语义一致(轻量数据,不走 config 管道)。
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bug,
  Code2,
  Copy,
  FlaskConical,
  Info,
  ListChecks,
  Play,
  Plus,
  Regex,
  Replace,
  Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { cn } from '@/lib/utils';
import type { ToolProps } from './registry';
import { ExplainPanel } from './regex-lab/explain-panel';
import { QuickReferencePanel } from './regex-lab/quick-reference-panel';
import { MatchInfoPanel } from './regex-lab/match-info-panel';
import type {
  CodegenLanguage,
  RegexDebugOutput,
  RegexLiveOutput,
  RegexTestCase,
  RegexTestsOutput,
  RegexMode,
} from './regex-lab/types';

// ============================================================
// 本地持久化(轻量会话记忆)
// ============================================================

const STORAGE_KEY = 'qraft.regex_lab.session.v1';

interface RegexSession {
  pattern: string;
  flags: string;
  testText: string;
  substitution: string;
  mode: RegexMode;
  cases: RegexTestCase[];
}

const DEFAULT_SESSION: RegexSession = {
  pattern: '',
  flags: 'g',
  testText: '',
  substitution: '',
  mode: 'match',
  cases: [],
};

function loadSession(): RegexSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<RegexSession>;
    return {
      ...DEFAULT_SESSION,
      ...parsed,
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

/** 防抖持久化:失败静默(隐私模式/存储满),不干扰交互 */
function saveSession(s: RegexSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage 不可用时放弃记忆 */
  }
}

// ============================================================
// flags 定义(标题/说明走 i18n)
// ============================================================

const FLAG_CHARS = ['g', 'i', 'm', 's', 'x', 'U', 'u', 'y', 'R'] as const;

// ============================================================
// 主组件
// ============================================================

export function RegexTester({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [session, setSession] = useState<RegexSession>(loadSession);
  const { pattern, flags, testText, substitution, mode, cases } = session;

  const patch = useCallback((p: Partial<RegexSession>) => {
    setSession((s) => {
      const next = { ...s, ...p };
      saveSession(next);
      return next;
    });
  }, []);

  // —— 实时计算:防抖 200ms 后请求 regex_live ——
  const [live, setLive] = useState<RegexLiveOutput | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const lastRequestId = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deferredAll = useDeferredValue(
    `${pattern}\u{0}${flags}\u{0}${testText}\u{0}${substitution}`,
  );
  const [dPattern, dFlags, dText, dSub] = useMemo(() => deferredAll.split('\u{0}'), [deferredAll]);

  useEffect(() => {
    // 空输入不打扰后端(live 置空由派生值 hasInput 控制,不在 effect 内 setState)
    if (!dPattern && !dText) {
      return undefined;
    }
    const id = ++lastRequestId.current;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setLiveLoading(true);
      try {
        const out = await invokeCommand<RegexLiveOutput>('regex_live', {
          input: { pattern: dPattern, flags: dFlags, testText: dText, substitution: dSub },
        });
        if (id === lastRequestId.current) setLive(out);
      } catch {
        if (id === lastRequestId.current) {
          setLive({
            ok: false,
            compileError: {
              column: 0,
              title: 'IPC error',
              message: t('tools.regex_tester.ipc_error'),
            },
            matches: [],
            matchCount: 0,
            truncatedText: false,
            matchesTruncated: false,
            substitutionResult: null,
            explain: [],
            groups: [],
            durationMs: 0,
          });
        }
      } finally {
        if (id === lastRequestId.current) setLiveLoading(false);
      }
    }, 200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [dPattern, dFlags, dText, dSub, t, toolId]);

  // 输入全空时视为"无工作区数据"(派生,替代 effect 内清空 state)
  const hasInput = Boolean(pattern) || Boolean(testText);
  const effectiveLive = hasInput ? live : null;
  const compileError = effectiveLive && !effectiveLive.ok ? effectiveLive.compileError : null;

  // —— 匹配条目 hover 联动:提升到主组件,编辑器与匹配面板共享 ——
  const [hoverRange, setHoverRange] = useState<[number, number] | null>(null);

  // —— 模式页签切换 ——
  const setMode = (m: RegexMode) => patch({ mode: m });

  // —— 快速参考插入:写到 pattern 输入框光标处(而非简单追加)——
  const patternInputRef = useRef<HTMLInputElement | null>(null);
  const insertToPattern = useCallback((token: string, cursorOffset: number) => {
    const input = patternInputRef.current;
    setSession((s) => {
      const selStart = input?.selectionStart ?? s.pattern.length;
      const selEnd = input?.selectionEnd ?? selStart;
      // 选中区间整体被替换;未选中则原位插入
      const nextPattern = s.pattern.slice(0, selStart) + token + s.pattern.slice(selEnd);
      // 请求把光标放到 token 内部光标位(典型:括号内)
      const caret = selStart + Math.min(cursorOffset, token.length);
      requestAnimationFrame(() => {
        if (input) {
          input.focus();
          input.setSelectionRange(caret, caret);
        }
      });
      saveSession({ ...s, pattern: nextPattern });
      return { ...s, pattern: nextPattern };
    });
  }, []);

  // —— 解释面板 hover → pattern 输入框内选区联动(选中对应 token 便于定位)——
  const onExplainHover = useCallback((span: [number, number] | null) => {
    const input = patternInputRef.current;
    if (!input) return;
    if (span) {
      input.focus();
      input.setSelectionRange(span[0], span[1]);
    } else if (input.selectionStart !== input.selectionEnd) {
      // 离开时折叠选区(不抢焦点:不调 focus)
      input.setSelectionRange(input.selectionStart, input.selectionStart);
    }
  }, []);

  const MODE_TABS: Array<{ id: RegexMode; icon: typeof Regex; key: string }> = [
    { id: 'match', icon: Regex, key: 'tab_match' },
    { id: 'substitution', icon: Replace, key: 'tab_substitution' },
    { id: 'tests', icon: FlaskConical, key: 'tab_tests' },
    { id: 'tools', icon: Code2, key: 'tab_tools' },
  ];

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="regex-tester"
    >
      {/* ============ 顶部:正则输入条(regex101 的 /pattern/flags)============ */}
      <div className="border-b border-border px-3 py-2" data-search-anchor="regex_tester:config">
        <div className="flex items-center gap-2">
          <Regex aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="relative flex min-w-0 flex-1 items-center rounded-md border border-input bg-background focus-within:border-ring">
            <span className="pl-2 text-sm text-muted-foreground select-none">/</span>
            <input
              ref={patternInputRef}
              value={pattern}
              onChange={(e) => patch({ pattern: e.target.value })}
              placeholder={t('tools.regex_tester.pattern_placeholder')}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60"
              data-testid="pattern"
              aria-label={t('tools.regex_tester.pattern_label')}
            />
            <span className="text-sm text-muted-foreground select-none">/</span>
            <button
              type="button"
              data-testid="flags-bar"
              className="flex items-center gap-0.5 rounded-r-md px-1.5 py-1.5 font-mono text-sm"
              title={t('tools.regex_tester.flags_hint')}
              aria-label={t('tools.regex_tester.flags_label')}
            >
              {flags
                .split('')
                .filter((f, i, arr) => arr.indexOf(f) === i)
                .map((f) => (
                  <span
                    key={f}
                    className="rounded px-0.5 text-xs text-primary"
                    title={t(`tools.regex_tester.flag_${f}`)}
                  >
                    {f}
                  </span>
                ))}
            </button>
          </div>

          {/* flags 快捷键按钮组 */}
          <div
            className="flex shrink-0 items-center gap-0.5"
            role="group"
            aria-label={t('tools.regex_tester.flags_label')}
            data-testid="flags-group"
          >
            {FLAG_CHARS.map((f) => {
              const active = flags.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  data-testid={`flag-${f}`}
                  data-active={active}
                  title={t(`tools.regex_tester.flag_${f}`)}
                  aria-pressed={active}
                  onClick={() => patch({ flags: active ? flags.replace(f, '') : flags + f })}
                  className={cn(
                    'size-6 rounded font-mono text-xs transition-colors',
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>

          {/* 状态徽章:匹配数 + 耗时 + 截断提示 */}
          <div className="shrink-0 text-xs text-muted-foreground" data-testid="status-badge">
            {liveLoading
              ? t('tools.regex_tester.computing')
              : effectiveLive?.ok
                ? `${t('tools.regex_tester.match_count', { count: effectiveLive.matchCount })} · ${effectiveLive.durationMs}ms`
                : ''}
            {effectiveLive?.ok &&
              (effectiveLive.matchesTruncated || effectiveLive.truncatedText) && (
                <span
                  className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-warning-foreground"
                  title={t('tools.regex_tester.truncated_hint')}
                  data-testid="truncated-badge"
                >
                  {t('tools.regex_tester.truncated_badge')}
                </span>
              )}
          </div>
        </div>

        {/* 编译错误内联条(点击定位到出错字符) */}
        {compileError && (
          <button
            type="button"
            role="alert"
            data-testid="compile-error"
            className="mt-1.5 flex w-full items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/15"
            title={t('tools.regex_tester.error_jump_hint')}
            onClick={() => {
              const input = patternInputRef.current;
              if (!input) return;
              input.focus();
              // 后端给出出错位置的字符偏移:选中该字符便于修正
              const at = Math.min(compileError.column, pattern.length);
              input.setSelectionRange(at, Math.min(at + 1, pattern.length));
            }}
          >
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            <span className="font-semibold">{compileError.title}</span>
            <span className="min-w-0 flex-1 truncate">{compileError.message}</span>
            {compileError.column > 0 && (
              <span className="shrink-0 font-mono">@{compileError.column}</span>
            )}
          </button>
        )}
      </div>

      {/* ============ 主体三栏:编辑器 | 模式工作区 | 解释+参考 ============ */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* —— 左:测试文本(带命中高亮)—— */}
        <ResizablePanel defaultSize={40} minSize={20} className="min-h-0 min-w-0">
          <TestTextEditor
            value={testText}
            onChange={(v) => patch({ testText: v })}
            live={effectiveLive?.ok ? effectiveLive : null}
            compileError={compileError}
            onModeChange={setMode}
            hoverRange={hoverRange}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* —— 中:模式页签工作区 —— */}
        <ResizablePanel defaultSize={36} minSize={20} className="min-h-0 min-w-0">
          <div
            className="flex h-full min-h-0 flex-col border-x border-border"
            data-testid="mode-workspace"
          >
            {/* 页签头 */}
            <div
              className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5"
              role="tablist"
              aria-label={t('tools.regex_tester.mode_tabs_aria')}
            >
              {MODE_TABS.map(({ id, icon: Icon, key }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  data-testid={`mode-${id}`}
                  data-active={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'flex items-center gap-1 rounded-t px-2.5 py-1.5 text-xs transition-colors',
                    mode === id
                      ? 'border-b-2 border-primary font-medium text-foreground'
                      : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {t(`tools.regex_tester.${key}`)}
                </button>
              ))}
            </div>

            {/* 页签体 */}
            {mode === 'match' && (
              <div
                className="flex min-h-0 flex-1 flex-col"
                data-testid="pane-match"
                data-search-anchor="regex_tester:output"
              >
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
                  <ListChecks aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    {t('tools.regex_tester.match_information')}
                  </span>
                  {effectiveLive?.ok && effectiveLive.matchesTruncated && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="match-list-truncated"
                    >
                      {t('tools.regex_tester.showing_first', {
                        shown: effectiveLive.matches.length,
                        total: effectiveLive.matchCount,
                      })}
                    </span>
                  )}
                </div>
                <MatchInfoPanel
                  output={effectiveLive?.ok ? effectiveLive : null}
                  onHoverRange={setHoverRange}
                />
              </div>
            )}

            {mode === 'substitution' && (
              <SubstitutionPane
                substitution={substitution}
                live={effectiveLive?.ok ? effectiveLive : null}
                onChange={(v) => patch({ substitution: v })}
              />
            )}

            {mode === 'tests' && (
              <TestsPane
                cases={cases}
                pattern={pattern}
                flags={flags}
                compileError={compileError}
                onChange={(cases) => patch({ cases })}
              />
            )}

            {mode === 'tools' && (
              <ToolsPane
                pattern={pattern}
                flags={flags}
                testText={testText}
                substitution={substitution}
                compileError={compileError}
              />
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* —— 右:解释树 + 快速参考 —— */}
        <ResizablePanel
          defaultSize={24}
          minSize={16}
          className="min-h-0 min-w-0 border-l border-border"
        >
          <div className="flex h-full min-h-0 flex-col" data-testid="explain-panel">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
              <Info aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium">{t('tools.regex_tester.explanation')}</span>
            </div>
            <ScrollArea className="min-h-0 flex-[1.2]">
              <ExplainPanel
                nodes={effectiveLive?.ok ? effectiveLive.explain : []}
                onHoverSpan={onExplainHover}
              />
            </ScrollArea>
            <div className="min-h-0 flex-1 border-t border-border">
              <QuickReferencePanel onInsert={insertToPattern} />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ============================================================
// 左栏:测试文本编辑器(Monaco 装饰高亮)
// ============================================================

/** Monaco 编辑器实例的最小类型面(避免引入完整 editor 类型负担) */
interface MonacoLikeEditor {
  createDecorationsCollection: (decorations?: unknown[]) => {
    set: (decorations: unknown[]) => void;
    clear: () => void;
  };
  getModel: () => {
    getPositionAt: (offset: number) => {
      lineNumber: number;
      column: number;
    };
  } | null;
}

function TestTextEditor({
  value,
  onChange,
  live,
  compileError,
  onModeChange,
  hoverRange,
}: {
  value: string;
  onChange: (v: string) => void;
  live: RegexLiveOutput | null;
  compileError: { title: string; message: string; column: number } | null;
  onModeChange: (m: RegexMode) => void;
  /** 匹配面板 hover 联动的区间(提升状态,由父组件管理) */
  hoverRange: [number, number] | null;
}): JSX.Element {
  const { t } = useTranslation();
  const editorRef = useRef<MonacoLikeEditor | null>(null);
  const decorationsRef = useRef<ReturnType<MonacoLikeEditor['createDecorationsCollection']> | null>(
    null,
  );

  // Monaco 装饰:整匹高亮 + hover 匹配叠加。
  // createDecorationsCollection 挂在编辑器实例上(非 monaco.editor 命名空间),
  // 且 set() 支持增量替换,复用同一 collection 避免整批重建。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const decorations: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      options: { inlineClassName: string };
    }> = [];

    if (live) {
      for (const m of live.matches) {
        const range = charRangeToMonaco(editor, m.range[0], m.range[1]);
        if (range) {
          decorations.push({ range, options: { inlineClassName: 'regex-lab-match' } });
        }
      }
    }
    if (hoverRange) {
      const range = charRangeToMonaco(editor, hoverRange[0], hoverRange[1]);
      if (range) {
        decorations.push({ range, options: { inlineClassName: 'regex-lab-match-hover' } });
      }
    }

    if (decorationsRef.current) {
      decorationsRef.current.set(decorations);
    } else {
      decorationsRef.current = editor.createDecorationsCollection(decorations);
    }
  }, [live, hoverRange]);

  // 文本被清空/组件卸载时清理装饰
  useEffect(
    () => () => {
      decorationsRef.current?.clear();
      decorationsRef.current = null;
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CodeEditor
        title={t('tools.regex_tester.text_title')}
        placeholder={t('tools.regex_tester.text_placeholder')}
        value={value}
        onChange={onChange}
        language="plaintext"
        className="h-full rounded-none border-0 border-r"
        data-testid="input"
        showStatusBar={false}
        searchAnchor="regex_tester:input"
        onMount={(ed) => {
          editorRef.current = ed as unknown as MonacoLikeEditor;
        }}
        statusBarRight={
          <span className="text-xs text-muted-foreground" data-testid="text-stats">
            {live
              ? t('tools.regex_tester.match_count', { count: live.matchCount })
              : compileError
                ? t('tools.regex_tester.compile_error_short')
                : ''}
          </span>
        }
      />
      {/* 截断提示(后端护栏:超长文本只预览前 1MB) */}
      {live?.truncatedText && (
        <div
          className="border-t border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning-foreground"
          data-testid="text-truncated-notice"
        >
          {t('tools.regex_tester.text_truncated')}
        </div>
      )}
      {/* 模式切换快捷提示(空态引导,与 regex101 的空态文案一致) */}
      {value === '' && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t('tools.regex_tester.empty_state')}{' '}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => onModeChange('tests')}
          >
            {t('tools.regex_tester.tab_tests')}
          </button>
        </div>
      )}
      <style>{`
        .regex-lab-match { background: color-mix(in srgb, #22c55e 25%, transparent); border-radius: 2px; }
        .regex-lab-match-hover { background: color-mix(in srgb, #f59e0b 40%, transparent); border-radius: 2px; outline: 1px solid #f59e0b; }
      `}</style>
    </div>
  );
}

/**
 * 字符偏移区间 → Monaco 位置区间。
 * Monaco 模型按 UTF-16 code unit 计数,与 JS string index / 后端字符偏移
 * 语义一致,直接经 model.getPositionAt 换算,免去逐字符扫描。
 * 返回 null 表示模型尚未就绪(挂载竞态,下次 effect 重试)。
 */
function charRangeToMonaco(
  editor: MonacoLikeEditor,
  start: number,
  end: number,
): {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
} | null {
  const model = editor.getModel();
  if (!model) return null;
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(Math.max(end, start));
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  };
}

// ============================================================
// 页签:替换(Substitution)
// ============================================================

function SubstitutionPane({
  substitution,
  live,
  onChange,
}: {
  substitution: string;
  live: RegexLiveOutput | null;
  onChange: (v: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pane-substitution">
      <div className="border-b border-border p-1.5">
        <Input
          value={substitution}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('tools.regex_tester.substitution_placeholder')}
          spellCheck={false}
          className="h-7 text-xs"
          data-testid="substitution-input"
          aria-label={t('tools.regex_tester.substitution_label')}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground">
          {t('tools.regex_tester.substitution_result')}
          {live?.substitutionResult && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
              onClick={() => void copyTextWithFeedback(live.substitutionResult ?? '')}
              data-testid="copy-substitution"
              title={t('tools.regex_tester.copy')}
            >
              <Copy aria-hidden className="size-3" />
            </button>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <pre
            className="whitespace-pre-wrap break-words p-2 font-mono text-xs"
            data-testid="substitution-output"
          >
            {live?.substitutionResult ?? ''}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}

// ============================================================
// 页签:单元测试(Unit Tests)
// ============================================================

function TestsPane({
  cases,
  pattern,
  flags,
  compileError,
  onChange,
}: {
  cases: RegexTestCase[];
  pattern: string;
  flags: string;
  compileError: { title: string; message: string } | null;
  onChange: (cases: RegexTestCase[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [results, setResults] = useState<RegexTestsOutput | null>(null);
  const [running, setRunning] = useState(false);
  // 确认交互沿用 JsonFormatter 方案:受控 open 锚定在触发按钮旁的小型 Popover,
  // 不用居中 modal(轻量防误触、不打断浏览);清空用布尔、单条删除按索引导 index 单开
  const [clearOpen, setClearOpen] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  const addCase = () =>
    onChange([
      ...cases,
      {
        description: `${t('tools.regex_tester.test_case')} ${cases.length + 1}`,
        text: '',
        shouldMatch: true,
        expectedMatch: null,
        expectedGroups: [],
      },
    ]);

  const run = async () => {
    setRunning(true);
    try {
      const out = await invokeCommand<RegexTestsOutput>('regex_tests', {
        pattern,
        flags,
        cases,
      });
      setResults(out);
    } catch {
      setResults(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="pane-tests"
      onKeyDown={(e) => {
        // Ctrl/Cmd+Enter 快捷运行用例(测试面板聚焦时生效)
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && cases.length > 0 && !running) {
          e.preventDefault();
          void run();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          onClick={addCase}
          data-testid="add-test-case"
        >
          <Plus aria-hidden className="size-3" />
          {t('tools.regex_tester.add_case')}
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void run()}
          disabled={running || cases.length === 0}
          data-testid="run-tests"
          title={t('tools.regex_tester.run_tests_hint')}
        >
          <Play aria-hidden className="size-3" />
          {running ? t('tools.regex_tester.testing') : t('tools.regex_tester.run_tests')}
        </Button>
        {results?.ok && (
          <span className="text-xs text-muted-foreground" data-testid="tests-summary">
            {t('tools.regex_tester.tests_passed', { count: results.passed })} ·{' '}
            {t('tools.regex_tester.tests_failed', { count: results.failed })}
          </span>
        )}
        {cases.length > 0 && (
          <Popover open={clearOpen} onOpenChange={setClearOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2 text-xs text-muted-foreground"
                data-testid="clear-tests"
              >
                <Trash2 aria-hidden className="size-3" />
                {t('tools.regex_tester.clear_cases')}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-56 p-3"
              data-testid="clear-tests-confirm"
            >
              <p className="text-xs font-semibold">
                {t('tools.regex_tester.clear_cases_confirm_title')}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t('tools.regex_tester.clear_cases_confirm_desc', { count: cases.length })}
              </p>
              <div className="mt-2.5 flex justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setClearOpen(false)}
                  data-testid="clear-tests-confirm-cancel"
                >
                  {t('tools.regex_tester.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    onChange([]);
                    setResults(null);
                    setClearOpen(false);
                  }}
                  data-testid="clear-tests-confirm-ok"
                >
                  {t('tools.regex_tester.confirm')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {compileError && (
        <div className="border-b border-border px-2 py-1.5 text-xs text-destructive" role="alert">
          {t('tools.regex_tester.fix_pattern_first')}: {compileError.message}
        </div>
      )}

      {cases.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          {t('tools.regex_tester.tests_empty')}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-2 p-2">
            {cases.map((c, i) => {
              const r = results?.results[i];
              return (
                <li
                  // eslint-disable-next-line react-x/no-array-index-key -- 用例可被增删改排序,无稳定业务主键;索引作 key 与用例数组生命周期一致
                  key={i}
                  className="rounded-md border border-border p-2"
                  data-testid={`test-case-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={c.description}
                      onChange={(e) => {
                        const next = [...cases];
                        next[i] = { ...c, description: e.target.value };
                        onChange(next);
                      }}
                      className="h-6 flex-1 text-xs"
                      aria-label={t('tools.regex_tester.case_description')}
                    />
                    {r && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                          r.passed
                            ? 'bg-green-500/15 text-green-600'
                            : 'bg-destructive/15 text-destructive',
                        )}
                        data-testid={`test-result-${i}`}
                      >
                        {r.passed ? '✓' : `✗ ${r.reason}`}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={c.text}
                    onChange={(e) => {
                      const next = [...cases];
                      next[i] = { ...c, text: e.target.value };
                      onChange(next);
                    }}
                    placeholder={t('tools.regex_tester.case_text_placeholder')}
                    rows={2}
                    className="mt-1.5 w-full rounded-md border border-input bg-background p-1.5 text-xs outline-none focus:border-ring"
                    data-testid={`case-text-${i}`}
                  />
                  <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={c.shouldMatch}
                      onChange={(e) => {
                        const next = [...cases];
                        next[i] = { ...c, shouldMatch: e.target.checked };
                        onChange(next);
                      }}
                      data-testid={`case-expect-${i}`}
                    />
                    {t('tools.regex_tester.case_should_match')}
                  </label>
                  <div className="mt-1.5">
                    <Popover
                      open={removeIndex === i}
                      onOpenChange={(o) => setRemoveIndex(o ? i : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-xs text-muted-foreground"
                          data-testid={`remove-case-${i}`}
                        >
                          <Trash2 aria-hidden className="size-3" />
                          {t('tools.regex_tester.remove_case')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        side="bottom"
                        className="w-56 p-3"
                        data-testid={`remove-case-${i}-confirm`}
                      >
                        <p className="text-xs font-semibold">
                          {t('tools.regex_tester.remove_case_confirm_title')}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {t('tools.regex_tester.remove_case_confirm_desc')}
                        </p>
                        <div className="mt-2.5 flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setRemoveIndex(null)}
                            data-testid={`remove-case-${i}-confirm-cancel`}
                          >
                            {t('tools.regex_tester.cancel')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => {
                              onChange(cases.filter((_, j) => j !== i));
                              setRemoveIndex(null);
                            }}
                            data-testid={`remove-case-${i}-confirm-ok`}
                          >
                            {t('tools.regex_tester.confirm')}
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

// ============================================================
// 页签:工具(调试器 + 代码生成器)
// ============================================================

const CODEGEN_LANGS: Array<{ id: CodegenLanguage; label: string }> = [
  { id: 'rust', label: 'Rust' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
];

function ToolsPane({
  pattern,
  flags,
  testText,
  substitution,
  compileError,
}: {
  pattern: string;
  flags: string;
  testText: string;
  substitution: string;
  compileError: { title: string; message: string } | null;
}): JSX.Element {
  const { t } = useTranslation();
  const [sub, setSub] = useState<'debugger' | 'codegen'>('debugger');
  const [debug, setDebug] = useState<RegexDebugOutput | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [lang, setLang] = useState<CodegenLanguage>('rust');
  const [code, setCode] = useState('');

  const runDebugger = async () => {
    setDebugLoading(true);
    try {
      const out = await invokeCommand<RegexDebugOutput>('regex_debug', {
        pattern,
        flags,
        text: testText,
      });
      setDebug(out);
    } catch {
      setDebug(null);
    } finally {
      setDebugLoading(false);
    }
  };

  const generate = async () => {
    try {
      const out = await invokeCommand<{ language: string; code: string }>('regex_codegen', {
        language: lang,
        pattern,
        flags,
        substitution: substitution || null,
      });
      setCode(out.code);
    } catch {
      setCode('');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pane-tools">
      {/* 工具子页签 */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 pt-1">
        <button
          type="button"
          data-testid="subtool-debugger"
          data-active={sub === 'debugger'}
          onClick={() => setSub('debugger')}
          className={cn(
            'flex items-center gap-1 rounded-t px-2 py-1 text-xs',
            sub === 'debugger'
              ? 'border-b-2 border-primary font-medium'
              : 'border-b-2 border-transparent text-muted-foreground',
          )}
        >
          <Bug aria-hidden className="size-3.5" />
          {t('tools.regex_tester.debugger')}
        </button>
        <button
          type="button"
          data-testid="subtool-codegen"
          data-active={sub === 'codegen'}
          onClick={() => setSub('codegen')}
          className={cn(
            'flex items-center gap-1 rounded-t px-2 py-1 text-xs',
            sub === 'codegen'
              ? 'border-b-2 border-primary font-medium'
              : 'border-b-2 border-transparent text-muted-foreground',
          )}
        >
          <Code2 aria-hidden className="size-3.5" />
          {t('tools.regex_tester.code_generator')}
        </button>
      </div>

      {sub === 'debugger' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 p-1.5">
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => void runDebugger()}
              disabled={debugLoading || !pattern || !testText}
              data-testid="run-debugger"
            >
              <Play aria-hidden className="size-3" />
              {debugLoading
                ? t('tools.regex_tester.computing')
                : t('tools.regex_tester.run_debugger')}
            </Button>
            {compileError && (
              <span className="truncate text-xs text-destructive">{compileError.message}</span>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {debug?.ok ? (
              <ol className="space-y-1 p-2" data-testid="debug-steps">
                {debug.steps.map((s, i) => (
                  <li
                    // eslint-disable-next-line react-x/no-array-index-key -- 回放步骤为一次性快照列表,索引即序号语义
                    key={i}
                    className={cn(
                      'rounded border px-2 py-1 font-mono text-xs',
                      s.outcome === 'match'
                        ? 'border-green-500/40 bg-green-500/10'
                        : 'border-border bg-muted/40',
                    )}
                  >
                    <span className="text-muted-foreground">@{s.start}</span>{' '}
                    {s.outcome === 'match' ? (
                      <>
                        <span className="text-green-600">match</span> →{' '}
                        <span className="rounded bg-muted px-1">{s.matchedText}</span>(到 @{s.end})
                      </>
                    ) : (
                      <span className="text-muted-foreground">fail</span>
                    )}
                  </li>
                ))}
                {debug.steps.length === 0 && (
                  <li className="p-2 text-xs text-muted-foreground">
                    {t('tools.regex_tester.debug_no_steps')}
                  </li>
                )}
              </ol>
            ) : (
              <p className="p-3 text-xs text-muted-foreground" data-testid="debug-empty">
                {t('tools.regex_tester.debug_empty')}
              </p>
            )}
          </ScrollArea>
        </div>
      )}

      {sub === 'codegen' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1 p-1.5">
            {CODEGEN_LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                data-testid={`codegen-lang-${l.id}`}
                data-active={lang === l.id}
                onClick={() => setLang(l.id)}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors',
                  lang === l.id
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {l.label}
              </button>
            ))}
            <Button
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => void generate()}
              disabled={!pattern}
              data-testid="generate-code"
            >
              {t('tools.regex_tester.generate')}
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <pre
              className="whitespace-pre-wrap break-words p-2 font-mono text-xs"
              data-testid="codegen-output"
            >
              {code || t('tools.regex_tester.codegen_empty')}
            </pre>
            {code && (
              <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/80 px-2 py-1 backdrop-blur">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  onClick={() => void copyTextWithFeedback(code)}
                  data-testid="copy-codegen"
                  title={t('tools.regex_tester.copy')}
                >
                  <Copy aria-hidden className="size-3" />
                  {t('tools.regex_tester.copy')}
                </button>
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
