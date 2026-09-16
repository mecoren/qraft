import { describe, expect, it } from 'vitest';
import { expandNestedJson } from './json-nested';

describe('expandNestedJson', () => {
  it('展开对象形态的嵌套字符串', () => {
    const { value, count } = expandNestedJson({ address: '{"city": "杭州"}', n: 1 });
    expect(value).toEqual({ address: { city: '杭州' }, n: 1 });
    expect(count).toBe(1);
  });

  it('展开数组形态的嵌套字符串', () => {
    const { value, count } = expandNestedJson({ ids: '[1, 2, 3]' });
    expect(value).toEqual({ ids: [1, 2, 3] });
    expect(count).toBe(1);
  });

  it('递归展开多层嵌套', () => {
    const inner = JSON.stringify({ city: '杭州' });
    const outer = JSON.stringify({ address: inner });
    const { value, count } = expandNestedJson({ payload: outer });
    expect(value).toEqual({ payload: { address: { city: '杭州' } } });
    expect(count).toBe(2);
  });

  it('数组元素内的嵌套字符串同样展开', () => {
    const { value, count } = expandNestedJson([{ a: '{"x":1}' }, '{"y":2}']);
    expect(value).toEqual([{ a: { x: 1 } }, { y: 2 }]);
    expect(count).toBe(2);
  });

  it('标量字符串("123"/"true"/普通文本)保持原样', () => {
    const input = { a: '123', b: 'true', c: 'hello', d: 'null' };
    const { value, count } = expandNestedJson(input);
    expect(value).toEqual(input);
    expect(count).toBe(0);
  });

  it('非法 JSON 字符串保持原样且不抛错', () => {
    const input = { a: '{bad json', b: '[1, 2' };
    const { value, count } = expandNestedJson(input);
    expect(value).toEqual(input);
    expect(count).toBe(0);
  });

  it('不变更输入对象(返回新结构)', () => {
    const input = { a: '{"x":1}' };
    expandNestedJson(input);
    expect(input).toEqual({ a: '{"x":1}' });
  });

  it('顶层字符串本身是 JSON 时同样展开', () => {
    const { value, count } = expandNestedJson('{"a": [1]}');
    expect(value).toEqual({ a: [1] });
    expect(count).toBe(1);
  });
});
