/**
 * 按字节 + 条数双上限的 LRU 缓存。
 *
 * 背景:markdown 渲染链的三个缓存(KaTeX 公式 HTML / Mermaid SVG / 图片资产
 * data URL)原先是「条数满即整体 clear()」——一次全清会把正被高频复用的
 * 热条目一起丢掉,下一轮渲染全量 cache miss(大文档公式回填可造成可感知的
 * 卡顿尖峰);同时条数上限不看字节,十几张大图的 data URL 就能吃掉上百 MB。
 *
 * 方案:Map 迭代序即插入序的经典 LRU——命中即 delete+set 刷新位序,淘汰从
 * 最旧端(sizeCost 最小者优先由插入序天然保证)逐条弹出,直到字节与条数
 * 双双达标。字节成本由调用方提供 cost 函数(字符串取 length 即 UTF-16 码元
 * 数,对 data URL/SVG 等以 ASCII 为主的载荷近似字节数)。
 */

export interface LruCacheOptions {
  /** 最大条目数(≥1) */
  maxEntries: number;
  /** 最大总字节成本(≥1) */
  maxBytes: number;
  /** 条目字节成本;缺省按值字符串长度计 */
  costOf?: (value: unknown) => number;
}

interface Entry<V> {
  value: V;
  cost: number;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly costOf: (value: V) => number;
  private totalCost = 0;

  constructor(options: LruCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.maxBytes = Math.max(1, options.maxBytes);
    const provided = options.costOf;
    this.costOf = provided
      ? (provided as (value: V) => number)
      : (((value: V) => String(value as unknown as string).length) as (value: V) => number);
  }

  /** 当前条目数 */
  get size(): number {
    return this.map.size;
  }

  /** 当前累计字节成本 */
  get bytes(): number {
    return this.totalCost;
  }

  /** 清空全部条目(测试用) */
  clear(): void {
    this.map.clear();
    this.totalCost = 0;
  }

  /**
   * 读取并刷新 LRU 位序。
   * 返回 undefined 表示未命中(不插入占位)。
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /**
   * 写入条目;超限后从最旧端逐条淘汰。
   * 单条成本超过 maxBytes 的条目不缓存(缓存它只会立刻挤空其余条目)。
   */
  set(key: K, value: V): void {
    const cost = this.costOf(value);
    // 已存在同键条目先按旧成本移除,避免重复累计
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.totalCost -= existing.cost;
      this.map.delete(key);
    }
    if (cost > this.maxBytes) return;
    this.map.set(key, { value, cost });
    this.totalCost += cost;
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    // Map 迭代序 = 插入序(get 的 delete+set 已把热条目顶到末尾)
    while (this.map.size > this.maxEntries || this.totalCost > this.maxBytes) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const entry = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (entry) this.totalCost -= entry.cost;
    }
  }
}
