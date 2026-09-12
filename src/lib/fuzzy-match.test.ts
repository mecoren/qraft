/**
 * fuzzy-match 单元测试 —— 子串/子序列两档匹配、打分排序与边界行为。
 */
import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyRank, NO_MATCH } from './fuzzy-match';

describe('fuzzyScore 子串档', () => {
  it('完整子串命中得高分', () => {
    expect(fuzzyScore('json', 'json formatter')).toBeGreaterThan(0);
    expect(fuzzyScore('json', 'json formatter')).toBeGreaterThan(
      fuzzyScore('json', 'some json deep inside a long line'),
    );
  });

  it('起始越早得分越高', () => {
    expect(fuzzyScore('base', 'base64 codec')).toBeGreaterThan(fuzzyScore('base', 'xx base yy'));
  });

  it('大小写由调用方归一(本函数不处理)', () => {
    expect(fuzzyScore('JSON', 'json')).toBe(NO_MATCH);
    expect(fuzzyScore('json', 'json')).toBeGreaterThan(0);
  });
});

describe('fuzzyScore 子序列档', () => {
  it('缩写按序散布命中', () => {
    expect(fuzzyScore('jsf', 'json format')).toBeGreaterThan(0);
    expect(fuzzyScore('b64', 'base64 codec')).toBeGreaterThan(0);
  });

  it('乱序不命中', () => {
    expect(fuzzyScore('fjs', 'json format')).toBe(NO_MATCH);
    expect(fuzzyScore('sj', 'json format')).toBe(NO_MATCH);
  });

  it('缺失字符不命中', () => {
    expect(fuzzyScore('jsonx', 'json format')).toBe(NO_MATCH);
  });

  it('查询长于目标不命中', () => {
    expect(fuzzyScore('abcdefgh', 'abc')).toBe(NO_MATCH);
  });

  it('连续命中优于散布命中', () => {
    expect(fuzzyScore('json', 'json xxx')).toBeGreaterThan(fuzzyScore('json', 'j1s2o3n xxx'));
  });

  it('CJK 混排子序列:中文字符按序命中', () => {
    expect(fuzzyScore('格式化', 'json 格式化器')).toBeGreaterThan(0);
  });

  it('词首命中优于词中命中', () => {
    // 「f」在「json format」中处于词首(空格之后),在「json xformat」中
    // 处于词中;子序列档内词首奖励应让前者得分更高
    expect(fuzzyScore('jf', 'json format')).toBeGreaterThan(fuzzyScore('jf', 'json xformat'));
  });
});

describe('fuzzyRank 排序', () => {
  const tools = ['JSON 格式化器', 'Base64 转换器', 'JSON ↔ CSV 转换器', '时间戳转换器'];

  it('按得分降序,子串命中优先于子序列', () => {
    const ranked = fuzzyRank(tools, 'json', (t) => t);
    expect(ranked[0]).toContain('JSON');
    // 子串档(标题直接含 json)全部排在子序列档之前
    expect(ranked.length).toBe(2);
  });

  it('空查询原样返回(全量)', () => {
    expect(fuzzyRank(tools, '', (t) => t)).toEqual(tools);
  });

  it('空白查询原样返回', () => {
    expect(fuzzyRank(tools, '   ', (t) => t)).toEqual(tools);
  });

  it('全部不命中返回空数组', () => {
    expect(fuzzyRank(tools, 'zzzzq', (t) => t)).toEqual([]);
  });

  it('同分保持原相对顺序(稳定)', () => {
    const items = ['abc x', 'abc y', 'abc z'];
    const ranked = fuzzyRank(items, 'abc', (t) => t);
    expect(ranked).toEqual(items);
  });

  it('缩写查询命中缩写源并按相关度排序', () => {
    const catalog = ['JSON 格式化器 json format', 'Base64 转换器 base64 codec'];
    const ranked = fuzzyRank(catalog, 'jsf', (t) => t);
    expect(ranked[0]).toContain('JSON');
  });
});
