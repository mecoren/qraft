import { describe, expect, it } from 'vitest';
import { buildDiffDecorations, buildUnifiedPatch, computeLineDiff } from './diff-utils';

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

  it('ignoreWhitespace:仅行尾空白不同的行视为相同', () => {
    const r = computeLineDiff('a   \nb\n', 'a\nb\n', { ignoreWhitespace: true });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(r.modifiedDecos).toEqual([]);
  });

  it('ignoreWhitespace 默认关闭:行尾空白不同仍算修改', () => {
    const r = computeLineDiff('a   \nb\n', 'a\nb\n');
    expect(r.stats.modified).toBe(1);
  });

  it('ignoreCase:仅大小写不同的行视为相同', () => {
    const r = computeLineDiff('Hello\nworld\n', 'hello\nWORLD\n', { ignoreCase: true });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
    expect(r.modifiedDecos).toEqual([]);
  });

  it('ignoreWhitespace + ignoreCase 可叠加', () => {
    const r = computeLineDiff('Hello  \n', 'hello\n', {
      ignoreWhitespace: true,
      ignoreCase: true,
    });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it('ignoreEol:仅 CRLF/LF 不同的文本视为相同(默认则整篇标红绿)', () => {
    // 默认:连续 REM/ADD 段按行配对记「修改」——两行全是假差异
    const off = computeLineDiff('a\r\nb\r\n', 'a\nb\n');
    expect(off.stats).toEqual({ added: 0, removed: 0, modified: 2 });
    expect(lines(off.originalDecos)).toEqual([1, 2]);
    expect(lines(off.modifiedDecos)).toEqual([1, 2]);
    // 开启 EOL 归一:无差异
    const on = computeLineDiff('a\r\nb\r\n', 'a\nb\n', { ignoreEol: true });
    expect(on.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(on.originalDecos).toEqual([]);
    expect(on.modifiedDecos).toEqual([]);
  });

  it('ignoreEol 与真实内容差异叠加:只标出真实修改行', () => {
    const r = computeLineDiff('a\r\nB\r\nc\r\n', 'a\nb\nc\n', { ignoreEol: true });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(lines(r.originalDecos)).toEqual([2]);
    expect(lines(r.modifiedDecos)).toEqual([2]);
  });
});

describe('computeLineDiff similarity', () => {
  it('完全相同(含双侧空)相似度为 1', () => {
    expect(computeLineDiff('a\nb\n', 'a\nb\n').similarity).toBe(1);
    expect(computeLineDiff('', '').similarity).toBe(1);
  });

  it('完全不同相似度为 0', () => {
    expect(computeLineDiff('aaa\n', 'bbb\n').similarity).toBe(0);
  });

  it('公共段占较长侧比例(0~1 区间)', () => {
    // 公共 'a\n' (2 字符)/ 较长侧 4 字符 = 0.5
    const r = computeLineDiff('a\n', 'a\nzz');
    expect(r.similarity).toBeCloseTo(2 / 4);
  });

  it('降级(整体替换)时相似度为 0', () => {
    const r = computeLineDiff('a\nb\n', 'x\ny\n', { maxEditLength: 0 });
    expect(r.degraded).toBe(true);
    expect(r.similarity).toBe(0);
  });
});

describe('buildUnifiedPatch', () => {
  it('生成统一格式补丁:头文件名 + hunk 头 + +/- 行', () => {
    const patch = buildUnifiedPatch('a\nold\n', 'a\nnew\n', {
      originalName: 'left.txt',
      modifiedName: 'right.txt',
    });
    expect(patch).toContain('--- left.txt');
    expect(patch).toContain('+++ right.txt');
    expect(patch).toContain('@@');
    expect(patch).toContain('-old');
    expect(patch).toContain('+new');
    expect(patch).toContain(' a');
  });

  it('ignore 选项与主比较同口径:仅空白差异不进补丁', () => {
    const patch = buildUnifiedPatch('foo  \n', 'foo\n', { ignoreWhitespace: true });
    expect(patch).not.toContain('-foo');
    expect(patch).not.toContain('+foo');
  });

  it('ignoreEol:仅换行符差异不进补丁', () => {
    const patch = buildUnifiedPatch('a\r\nb\r\n', 'a\nb\n', { ignoreEol: true });
    expect(patch).not.toMatch(/^[-+]a/m);
  });

  it('自定义文件名缺省用 original/modified 占位', () => {
    const patch = buildUnifiedPatch('x\n', 'y\n');
    expect(patch).toContain('--- original');
    expect(patch).toContain('+++ modified');
  });
});

/** 构建最小 Monaco 编辑器实例桩:按行内容数组模拟 model 行数与最大列号 */
function mockEditorInstance(lines: string[]) {
  return {
    getModel: () => ({
      getLineCount: () => lines.length,
      getLineMaxColumn: (line: number) => (lines[line - 1]?.length ?? 0) + 1,
    }),
  } as unknown as Parameters<typeof buildDiffDecorations>[0];
}

describe('buildDiffDecorations', () => {
  it('差异行同时产出整行背景类与 VSCode 风格 gutter 色条类', () => {
    const editor = mockEditorInstance(['a', 'b']);
    const out = buildDiffDecorations(editor, [{ line: 2, wordSpans: [] }], 'original');
    expect(out).toHaveLength(1);
    expect(out[0].options).toEqual({
      isWholeLine: true,
      className: 'text-compare-line-removed',
      marginClassName: 'text-compare-gutter-removed',
    });
    expect(out[0].range).toMatchObject({ startLineNumber: 2, endLineNumber: 2 });

    const added = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'modified');
    expect(added[0].options).toEqual({
      isWholeLine: true,
      className: 'text-compare-line-added',
      marginClassName: 'text-compare-gutter-added',
    });
  });

  it('词级区间映射为行内装饰,原始侧与修改侧用各自的词级类', () => {
    const editor = mockEditorInstance(['hello world']);
    const out = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 7, end: 12 }] }],
      'modified',
    );
    // 1 个整行装饰 + 1 个词级装饰
    expect(out).toHaveLength(2);
    expect(out[1].options).toEqual({ className: 'text-compare-word-added' });
    expect(out[1].range).toMatchObject({ startLineNumber: 1, startColumn: 7, endColumn: 12 });

    const orig = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 1, end: 6 }] }],
      'original',
    );
    expect(orig[1].options).toEqual({ className: 'text-compare-word-removed' });
  });

  it('越界行号跳过(deferred 值滞后时不刷到别的行),词级列号夹取到行宽', () => {
    const editor = mockEditorInstance(['one line']);
    // 行号 2 超出模型行数:整行装饰与词级装饰一并跳过
    expect(
      buildDiffDecorations(editor, [{ line: 2, wordSpans: [{ start: 1, end: 3 }] }], 'original'),
    ).toEqual([]);

    // 词级 end 超出该行最大列号(9):夹取到 9
    const out = buildDiffDecorations(
      editor,
      [{ line: 1, wordSpans: [{ start: 4, end: 99 }] }],
      'modified',
    );
    expect(out[1].range).toMatchObject({ startColumn: 4, endColumn: 9 });
  });

  it('提供标尺色时差异行携带右缘概览标尺刻度(VSCode 对齐)', () => {
    const editor = mockEditorInstance(['a']);
    const out = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'modified', {
      added: '#0a0',
      removed: '#a00',
    });
    // toEqual 忽略 undefined 属性:未传 rulerColors 时不产生 overviewRuler 键
    expect(out[0].options).toMatchObject({
      overviewRuler: { color: '#0a0', position: 7 },
    });
    const removed = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'original', {
      added: '#0a0',
      removed: '#a00',
    });
    expect(removed[0].options).toMatchObject({
      overviewRuler: { color: '#a00', position: 7 },
    });
    const noColors = buildDiffDecorations(editor, [{ line: 1, wordSpans: [] }], 'modified');
    expect(noColors[0].options).not.toHaveProperty('overviewRuler', expect.anything());
  });
});
