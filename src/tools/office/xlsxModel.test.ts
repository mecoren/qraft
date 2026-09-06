import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { exportRowsToXlsx, parseWorkbook } from './xlsxModel';

/** 构造一个两行两列的 xlsx 字节(测试夹具,SheetJS 直出) */
function makeSampleXlsx(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([
    ['姓名', '年龄'],
    ['张三', '30'],
    ['李四', '25'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(out as ArrayBuffer);
}

describe('parseWorkbook', () => {
  it('解析工作表名与单元格文本矩阵', () => {
    const model = parseWorkbook(makeSampleXlsx());
    expect(model.sheets).toHaveLength(1);
    expect(model.sheets[0].name).toBe('Sheet1');
    expect(model.sheets[0].rows).toEqual([
      [{ text: '姓名' }, { text: '年龄' }],
      [{ text: '张三' }, { text: '30' }],
      [{ text: '李四' }, { text: '25' }],
    ]);
  });

  it('非法字节不抛错:SheetJS 宽容解析,最多产出一个兜底表(不崩溃)', () => {
    // SheetJS 对非法输入不抛异常,而是宽容解读出一张 Sheet1;视图按其
    // (近乎空白)的内容渲染即可,关键保证是不向上冒泡异常
    const model = parseWorkbook(new Uint8Array([1, 2, 3, 4]));
    expect(model.sheets.length).toBeLessThanOrEqual(1);
    expect(model.sheets[0].name).toBe('Sheet1');
  });
});

describe('exportRowsToXlsx → parseWorkbook 回环', () => {
  it('导出的行数据可被解析回同构文本矩阵', () => {
    const rows = [
      ['姓名', '年龄'],
      ['王五', '40'],
    ];
    const bytes = exportRowsToXlsx(rows, '导出');
    const model = parseWorkbook(bytes);
    expect(model.sheets[0].name).toBe('导出');
    expect(model.sheets[0].rows).toEqual([
      [{ text: '姓名' }, { text: '年龄' }],
      [{ text: '王五' }, { text: '40' }],
    ]);
  });
});
