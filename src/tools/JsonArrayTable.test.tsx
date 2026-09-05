import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  compareCells,
  jsonArrayToTable,
  sortTable,
  tableToDelimited,
  tableToMarkdown,
  type TableData,
} from './json-array-table-utils';
import { JsonArrayTable } from './JsonArrayTable';

describe('jsonArrayToTable', () => {
  it('对象数组:列取键并集,嵌套值序列化', () => {
    const r = jsonArrayToTable('[{"a":1,"b":{"x":2}},{"a":2,"c":3}]');
    expect(r.columns).toEqual(['a', 'b', 'c']);
    expect(r.rows[0]).toEqual(['1', '{"x":2}', '']);
  });

  it('deepFlatten:嵌套对象展开为点路径', () => {
    const r = jsonArrayToTable('[{"a":{"b":1}},{"a":{"c":2}}]', { deepFlatten: true });
    expect(r.columns).toEqual(['a.b', 'a.c']);
    expect(r.rows[0]).toEqual(['1', '']);
  });

  it('二维数组:默认生成 列N;首行作表头可开', () => {
    const r = jsonArrayToTable('[[1,2],[3,4]]');
    expect(r.columns).toEqual(['列 1', '列 2']);
    expect(r.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    const h = jsonArrayToTable('[["name","age"],["li",18]]', { firstRowHeader: true });
    expect(h.columns).toEqual(['name', 'age']);
    expect(h.rows).toEqual([['li', '18']]);
  });

  it('标量混合归入 value 列;非数组报错', () => {
    const r = jsonArrayToTable('[1,"two",{"x":1}]');
    expect(r.columns).toEqual(['x', 'value']);
    expect(r.rows[1]).toEqual(['', 'two']);
    expect(() => jsonArrayToTable('{"a":1}')).toThrow(/数组/);
  });
});

describe('sortTable / compareCells', () => {
  const table: TableData = {
    columns: ['n', 's'],
    rows: [
      ['10', 'b'],
      ['2', 'a'],
      ['', 'c'],
    ],
  };

  it('数字感知升序:空串排最后', () => {
    const sorted = sortTable(table, 0, 'asc');
    expect(sorted.rows.map((r) => r[0])).toEqual(['2', '10', '']);
  });

  it('降序反转;col 为 null 时原样返回', () => {
    expect(sortTable(table, 0, 'desc').rows.map((r) => r[0])).toEqual(['', '10', '2']);
    expect(sortTable(table, null, 'desc').rows).toEqual(table.rows);
  });

  it('字符串列按本地化序', () => {
    expect(sortTable(table, 1, 'asc').rows.map((r) => r[1])).toEqual(['a', 'b', 'c']);
  });

  it('compareCells 纯字符串', () => {
    expect(compareCells('apple', 'Banana')).toBeLessThan(0);
  });
});

describe('tableToDelimited / tableToMarkdown', () => {
  it('TSV/CSV 转义一致', () => {
    const t: TableData = { columns: ['a', 'b'], rows: [['x,y', '1']] };
    expect(tableToDelimited(t, ',')).toBe('a,b\r\n"x,y",1');
    expect(tableToDelimited(t, '\t')).toBe('a\tb\r\nx,y\t1');
  });

  it('Markdown:分隔行与 | 转义、换行折叠', () => {
    const t: TableData = { columns: ['a', 'b'], rows: [['x|y', 'l1\nl2']] };
    expect(tableToMarkdown(t)).toBe(['| a | b |', '| --- | --- |', '| x\\|y | l1 l2 |'].join('\n'));
  });
});

describe('JsonArrayTable 组件', () => {
  it('输入对象数组生成表格与状态栏摘要', async () => {
    render(<JsonArrayTable toolId="json_array_table" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jat-input').querySelector('textarea')!, {
      target: { value: '[{"name":"Alice","age":30},{"name":"Bob","age":25}]' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('jat-status')).toHaveTextContent('2 行 × 2 列');
    });
    expect(screen.getByTestId('jat-table')).toHaveTextContent('Alice');
  });

  it('点击表头循环 升序 → 降序 → 取消', async () => {
    render(<JsonArrayTable toolId="json_array_table" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jat-input').querySelector('textarea')!, {
      target: { value: '[{"n":10},{"n":2},{"n":30}]' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('jat-table')).toBeInTheDocument();
    });
    // 初始顺序 10,2,30
    const rows = () =>
      screen.getAllByTestId('jat-table')[0]!.querySelectorAll('tbody tr td:first-child');
    expect(rows()[0]!.textContent).toBe('10');
    // 升序
    fireEvent.click(screen.getByTestId('jat-sort-0'));
    expect(rows()[0]!.textContent).toBe('2');
    // 降序
    fireEvent.click(screen.getByTestId('jat-sort-0'));
    expect(rows()[0]!.textContent).toBe('30');
    // 取消 → 恢复原序
    fireEvent.click(screen.getByTestId('jat-sort-0'));
    expect(rows()[0]!.textContent).toBe('10');
  });

  it('输入非数组显示错误', async () => {
    render(<JsonArrayTable toolId="json_array_table" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jat-input').querySelector('textarea')!, {
      target: { value: '{"a":1}' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('jat-error')).toBeInTheDocument();
    });
  });
});
