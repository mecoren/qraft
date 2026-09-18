/**
 * monaco-diff-mapper 单测 —— ILineChange(手造,不依赖真实 Monaco)→
 * LineDiffResult 的映射契约。空侧 End===0 约定与字符区间裁剪是回归重点。
 */
import { describe, expect, it } from 'vitest';
import type { editor } from 'monaco-editor';
import { mapLineChangesToDiffResult } from './monaco-diff-mapper';

/** 构造行级变更(列区间缺省按整行替换语义由调用方显式给出) */
function lineChange(
  origStart: number,
  origEnd: number,
  modStart: number,
  modEnd: number,
  charChanges?: editor.ICharChange[],
): editor.ILineChange {
  return {
    originalStartLineNumber: origStart,
    originalEndLineNumber: origEnd,
    modifiedStartLineNumber: modStart,
    modifiedEndLineNumber: modEnd,
    charChanges,
  };
}

/** 构造字符级变更(单行内替换:原始 [oStart,oEnd) → 修改 [mStart,mEnd)) */
function charChange(
  line: number,
  oStart: number,
  oEnd: number,
  mStart: number,
  mEnd: number,
): editor.ICharChange {
  return {
    originalStartLineNumber: line,
    originalStartColumn: oStart,
    originalEndLineNumber: line,
    originalEndColumn: oEnd,
    modifiedStartLineNumber: line,
    modifiedStartColumn: mStart,
    modifiedEndLineNumber: line,
    modifiedEndColumn: mEnd,
  };
}

/** 便捷:只取每侧行号列表 */
function lines(decos: ReadonlyArray<{ line: number }>): number[] {
  return decos.map((d) => d.line);
}

