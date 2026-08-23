/**
 * json-utils 排序扩展单元测试 —— sortJsonKeysBy 多模式
 */
import { describe, expect, it } from 'vitest';
import { sortJsonKeys, sortJsonKeysBy } from './json-utils';

describe('sortJsonKeysBy', () => {
  const sample = {
    b: 1,
    A: 2,
    a10: 3,
    a2: 4,
    '0xff': 5,
    nested: { z: 1, y: 2 },
    arr: [{ d: 1, c: 2 }],
  };

  it('alpha mode is code-unit case sensitive', () => {
    const out = sortJsonKeysBy(sample, { mode: 'alpha' }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['0xff', 'A', 'a10', 'a2', 'arr', 'b', 'nested']);
  });

  it('descending flips the order', () => {
    const out = sortJsonKeysBy({ b: 1, a: 2 }, { mode: 'alpha', descending: true }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(['b', 'a']);
  });

  it('case-insensitive groups same letters then falls back to case order', () => {
    const out = sortJsonKeysBy(
      { Beta: 1, apple: 2, Alpha: 3, banana: 4 },
      { mode: 'alpha-insensitive' },
    ) as Record<string, unknown>;
    // 忽略大小写排序:alpha < apple < banana < beta
    const keys = Object.keys(out);
    expect(keys.indexOf('Alpha')).toBeLessThan(keys.indexOf('apple'));
    expect(keys.indexOf('apple')).toBeLessThan(keys.indexOf('banana'));
    expect(keys.indexOf('banana')).toBeLessThan(keys.indexOf('Beta'));
  });

  it('natural mode compares digit runs numerically (a2 < a10)', () => {
    const out = sortJsonKeysBy({ file10: 1, file9: 2, file2: 3 }, { mode: 'natural' }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(['file2', 'file9', 'file10']);
  });

  it('length mode orders by key length then lexicographic', () => {
    const out = sortJsonKeysBy({ ccc: 1, bb: 2, aaa: 3, a: 4 }, { mode: 'length' }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(['a', 'bb', 'aaa', 'ccc']);
  });

  it('hex mode compares hex numbers numerically with fallback for non-hex keys', () => {
    const out = sortJsonKeysBy(
      { '0x10': 1, '0x2': 2, name: 3, '0xFF': 4 },
      { mode: 'hex' },
    ) as Record<string, unknown>;
    // 十六进制值排序在前(2 < 0x10 < 0xFF),无十六进制内容的键按字典序垫底
    expect(Object.keys(out)).toEqual(['0x2', '0x10', '0xFF', 'name']);
  });

  it('reverse keeps original order inverted recursively without sorting', () => {
    const out = sortJsonKeysBy(sample, { mode: 'reverse' }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['arr', 'nested', '0xff', 'a2', 'a10', 'A', 'b']);
    // 嵌套对象同样反转
    expect(Object.keys(out.nested as object)).toEqual(['y', 'z']);
  });

  it('random preserves all keys exactly once', () => {
    const out = sortJsonKeysBy({ a: 1, b: 2, c: 3, d: 4, e: 5 }, { mode: 'random' }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sorts keys inside arrays of objects but keeps array order', () => {
    const out = sortJsonKeysBy(
      [
        { b: 1, a: 2 },
        { e: 3, d: 4 },
      ],
      { mode: 'alpha' },
    ) as Array<Record<string, unknown>>;
    expect(Object.keys(out[0])).toEqual(['a', 'b']);
    expect(Object.keys(out[1])).toEqual(['d', 'e']);
  });

  it('legacy sortJsonKeys delegates to ascending/descending alpha', () => {
    expect(Object.keys(sortJsonKeys({ b: 1, a: 2 }) as object)).toEqual(['a', 'b']);
    expect(Object.keys(sortJsonKeys({ b: 1, a: 2 }, true) as object)).toEqual(['b', 'a']);
  });
});
