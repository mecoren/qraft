/**
 * JSON 数组到表格 —— 对象数组渲染为表格,导出 CSV / TSV
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { downloadText } from '@/lib/file-utils';
import { t as translate } from '@/i18n';
import type { ToolProps } from './registry';

interface TableData {
  columns: string[];
  rows: string[][];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function jsonArrayToTable(input: string): TableData {
  const value: unknown = JSON.parse(input);
  if (!Array.isArray(value)) throw new Error(translate('tools.json_array_table.not_array'));
  if (value.length === 0) return { columns: [], rows: [] };

  // 汇总所有对象键为列;非对象元素归入 value 列
  const columns: string[] = [];
  const seen = new Set<string>();
  let hasScalar = false;
  for (const item of value) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          columns.push(k);
        }
      }
    } else {
      hasScalar = true;
    }
  }
  if (hasScalar && !seen.has('value')) columns.push('value');

  const rows = value.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return columns.map((c) => cellText((item as Record<string, unknown>)[c]));
    }
    return columns.map((c) => (c === 'value' ? cellText(item) : ''));
  });
  return { columns, rows };
}

function csvEscape(text: string, sep: string): string {
  if (text.includes(sep) || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function tableToDelimited(table: TableData, sep: ',' | '\t'): string {
  const lines = [
    table.columns.map((c) => csvEscape(c, sep)).join(sep),
    ...table.rows.map((r) => r.map((c) => csvEscape(c, sep)).join(sep)),
  ];
  return lines.join('\n');
}

export function JsonArrayTable(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  // 大数组建表开销大:defer 输入优先,建表低优先级追赶
  const deferredInput = useDeferredValue(input);

  const result = useMemo((): { table: TableData | null; error: string | null } => {
    if (!deferredInput.trim()) return { table: null, error: null };
    try {
      return { table: jsonArrayToTable(deferredInput), error: null };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [deferredInput]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):左侧输入编辑器贴边成区,
    // 右侧为带内边距的结果面板,表格卡片去阴影后浮于其中
    <div
      className="grid h-full min-h-0 grid-cols-2 overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="json-array-table"
    >
      <CodeEditor
        title={t('tools.json_array_table.input_title')}
        language="json"
        value={input}
        onChange={setInput}
        placeholder='[{"name":"Alice","age":30},{"name":"Bob","age":25}]'
        data-testid="jat-input"
        // 只保留右侧边框(朝向右侧面板),外三边由外层 shell 卡片提供
        className="min-h-0 rounded-none border-0 border-r"
        searchAnchor="json_array_table:input"
      />

      <div className="flex min-h-0 flex-col gap-2 p-2" data-search-anchor="json_array_table:table">
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">{t('tools.json_array_table.table_title')}</h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="jat-csv"
              disabled={!result.table || result.table.columns.length === 0}
              onClick={() =>
                result.table &&
                downloadText('table.csv', tableToDelimited(result.table, ','), 'text/csv')
              }
            >
              <Download aria-hidden className="size-3.5" /> CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="jat-tsv"
              disabled={!result.table || result.table.columns.length === 0}
              onClick={() =>
                result.table &&
                downloadText(
                  'table.tsv',
                  tableToDelimited(result.table, '\t'),
                  'text/tab-separated-values',
                )
              }
            >
              <Download aria-hidden className="size-3.5" /> TSV
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-card">
          {result.error ? (
            <p data-testid="jat-error" className="px-4 py-3 text-xs text-destructive">
              {result.error}
            </p>
          ) : !result.table || result.table.columns.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {t('tools.json_array_table.empty_state')}
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-body-sm" data-testid="jat-table">
                <thead className="sticky top-0 bg-secondary">
                  <tr>
                    {result.table.columns.map((c) => (
                      <th
                        key={c}
                        className="border-b border-border px-3 py-2 text-left font-semibold"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.table.rows.map((row, i) => (
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
      </div>
    </div>
  );
}
