import { describe, it, expect } from 'vitest';
import { normalizeJsonIndent, normalizeJsonIndentStyle } from './json-utils';

/**
 * normalizeJsonIndentStyle 的 TDD 覆盖:新 {useTabs,size} 对象形状为主,
 * 旧 number 数据(已发布 config.json 中 values.indent 存的是纯数字)兼容。
 */
describe('normalizeJsonIndentStyle', () => {
  it('旧 number 数据 4 → {useTabs:false,size:4}', () => {
    expect(normalizeJsonIndentStyle(4)).toEqual({ useTabs: false, size: 4 });
  });

  it('新对象 {useTabs:true,size:4} 原样保持', () => {
    expect(normalizeJsonIndentStyle({ useTabs: true, size: 4 })).toEqual({
      useTabs: true,
      size: 4,
    });
  });

  it('非法值回落 {useTabs:false,size:2}', () => {
    expect(normalizeJsonIndentStyle(0)).toEqual({ useTabs: false, size: 2 });
    expect(normalizeJsonIndentStyle(99)).toEqual({ useTabs: false, size: 2 });
    expect(normalizeJsonIndentStyle(undefined)).toEqual({ useTabs: false, size: 2 });
    expect(normalizeJsonIndentStyle('tab')).toEqual({ useTabs: false, size: 2 });
    expect(normalizeJsonIndentStyle({ useTabs: true, size: 0 })).toEqual({
      useTabs: false,
      size: 2,
    });
  });

  it('normalizeJsonIndent 保留旧签名并转发 size(旧调用方行为不变)', () => {
    expect(normalizeJsonIndent(4)).toBe(4);
    expect(normalizeJsonIndent(0)).toBe(2);
    expect(normalizeJsonIndent(undefined)).toBe(2);
  });
});
