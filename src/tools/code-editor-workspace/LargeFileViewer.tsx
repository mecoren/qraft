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
 * - 全文搜索:`fs_large_file_search` 流式扫描(Rust 侧大小写不敏感、
 *   命中上限钳制),进度经 `app:large-file-search-progress` 事件上报;
 *   命中列表点击经虚拟定位跳转(10GB 级 grep 是编辑器/VSCode 做不到的
 *   差异化能力);新搜索取代旧请求与组件卸载都按 scanId 取消,不留僵尸扫描
 * - 只读:不支持编辑/保存;支持选中行复制、转到行、超长行截断标记
 *
 * 行窗口缓存(LRU 分片池):Map<文件键, Map<窗口起始行号, 结果>>,
 * 每个文件最多 CACHE_WINDOWS 个窗口(约 1600 行);文件分片间整片 LRU,
 * 内存占用与打开的大文件数相关、与单文件大小无关。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaseSensitive, Search } from 'lucide-react';
import { writeClipboardText } from '@/lib/clipboard';
import { formatBytes } from '@/lib/file-utils';
import { TEXT_ENCODINGS } from '@/lib/text-encodings';
import { GotoLineQuickPick } from '@/components/ui/code-editor-quick-picks';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import { listen } from '@/lib/ipc';
import type { EditorTab } from './schema';
import {
  anchorForLine,
  cancelLargeFileScan,
  largeFileSearch,
  newLargeFileScanId,
  readFileLines,
  type LargeFileSearchProgressPayload,
  type LargeFileSearchResult,
  type LineCalibrationPoint,
  type LinesWindowResult,
} from './fileOps';

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

/**
 * 行窗口缓存池:按「path:lineCount」分片,每个分片是以窗口起始行号为键
 * 的插入序 LRU(容量 CACHE_WINDOWS);分片之间按整片 LRU 逐出(容量
 * CACHE_FILES)。分片隔离保证:多个大文件 Tab 交替激活不互挤缓存,
 * 文件重扫(lineCount 变化)自然落入新分片,迟到请求只会写回自己发起时
 * 的分片——不会再按行号命中其它文件的内容。
 */
const CACHE_FILES = 4;
const windowCache = createWindowCachePool(CACHE_WINDOWS, CACHE_FILES);

function createWindowCachePool(bucketLimit: number, maxBuckets: number) {
  const buckets = new Map<string, Map<number, CacheEntry>>();

  /** 取分片并touch(置为最近使用);不存在则建,整片维度按 LRU 逐出 */
  const bucketFor = (key: string): Map<number, CacheEntry> => {
    let bucket = buckets.get(key);
    if (bucket) {
      buckets.delete(key);
      buckets.set(key, bucket);
      return bucket;
    }
    bucket = new Map<number, CacheEntry>();
    buckets.set(key, bucket);
    while (buckets.size > maxBuckets) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    return bucket;
  };

  return {
    get: (key: string, line: number): CacheEntry | undefined => bucketFor(key).get(line),
    set: (key: string, line: number, value: CacheEntry): void => {
      const bucket = bucketFor(key);
      bucket.set(line, value);
      while (bucket.size > bucketLimit) {
        const oldest = bucket.keys().next().value;
        if (oldest === undefined) break;
        bucket.delete(oldest);
      }
    },
    /** 指定分片中已完成窗口的起始行号集合(读取锚点复用) */
    completed: (key: string): Array<[number, LinesWindowResult]> =>
      [...bucketFor(key).entries()].filter(
        (e): e is [number, LinesWindowResult] => !(e[1] instanceof Promise),
      ),
  };
}

/**
 * 计算目标行的读取锚点:优先复用当前文件分片中不超过目标行的最大
 * next 锚点(滚动接续,零数行开销),否则用校准点最近锚点(跳转)。
 */
