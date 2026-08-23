import { describe, expect, it } from 'vitest';
import { buildSyncAnchors, mapAcrossAnchors } from './markdown-scroll';

describe('buildSyncAnchors', () => {
  const headings = [
    { id: 'a', line: 10 },
    { id: 'b', line: 20 },
    { id: 'c', line: 30 },
  ];

  it('生成 起点锚点 + 标题锚点 + 终点锚点', () => {
    const anchors = buildSyncAnchors({
      headings,
      resolveTop: (id) => ({ a: 100, b: 200, c: 300 })[id] ?? null,
      maxLine: 40,
      maxScrollTop: 900,
    });
    expect(anchors[0]).toEqual({ line: 1, top: 0 });
    expect(anchors.slice(1, -1)).toEqual([
      { line: 10, top: 100 },
      { line: 20, top: 200 },
      { line: 30, top: 300 },
    ]);
    expect(anchors[anchors.length - 1]).toEqual({ line: 40, top: 900 });
  });

  it('无标题时退化为两点比例映射', () => {
    const anchors = buildSyncAnchors({
      headings: [],
      resolveTop: () => null,
      maxLine: 50,
      maxScrollTop: 1000,
    });
    expect(anchors).toHaveLength(2);
    // 中点行号映射中点滚动位:(25-1)/(50-1) 分段线性
    expect(mapAcrossAnchors(anchors, 25, 'line', 'top')).toBeCloseTo((1000 * 24) / 49);
  });

  it('跳过定位失败与乱序标题', () => {
    const anchors = buildSyncAnchors({
      headings: [
        { id: 'x-missing', line: 5 },
        { id: 'b', line: 8 },
        { id: 'backwards', line: 4 },
        { id: 'same-top', line: 9 },
      ],
      resolveTop: (id) => (id === 'b' ? 120 : id === 'backwards' ? 50 : id === 'same-top' ? 120 : null),
      maxLine: 60,
      maxScrollTop: 600,
    });
    // 仅 b 进入锚点(missing 定位失败 / backwards 行号倒退 / same-top offset 未递增)
    expect(anchors.map((a) => a.line)).toEqual([1, 8, 60]);
  });
});

describe('mapAcrossAnchors 分段线性插值', () => {
  const anchors = [
    { line: 1, top: 0 },
    { line: 10, top: 100 },
    { line: 20, top: 400 },
    { line: 30, top: 1000 },
  ];

  it('段内线性映射(line → top)', () => {
    expect(mapAcrossAnchors(anchors, 15, 'line', 'top')).toBe(250);
    expect(mapAcrossAnchors(anchors, 25, 'line', 'top')).toBe(700);
  });

  it('反向插值(top → line)可还原同一映射', () => {
    expect(mapAcrossAnchors(anchors, 250, 'top', 'line')).toBeCloseTo(15);
    expect(mapAcrossAnchors(anchors, 700, 'top', 'line')).toBeCloseTo(25);
  });

  it('边界夹取:低于首锚点/超出尾锚点取端点值', () => {
    expect(mapAcrossAnchors(anchors, -5, 'line', 'top')).toBe(0);
    expect(mapAcrossAnchors(anchors, 999, 'line', 'top')).toBe(1000);
    expect(mapAcrossAnchors(anchors, 5000, 'top', 'line')).toBe(30);
  });

  it('空锚点返回 0,单锚点恒定', () => {
    expect(mapAcrossAnchors([], 42, 'line', 'top')).toBe(0);
    expect(mapAcrossAnchors([{ line: 3, top: 77 }], 42, 'line', 'top')).toBe(77);
  });
});
