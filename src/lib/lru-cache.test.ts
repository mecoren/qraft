import { describe, expect, it } from 'vitest';
import { LruCache } from './lru-cache';

describe('LruCache(双上限 LRU)', () => {
  it('命中刷新位序:最旧端淘汰的是冷条目而非最早写入的热条目', () => {
    const cache = new LruCache<string, string>({ maxEntries: 3, maxBytes: 1000 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    // 刷新 a → 位序变为 b, c, a
    expect(cache.get('a')).toBe('A');
    cache.set('d', 'D'); // 超条数上限,b 淘汰
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
    expect(cache.get('d')).toBe('D');
  });

  it('字节上限:总成本超限时从最旧端逐条释放', () => {
    const cache = new LruCache<string, string>({ maxEntries: 100, maxBytes: 10 });
    cache.set('x1', '1'.repeat(4)); // 4
    cache.set('x2', '2'.repeat(4)); // 4 → total 8
    cache.set('x3', '3'.repeat(4)); // 4 → total 12 > 10 → 淘汰 x1
    expect(cache.get('x1')).toBeUndefined();
    expect(cache.bytes).toBe(8);
    expect(cache.size).toBe(2);
  });

  it('单条成本超过 maxBytes 的条目不入缓存(不挤空其余条目)', () => {
    const cache = new LruCache<string, string>({ maxEntries: 10, maxBytes: 10 });
    cache.set('keep', 'k');
    cache.set('huge', 'h'.repeat(50));
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.get('keep')).toBe('k');
    expect(cache.bytes).toBe(1);
  });

  it('同键重写按新成本累计(不重复计费旧值)', () => {
    const cache = new LruCache<string, string>({ maxEntries: 10, maxBytes: 100 });
    cache.set('k', '12345');
    cache.set('k', '12');
    expect(cache.bytes).toBe(2);
    expect(cache.get('k')).toBe('12');
  });

  it('自定义 costOf 覆盖默认长度计费', () => {
    const cache = new LruCache<string, number>({
      maxEntries: 10,
      maxBytes: 5,
      costOf: (v) => v as number,
    });
    cache.set('a', 3);
    cache.set('b', 3); // total 6 > 5 → a 淘汰
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(3);
  });

  it('未命中返回 undefined 且不占条目', () => {
    const cache = new LruCache<string, string>({ maxEntries: 2, maxBytes: 100 });
    expect(cache.get('nope')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('条数与字节双上限同时生效', () => {
    const cache = new LruCache<string, string>({ maxEntries: 2, maxBytes: 100 });
    cache.set('a', 'a');
    cache.set('b', 'b');
    cache.set('c', 'c'); // 条数超限 → a 淘汰
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('b');
  });
});
