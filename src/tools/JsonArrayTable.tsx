/**
 * JSON 数组到表格 —— 对象数组 / 二维数组渲染为表格。
 * - 左栏 JSON 输入(Monaco),右栏同构表格编辑框(26px 标题栏 + 状态栏)
 * - 列排序(点击表头 升 → 降 → 取消)、深展平、首行作表头(二维数组)
 * - 导出 CSV / TSV,复制 TSV / Markdown;大表仅渲染前 2000 行并在状态栏提示
 */
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, TableProperties } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { downloadText } from '@/lib/file-utils';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import {
  jsonArrayToTable,
  sortTable,
  tableToDelimited,
  tableToMarkdown,
  type SortDir,
  type TableData,
} from './json-array-table-utils';
import type { ToolProps } from './registry';

/** 大表渲染上限:超过后仅渲染前 N 行,状态栏提示 */
const RENDER_LIMIT = 2000;

export function JsonArrayTable({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [deepFlatten, setDeepFlatten] = useState(false);
  const [firstRowHeader, setFirstRowHeader] = useState(false);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // 大数组建表开销大:defer 输入优先,建表低优先级追赶
  const deferredInput = useDeferredValue(input);

  const result = useMemo((): {
    table: TableData | null;
    error: string | null;
    isMatrix: boolean;
  } => {
    if (!deferredInput.trim()) return { table: null, error: null, isMatrix: false };
    try {
      const parsed: unknown = JSON.parse(deferredInput);
      const isMatrix =
        Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => Array.isArray(x));
      return {
        table: jsonArrayToTable(deferredInput, { deepFlatten, firstRowHeader }),
        error: null,
        isMatrix,
      };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : String(e), isMatrix: false };
    }
  }, [deferredInput, deepFlatten, firstRowHeader]);

  const sorted = useMemo(
    () => (result.table ? sortTable(result.table, sortCol, sortDir) : null),
    [result.table, sortCol, sortDir],
  );

  const renderedRows = sorted ? sorted.rows.slice(0, RENDER_LIMIT) : [];
  const truncated = sorted ? sorted.rows.length > RENDER_LIMIT : false;

  /** 表格数据非空时的状态栏摘要(N 行 × M 列);空态由占位文案兜底 */
  const summary = sorted
    ? t('tools.json_array_table.table_summary', {
        rows: sorted.rows.length,
        cols: sorted.columns.length,
      })
    : null;

  const canExport = !!sorted && sorted.columns.length > 0;

  const toggleSort = (col: number): void => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortCol(null);
      setSortDir('asc');
    }
  };

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: canExport
      ? () => void copyTextWithFeedback(tableToDelimited(sorted!, '\t'))
      : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter / QrcodeTool 基准):左右双栏收进同一卡片
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="json-array-table"
    >
      <ConfigSection title="" searchAnchor="json_array_table:config">
        <ConfigRow
          icon={TableProperties}
          label={t('tools.json_array_table.deep_flatten')}
          hint={t('tools.json_array_table.deep_flatten_hint')}
        >
          <Switch
            checked={deepFlatten}
            onCheckedChange={setDeepFlatten}
            aria-label={t('tools.json_array_table.deep_flatten')}
            data-testid="jat-deep-flatten"
          />
        </ConfigRow>
        {result.isMatrix && (
          <ConfigRow
            icon={TableProperties}
            label={t('tools.json_array_table.first_row_header')}
            hint={t('tools.json_array_table.first_row_header_hint')}
          >
            <Switch
              checked={firstRowHeader}
              onCheckedChange={setFirstRowHeader}
              aria-label={t('tools.json_array_table.first_row_header')}
              data-testid="jat-first-row-header"
            />
          </ConfigRow>
        )}
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.json_array_table.input_title')}
            language="json"
            value={input}
            onChange={setInput}
            placeholder='[{"name":"Alice","age":30},{"name":"Bob","age":25}]'
            data-testid="jat-input"
            // 只保留右侧边框(朝向中间分隔缝),外三边由外层 shell 卡片提供
            className="h-full rounded-none border-0 border-r"
            searchAnchor="json_array_table:input"
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {/* 表格面板:与左侧编辑器同高同构的「编辑框」,边框对称(只留左侧朝向分隔缝) */}
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-l"
            data-search-anchor="json_array_table:table"
          >
            {/* 标题栏:与 CodeEditor 标题栏同高(26px)、同排版,导出/复制放动作区 */}
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.json_array_table.table_title')}
              </span>
              <span className="flex h-[26px] shrink-0 items-center gap-0.5">
                <HeaderAction
                  testId="jat-copy-tsv"
                  disabled={!canExport}
                  onClick={() => {
                    if (sorted) void copyTextWithFeedback(tableToDelimited(sorted, '\t'));
                  }}
                >
                  {t('tools.json_array_table.copy_tsv')}
                </HeaderAction>
                <HeaderAction
                  testId="jat-copy-md"
                  disabled={!canExport}
                  onClick={() => {
                    if (sorted) void copyTextWithFeedback(tableToMarkdown(sorted));
                  }}
                >
                  Markdown
                </HeaderAction>
                <HeaderAction
                  testId="jat-csv"
                  disabled={!canExport}
                  onClick={() => {
                    if (sorted)
                      downloadText('table.csv', tableToDelimited(sorted, ','), 'text/csv');
                  }}
                >
                  <Download aria-hidden className="size-3.5" /> CSV
                </HeaderAction>
                <HeaderAction
                  testId="jat-tsv"
                  disabled={!canExport}
                  onClick={() => {
                    if (sorted)
                      downloadText(
                        'table.tsv',
                        tableToDelimited(sorted, '\t'),
                        'text/tab-separated-values',
                      );
                  }}
                >
                  <Download aria-hidden className="size-3.5" /> TSV
                </HeaderAction>
              </span>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              {result.error ? (
                <p data-testid="jat-error" className="px-4 py-3 text-xs text-destructive">
                  {result.error}
                </p>
              ) : !sorted || sorted.columns.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t('tools.json_array_table.empty_state')}
                </p>
              ) : (
                <>
                  <table className="w-full border-collapse text-body-sm" data-testid="jat-table">
                    <thead className="sticky top-0 bg-secondary">
                      <tr>
                        {sorted.columns.map((c, i) => (
                          <th
                            key={c}
                            className="border-b border-border px-3 py-2 text-left font-semibold"
                            aria-sort={
                              sortCol === i
                                ? sortDir === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                          >
                            <button
                              type="button"
                              data-testid={`jat-sort-${i}`}
                              onClick={() => toggleSort(i)}
                              className="flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {c}
                              {sortCol === i ? (
                                sortDir === 'asc' ? (
                                  <ArrowUp aria-hidden className="size-3" />
                                ) : (
                                  <ArrowDown aria-hidden className="size-3" />
                                )
                              ) : (
                                <ArrowUpDown
                                  aria-hidden
                                  className="size-3 text-muted-foreground/60"
                                />
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {renderedRows.map((row, i) => (
                        // eslint-disable-next-line react-x/no-array-index-key -- 行无稳定业务主键,表格为只读展示
                        <tr key={i} className="odd:bg-transparent even:bg-muted/40">
                          {row.map((cell, j) => (
                            // eslint-disable-next-line react-x/no-array-index-key -- 单元格随行重建
                            <td key={j} className="border-b border-border px-3 py-1.5 align-top">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ScrollBar orientation="horizontal" />
                </>
              )}
            </ScrollArea>

            {/* 底部状态栏:与 CodeEditor 状态栏同构(border-t + py-0.5 + text-xs),行×列 + 截断提示 */}
            <div
              data-testid="jat-status"
              className="flex items-center justify-between gap-1 border-t border-input px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
            >
              <span className="flex min-w-0 items-center gap-2">
                {truncated && (
                  <span>{t('tools.json_array_table.render_limit', { limit: RENDER_LIMIT })}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {summary ?? t('tools.json_array_table.empty_state')}
              </span>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
