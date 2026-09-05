/**
 * JSON 数组到表格 —— 对象数组 / 二维数组渲染为表格,支持列排序、
 * 深展平(dot path)、导出 CSV / TSV / 复制 TSV / Markdown。
 * 纯函数与组件分离,便于单元测试。
 */

import { flattenEntry } from './json-csv-utils';
import { t as translate } from '@/i18n';

export interface TableData {
  columns: string[];
  rows: string[][];
}

export interface JsonArrayTableOptions {
  /** 嵌套对象递归展开为 a.b 点路径(默认 false,嵌套值序列化为 JSON 字符串) */
  deepFlatten?: boolean;
  /** 输入为「数组的数组」时,首行是否作表头(默认 false → 生成 列1..n) */
  firstRowHeader?: boolean;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function jsonArrayToTable(input: string, options: JsonArrayTableOptions = {}): TableData {
  const { deepFlatten = false, firstRowHeader = false } = options;
  const value: unknown = JSON.parse(input);
  if (!Array.isArray(value)) throw new Error(translate('tools.json_array_table.not_array'));
  if (value.length === 0) return { columns: [], rows: [] };

  // 数组的数组:可选首行作表头,否则生成 列1..n
  if (value.every((item) => Array.isArray(item))) {
    const matrix = value.map((row) => (row as unknown[]).map(cellText));
    const width = Math.max(...matrix.map((r) => r.length));
    if (firstRowHeader && matrix.length > 1) {
      const [head, ...body] = matrix;
      const columns = head!.map((h, i) => h || `${i + 1}`);
      return { columns, rows: body.map((r) => columns.map((_, i) => r[i] ?? '')) };
    }
    const columns = Array.from({ length: width }, (_, i) =>
      translate('tools.json_array_table.column_n', { n: i + 1 }),
    );
    return { columns, rows: matrix.map((r) => columns.map((_, i) => r[i] ?? '')) };
  }

  // 对象数组:汇总所有键为列;非对象元素归入 value 列
  const columns: string[] = [];
  const seen = new Set<string>();
  let hasScalar = false;
  for (const item of value) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const flat = deepFlatten ? flattenEntry(item, true) : (item as Record<string, unknown>);
      for (const k of Object.keys(flat)) {
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
      const flat = deepFlatten ? flattenEntry(item, true) : (item as Record<string, unknown>);
      return columns.map((c) => cellText(flat[c]));
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
  return lines.join('\r\n');
}

/** Markdown 表格(单元格内 | 转义,换行折叠为空格) */
export function tableToMarkdown(table: TableData): string {
  const escape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [
    `| ${table.columns.map(escape).join(' | ')} |`,
    `| ${table.columns.map(() => '---').join(' | ')} |`,
    ...table.rows.map((r) => `| ${r.map(escape).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** 数字感知比较:两侧均为有限数字时按数值,否则按本地化字符串序;空串排最后 */
export function compareCells(a: string, b: string): number {
  if (a === '' || b === '') {
    if (a === '' && b === '') return 0;
    return a === '' ? 1 : -1;
  }
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export type SortDir = 'asc' | 'desc';

/** 按列排序(不改动原数组,返回副本);空目录保持原序 */
export function sortTable(table: TableData, col: number | null, dir: SortDir): TableData {
  if (col === null || col < 0 || col >= table.columns.length) return table;
  const rows = [...table.rows].sort((r1, r2) =>
    dir === 'asc'
      ? compareCells(r1[col] ?? '', r2[col] ?? '')
      : compareCells(r2[col] ?? '', r1[col] ?? ''),
  );
  return { columns: table.columns, rows };
}
