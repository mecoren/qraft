import { describe, expect, it } from 'vitest';
import { pushVisited } from './keepalive';

describe('pushVisited(LRU keepalive 容量管理)', () => {
  it('新工具追加到末尾', () => {
    expect(pushVisited(['a', 'b'], 'c', 8)).toEqual(['a', 'b', 'c']);
  });

  it('重复访问移到末尾(刷新最近使用位序)', () => {
    expect(pushVisited(['a', 'b', 'c'], 'a', 8)).toEqual(['b', 'c', 'a']);
  });

  it('超过容量淘汰最旧的工具', () => {
    expect(pushVisited(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('永不淘汰当前工具(即使它最旧)', () => {
    expect(pushVisited(['a', 'b'], 'a', 2)).toEqual(['b', 'a']);
  });

  it('max<=1 时至少保留当前工具', () => {
    expect(pushVisited(['a', 'b', 'c'], 'd', 1)).toEqual(['d']);
  });

  it('空列表初始化', () => {
    expect(pushVisited([], 'x', 8)).toEqual(['x']);
  });
});
