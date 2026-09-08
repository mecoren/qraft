import { describe, it, expect } from 'vitest';
import { collectJsonStats } from './json-stats';

describe('collectJsonStats', () => {
  it('returns null counts for primitives at root', () => {
    const s = collectJsonStats(42);
    expect(s.objects).toBe(0);
    expect(s.arrays).toBe(0);
    expect(s.keys).toBe(0);
    expect(s.leaves).toBe(1); // 根标量本身是一个叶子
    expect(s.maxDepth).toBe(1); // 深度语义:树高(根算 1)
    expect(s.topLevelKeys).toEqual([]);
  });

  it('counts a flat object', () => {
    const s = collectJsonStats({ a: 1, b: 'x', c: null, d: true });
    expect(s.objects).toBe(1);
    expect(s.arrays).toBe(0);
    expect(s.keys).toBe(4);
    expect(s.leaves).toBe(4);
    expect(s.maxDepth).toBe(2); // root(1) → 叶子(2)
    expect(s.topLevelKeys).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts nested structures and depth', () => {
    // 链:root(1) > b(2) > d 数组(3) > {e}(4) > 叶子 3(5)
    const s = collectJsonStats({ a: 1, b: { c: 2, d: [{ e: 3 }] } });
    expect(s.objects).toBe(3); // root + b + {e}
    expect(s.arrays).toBe(1);
    expect(s.keys).toBe(5); // a, b, c, d, e
    expect(s.leaves).toBe(3); // 1, 2, 3
    expect(s.maxDepth).toBe(5);
  });

  it('counts empty containers without leaves', () => {
    const s = collectJsonStats({ a: {}, b: [] });
    expect(s.objects).toBe(2); // root + {}
    expect(s.arrays).toBe(1);
    expect(s.leaves).toBe(0);
    expect(s.maxDepth).toBe(2); // root(1) → {}(2);[] 同层不更深
  });

  it('caps the traversal on pathological deep structures to stay responsive', () => {
    // 构造 10000 层嵌套(远超正常文档),统计应安全返回而非爆栈
    let deep: unknown = { x: 1 };
    for (let i = 0; i < 9999; i++) deep = { x: deep };
    const s = collectJsonStats(deep);
    expect(s.objects).toBeGreaterThan(0);
    // 深度上限 MAX_TRAVERSE_DEPTH 之下如实计数(10001 = 10000 容器 + 叶子)
    expect(s.maxDepth).toBeLessThanOrEqual(10001);
  });

  it('null is a leaf, not an object', () => {
    const s = collectJsonStats({ a: null });
    expect(s.objects).toBe(1);
    expect(s.leaves).toBe(1);
  });

  it('top-level keys list is capped for wide documents', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 500; i++) wide[`k${i}`] = i;
    const s = collectJsonStats(wide);
    expect(s.keys).toBe(500);
    expect(s.topLevelKeys.length).toBeLessThanOrEqual(100); // 展示上限
    expect(s.topLevelKeys[0]).toBe('k0');
  });
});
