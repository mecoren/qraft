import { describe, expect, it } from 'vitest';
import { MAX_KEEPALIVE_SLOTS, pushVisited, totalSlots } from './keepalive';

describe('pushVisited(LRU keepalive 容量管理)', () => {
  // 下述用例的 a/b/c/d 均为轻工具(catalog 无 heavy 标记或未知 id → 1 名额)

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

describe('名额制容量(重型工具 ×2)', () => {
  // json_formatter / markdown_editor 为 catalog 内 heavy: true 的真实工具
  const HEAVY = 'json_formatter';
  const HEAVY_2 = 'markdown_editor';
  const LIGHT = 'unknown_tool_x';

  it('重型工具占 2 名额,轻工具占 1', () => {
    expect(totalSlots([HEAVY])).toBe(2);
    expect(totalSlots([LIGHT])).toBe(1);
    expect(totalSlots([HEAVY, LIGHT])).toBe(3);
  });

  it('同样 10 名额:6 个重工具(12 名额)只留最近 5 个', () => {
    const heavies = [
      HEAVY,
      HEAVY_2,
      'hash_calculator',
      'regex_tester',
      'jwt_parser',
      'xml_formatter',
    ];
    let visited: string[] = [];
    for (const id of heavies) {
      visited = pushVisited(visited, id, MAX_KEEPALIVE_SLOTS);
    }
    // 12 名额 > 10:最旧的 HEAVY 被淘汰,剩 5 个重工具恰好 10 名额
    expect(visited).toEqual(heavies.slice(1));
    expect(totalSlots(visited)).toBe(10);
  });

  it('混驻场景:重+轻组合按总名额淘汰最旧', () => {
    let visited: string[] = [];
    const seq = [HEAVY, LIGHT, 'a', 'b']; // 2+1+1+1 = 5 名额
    for (const id of seq) visited = pushVisited(visited, id, 8);
    expect(visited).toEqual(seq);
    // 再进 2 个轻工具:5+1+1 = 7 ≤ 8 全保留
    visited = pushVisited(visited, 'c', 8);
    visited = pushVisited(visited, 'd', 8);
    expect(visited).toEqual([HEAVY, LIGHT, 'a', 'b', 'c', 'd']);
    // 7+1 = 8 恰好不超,全保留;再进一个轻工具(9 > 8):最旧的 HEAVY(2 名额)被淘汰 → 7 名额
    visited = pushVisited(visited, 'e', 8);
    expect(visited).toEqual([HEAVY, LIGHT, 'a', 'b', 'c', 'd', 'e']);
    visited = pushVisited(visited, 'f', 8);
    expect(visited).toEqual([LIGHT, 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(totalSlots(visited)).toBe(7);
  });

  it('当前工具永不淘汰:淘汰最旧端时跳过当前,名额达标即停', () => {
    // 3 名额上限,存量 [HEAVY, HEAVY_2, a] = 5 名额,当前是 HEAVY
    const visited = pushVisited([HEAVY, HEAVY_2, 'a'], HEAVY, 3);
    // 当前 HEAVY(2 名额)保留;从最旧端(非当前)淘汰 HEAVY_2 → 2+1 = 3 恰好达标停
    expect(visited).toEqual(['a', HEAVY]);
  });
});
