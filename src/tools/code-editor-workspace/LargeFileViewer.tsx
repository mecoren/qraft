/**
 * 大文件只读查看器 —— 超过编辑器整读上限(20MB)文件的流式查看
 *
 * 架构(与后端 media/large_file.rs 的锚点协议对齐):
 * - 打开时 `fs_large_file_info` 一次扫描建立行校准点(索引中转;
 *   10GB 文件数秒完成,进度经 `app:large-file-progress` 事件上报)
 * - 虚拟滚动:DOM 只渲染可视区 ± 缓冲的行(固定行高,总高 = 行数 × 行高);
 *   行内容按需经 `fs_read_file_lines` 拉取行窗口,窗口间用返回的
 *   nextOffset/nextLine 精确锚点接续(顺序滚动零数行开销)
 * - 跳转:最近校准点锚点 + 后端数行到目标(行号恒精确)
 * - 只读:不支持编辑/保存/查找(10GB 查找需要后端全文扫描,另议);
 *   支持选中行复制、转到行、超长行截断标记
 *
 * 行窗口缓存(LRU):Map<行号, Promise<LinesWindowResult>>,
 * 最多 CACHE_WINDOWS 个窗口(约 1600 行),超出逐出最旧;
 * 组件卸载即释放,内存占用与文件大小无关。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { writeClipboardText } from '@/lib/clipboard';
import { formatBytes } from '@/lib/file-utils';
import { TEXT_ENCODINGS } from '@/lib/text-encodings';
import { GotoLineQuickPick } from '@/components/ui/code-editor-quick-picks';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import type { EditorTab } from './schema';
import { anchorForLine, readFileLines, type LinesWindowResult } from './fileOps';

/** 单窗口请求行数(覆盖可视区 + 上下缓冲,一次 IPC 拿一批) */
export const LINES_PER_WINDOW = 800;
/** 窗口缓存上限(窗口数);超出按插入序逐出最旧 */
const CACHE_WINDOWS = 6;
/** 可视区外缓冲行数(快速滚动时不闪空白) */
const OVERSCAN_LINES = 40;
/** 行号栏宽度(px):千万级行号(8-9 位)完整显示 */
const GUTTER_WIDTH = 92;
/** 超长行截断标记的字节上限(与后端 WINDOW_MAX_BYTES 对齐) */
const TRUNCATED_NOTE = 4 * 1024 * 1024;
/**
 * 浏览器 scrollTop 安全上限(Chromium ~33.5M px)。总高超过该值时
 * 启用「行分组」:每个滚动单元代表 rowsPerUnit 个物理行,单元内容展示
 * 组首行并在 gutter 标注行号段;窗口请求仍按组首行发起,行号恒精确。
 * 10GB ≈ 2 亿行 → 分组后单元数 ≤ 1600 万,总高回到上限内。
 */
const MAX_SCROLL_PX = 16 * 1024 * 1024;
/** 行分组粒度上限:分组过大会让「逐行阅读」体验退化,上限保守取 32 */
const MAX_ROWS_PER_UNIT = 32;

/** 行窗口缓存条目:已完成窗口或 in-flight 请求(去重用) */
type CacheEntry = LinesWindowResult | Promise<LinesWindowResult>;

/** 行窗口缓存:窗口起始行号 → 结果;插入序 LRU,容量有限 */
const windowCache = createWindowCache(CACHE_WINDOWS);

