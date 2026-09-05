/**
 * CSV 序列化/解析纯函数(RFC 4180 口径):
 * - 行尾统一 CRLF;含 分隔符/引号/CR/LF 的字段用引号包裹,内部双写引号转义
 * - 解析用状态机:引号段内的分隔符/换行/CRLF 均不切分
 * - 支持自定义分隔符(逗号/分号/Tab/管道)
 * - CSV→JSON 可选类型推断(数字/布尔/null);JSON→CSV 可选深展平(dot path)
 */

export type CsvDelimiter = ',' | ';' | '\t' | '|';

/** 单字段序列化 */
function csvField(v: unknown, delimiter: string): string {
  const s =
    v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const needsQuote =
    s.includes(delimiter) || s.includes('"') || s.includes('\r') || s.includes('\n');
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 对象数组 → CSV(列取键并集;空数组返回空串) */
export function jsonToCsv(
  items: Array<Record<string, unknown>>,
  delimiter: CsvDelimiter = ',',
): string {
  if (items.length === 0) return '';
  const columns = [...new Set(items.flatMap((o) => Object.keys(o)))];
  const lines = [columns.map((c) => csvField(c, delimiter)).join(delimiter)];
  for (const o of items) {
    lines.push(columns.map((c) => csvField(o[c], delimiter)).join(delimiter));
  }
  return lines.join('\r\n');
}

/** CSV → 字符串二维数组(状态机;过滤纯空行) */
export function csvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnything = false;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
    sawAnything = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      // 仅在字段起始处视为开引号(RFC 4180 宽松实现)
      inQuotes = true;
      sawAnything = true;
    } else if (ch === delimiter) {
      pushField();
      sawAnything = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      sawAnything = true;
    }
  }
  if (field !== '' || sawAnything || rows.length === 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** CSV 单元格类型推断:整数/浮点/布尔/null;其余保持原字符串 */
export function inferScalar(s: string): unknown {
  const t = s.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  // 限长避免超长数字串被 Number 静默降精度
  if (/^-?\d{1,15}$/.test(t)) return Number(t);
  if (/^-?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return s;
}

export interface CsvToJsonOptions {
  /** 首行是否为表头(默认 true);false 时输出二维数组 */
  header?: boolean;
  delimiter?: CsvDelimiter;
  /** 对字符串单元格做类型推断(仅 header=true 的对象数组模式) */
  infer?: boolean;
}

/**
 * CSV → 结构化数据。
 * header=true:首行为表头,输出对象数组(缺列补空串);
 * header=false:输出二维数组。
 */
export function csvToJson(
  text: string,
  options: CsvToJsonOptions = {},
): Array<Record<string, unknown>> | unknown[][] {
  const { header = true, delimiter = ',', infer = false } = options;
  const rows = csvRows(text, delimiter);
  if (!header) return rows;
  if (rows.length === 0) return [];
  const [head, ...body] = rows;
  return body.map((r) => {
    const obj: Record<string, unknown> = {};
    head!.forEach((h, i) => {
      const raw = r[i] ?? '';
      obj[h] = infer ? inferScalar(raw) : raw;
    });
    return obj;
  });
}

/**
 * 单条记录展平:
 * - deep=false(默认):一层展平,嵌套对象/数组序列化为 JSON 字符串
 * - deep=true:嵌套对象递归展开为 dot path 键;数组序列化为 JSON 字符串
 */
export function flattenEntry(value: unknown, deep = false): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { value: value as never };
  const out: Record<string, unknown> = {};
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (deep && typeof v === 'object' && v !== null && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, key);
      } else {
        out[key] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      }
    }
  };
  walk(value as Record<string, unknown>, '');
  return out;
}
