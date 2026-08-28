/**
 * 对比差异视图 —— 文本比较工具与文本编辑器「文件对比」共用的差异渲染组件
 *
 * 职责(自 TextCompare 主区域抽取,行为不变):
 * - 并排布局:双 CodeEditor + ResizablePanelGroup 可拖分隔条;
 * - 差异渲染四件套:行级红/绿背景、行内词级高亮、gutter 色条 + 行号加粗、
 *   右缘概览标尺刻度(差异计算见 ./diff-utils);
 * - 工具栏:差异统计徽标 / 行内开关 / 滚动同步开关,内联在「修改侧标题旁」
 *   (VSCode 风格);
 * - 行内模式:单体 DiffEditor(renderSideBySide: false,修改侧可编辑)。
 *
 * 边界:
 * - 内容受控于调用方(onOriginalChange / onModifiedChange),组件不持久化;
 * - 多 Tab 切换、文件级按钮(粘贴/打开/清除)经 chrome props 由调用方决定;
 * - i18n 暂沿用 tools.text_compare.* 键(两处消费文案一致,避免键迁移扰动)。
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
import { DiffEditor, type DiffBeforeMount, type DiffOnMount, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Link2, Link2Off, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeEditor, type EditorLanguage } from '@/components/ui/code-editor';
import { defineThemeFor, getThemeName, useMonacoTheme } from '@/components/ui/monaco-theme';
import type { MonacoEditor } from '@/components/ui/monaco-context-menu';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import { cn } from '@/lib/utils';
import {
  buildDiffDecorations,
  WORD_DIFF_MAX_CHARS,
  type DiffRulerColors,
  type LineDiffResult,
} from './diff-utils';
import { createDiffService, type DiffService } from './diff-service';

// Monaco loader 路径配置(import 即执行,保证任何编辑器挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/** 空差异结果(初始态:双侧内容尚未计算) */
const EMPTY_DIFF_RESULT: LineDiffResult = {
  stats: { added: 0, removed: 0, modified: 0 },
  originalDecos: [],
  modifiedDecos: [],
  degraded: false,
};

/** 单侧编辑器的文件级外观选项(粘贴/打开/清除按钮与占位文案) */
export interface TextDiffSideChrome {
  showPaste?: boolean;
  showOpenFile?: boolean;
  showClear?: boolean;
  placeholder?: string;
}

export interface TextDiffViewProps {
  /** 原始侧内容(受控) */
  original: string;
  /** 修改侧内容(受控) */
  modified: string;
  onOriginalChange: (value: string) => void;
  onModifiedChange: (value: string) => void;
  /** 两侧标题(显示在各自编辑器标题栏) */
  originalTitle: string;
  modifiedTitle: string;
  /** 两侧语言(按文件/文档分别传入,默认纯文本) */
  originalLanguage?: EditorLanguage;
  modifiedLanguage?: EditorLanguage;
  /** 是否启用代码折叠(文件对比场景开启),默认关闭 */
  folding?: boolean;
  /** 初始即使用行内模式,默认并排 */
  defaultInline?: boolean;
  /** 左(原始)侧文件级外观 */
  leftChrome?: TextDiffSideChrome;
  /** 右(修改)侧文件级外观 */
  rightChrome?: TextDiffSideChrome;
  /** 主区域搜索锚点(全局搜索定位用) */
  searchAnchor?: string;
  /** 左侧编辑器搜索锚点 */
  leftSearchAnchor?: string;
  /** 右侧编辑器搜索锚点 */
  rightSearchAnchor?: string;
  /** testid 前缀:生成 `{prefix}-stats` / `{prefix}-original` 等 */
  testIdPrefix?: string;
  className?: string;
}

