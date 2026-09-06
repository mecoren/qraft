/**
 * Excel(xlsx/xlsm)解析与导出 —— 封装 SheetJS 社区维护分支(@e965/xlsx)
 *
 * 纯逻辑模块:字节 → 工作簿模型(rows / cells 的原始文本与数值),
 * 供表格 UI 渲染;编辑后的行数据可导出为 xlsx(新文件,不覆盖原文件)。
 *
 * 体积说明:xlsx core 构建约 491KB min(懒加载在 Office 工具 chunk 内),
 * 不支持 codepage(读取 GBK 编码的老 xls 不受影响 —— SheetJS 对 xls 的
 * 编码处理走内置 logic,codepage 仅影响部分少语种)。
 */
import { read, utils, write } from '@e965/xlsx';

/** 单元格展示形态:文本(原样)/ 数值;日期由 SheetJS 格式化为文本 */
export interface SheetCell {
  text: string;
}

/** 工作表模型:行 × 列的文本矩阵 + 合并区域 */
export interface SheetModel {
  /** 工作表名 */
  name: string;
  /** 行数据(二维文本矩阵;空单元格为 '') */
  rows: SheetCell[][];
  /** 合并单元格区域(A1 范围形态,如 "A1:B2";供 UI 展示用) */
  merges: string[];
}

/** 工作簿模型:全部工作表 */
export interface WorkbookModel {
  sheets: SheetModel[];
}

/** 空白单元格的展示形态 */
const EMPTY_CELL: SheetCell = { text: '' };

/**
 * 解析 xlsx/xlsm 字节为工作簿模型。
 * 单元格统一取格式化文本(w 展示值,日期/百分比按单元格格式转文本),
 * 数值精度问题不在此处处理(展示形态与 Excel 复制一致)。
 * 解析失败(文件损坏 / 非法 ZIP)抛出 Error。
 */
export function parseWorkbook(bytes: Uint8Array): WorkbookModel {
  const wb = read(bytes, { type: 'array' });
  const sheets: SheetModel[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows: SheetCell[][] = [];
    const ref = ws['!ref'];
    if (ref) {
      const range = utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: SheetCell[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell == null) {
            row.push(EMPTY_CELL);
            continue;
          }
          // w(格式化文本)缺失时回退 v(原始值);二者皆空的单元格视为空白
          const text = cell.w ?? (cell.v != null ? String(cell.v) : '');
          row.push({ text });
        }
        rows.push(row);
      }
    }
    const merges = (ws['!merges'] ?? []).map((m) => utils.encode_range(m));
    return { name, rows, merges };
  });
  return { sheets };
}

/** 行的编辑形态:字符串二维矩阵(表格 UI 可编辑) */
export type EditableRows = string[][];

/**
 * 把编辑后的行数据导出为 xlsx 字节(新文件)。
 * 全部按文本单元格写入(简易编辑器不保留公式/格式;数值文本由 SheetJS
 * 在读取时可识别)。导出的字节走 fs_save_bytes 另存,不覆盖原文件。
 */
export function exportRowsToXlsx(rows: EditableRows, sheetName: string): Uint8Array {
  const ws = utils.aoa_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, sheetName);
  const out = write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(out as ArrayBuffer);
}
