import { describe, it, expect } from 'vitest';
import { diffLines, alignDiff, inlineDiff, summarizeDiff } from './diff';

describe('diffLines', () => {
  it('完全相同文本 → 全部 equal', () => {
    const ops = diffLines('a\nb\nc', 'a\nb\nc');
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('纯新增', () => {
    const ops = diffLines('', 'x\ny');
    expect(ops).toEqual([
      { op: 'add', text: 'x' },
      { op: 'add', text: 'y' },
    ]);
  });

  it('纯删除', () => {
    const ops = diffLines('x\ny', '');
    expect(ops).toEqual([
      { op: 'remove', text: 'x' },
      { op: 'remove', text: 'y' },
    ]);
  });

  it('中间修改一行 → remove + add 相邻', () => {
    const ops = diffLines('a\nb\nc', 'a\nB\nc');
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'add', text: 'B' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('尾部追加', () => {
    const ops = diffLines('a', 'a\nb');
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'add', text: 'b' },
    ]);
  });

  it('乱序重排能识别移动为删除+新增', () => {
    const ops = diffLines('1\n2\n3', '3\n2\n1');
    // 中间行 2 保留,1 与 3 分别 remove/add
    expect(ops.filter((o) => o.op === 'equal')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'remove')).toHaveLength(2);
    expect(ops.filter((o) => o.op === 'add')).toHaveLength(2);
  });
});

describe('alignDiff', () => {
  it('equal 行两侧同显且行号递增', () => {
    const rows = alignDiff(diffLines('a\nb', 'a\nb'));
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.lineNo).toBe(1);
    expect(rows[0].right?.lineNo).toBe(1);
    expect(rows[1].left?.lineNo).toBe(2);
  });

  it('remove+add 配对为修改行(paired)', () => {
    const rows = alignDiff(diffLines('a\nb\nc', 'a\nB\nc'));
    const modify = rows[1];
    expect(modify.left?.op).toBe('remove');
    expect(modify.right?.op).toBe('add');
    expect(modify.left?.paired).toBe(true);
    expect(modify.right?.paired).toBe(true);
  });

  it('多余新增行右显左空', () => {
    const rows = alignDiff(diffLines('a', 'a\nb\nc'));
    expect(rows).toHaveLength(3);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.text).toBe('b');
    expect(rows[2].right?.text).toBe('c');
  });

  it('多余删除行左显右空', () => {
    const rows = alignDiff(diffLines('a\nb\nc', 'a'));
    expect(rows).toHaveLength(3);
    expect(rows[1].right).toBeNull();
    expect(rows[1].left?.text).toBe('b');
  });

  it('删除与新增数量不等时按小值配对', () => {
    // 2 删 1 增 → 1 对修改 + 1 纯删除
    const rows = alignDiff(diffLines('x\ny', 'z'));
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.paired).toBe(true);
    expect(rows[1].left?.paired).toBe(false);
    expect(rows[1].right).toBeNull();
  });

  it('空输入 → 0 行', () => {
    expect(alignDiff(diffLines('', ''))).toHaveLength(0);
  });
});

describe('inlineDiff', () => {
  it('单行中间字符变化 → 仅变化段 changed', () => {
    const { left, right } = inlineDiff('hello world', 'hello qraft');
    expect(left).toEqual([
      { text: 'hello ', changed: false },
      { text: 'world', changed: true },
    ]);
    expect(right).toEqual([
      { text: 'hello ', changed: false },
      { text: 'qraft', changed: true },
    ]);
  });

  it('相同行 → 单侧单段未变', () => {
    const { left, right } = inlineDiff('abc', 'abc');
    expect(left).toEqual([{ text: 'abc', changed: false }]);
    expect(right).toEqual([{ text: 'abc', changed: false }]);
  });

  it('含 emoji(代理对)不拆散', () => {
    const { right } = inlineDiff('a😀b', 'a😀c');
    // 😀 应保持为一个单元;变化仅在尾部 b→c
    const joined = right.map((s) => s.text).join('');
    expect(joined).toBe('a😀c');
  });
});

describe('summarizeDiff', () => {
  it('修改与纯删除', () => {
    // b→B 配对为修改;d 无对侧 → 纯删除
    const rows = alignDiff(diffLines('a\nb\nc\nd', 'a\nB\nc'));
    const s = summarizeDiff(rows);
    expect(s.modified).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.added).toBe(0);
  });

  it('删除新增数量不等时按小值配对,剩余计入新增', () => {
    // remove[d] 与 add[e] 配对为修改;f 剩余 → 新增
    const rows = alignDiff(diffLines('a\nb\nc\nd', 'a\nB\nc\ne\nf'));
    const s = summarizeDiff(rows);
    expect(s.modified).toBe(2); // b→B, d→e
    expect(s.added).toBe(1); // f
    expect(s.removed).toBe(0);
  });
});