function anchorForRequest(
  cacheKey: string,
  calibration: ReadonlyArray<LineCalibrationPoint>,
  targetLine: number,
): { offset: number; line: number } {
  let best: { offset: number; line: number } | null = null;
  for (const [, win] of windowCache.completed(cacheKey)) {
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
  // 滚动 rAF 合帧:flick 快速滚动时每个动画帧最多渲染一次,
  // 避免逐事件重算可视窗口并沿途发起整串窗口请求
  const scrollRafRef = useRef(0);
  const scheduleScrollSync = useCallback((el: HTMLDivElement): void => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(
    () => () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );
  const [viewportHeight, setViewportHeight] = useState(600);
  const [gotoOpen, setGotoOpen] = useState(false);

  // 行窗口缓存分片键:path + lineCount(重扫后行数变化即落入新分片,
  // 旧分片自然废弃,无需手动 clear;不同文件互不挤占、互不串台)
  const cacheKey = tab.path ? `${tab.path}:${info?.lineCount ?? 0}` : '';

  // 可视区滚动单元范围(含缓冲);行号由单元换算(firstRowOfUnit)
  const firstUnit = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN_LINES);
  const visibleUnits = Math.ceil(viewportHeight / lineHeight) + OVERSCAN_LINES * 2;
  const lastUnit = Math.min(Math.max(unitCount - 1, 0), firstUnit + visibleUnits);
  // 可视区覆盖的物理行范围(窗口请求仍按 LINES_PER_WINDOW 网格对齐物理行)
  const firstVisible = firstRowOfUnit(firstUnit);
  const lastVisible = Math.min(info?.lineCount ?? 1, firstRowOfUnit(lastUnit) + rowsPerUnit - 1);

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
      if (windowCache.get(cacheKey, start) !== undefined) continue;
      const anchor = anchorForRequest(cacheKey, info.calibration, start);
      const promise = readFileLines(
        tab.path,
        info.encoding,
        anchor.offset,
        anchor.line,
        start,
        LINES_PER_WINDOW,
      )
        .then((win) => {
          windowCache.set(cacheKey, start, win);
          // 请求落地后触发一次重渲染(renderedLines 重新读缓存)
          setRenderTick((v) => v + 1);
          return win;
        })
        .catch((e) => {
          // 失败不缓存,下次滚动重试;提示一次
          toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
          throw e;
        });
      windowCache.set(cacheKey, start, promise);
    }
  }, [windowStarts, info, tab.path, cacheKey, t]);

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
      const cached = windowCache.get(cacheKey, winStart);
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

  // —— 全文搜索(流式 IPC;进度事件驱动徽章)——
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<LargeFileSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchProgress, setSearchProgress] = useState<number | null>(null);
  /** 搜索区分大小写开关(默认不敏感,与编辑器跨文件搜索一致) */
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  /** 搜索请求代次:仅最新请求的结果生效(快速连续搜索防竞态串台) */
  const searchSeqRef = useRef(0);
  /** 在飞搜索的后端任务标识:被取代 / 卸载时据此取消,不再占用磁盘带宽 */
  const searchIdRef = useRef<string | null>(null);

  /** 发起一次流式搜索:先取消上一趟,过期响应(含 ERR_CANCELLED)一律丢弃 */
  const runSearch = useCallback(
    (query: string, caseSensitive: boolean) => {
      if (!tab.path) return;
      const seq = ++searchSeqRef.current;
      const superseded = searchIdRef.current;
      const scanId = newLargeFileScanId();
      searchIdRef.current = scanId;
      if (superseded) void cancelLargeFileScan(superseded);
      setSearching(true);
      setSearchProgress(0);
      void largeFileSearch(tab.path, query, caseSensitive, scanId)
        .then((result) => {
          if (seq !== searchSeqRef.current) return; // 过期响应丢弃
          setSearchResult(result);
        })
        .catch((err) => {
          if (seq !== searchSeqRef.current) return;
          toast.error(err instanceof Error ? err.message : t('tools.text_editor.err_open_file'));
        })
        .finally(() => {
          if (seq !== searchSeqRef.current) return;
          searchIdRef.current = null;
          setSearching(false);
          setSearchProgress(null);
        });
    },
    [tab.path, t],
  );

  // 卸载(关闭 Tab / 切走工具):中断在飞搜索。代次自增让迟到回调作废,
  // 取消产生的 ERR_CANCELLED 不会弹成错误提示
  useEffect(
    () => () => {
      searchSeqRef.current += 1;
      const pending = searchIdRef.current;
      searchIdRef.current = null;
      if (pending) void cancelLargeFileScan(pending);
    },
    [],
  );

  /** 订阅搜索进度事件(组件级,载荷带 path 校验归属) */
  useEffect(() => {
    if (!tab.path) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<LargeFileSearchProgressPayload>(
          'app:large-file-search-progress',
          (p) => {
            if (p?.path !== tab.path) return;
            const total = p.total || 1;
            setSearchProgress(Math.min(100, Math.round((p.scanned / total) * 100)));
          },
        );
      } catch {
        // 事件系统不可用:搜索仍可用,仅无进度
      }
    })();
    return () => unlisten?.();
  }, [tab.path]);

  /** 提交搜索:空串短路;流式命令 + 代次防竞态 */
  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const query = searchQuery.trim();
      if (!query || !tab.path) return;
      setSearchOpen(true);
      runSearch(query, searchCaseSensitive);
    },
    [searchQuery, searchCaseSensitive, tab.path, runSearch],
  );

  /** 切换大小写口径后立即按新口径重跑一次(有查询时) */
  const toggleSearchCase = useCallback(() => {
    const next = !searchCaseSensitive;
    setSearchCaseSensitive(next);
    const query = searchQuery.trim();
    if (!query || !tab.path) return;
    runSearch(query, next);
  }, [searchQuery, searchCaseSensitive, tab.path, runSearch]);

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
          {/* 全文搜索(流式 IPC):输入即触发,徽章计数,命中列表点击跳转 */}
          <form
            onSubmit={handleSearchSubmit}
            className="relative mr-1 flex items-center"
            data-testid={dataTestId ? `${dataTestId}-search-form` : 'large-file-search-form'}
          >
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 size-3 text-muted-foreground"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('tools.text_editor.large_search_placeholder')}
              title={t('tools.text_editor.large_search_title')}
              data-testid={dataTestId ? `${dataTestId}-search-input` : 'large-file-search-input'}
              className="h-[22px] w-40 rounded-sm border border-input bg-background pl-6 pr-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
            />
            {/* 大小写口径切换(Aa):激活=区分大小写;切换即按新口径重跑 */}
            <button
              type="button"
              aria-pressed={searchCaseSensitive}
              title={t('tools.text_editor.large_search_case_title')}
              aria-label={t('tools.text_editor.large_search_case_title')}
              data-testid={dataTestId ? `${dataTestId}-search-case` : 'large-file-search-case'}
              onClick={toggleSearchCase}
              className={`ml-0.5 flex h-[22px] w-6 shrink-0 items-center justify-center rounded-sm text-[11px] font-semibold transition-colors ${
                searchCaseSensitive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <CaseSensitive aria-hidden className="size-3.5" />
            </button>
            {/* 命中计数徽章:搜索完成后展示;扫描中显示进度 */}
            {searching && searchProgress !== null && (
              <span
                className="ml-1 whitespace-nowrap rounded-sm bg-accent px-1 py-0.5 text-[11px] tabular-nums text-accent-foreground"
                data-testid={
                  dataTestId ? `${dataTestId}-search-progress` : 'large-file-search-progress'
                }
              >
                {searchProgress}%
              </span>
            )}
            {!searching && searchResult && (
              <span
                data-testid={dataTestId ? `${dataTestId}-search-badge` : 'large-file-search-badge'}
                className="ml-1 cursor-pointer whitespace-nowrap rounded-sm bg-accent px-1 py-0.5 text-[11px] tabular-nums text-accent-foreground"
                onClick={() => setSearchOpen((v) => !v)}
                title={t('tools.text_editor.large_search_hits_title')}
              >
                {t('tools.text_editor.large_search_hits', {
                  count: searchResult.hits.length,
                })}
              </span>
            )}
          </form>
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

      {/* 搜索命中列表:徽章点击展开/收起;点击条目虚拟定位跳转 */}
      {searchOpen && searchResult && (
        <div
          data-testid={dataTestId ? `${dataTestId}-search-hits` : 'large-file-search-hits'}
          className="max-h-48 shrink-0 overflow-auto border-b border-border bg-background-layer"
        >
          {searchResult.truncated && (
            <p
              data-testid={
                dataTestId ? `${dataTestId}-search-truncated` : 'large-file-search-truncated'
              }
              className="px-3 py-1 text-[11px] text-muted-foreground"
            >
              {t('tools.text_editor.large_search_truncated')}
            </p>
          )}
          {searchResult.hits.length === 0 && !searchResult.truncated && (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">
              {t('tools.text_editor.large_search_empty')}
            </p>
          )}
          {searchResult.hits.map((hit) => (
            <button
              key={hit.line}
              type="button"
              onClick={() => {
                jumpToLine(hit.line);
                setSearchOpen(false);
              }}
              data-testid={
                dataTestId
                  ? `${dataTestId}-search-hit-${hit.line}`
                  : `large-file-search-hit-${hit.line}`
              }
              className="flex w-full items-start gap-2 px-3 py-1 text-left font-mono text-[11px] leading-5 transition-colors hover:bg-accent"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground">{hit.line}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{hit.preview}</span>
            </button>
          ))}
        </div>
      )}

      {/* 虚拟滚动主体 */}
      <div
        ref={scrollRef}
        onScroll={(e) => scheduleScrollSync(e.currentTarget)}
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
