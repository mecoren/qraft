/**
 * JSON 数组到表格 —— 对象数组渲染为表格,导出 CSV / TSV
 */

import { useMemo, useState, type JSX } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { downloadText } from '@/lib/file-utils';
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
  if (!Array.isArray(value)) throw new Error('输入必须是 JSON 数组');
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
  const [input, setInput] = useState('');

  const result = useMemo((): { table: TableData | null; error: string | null } => {
    if (!input.trim()) return { table: null, error: null };
    try {
      return { table: jsonArrayToTable(input), error: null };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [input]);

  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-3" data-testid="json-array-table">
      <CodeEditor
        title="JSON 数组"
        language="json"
        value={input}
        onChange={setInput}
        placeholder='[{"name":"Alice","age":30},{"name":"Bob","age":25}]'
        data-testid="jat-input"
        className="min-h-0"
        searchAnchor="json_array_table:input"
      />

      <div className="flex min-h-0 flex-col gap-2" data-search-anchor="json_array_table:table">
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">表格</h2>
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

        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card shadow-card">
          {result.error ? (
            <p data-testid="jat-error" className="px-4 py-3 text-xs text-destructive">
              {result.error}
            </p>
          ) : !result.table || result.table.columns.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              输入 JSON 对象数组后自动生成表格
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
