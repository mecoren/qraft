/**
 * 重复行检测器 —— Duplicate detector
 *
 * 功能:
 * - 整行 / 子串(偏移/长度)两种匹配模式
 * - 保留首次 / 保留末次 / 全部移除 三种去重策略
 * - 实时检测重复数据并以「值 / 数量」表格在右侧罗列,顶部汇总「总计 / 不重复 / 重复」
 * - 「是否统计」开关控制是否统计**不重复的数据**(默认开启):
 *   - 开启:统计并展示全部数据行(含不重复行,数量=1)
 *   - 关闭:仅统计重复的数据(数量≥2),汇总中「不重复」项隐藏
 * - 点击「去重」按钮按所选策略去除重复行,写回输入框
 *
 * 实现要点:
 * - 完全前端同步实现,无需 Rust 后端
 * - 算法采用 Map + 出现索引列表的多趟 O(n) 方案,与项目里 P0/P1 文本工具的语义保持一致
 * - 表格按首次出现的顺序排列,与原始输入顺序对应便于定位
 */

import { useDeferredValue, useMemo, useRef, useState, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ClipboardCopy, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { toast } from 'sonner';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import type { ToolProps } from './registry';

// ============================================================
// 纯函数(导出便于单测复用)
// ============================================================

export type DupMatchMode = 'line' | 'substring';

export type UnduplicateMode = 'keepFirst' | 'keepLast' | 'removeAll';

/**
 * 把输入文本规范地拆分为行,兼容 LF / CRLF。
 * - `\r\n`(Windows)、`\n`(Unix/macOS)都会正确处理,行尾不残留 `\r`
 * - 空输入返回空数组;末尾换行产生的空串会保留(便于正确计数行数)
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}

/** 取得每行用于去重比较的「键」 */
function keyOf(line: string, mode: DupMatchMode, offset: number, length: number): string {
  if (mode === 'line') return line;
  const safeOffset = Math.max(0, offset);
  const safeLen = Math.max(0, length);
  if (safeLen === 0) return '';
  // 使用 Array.from 以正确处理代理对与 surrogate pair
  const chars = Array.from(line);
  const start = Math.min(safeOffset, chars.length);
  return chars.slice(start, start + safeLen).join('');
}

/**
 * 把每行归并到所在 key 的出现索引列表。
 * - 子串模式下,键为空(无有效子串)的行放入 `orphan` 数组,这些行**不算**重复也不参与去重
 * - line 模式下所有行都有非空键
 */
function buildGroups(
  lines: readonly string[],
  mode: DupMatchMode,
  offset: number,
  length: number,
): { groups: Map<string, number[]>; orphan: number[] } {
  const groups = new Map<string, number[]>();
  const orphan: number[] = [];
  lines.forEach((line, i) => {
    const k = keyOf(line, mode, offset, length);
    if (mode === 'substring' && k === '') {
      orphan.push(i);
      return;
    }
    const arr = groups.get(k);
    if (arr) arr.push(i);
    else groups.set(k, [i]);
  });
  return { groups, orphan };
}

/** 表格行:{ key, count }——按首次出现顺序 */
export interface DupRow {
  /** 表格展示用的「值」(line 模式 = 整行;substring 模式 = 该 key 对应的原始整行) */
  value: string;
  /** 出现次数(>= 1) */
  count: number;
}

/**
 * 把每行归并为「值 / 数量」表格行。
 * @param includeUnique 是否统计不重复的数据(即数量 = 1 的行)
 *  - true:返回所有分组(含不重复行)
 *  - false(默认):仅返回重复出现的 key(count > 1)
 */
export function buildDuplicatesTable(
  lines: readonly string[],
  mode: DupMatchMode,
  offset: number,
  length: number,
  includeUnique = false,
): DupRow[] {
  const { groups } = buildGroups(lines, mode, offset, length);
  const rows: DupRow[] = [];
  for (const [k, idxs] of groups) {
    if (!includeUnique && idxs.length === 1) continue;
    const value = mode === 'line' ? k : (lines[idxs[0]] ?? '');
    rows.push({ value, count: idxs.length });
  }
  // Map 的插入顺序即首次出现顺序,无需再排序
  return rows;
}

/** 列出「重复行」的纯文本(每个重复 key 一行)。保留导出便于其他场景复用 */
export function listDuplicates(
  lines: readonly string[],
  mode: DupMatchMode,
  offset: number,
  length: number,
): string[] {
  return buildDuplicatesTable(lines, mode, offset, length).map((r) => r.value);
}

/** 统计:总行数 / 不重复行数 / 重复行数(总行数 = 不重复 + 重复) */
export interface DupStats {
  total: number;
  unique: number;
  duplicates: number;
}

/**
 * 统计行数信息,三段计数恒满足 unique + duplicates + orphan = total。
 * - unique:出现次数=1 的成员总数
 * - duplicates:出现次数≥2 的成员总数(整组成员都计为重复)
 * - 子串模式下,无有效 key 的行归入 orphan,不参与 unique/duplicates 计数
 */
export function summarize(
  lines: readonly string[],
  mode: DupMatchMode,
  offset: number,
  length: number,
): DupStats {
  const { groups, orphan } = buildGroups(lines, mode, offset, length);
  const total = lines.length;
  let unique = 0;
  let duplicates = 0;
  for (const [, idxs] of groups) {
    if (idxs.length === 1) unique += 1;
    else duplicates += idxs.length;
  }
  // orphan 行虽然不计入 unique/duplicates,但属于 total;
  // 此接口返回的总和 unique + duplicates + orphan.length === total
  void orphan;
  return { total, unique, duplicates };
}

/** 按策略对行去重 */
export function unduplicateLines(
  lines: readonly string[],
  mode: DupMatchMode,
  offset: number,
  length: number,
  uniqMode: UnduplicateMode,
): string[] {
  const { groups, orphan } = buildGroups(lines, mode, offset, length);

  const keep = new Set<number>(orphan); // orphan 始终保留

  for (const [, idxs] of groups) {
    if (idxs.length === 1) {
      keep.add(idxs[0]);
      continue;
    }
    if (uniqMode === 'removeAll') {
      // 整组丢弃
      continue;
    }
    if (uniqMode === 'keepFirst') {
      keep.add(idxs[0]);
    } else {
      // keepLast
      keep.add(idxs[idxs.length - 1]);
    }
  }

  // 按原始顺序返回
  return lines.filter((_, i) => keep.has(i));
}

// ============================================================
// UI 组件
// ============================================================

const MODE_LABEL_KEY: Record<DupMatchMode, string> = {
  line: 'tools.duplicate_detector.mode_line',
  substring: 'tools.duplicate_detector.mode_substring',
};

const UNIQUE_MODE_LABEL_KEY: Record<UnduplicateMode, string> = {
  keepFirst: 'tools.duplicate_detector.uniq_keep_first',
  keepLast: 'tools.duplicate_detector.uniq_keep_last',
  removeAll: 'tools.duplicate_detector.uniq_remove_all',
};

function parseNonNegativeInt(value: string): number | null {
  if (value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function DuplicateDetector(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<DupMatchMode>('line');
  const [offsetStr, setOffsetStr] = useState('0');
  const [lengthStr, setLengthStr] = useState('1');
  const [uniqMode, setUniqMode] = useState<UnduplicateMode>('keepFirst');
  const [statUnique, setStatUnique] = useState(true);

  const offsetNum = parseNonNegativeInt(offsetStr);
  const lengthNum = parseNonNegativeInt(lengthStr);
  const offsetValid = offsetNum !== null;
  const lengthValid = lengthNum !== null;
  const configValid = mode === 'line' || (offsetValid && lengthValid);

  // 输入防抖:即时更新的输入框 + 低优先级的计算链。
  // 用户快速键入时,input 立刻响应(编辑器不卡),而表格/统计等重计算
  // 交给 deferredInput 在空闲时才重算,避免每个按键都全量分析大文本。
  const deferredInput = useDeferredValue(input);

  const lines = useMemo(() => splitLines(deferredInput), [deferredInput]);

  const tableRows = useMemo(() => {
    if (!deferredInput || !configValid) return [];
    if (mode === 'substring') {
      return buildDuplicatesTable(lines, mode, offsetNum!, lengthNum!, statUnique);
    }
    return buildDuplicatesTable(lines, mode, 0, 0, statUnique);
  }, [deferredInput, lines, mode, offsetNum, lengthNum, configValid, statUnique]);

  const stats = useMemo(() => {
    if (!deferredInput || !configValid) {
      return { total: 0, unique: 0, duplicates: 0 };
    }
    if (mode === 'substring') {
      return summarize(lines, mode, offsetNum!, lengthNum!);
    }
    return summarize(lines, mode, 0, 0);
  }, [deferredInput, lines, mode, offsetNum, lengthNum, configValid]);

  const handleUnduplicate = (): void => {
    if (!input) {
      toast.info(t('tools.duplicate_detector.toast_empty_input'));
      return;
    }
    if (!configValid) {
      toast.error(t('tools.duplicate_detector.toast_invalid_offset_length'));
      return;
    }
    // 基于最新输入即时计算(不走 deferred,避免快速输入后的竞态)
    const linesNow = splitLines(input);
    const preview =
      mode === 'substring'
        ? unduplicateLines(linesNow, mode, offsetNum!, lengthNum!, uniqMode).join('\n')
        : unduplicateLines(linesNow, mode, 0, 0, uniqMode).join('\n');
    if (input === preview) {
      toast.info(t('tools.duplicate_detector.toast_already_unique'));
      return;
    }
    setInput(preview);
    toast.success(t('tools.duplicate_detector.toast_dedup_done'));
  };

  /** 把表格序列化为纯文本(值 + 数量,用于复制按钮) */
  const tableText = useMemo(() => {
    if (tableRows.length === 0) return '';
    return tableRows.map((r) => `${r.value}\t${r.count}`).join('\n');
  }, [tableRows]);

  /** 表格渲染 —— 支持选中/复制整段文本 */
  const handleCopyTable = (): void => {
    if (!tableText) {
      toast.info(t('tools.duplicate_detector.toast_nothing_to_copy'));
      return;
    }
    // 统一复制反馈(成功 toast + 预览/失败报错),与 CopyAction 同一范式
    void copyTextWithFeedback(tableText);
  };

  return (
    <div className="flex h-full flex-col gap-3" data-testid="duplicate-detector">
      {/* 顶栏:全部配置 + 按钮合并在一行 */}
      <section
        aria-label={t('tools.duplicate_detector.config_aria')}
        className="rounded-lg border border-border bg-card shadow-card"
        data-search-anchor="duplicate_detector:config"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
          {/* 匹配模式 */}
          <label className="flex items-center gap-2 text-body-sm">
            <ListChecks aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-muted-foreground">
              {t('tools.duplicate_detector.match_mode')}
            </span>
            <Select value={mode} onValueChange={(v) => setMode(v as DupMatchMode)}>
              <SelectTrigger data-testid="dd-mode" className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABEL_KEY) as DupMatchMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(MODE_LABEL_KEY[m])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {/* 偏移 / 长度 */}
          <label className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <span className="shrink-0">{t('tools.duplicate_detector.offset_label')}</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={offsetStr}
              onChange={(e) => setOffsetStr(e.target.value)}
              disabled={mode === 'line'}
              data-testid="dd-offset"
              aria-invalid={!offsetValid}
              className="h-8 w-20 text-right tabular-nums"
            />
          </label>
          <label className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <span className="shrink-0">{t('tools.duplicate_detector.length_label')}</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={lengthStr}
              onChange={(e) => setLengthStr(e.target.value)}
              disabled={mode === 'line'}
              data-testid="dd-length"
              aria-invalid={!lengthValid}
              className="h-8 w-20 text-right tabular-nums"
            />
          </label>

          {/* 去重模式 */}
          <label className="flex items-center gap-2 text-body-sm">
            <span className="shrink-0 text-muted-foreground">
              {t('tools.duplicate_detector.dedupe_mode')}
            </span>
            <Select value={uniqMode} onValueChange={(v) => setUniqMode(v as UnduplicateMode)}>
              <SelectTrigger data-testid="dd-uniq" className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(UNIQUE_MODE_LABEL_KEY) as UnduplicateMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(UNIQUE_MODE_LABEL_KEY[m])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {/* 是否统计(不重复的数据) */}
          <label
            className="flex items-center gap-2 text-body-sm text-muted-foreground"
            title={t('tools.duplicate_detector.stat_unique_title')}
          >
            <span className="shrink-0">{t('tools.duplicate_detector.stat_unique')}</span>
            <Switch
              checked={statUnique}
              onCheckedChange={setStatUnique}
              aria-label={t('tools.duplicate_detector.stat_unique_aria')}
              data-testid="dd-stat-unique-toggle"
            />
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleUnduplicate}
              disabled={!input || !configValid}
              data-testid="dd-undup"
            >
              {t('tools.duplicate_detector.dedupe_btn')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopyTable}
              disabled={tableRows.length === 0}
              data-testid="dd-copy"
              title={t('tools.duplicate_detector.copy_table')}
              aria-label={t('tools.duplicate_detector.copy_table')}
            >
              <ClipboardCopy aria-hidden className="size-3.5" />
              {t('tools.duplicate_detector.copy_btn')}
            </Button>
          </div>
        </div>
      </section>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.duplicate_detector.input_title')}
            value={input}
            onChange={setInput}
            language="plaintext"
            className="h-full"
            data-testid="dd-input"
            searchAnchor="duplicate_detector:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <DuplicatesTable
            rows={tableRows}
            statUnique={statUnique}
            stats={stats}
            testId="dd-duplicates"
            searchAnchor="duplicate_detector:result"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ============================================================
// 结果区表格组件
// ============================================================

interface DuplicatesTableProps {
  rows: DupRow[];
  /** 是否统计不重复的数据:true 时汇总显示「不重复」且表格包含数量=1 的行 */
  statUnique: boolean;
  stats: DupStats;
  testId?: string;
  /** 全局搜索锚点,用于跳转定位高亮 */
  searchAnchor?: string;
}

/**
 * 结果区表格:恒显示「值」与「数量」两列,顶部合成一行汇总信息。
 * 「是否统计」开启时,表格统计并展示全部数据(含不重复行,数量=1),汇总含「不重复」项;
 * 关闭时仅统计重复的数据(数量≥2),汇总中「不重复」项隐藏。
 * 大数据量下使用 useVirtualizer 只渲染可见行,保证上万行结果依旧流畅。
 */
export function DuplicatesTable({
  rows,
  statUnique,
  stats,
  testId,
  searchAnchor,
}: DuplicatesTableProps): JSX.Element {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 虚拟列表:仅渲染可见行。initialRect 保证 jsdom / 首次渲染也有非零可视区。
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
    initialRect: { width: 400, height: 300 },
  });

  return (
    <div
      data-testid={testId}
      data-slot="duplicates-table"
      data-search-anchor={searchAnchor}
      className="flex h-full flex-col overflow-hidden rounded-md border border-input"
    >
      {/* 顶部 汇总 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-input bg-card px-3 py-1.5 text-xs">
        <span className="font-medium text-foreground">
          {t('tools.duplicate_detector.result_title')}
        </span>
        <span className="flex items-center gap-3 tabular-nums text-muted-foreground">
          <span data-testid="dd-stat-total">
            {t('tools.duplicate_detector.summary_total', { n: stats.total })}
          </span>
          {statUnique && (
            <>
              <span aria-hidden className="h-3 w-px bg-border" />
              <span data-testid="dd-stat-unique">
                {t('tools.duplicate_detector.summary_unique', { n: stats.unique })}
              </span>
            </>
          )}
          <span aria-hidden className="h-3 w-px bg-border" />
          <span data-testid="dd-stat-dup" className="text-foreground/90">
            {t('tools.duplicate_detector.summary_duplicates', { n: stats.duplicates })}
          </span>
        </span>
      </div>

      {/* 表格头(值 + 数量两列) */}
      <div
        className="grid shrink-0 border-b border-input bg-muted/40 text-xs font-medium text-muted-foreground"
        style={{ gridTemplateColumns: '1fr 72px' }}
      >
        <div className="px-3 py-1.5">{t('tools.duplicate_detector.col_value')}</div>
        <div className="border-l border-input px-3 py-1.5 text-right tabular-nums">
          {t('tools.duplicate_detector.col_count')}
        </div>
      </div>

      {/* 表格主体(虚拟滚动) */}
      <ScrollArea viewportRef={scrollRef} className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <div
            className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-muted-foreground"
            data-testid="dd-empty"
          >
            {statUnique
              ? t('tools.duplicate_detector.empty_all')
              : t('tools.duplicate_detector.empty_duplicates')}
          </div>
        ) : (
          <div
            data-testid="dd-rows"
            className="relative w-full"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const r = rows[vi.index];
              return (
                <div
                  key={`${r.value}-${r.count}`}
                  data-index={vi.index}
                  className="absolute left-0 top-0 grid w-full font-mono text-sm hover:bg-muted/30"
                  style={{
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                    gridTemplateColumns: '1fr 72px',
                  }}
                >
                  <div className="truncate px-3 py-1.5" title={r.value} data-testid="dd-row-value">
                    {r.value === '' ? (
                      <span className="text-muted-foreground">
                        {t('tools.duplicate_detector.empty_line_value')}
                      </span>
                    ) : (
                      r.value
                    )}
                  </div>
                  <div
                    className="border-l border-input px-3 py-1.5 text-right tabular-nums text-foreground"
                    data-testid="dd-row-count"
                  >
                    {r.count}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