export function TextDiffView({
  original,
  modified,
  onOriginalChange,
  onModifiedChange,
  originalTitle,
  modifiedTitle,
  originalLanguage = 'plaintext',
  modifiedLanguage = 'plaintext',
  folding = false,
  defaultInline = false,
  leftChrome,
  rightChrome,
  searchAnchor,
  leftSearchAnchor,
  rightSearchAnchor,
  testIdPrefix = 'text-diff',
  className,
}: TextDiffViewProps): JSX.Element {
  const { t } = useTranslation();

  // —— 差异计算(deferred 缓冲 + service 快慢路径 + 大输入 worker)——
  // service 挂载即创建、卸载时 dispose;worker 本身在首个大输入时才惰性创建,
  // 小文档(同步快路径)全程零 worker 开销
  const serviceRef = useRef<DiffService | null>(null);
  useEffect(() => {
    serviceRef.current = createDiffService();
    return () => {
      serviceRef.current?.dispose();
      serviceRef.current = null;
    };
  }, []);

  const deferredOriginal = useDeferredValue(original);
  const deferredModified = useDeferredValue(modified);
  const includeWordDiff =
    deferredOriginal.length <= WORD_DIFF_MAX_CHARS && deferredModified.length <= WORD_DIFF_MAX_CHARS;

  // 差异结果异步到达:小输入同步快路径(微任务即达,体感同步),大输入在
  // worker 内计算不阻塞主线程;计算期间保留上一次结果,统计与高亮不清空
  const [diffResult, setDiffResult] = useState<LineDiffResult>(EMPTY_DIFF_RESULT);
  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    let cancelled = false;
    void service.compute(deferredOriginal, deferredModified, includeWordDiff).then((result) => {
      // 只采纳最新一次请求:输入连续变化时,旧响应结果丢弃,防止乱序回写
      // 过期高亮(装饰构建处另有行号/列号夹取兜底)
      if (!cancelled) setDiffResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [deferredOriginal, deferredModified, includeWordDiff]);
  const stats = diffResult.stats;
  const hasDiff = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  // —— 编辑器实例与装饰注入 ——
  const [origEditor, setOrigEditor] = useState<MonacoEditor | null>(null);
  const [modEditor, setModEditor] = useState<MonacoEditor | null>(null);
  const origDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const modDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // 装饰集合生命周期:随编辑器实例创建/销毁(实例复用于多次内容变化)
  useEffect(() => {
    if (!origEditor) return;
    origDecoRef.current?.clear();
    origDecoRef.current = origEditor.createDecorationsCollection([]);
    return () => {
      origDecoRef.current?.clear();
      origDecoRef.current = null;
    };
  }, [origEditor]);
  useEffect(() => {
    if (!modEditor) return;
    modDecoRef.current?.clear();
    modDecoRef.current = modEditor.createDecorationsCollection([]);
    return () => {
      modDecoRef.current?.clear();
      modDecoRef.current = null;
    };
  }, [modEditor]);

  const themeName = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);

  /**
   * VSCode 对齐:差异行在右缘概览标尺绘制红/绿刻度。Monaco 标尺经
   * canvas 绘制,不接受 CSS var(),须经 getComputedStyle 解析成具体
   * 色值;主题/调色板切换时随 themeName 重算,装饰 effect 依赖本值
   * 联动刷新。
   */
  const rulerColors = useMemo<DiffRulerColors>(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      added: style.getPropertyValue('--diff-add-emph').trim(),
      removed: style.getPropertyValue('--diff-remove-emph').trim(),
    };
    // themeName 不在闭包内:仅作为「主题/调色板已切换」的重算信号,
    // 使标尺刻度色随当前调色板的 --diff-*-emph 值刷新
    // eslint-disable-next-line react-x/exhaustive-deps, react-hooks/exhaustive-deps
  }, [themeName]);

  // 差异结果变化时刷新两侧装饰(deferred 值滞后时越界装饰在构建处跳过)
  useEffect(() => {
    if (origDecoRef.current && origEditor) {
      origDecoRef.current.set(
        buildDiffDecorations(origEditor, diffResult.originalDecos, 'original', rulerColors),
      );
    }
  }, [diffResult, origEditor, rulerColors]);
  useEffect(() => {
    if (modDecoRef.current && modEditor) {
      modDecoRef.current.set(
        buildDiffDecorations(modEditor, diffResult.modifiedDecos, 'modified', rulerColors),
      );
    }
  }, [diffResult, modEditor, rulerColors]);

  // —— 行内/并排布局开关(行内 = 单体 DiffEditor,修改侧可编辑)——
  const [inlineMode, setInlineMode] = useState(defaultInline);

  /**
   * 切换到行内时并排侧 CodeEditor 卸载,但 onMount 设置的实例 state 不会自动
   * 清空(CodeEditor 无 onUnmount 回调)—— 在切换事件里同步置 null(与
   * setInlineMode 同批更新),防止滚动同步监听挂在已销毁实例上;切回并排时
   * CodeEditor 重新挂载并经 onMount 回填实例
   */
  const handleToggleInline = useCallback(() => {
    const next = !inlineMode;
    setInlineMode(next);
    if (next) {
      setOrigEditor(null);
      setModEditor(null);
    }
  }, [inlineMode]);

  // —— 左右竖向滚动镜像同步(可开关;等值判断自收敛,防事件回环)——
  const [syncScroll, setSyncScroll] = useState(true);
  const syncingRef = useRef(false);
  useEffect(() => {
    if (!origEditor || !modEditor) return;
    const mirror = (from: MonacoEditor, to: MonacoEditor) => {
      if (!syncScroll || syncingRef.current) return;
      const top = from.getScrollTop();
      if (to.getScrollTop() !== top) {
        syncingRef.current = true;
        to.setScrollTop(top);
        syncingRef.current = false;
      }
    };
    const d1 = origEditor.onDidScrollChange(() => mirror(origEditor, modEditor));
    const d2 = modEditor.onDidScrollChange(() => mirror(modEditor, origEditor));
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [origEditor, modEditor, syncScroll]);

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  }, []);

  // 行内模式写回经 ref 取最新回调:监听只在挂载时注册一次,直接闭包会
  // 滞留首次渲染的回调(多 Tab/多对比切换时写错目标);受控 prop 同步更新
  // 模型时监听同样触发,getValue 与受控值相等,写回为幂等 no-op,不会成环
  const onModifiedChangeRef = useRef(onModifiedChange);
  useEffect(() => {
    onModifiedChangeRef.current = onModifiedChange;
  });

  const handleInlineMount: DiffOnMount = useCallback((instance) => {
    const mod = instance.getModifiedEditor();
    mod.onDidChangeModelContent(() => {
      onModifiedChangeRef.current(mod.getValue());
    });
  }, []);

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  /** 与 CodeEditor 展示优化对齐的 DiffEditor 公共选项(字号随设置档位缩放) */
  const editorFontSize = useEditorFontSize();
  const baseDiffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      // Monaco 默认 useShadowDOM: true,编辑器与分隔条(sash)渲染在 Shadow DOM 内,
      // 应用样式无法穿透覆盖;关闭后由 globals.css 统一分隔条悬浮高亮样式
      useShadowDOM: false,
      fontFamily:
        "var(--app-mono-font-family, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontLigatures: true,
      fontSize: editorFontSize.fontSize,
      lineHeight: editorFontSize.lineHeight,
      lineNumbers: 'on',
      glyphMargin: false,
      folding,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      diffWordWrap: 'on',
      tabSize: 2,
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10, bottom: 10 },
      scrollbar: {
        // 与全局滚动条美化一致:轨道 10px、滑块可见 6px
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
      bracketPairColorization: { enabled: true },
      roundedSelection: true,
      // VSCode 对齐:行内 DiffEditor 由原生逻辑绘制右缘差异刻度
      overviewRulerLanes: 3,
      scrollBeyondLastColumn: 0,
      contextmenu: true,
      fixedOverflowWidgets: true,
      // 不折叠未变更区域,保持"全量并排"观感
      hideUnchangedRegions: { enabled: false },
    }),
    [editorFontSize, folding],
  );

  /** 行内模式:修改侧可编辑(onChange 写回),原始侧只读 */
  const inlineOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      ...baseDiffOptions,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: false,
    }),
    [baseDiffOptions],
  );

  // —— 工具栏公共小件:统计徽标 / 行内开关 / 同步滚动开关 ——
  const statsBadge = (
    <span
      className="flex items-center gap-1 whitespace-nowrap tabular-nums text-xs text-muted-foreground"
      data-testid={`${testIdPrefix}-stats`}
    >
      {hasDiff ? (
        <>
          <span className="text-success">+{stats.added}</span>
          <span className="text-destructive">−{stats.removed}</span>
          <span>~{stats.modified}</span>
        </>
      ) : (
        t('tools.text_compare.diff_none')
      )}
    </span>
  );

  const inlineToggle = (
    <button
      type="button"
      data-testid={`${testIdPrefix}-inline-toggle`}
      aria-pressed={inlineMode}
      title={t('tools.text_compare.inline_mode')}
      aria-label={t('tools.text_compare.inline_mode')}
      onClick={handleToggleInline}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inlineMode ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Rows3 aria-hidden className="size-3.5" />
    </button>
  );

  const syncScrollButton = (
    <button
      type="button"
      data-testid={`${testIdPrefix}-sync-scroll`}
      aria-pressed={syncScroll}
      title={syncScroll ? t('tools.text_compare.sync_scroll_on') : t('tools.text_compare.sync_scroll_off')}
      aria-label={t('tools.text_compare.sync_scroll_aria')}
      onClick={() => setSyncScroll((v) => !v)}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        syncScroll ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {syncScroll ? <Link2 aria-hidden className="size-3.5" /> : <Link2Off aria-hidden className="size-3.5" />}
    </button>
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {inlineMode ? (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-search-anchor={searchAnchor}
          data-testid={`${testIdPrefix}-inline`}
        >
          {/* 工具栏:与 CodeEditor 标题栏同款样式(行内模式无同步滚动按钮);
            * 统计/开关紧跟标题(VSCode 风格),不贴工具栏右缘 */}
          <div className="flex min-w-0 shrink-0 items-center border-b border-input px-2 py-0.5">
            <span className="flex min-w-0 items-center gap-2 pl-1 text-xs font-medium text-foreground">
              <span className="truncate">{t('tools.text_compare.inline_diff_title')}</span>
              {statsBadge}
              {inlineToggle}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              language={modifiedLanguage}
              theme={themeName}
              beforeMount={handleBeforeMount}
              original={original}
              modified={modified}
              // 行内模式修改侧可编辑:onMount 挂载内容监听写回(经 ref 取最新回调)
              onMount={handleInlineMount}
              options={inlineOptions}
              className="h-full"
              loading={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t('tools.text_compare.loading_editor')}
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          data-search-anchor={searchAnchor}
        >
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
            <CodeEditor
              title={originalTitle}
              language={originalLanguage}
              value={original}
              onChange={onOriginalChange}
              placeholder={leftChrome?.placeholder}
              // 只保留右侧边框(朝向中间分隔缝),去掉外三边:外层容器已提供
              // 框体,避免双线/双圆角叠加
              className="h-full rounded-none border-0 border-r"
              data-testid={`${testIdPrefix}-original`}
              searchAnchor={leftSearchAnchor}
              folding={folding}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste={leftChrome?.showPaste}
              showOpenFile={leftChrome?.showOpenFile}
              showClear={leftChrome?.showClear}
              onMount={(instance) => setOrigEditor(instance)}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
            <CodeEditor
              title={modifiedTitle}
              language={modifiedLanguage}
              // VSCode 风格:差异统计与布局操作紧跟标题展示,而非贴工具栏
              // 最右缘(header 复用 CodeEditor 的自定义标题区插槽);
              // 文件级按钮(粘贴/打开/清除)仍由 CodeEditor 常规放在右侧
              header={
                <span
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`${testIdPrefix}-modified-header`}
                >
                  <span className="truncate">{modifiedTitle}</span>
                  {statsBadge}
                  {inlineToggle}
                  {syncScrollButton}
                </span>
              }
              value={modified}
              onChange={onModifiedChange}
              placeholder={rightChrome?.placeholder}
              // 对称:只保留左侧边框(朝向中间分隔缝),理由同原始侧
              className="h-full rounded-none border-0 border-l"
              data-testid={`${testIdPrefix}-modified`}
              searchAnchor={rightSearchAnchor}
              folding={folding}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste={rightChrome?.showPaste}
              showOpenFile={rightChrome?.showOpenFile}
              showClear={rightChrome?.showClear}
              onMount={(instance) => setModEditor(instance)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