function createWindowCache(limit: number) {
  const map = new Map<number, CacheEntry>();
  return {
    get: (line: number): CacheEntry | undefined => map.get(line),
    set: (line: number, value: CacheEntry): void => {
      map.set(line, value);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    clear: (): void => {
      map.clear();
    },
    /** 已完成窗口的起始行号集合(读取锚点复用) */
    completed: (): Array<[number, LinesWindowResult]> =>
      [...map.entries()].filter(
        (e): e is [number, LinesWindowResult] => !(e[1] instanceof Promise),
      ),
  };
}

/**
 * 计算目标行的读取锚点:优先复用窗口缓存中不超过目标行的最大 next 锚点
 * (滚动接续,零数行开销),否则用校准点最近锚点(跳转)。
 */
function anchorForRequest(
  calibration: ReadonlyArray<[number, number]>,
  targetLine: number,
): { offset: number; line: number } {
  let best: { offset: number; line: number } | null = null;
  for (const [, win] of windowCache.completed()) {
    const anchorLine = win.nextLine;
    if (anchorLine <= targetLine && (!best || anchorLine > best.line)) {
      best = { offset: win.nextOffset, line: anchorLine };
    }
  }
  if (best) return best;
  return anchorForLine(calibration, targetLine);
}

export interface LargeFileViewerProps {
  /** 大文件 Tab(largeFile=true) */
  tab: EditorTab;
  /** 行号跳转请求:变化即跳转(外部 goto 触发) */
  onGotoLine?: (jump: (line: number) => void) => void;
  'data-testid'?: string;
}

export function LargeFileViewer({
  tab,
  onGotoLine,
  'data-testid': dataTestId,
}: LargeFileViewerProps): JSX.Element {
  const { t } = useTranslation();
  const info = tab.largeFileInfo ?? null;
  const progress = tab.largeFileProgress;
  const error = tab.largeFileError ?? null;

  const editorFontSize = useEditorFontSize();
  // 虚拟行高直接采用编辑器行高(与 Monaco 状态栏口径一致)
  const lineHeight = editorFontSize.lineHeight;

  // 行分组:总高(行数 × 行高)超过浏览器 scrollTop 上限时,把
  // rowsPerUnit 个物理行合并为一个滚动单元(见 MAX_SCROLL_PX 注释)
  const rowsPerUnit = useMemo(() => {
    if (!info || info.lineCount === 0) return 1;
    const totalPx = info.lineCount * lineHeight;
    if (totalPx <= MAX_SCROLL_PX) return 1;
    const ratio = totalPx / MAX_SCROLL_PX;
    return Math.min(MAX_ROWS_PER_UNIT, Math.max(1, Math.ceil(ratio)));
  }, [info, lineHeight]);
  // 分组模式:每个滚动单元代表 rowsPerUnit 行;unit k 覆盖物理行
  // [k × rowsPerUnit + 1, (k+1) × rowsPerUnit]。单行模式退化为 k → 行 k+1
  const unitCount = info ? Math.ceil(info.lineCount / rowsPerUnit) : 0;
  const firstRowOfUnit = useCallback(
    (unit: number): number => unit * rowsPerUnit + 1,
    [rowsPerUnit],
  );

  // —— 滚动状态(ref 驱动,避免每次滚动触发 React 渲染)——
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [gotoOpen, setGotoOpen] = useState(false);

  // 行窗口缓存:模块级单例。切换文件 / 重扫时清空(按 path + lineCount
  // 判定,而非 info 引用:info 对象每次 setLargeFileInfo 都是新引用,
  // 以引用为依赖会把已完成窗口误清,导致渲染回退占位)
  const cacheKey = tab.path ? `${tab.path}:${info?.lineCount ?? 0}` : '';
  const lastCacheKeyRef = useRef('');
  useEffect(() => {
    if (lastCacheKeyRef.current !== cacheKey) {
      lastCacheKeyRef.current = cacheKey;
      windowCache.clear();
    }
  }, [cacheKey]);

  // 可视区滚动单元范围(含缓冲);行号由单元换算(firstRowOfUnit)
  const firstUnit = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN_LINES);
  const visibleUnits = Math.ceil(viewportHeight / lineHeight) + OVERSCAN_LINES * 2;
  const lastUnit = Math.min(Math.max(unitCount - 1, 0), firstUnit + visibleUnits);
  // 可视区覆盖的物理行范围(窗口请求仍按 LINES_PER_WINDOW 网格对齐物理行)
  const firstVisible = firstRowOfUnit(firstUnit);
  const lastVisible = Math.min(
    info?.lineCount ?? 1,
    firstRowOfUnit(lastUnit) + rowsPerUnit - 1,
  );

  // 可视区请求的窗口起点集合:窗口对齐到 LINES_PER_WINDOW 网格,
  // 同一窗口内的行只发一次请求
  const windowStarts = useMemo(() => {
    if (!info || info.lineCount === 0) return [];
    const starts: number[] = [];
    const firstWin = Math.max(
      1,
      Math.floor((firstVisible - 1) / LINES_PER_WINDOW) * LINES_PER_WINDOW + 1,
    );
    for (let s = firstWin; s <= lastVisible; s += LINES_PER_WINDOW) {
      starts.push(s);
    }
    return starts;
  }, [info, firstVisible, lastVisible]);

  // 触发窗口加载(in-flight 去重:Promise 也入缓存)。
  // 请求落地后 bump 渲染计数:renderedLines 直接读缓存,依赖 [renderTick]
  // 保证窗口完成后的重渲染能取到内容
  const [renderTick, setRenderTick] = useState(0);
  useEffect(() => {
    if (!info || !tab.path) return;
    for (const start of windowStarts) {
      if (windowCache.get(start) !== undefined) continue;
      const anchor = anchorForRequest(info.calibration, start);
      const promise = readFileLines(
        tab.path,
        info.encoding,
        anchor.offset,
        anchor.line,
        start,
        LINES_PER_WINDOW,
      )
        .then((win) => {
          windowCache.set(start, win);
          // 请求落地后触发一次重渲染(renderedLines 重新读缓存)
          setRenderTick((v) => v + 1);
          return win;
        })
        .catch((e) => {
          // 失败不缓存,下次滚动重试;提示一次
          toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
          throw e;
        });
      windowCache.set(start, promise);
    }
  }, [windowStarts, info, tab.path, t]);

  // 视口尺寸观察(ResizeObserver)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // 渲染单元:窗口命中直接取组首行内容;未命中(滚动过快)空占位。
  // 直接计算(不 useMemo):renderTick 依赖让窗口落地后的重渲染取到内容;
  // 可视区单元数恒有限(视口 + 缓冲),计算开销可忽略
  const renderedUnits: Array<{
    unit: number;
    line: number;
    text: string | null;
    truncated: boolean;
    rows: number;
  }> = [];
  if (info) {
    for (let unit = firstUnit; unit <= lastUnit; unit++) {
      const line = firstRowOfUnit(unit);
      const rows = Math.min(rowsPerUnit, (info.lineCount ?? 0) - line + 1);
      const winStart = Math.floor((line - 1) / LINES_PER_WINDOW) * LINES_PER_WINDOW + 1;
      const cached = windowCache.get(winStart);
      if (cached && !(cached instanceof Promise)) {
        const win: LinesWindowResult = cached;
        const idx = line - win.startLine;
        if (idx >= 0 && idx < win.lines.length) {
          renderedUnits.push({
            unit,
            line,
            text: win.lines[idx],
            truncated: win.truncated && idx === win.lines.length - 1,
            rows,
          });
          continue;
        }
      }
      renderedUnits.push({ unit, line, text: null, truncated: false, rows });
    }
  }
  const _renderTick = renderTick; // 引用计数,确保 lint 不裁剪未用变量
  void _renderTick;

  // 转到行:滚到目标行所在单元(虚拟定位,窗口按需加载)
  const jumpToLine = useCallback(
    (line: number) => {
      const el = scrollRef.current;
      if (!el || !info) return;
      const clamped = Math.min(Math.max(Math.floor(line) || 1, 1), info.lineCount);
      const unit = Math.floor((clamped - 1) / rowsPerUnit);
      el.scrollTop = unit * lineHeight;
    },
    [info, lineHeight, rowsPerUnit],
  );

  // 暴露跳转入口(父组件 goto 注册)
  useEffect(() => {
    onGotoLine?.(jumpToLine);
  }, [onGotoLine, jumpToLine]);

  // 复制选中行:浏览器原生选区跨行时取选区文本;无选区提示
  const handleCopySelection = useCallback(() => {
    const selection = window.getSelection()?.toString() ?? '';
    if (!selection) {
      toast.info(t('tools.text_editor.large_copy_empty'));
      return;
    }
    void writeClipboardText(selection).then((ok) => {
      if (ok) toast.success(t('tools.text_editor.large_copy_done'));
      else toast.error(t('tools.text_editor.err_copy_path'));
    });
  }, [t]);

  // —— 状态层 ——
  if (error) {
    return (
      <div
        data-testid={dataTestId ? `${dataTestId}-error` : 'large-file-error'}
        className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
      >
        <p>{t('tools.text_editor.large_scan_failed', { reason: error })}</p>
      </div>
    );
  }

  if (!info) {
    // 索引扫描中:进度条(百分比或不确定态)
    const pct = typeof progress === 'number' ? progress : 0;
    return (
      <div
        data-testid={dataTestId ? `${dataTestId}-progress` : 'large-file-progress'}
        className="flex h-full flex-col items-center justify-center gap-4 text-sm text-muted-foreground"
      >
        <p className="tabular-nums">
          {t('tools.text_editor.large_scanning', { percent: Math.round(pct) })}
        </p>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-accent">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
    );
  }

  const encodingLabel =
    TEXT_ENCODINGS.find((e) => e.id === info.encoding)?.label ?? info.encoding.toUpperCase();

  return (
    <div
      data-testid={dataTestId ?? 'large-file-viewer'}
      data-search-anchor="text_editor:editor"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      {/* 26px 标题栏(面板一致性模式):路径 + 规模徽章 + 复制选中 */}
      <div className="flex h-[26px] shrink-0 items-center justify-between gap-x-2 border-b border-border bg-background px-2">
        <span
          className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground"
          title={tab.path ?? tab.title}
        >
          {tab.path ?? tab.title}
        </span>
        <span className="flex h-full shrink-0 items-center">
          <span
            data-testid={dataTestId ? `${dataTestId}-badge` : 'large-file-badge'}
            className="mr-1 whitespace-nowrap rounded-sm bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground"
          >
            {t('tools.text_editor.large_badge')}
          </span>
          <button
            type="button"
            onClick={handleCopySelection}
            title={t('tools.text_editor.large_copy_selection')}
            data-testid={dataTestId ? `${dataTestId}-copy` : 'large-file-copy'}
            className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('tools.text_editor.large_copy_selection')}
          </button>
        </span>
      </div>

      {/* 虚拟滚动主体 */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto bg-background"
        data-testid={dataTestId ? `${dataTestId}-scroll` : 'large-file-scroll'}
      >
        <div
          className="relative font-mono"
          style={{
            height: `${Math.max(unitCount, 1) * lineHeight}px`,
            fontSize: editorFontSize.fontSize,
            lineHeight: `${lineHeight}px`,
          }}
        >
          {renderedUnits.map(({ unit, line, text, truncated, rows }) => (
            <div
              key={unit}
              data-line={line}
              data-testid={dataTestId ? `${dataTestId}-line` : 'large-file-line'}
              className="absolute inset-x-0 flex whitespace-pre select-text"
              style={{ top: `${unit * lineHeight}px`, height: `${lineHeight}px` }}
            >
              <span
                aria-hidden
                className="shrink-0 select-none pr-3 text-right text-muted-foreground/70 tabular-nums"
                style={{ width: `${GUTTER_WIDTH}px` }}
              >
                {rows > 1 ? `${line}+${rows}` : line}
              </span>
              <span className="min-w-0 flex-1 truncate pr-4 text-foreground">
                {text ?? ''}
                {truncated && (
                  <span
                    className="ml-2 select-none text-[11px] text-muted-foreground"
                    title={t('tools.text_editor.large_truncated_title', {
                      bytes: formatBytes(TRUNCATED_NOTE),
                    })}
                  >
                    {t('tools.text_editor.large_truncated')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 状态栏(面板一致性模式):行号定位 + 编码 + 行尾 + 规模 */}
      <div
        data-testid={dataTestId ? `${dataTestId}-status` : 'large-file-status'}
        className="flex h-[24px] shrink-0 items-center justify-between gap-1 border-t border-border bg-background px-2 text-xs text-muted-foreground"
      >
        <span className="flex min-w-0 items-center gap-2" />
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGotoOpen(true)}
            title={t('tools.text_editor.large_goto_title')}
            data-testid={dataTestId ? `${dataTestId}-goto` : 'large-file-goto'}
            className="whitespace-nowrap rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {t('tools.text_editor.large_goto_label')}
          </button>
          <span
            className="whitespace-nowrap px-1.5 py-0.5"
            title={t('tools.text_editor.large_eol_title')}
          >
            {info.eol === 'crlf' ? 'CRLF' : 'LF'}
          </span>
          <span
            className="whitespace-nowrap px-1.5 py-0.5"
            title={t('tools.text_editor.large_encoding_title')}
          >
            {encodingLabel}
          </span>
          <span
            className="whitespace-nowrap tabular-nums"
            title={t('tools.text_editor.large_lines_title')}
          >
            {t('tools.text_editor.large_lines', {
              lines: info.lineCount.toLocaleString(),
            })}
          </span>
          <span
            className="whitespace-nowrap tabular-nums"
            title={t('tools.text_editor.large_size_title')}
          >
            {formatBytes(info.size)}
          </span>
        </span>
      </div>

      {/* 转到行快选弹窗(复用编辑器状态栏组件) */}
      <GotoLineQuickPick
        open={gotoOpen}
        onOpenChange={setGotoOpen}
        cursor={{ line: firstVisible, column: 1 }}
        maxLine={info.lineCount}
        onJump={jumpToLine}
        data-testid={`${dataTestId ?? 'large-file'}-goto-pick`}
      />
    </div>
  );
}
