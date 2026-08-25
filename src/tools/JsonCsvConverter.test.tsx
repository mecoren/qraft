import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonCsvConverter } from './JsonCsvConverter';
import { jsonToCsv, csvToJson, csvRows } from './json-csv-utils';

describe('jsonToCsv', () => {
  it('对象数组转 CSV:列取键并集,逗号/引号/换行正确转义,CRLF 行尾', () => {
    const csv = jsonToCsv([
      { name: 'a,b', age: 1 },
      { name: '"q"', note: 'line\nbreak' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('name,age,note');
    expect(lines[1]).toBe('"a,b",1,');
    expect(lines[2]).toBe('"""q""",,"line\nbreak"');
  });

  it('嵌套值序列化为 JSON 字符串(引号按 RFC 双写);null/undefined 输出空', () => {
    const csv = jsonToCsv([{ a: null, b: { x: 1 } }]);
    expect(csv).toBe('a,b\r\n,"{""x"":1}"');
  });

  it('空数组返回空串;单个对象按单行表处理', () => {
    expect(jsonToCsv([])).toBe('');
    expect(jsonToCsv([{ a: 1 }])).toBe('a\r\n1');
  });
});

describe('csvRows / csvToJson', () => {
  it('状态机解析:引号内逗号/引号内 CRLF/双写引号转义', () => {
    const rows = csvRows('a,b\r\n"x,1","y""z"\r\n2,3');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['x,1', 'y"z']);
    expect(rows[2]).toEqual(['2', '3']);
  });

  it('首行为表头时输出对象数组,缺列补空串', () => {
    const arr = csvToJson('name,age\r\nli,18\r\nwang', true);
    expect(arr).toEqual([
      { name: 'li', age: '18' },
      { name: 'wang', age: '' },
    ]);
  });

  it('header=false 输出二维数组;空输入返回空数组', () => {
    expect(csvToJson('1,2', false)).toEqual([['1', '2']]);
    expect(csvToJson('', false)).toEqual([]);
  });
});

describe('JsonCsvConverter 端到端', () => {
  it('JSON→CSV 方向即时转换', () => {
    render(<JsonCsvConverter toolId="json_csv_converter" metadata={null as never} />);
    const input = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(input, { target: { value: '[{"a":1},{"a":2}]' } });
    const out = screen.getByTestId('output').querySelector('textarea')!;
    // jsdom textarea 会把 CRLF 规范化为 LF,这里只断言行内容
    expect(out.value).toBe('a\n1\n2');
  });

  it('切换方向为 CSV→JSON 并转换', async () => {
    const user = userEvent.setup();
    render(<JsonCsvConverter toolId="json_csv_converter" metadata={null as never} />);
    // Radix Tabs 触发器在 jsdom 合成点击下不激活,用其键盘激活语义(ArrowRight)
    screen.getByRole('tab', { name: 'JSON → CSV' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'CSV → JSON' })).toHaveAttribute(
      'data-state',
      'active',
    );
    fireEvent.change(screen.getByTestId('input').querySelector('textarea')!, {
      target: { value: 'name,age\nli,18' },
    });
    const out = screen.getByTestId('output').querySelector('textarea')!;
    // useDeferredValue 二次渲染为异步调度,轮询等待最终输出
    await waitFor(
      () => {
        expect(out.value).toContain('"age": "18"');
      },
      { timeout: 3000 },
    );
  });

  it('非法 JSON 输出错误信息而非崩溃', () => {
    render(<JsonCsvConverter toolId="json_csv_converter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('input').querySelector('textarea')!, {
      target: { value: '{oops}' },
    });
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value).toContain('转换失败');
  });
});
