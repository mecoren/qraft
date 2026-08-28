import { describe, expect, it } from 'vitest';
import { computeLineDiff } from './text-compare-utils';

/** 便捷:只取每侧行号列表 */
function lines(decos: ReadonlyArray<{ line: number }>): number[] {
  return decos.map((d) => d.line);
}

describe('computeLineDiff', () => {
  it('完全相同的文本无差异', () => {
    const r = computeLineDiff('a\nb\n', 'a\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(r.modifiedDecos).toEqual([]);
    expect(r.degraded).toBe(false);
  });

  it('纯新增:修改侧标绿,原始侧无装饰', () => {
    const r = computeLineDiff('a\nb\n', 'a\nb\nc\n');
    expect(r.stats).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(lines(r.modifiedDecos)).toEqual([3]);
  });

  it('纯删除:原始侧标红,修改侧无装饰', () => {
    const r = computeLineDiff('a\nb\nc\n', 'a\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(lines(r.originalDecos)).toEqual([3]);
    expect(r.modifiedDecos).toEqual([]);
  });

  it('修改行配对:两侧同行号装饰,带词级区间', () => {
    const r = computeLineDiff('aaa bbb\n', 'aaa ccc\n');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([1]);
    expect(lines(r.modifiedDecos)).toEqual([1]);
    // 'bbb' 在第 5 列起、长度 3(1-based 起列 5,开区间止列 8)
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 5, end: 8 }]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 5, end: 8 }]);
  });

  it('连续增删段:按行数配对,余量记纯增/纯删', () => {
    // equal 'x' → removed 'y' + added 'p q r'
    const r = computeLineDiff('x\ny\n', 'x\np\nq\nr\n');
    expect(r.stats).toEqual({ added: 2, removed: 0, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([2]);
    expect(lines(r.modifiedDecos)).toEqual([2, 3, 4]);
    // 配对行(第 2 行)带词级区间,纯新增行(3/4)无词级区间
    expect(r.modifiedDecos[0].wordSpans.length).toBeGreaterThan(0);
    expect(r.modifiedDecos[1].wordSpans).toEqual([]);
    expect(r.modifiedDecos[2].wordSpans).toEqual([]);
  });

  it('空串对照:全部内容记为新增', () => {
    const r = computeLineDiff('', 'a\nb\n');
    expect(r.stats).toEqual({ added: 2, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(lines(r.modifiedDecos)).toEqual([1, 2]);
  });

  it('CRLF 行尾:行号与词级列号均按剥离 \r 后计算', () => {
    const r = computeLineDiff('a\r\nb\r\n', 'a\r\nc\r\n');
    expect(r.stats.modified).toBe(1);
    expect(lines(r.originalDecos)).toEqual([2]);
    expect(lines(r.modifiedDecos)).toEqual([2]);
    // 'b'(整行第 1 列)→'c'
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 1, end: 2 }]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 1, end: 2 }]);
  });

  it('词级列号按 UTF-16 码元计(中文各占 1 列)', () => {
    const r = computeLineDiff('你好世界', '你好啊世界');
    expect(r.stats.modified).toBe(1);
    // 原始侧无删除片段,修改侧 '啊' 在第 3 列
    expect(r.originalDecos[0].wordSpans).toEqual([]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 3, end: 4 }]);
  });

  it('includeWordDiff=false:保留行级与统计,词级区间为空', () => {
    const r = computeLineDiff('aaa bbb\n', 'aaa ccc\n', { includeWordDiff: false });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([1]);
    expect(r.originalDecos[0].wordSpans).toEqual([]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([]);
  });

  it('maxEditLength 超限:降级为整体替换', () => {
    const r = computeLineDiff('a\nb\n', 'x\ny\n', { maxEditLength: 0 });
    expect(r.degraded).toBe(true);
    expect(r.stats).toEqual({ added: 2, removed: 2, modified: 0 });
    expect(lines(r.originalDecos)).toEqual([1, 2]);
    expect(lines(r.modifiedDecos)).toEqual([1, 2]);
    expect(r.originalDecos[0].wordSpans).toEqual([]);
  });

  it('多段差异:各段独立配对与统计', () => {
    // 1 行相同、1 行修改、1 行相同、末尾 1 行删除
    const r = computeLineDiff('a\nb\nc\nd\n', 'a\nB\nc\n');
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([2, 4]);
    expect(lines(r.modifiedDecos)).toEqual([2]);
  });

  it('末尾换行差异被忽略(不产生修改统计)', () => {
    const r = computeLineDiff('a\nb', 'a\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(r.modifiedDecos).toEqual([]);
  });
});