describe('mapLineChangesToDiffResult', () => {
  it('空变更序列即完全相同', () => {
    const r = mapLineChangesToDiffResult([], 'a\nb\n', 'a\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(r.modifiedDecos).toEqual([]);
    expect(r.blocks).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.similarity).toBe(1);
  });

  it('纯新增块:原始侧区间为 null,修改侧整段标绿', () => {
    const r = mapLineChangesToDiffResult([lineChange(2, 0, 3, 3)], 'a\nb\n', 'a\nb\nc\n');
    expect(r.stats).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(lines(r.modifiedDecos)).toEqual([3]);
    expect(r.blocks).toEqual([{ origStart: null, origEnd: null, modStart: 3, modEnd: 3 }]);
  });

  it('纯删除块:修改侧区间为 null,原始侧整段标红', () => {
    const r = mapLineChangesToDiffResult([lineChange(3, 3, 3, 0)], 'a\nb\nc\n', 'a\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(lines(r.originalDecos)).toEqual([3]);
    expect(r.modifiedDecos).toEqual([]);
    expect(r.blocks).toEqual([{ origStart: 3, origEnd: 3, modStart: null, modEnd: null }]);
  });

  it('配对修改行携带双侧字符级区间(单 token 尾变只标尾段)', () => {
    // 'helloWorldFoo' → 'helloWorldBar':第 11 列起长度 3 被替换
    const r = mapLineChangesToDiffResult(
      [lineChange(1, 1, 1, 1, [charChange(1, 11, 14, 11, 14)])],
      'helloWorldFoo\n',
      'helloWorldBar\n',
    );
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 11, end: 14 }]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 11, end: 14 }]);
    expect(r.blocks).toEqual([{ origStart: 1, origEnd: 1, modStart: 1, modEnd: 1 }]);
  });

  it('行内纯插入:原始侧零宽区间无高亮,修改侧标出插入段', () => {
    // '你好世界' → '你好啊世界':原始第 3 列零宽,修改第 3~4 列
    const r = mapLineChangesToDiffResult(
      [
        lineChange(1, 1, 1, 1, [
          {
            originalStartLineNumber: 1,
            originalStartColumn: 3,
            originalEndLineNumber: 1,
            originalEndColumn: 3,
            modifiedStartLineNumber: 1,
            modifiedStartColumn: 3,
            modifiedEndLineNumber: 1,
            modifiedEndColumn: 4,
          },
        ]),
      ],
      '你好世界',
      '你好啊世界',
    );
    expect(r.stats.modified).toBe(1);
    expect(r.originalDecos[0].wordSpans).toEqual([]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 3, end: 4 }]);
  });

  it('大块无 charChanges:配对行只有行级背景,余量记纯增/纯删', () => {
    const original = Array.from({ length: 30 }, (_, i) => `o${i}`).join('\n');
    const modified = Array.from({ length: 32 }, (_, i) => `m${i}`).join('\n');
    const r = mapLineChangesToDiffResult([lineChange(1, 30, 1, 32)], original, modified);
    expect(r.stats).toEqual({ added: 2, removed: 0, modified: 30 });
    expect(lines(r.originalDecos)).toHaveLength(30);
    expect(lines(r.modifiedDecos)).toHaveLength(32);
    expect(r.originalDecos[0].wordSpans).toEqual([]);
    expect(r.blocks).toEqual([{ origStart: 1, origEnd: 30, modStart: 1, modEnd: 32 }]);
  });

  it('跨行字符变更按行裁剪:首行取尾段、尾行取首段', () => {
    // 原始 1~2 行整段被替换:原始侧第 1 行 [3,行尾]、第 2 行 [行首,2]
    const r = mapLineChangesToDiffResult(
      [
        lineChange(1, 2, 1, 2, [
          {
            originalStartLineNumber: 1,
            originalStartColumn: 3,
            originalEndLineNumber: 2,
            originalEndColumn: 2,
            modifiedStartLineNumber: 1,
            modifiedStartColumn: 1,
            modifiedEndLineNumber: 2,
            modifiedEndColumn: 5,
          },
        ]),
      ],
      'abXX\nYcde\n',
      'PQ\nRSTU\n',
    );
    // 'abXX' 行长 4 → maxCol 5;[3,5];'Ycde' 行长 4 → [1,2]
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 3, end: 5 }]);
    expect(r.originalDecos[1].wordSpans).toEqual([{ start: 1, end: 2 }]);
    // 修改侧第 1 行整行 [1,3]('PQ' 长 2)、第 2 行 [1,5]('RSTU' 长 4)
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 1, end: 3 }]);
    expect(r.modifiedDecos[1].wordSpans).toEqual([{ start: 1, end: 5 }]);
  });

  it('删除行配到非相邻新增行:余量行按绝对行号仍拿词级高亮', () => {
    // 原始第 1 行 type:text → 修改第 2 行 type:string(修改第 1 行 description 为纯插入)
    // 块两侧行数不等(1 vs 2),旧的位置 paired 窗口只扫到 mod 第 1 行,丢掉第 2 行高亮
    const r = mapLineChangesToDiffResult(
      [
        lineChange(1, 1, 1, 2, [
          {
            originalStartLineNumber: 1,
            originalStartColumn: 11,
            originalEndLineNumber: 1,
            originalEndColumn: 15,
            modifiedStartLineNumber: 2,
            modifiedStartColumn: 11,
            modifiedEndLineNumber: 2,
            modifiedEndColumn: 17,
          },
        ]),
      ],
      '    "type": "text"\n',
      '    "description": "",\n    "type": "string"\n',
    );
    // 纯插入行(description,第 1 行)无词级;被语义配对到的 string 行(第 2 行)拿到词级区间
    expect(r.modifiedDecos.find((d) => d.line === 1)?.wordSpans).toEqual([]);
    expect(r.modifiedDecos.find((d) => d.line === 2)?.wordSpans).toEqual([{ start: 11, end: 17 }]);
    expect(r.originalDecos.find((d) => d.line === 1)?.wordSpans).toEqual([{ start: 11, end: 15 }]);
    // stats 口径不变:1 配对修改 + 1 余量新增
    expect(r.stats).toEqual({ added: 1, removed: 0, modified: 1 });
  });

  it('多段变更各成独立块且顺序排列', () => {
    const r = mapLineChangesToDiffResult(
      [lineChange(2, 2, 2, 2, [charChange(2, 1, 2, 1, 2)]), lineChange(4, 4, 4, 0)],
      'a\nb\nc\nd\n',
      'a\nB\nc\n',
    );
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([2, 4]);
    expect(lines(r.modifiedDecos)).toEqual([2]);
    expect(r.blocks).toEqual([
      { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
      { origStart: 4, origEnd: 4, modStart: null, modEnd: null },
    ]);
  });

  it('相似度:整行替换远低于单字修改,恒在 0~1 区间', () => {
    const diff = mapLineChangesToDiffResult(
      [lineChange(1, 1, 1, 1, [charChange(1, 1, 4, 1, 4)])],
      'aaa\n',
      'bbb\n',
    );
    expect(diff.similarity).toBeGreaterThanOrEqual(0);
    const same = mapLineChangesToDiffResult([], '', '');
    expect(same.similarity).toBe(1);
    const tiny = mapLineChangesToDiffResult(
      [lineChange(2, 2, 2, 2, [charChange(2, 1, 2, 1, 2)])],
      'aaa\nx\nccc\n',
      'aaa\ny\nccc\n',
    );
    expect(tiny.similarity).toBeGreaterThan(0.5);
    expect(tiny.similarity).toBeLessThanOrEqual(1);
    expect(tiny.similarity).toBeGreaterThan(diff.similarity);
  });
});
