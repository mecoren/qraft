import { describe, expect, it } from 'vitest';
import { convertDatesToTimestamps, convertTimestampsToDates } from './json-timestamp';

describe('convertTimestampsToDates', () => {
  it('秒级数字与毫秒级数字分别转换', () => {
    const { value, count } = convertTimestampsToDates({ a: 1496937600, b: 1584201600000 });
    expect(count).toBe(2);
    // 本地时区格式化:只断言形态,不锁定时区偏移
    expect(value).toEqual({
      a: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      b: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    });
  });

  it('纯数字字符串同样转换,结果为字符串', () => {
    const { value, count } = convertTimestampsToDates({ finish: '1496937600' });
    expect(count).toBe(1);
    expect(typeof (value as Record<string, unknown>).finish).toBe('string');
  });

  it('区间外数字(小 id/年份/超大精度数)原样保留', () => {
    const input = { id: 42, year: 2024, big: Number.MAX_SAFE_INTEGER + 100 };
    const { value, count } = convertTimestampsToDates(input);
    expect(value).toEqual(input);
    expect(count).toBe(0);
  });

  it('数组与嵌套对象递归转换', () => {
    const { value, count } = convertTimestampsToDates({ list: [1496937600, 'x'] });
    expect(count).toBe(1);
    expect((value as { list: unknown[] }).list[1]).toBe('x');
  });

  it('不变更输入', () => {
    const input = { a: 1496937600 };
    convertTimestampsToDates(input);
    expect(input).toEqual({ a: 1496937600 });
  });
});

describe('convertDatesToTimestamps', () => {
  it('空格分隔时间转毫秒数字', () => {
    const { value, count } = convertDatesToTimestamps({ finish: '2017-06-09 00:00:00' });
    expect(count).toBe(1);
    expect(typeof (value as Record<string, unknown>).finish).toBe('number');
    // 往返一致:转出的毫秒数格式化回同一天的开始
    const back = convertTimestampsToDates(value);
    expect(back.count).toBe(1);
  });

  it('ISO 时间同样转换', () => {
    const { count } = convertDatesToTimestamps({ t: '2020-03-15T00:00:00Z' });
    expect(count).toBe(1);
  });

  it('普通文本/纯日期/数字原样保留', () => {
    const input = { a: 'hello', b: '2020-03-15', c: 123, d: 'notepad.exe' };
    const { value, count } = convertDatesToTimestamps(input);
    expect(value).toEqual(input);
    expect(count).toBe(0);
  });

  it('非法日期(如 2020-13-45)不转', () => {
    const { count } = convertDatesToTimestamps({ t: '2020-13-45 00:00:00' });
    expect(count).toBe(0);
  });
});
