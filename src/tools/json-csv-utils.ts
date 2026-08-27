/**
 * CSV 序列化/解析纯函数(RFC 4180 口径):
 * - 行尾统一 CRLF;含 逗号/引号/CR/LF 的字段用引号包裹,内部双写引号转义
 * - 解析用状态机:引号段内的逗号/换行/CRLF 均不切分
 */

/** 单字段序列化 */
function csvField(v: unknown): string {
  const s =
    v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 对象数组 → CSV(列取键并集;空数组返回空串) */
export function jsonToCsv(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return '';
  const columns = [...new Set(items.flatMap((o) => Object.keys(o)))];
  const lines = [columns.map(csvField).join(',')];
  for (const o of items) lines.push(columns.map((c) => csvField(o[c])).join(','));
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

/**
 * CSV → 结构化数据。
 * header=true:首行为表头,输出对象数组(缺列补空串);
 * header=false:输出二维数组。
 */
export function csvToJson(
  text: string,
  header = true,
  delimiter = ',',
): Array<Record<string, string>> | string[][] {
  const rows = csvRows(text, delimiter);
  if (!header) return rows;
  if (rows.length === 0) return [];
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}
