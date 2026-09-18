import { describe, expect, it } from 'vitest';
import {
  applyDiffBlockCopy,
  buildDiffDecorations,
  buildUnifiedPatch,
  buildUnifiedPatchFromBlocks,
  computeAlignmentZones,
  computeHiddenRanges,
  computeLineDiff,
  createBlockLineMapper,
} from './diff-utils';

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

describe('blocks (chunk 精确产出)', () => {
  it('修改块:双侧区间配对', () => {
    const r = computeLineDiff('a\nX\nc\nd\n', 'a\nY\nc\nd\n');
    const blocks = r.blocks;
    expect(blocks).toEqual([{ origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 }]);
  });

  it('纯新增块:原始侧区间为 null', () => {
    const r = computeLineDiff('a\nb\n', 'a\nb\nc\n');
    const blocks = r.blocks;
    expect(blocks).toEqual([{ origStart: null, origEnd: null, modStart: 3, modEnd: 3 }]);
  });

  it('纯删除块:修改侧区间为 null', () => {
    const r = computeLineDiff('a\nb\nc\n', 'a\nb\n');
    const blocks = r.blocks;
    expect(blocks).toEqual([{ origStart: 3, origEnd: 3, modStart: null, modEnd: null }]);
  });

  it('增删不等长段:整段一块(配对行与余量行连续,拷贝整段搬运)', () => {
    // removed 1 行 + added 3 行:同一 chunk 产出单块,双侧区间各自完整
    const r = computeLineDiff('x\ny\n', 'x\np\nq\nr\n');
    const blocks = r.blocks;
    expect(blocks).toEqual([{ origStart: 2, origEnd: 2, modStart: 2, modEnd: 4 }]);
  });

  it('多段差异:各成独立块(顺序排列)', () => {
    const r = computeLineDiff('a\nb\nc\nX\ne\n', 'a\nB\nc\nD\ne\n');
    const blocks = r.blocks;
    expect(blocks).toEqual([
      { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
      { origStart: 4, origEnd: 4, modStart: 4, modEnd: 4 },
    ]);
  });
});

describe('applyDiffBlockCopy', () => {
  it('从原始侧复制修改块:对侧配对区间被替换为原始侧内容', () => {
    // 原始 'old' → 修改 'new';从原始侧复制后,修改侧该行变回 'old'
    const r = computeLineDiff('a\nold\nc\n', 'a\nnew\nc\n');
    const block = r.blocks[0]!;
    const next = applyDiffBlockCopy('a\nold\nc\n', 'a\nnew\nc\n', block, 'original');
    expect(next).toBe('a\nold\nc\n');
  });

  it('从修改侧复制修改块:原始侧配对区间被替换为修改侧内容', () => {
    const r = computeLineDiff('a\nold\nc\n', 'a\nnew\nc\n');
    const block = r.blocks[0]!;
    const next = applyDiffBlockCopy('a\nnew\nc\n', 'a\nold\nc\n', block, 'modified');
    expect(next).toBe('a\nnew\nc\n');
  });

  it('从原始侧复制纯删除块:修改侧在配对位置插入被删行', () => {
    // 原始多了第 3 行;从原始侧复制该块,修改侧补回第 3 行
    const r = computeLineDiff('a\nb\nc\n', 'a\nb\n');
    const block = r.blocks[0]!;
    const next = applyDiffBlockCopy('a\nb\nc\n', 'a\nb\n', block, 'original');
    expect(next).toBe('a\nb\nc\n');
  });

  it('从修改侧复制纯新增块:原始侧在配对位置获得新增行', () => {
    const r = computeLineDiff('a\nb\n', 'a\nb\nc\n');
    const block = r.blocks[0]!;
    const next = applyDiffBlockCopy('a\nb\nc\n', 'a\nb\n', block, 'modified');
    expect(next).toBe('a\nb\nc\n');
  });

  it('从修改侧删除纯新增块:原始侧对应行被移除', () => {
    // 修改侧多了第 3 行;反向「复制」= 把修改侧的空区间写到原始?
    // 语义:发起侧区间为 null(修改侧纯新增块中原始侧为空)时 no-op 由调用侧
    // 不挂按钮规避;此处验证原始侧发起(删除语义:原始侧空 → no-op)
    const r = computeLineDiff('a\nb\n', 'a\nb\nc\n');
    const block = r.blocks[0]!;
    // 从原始侧发起:srcStart=null → no-op
    const noop = applyDiffBlockCopy('a\nb\n', 'a\nb\nc\n', block, 'original');
    expect(noop).toBe('a\nb\nc\n');
  });

  it('多行块整段替换:CRLF 文本保持原 EOL 写回', () => {
    const r = computeLineDiff('a\nX1\nX2\nb\n', 'a\nY1\nY2\nb\n');
    const block = r.blocks[0]!;
    const next = applyDiffBlockCopy(
      'a\r\nX1\r\nX2\r\nb\r\n',
      'a\r\nY1\r\nY2\r\nb\r\n',
      block,
      'original',
    );
    expect(next).toBe('a\r\nX1\r\nX2\r\nb\r\n');
  });

  it('内容相同时为幂等 no-op(返回对侧原文本)', () => {
    const r = computeLineDiff('a\nold\nc\n', 'a\nnew\nc\n');
    const block = r.blocks[0]!;
    // 同块自复制(对侧已一致时):替换结果与原文相等
    const next = applyDiffBlockCopy('a\nnew\nc\n', 'a\nnew\nc\n', block, 'modified');
    expect(next).toBe('a\nnew\nc\n');
  });
});

describe('createBlockLineMapper', () => {
  it('无块时恒等映射', () => {
    const m = createBlockLineMapper([]);
    expect(m.origToMod(5)).toBe(5);
    expect(m.modToOrig(5)).toBe(5);
  });

  it('等价区按行号差平移,块内落对侧区间', () => {
    // 原始 [a,X] vs 修改 [a,i1,i2,i3,Y]:纯新增块 + 修改块(引擎实际产出形态)
    const m = createBlockLineMapper([
      { origStart: null, origEnd: null, modStart: 2, modEnd: 4 },
      { origStart: 2, origEnd: 2, modStart: 5, modEnd: 5 },
    ]);
    expect(m.origToMod(1)).toBe(1);
    expect(m.origToMod(2)).toBe(5);
    expect(m.modToOrig(1)).toBe(1);
    // 新增行落到原始侧插入锚点(第 1 行后)
    expect(m.modToOrig(2)).toBe(1);
    expect(m.modToOrig(4)).toBe(1);
    expect(m.modToOrig(5)).toBe(2);
    expect(m.modToOrig(6)).toBe(3);
  });

  it('纯新增块:修改侧块内行落到原始侧插入锚点', () => {
    // 原始 2 行,修改侧 3~4 行为新增(锚点=原始第 2 行后)
    const m = createBlockLineMapper([{ origStart: null, origEnd: null, modStart: 3, modEnd: 4 }]);
    expect(m.origToMod(1)).toBe(1);
    // 锚点行本身仍归属其前等价游程
    expect(m.origToMod(2)).toBe(2);
    expect(m.modToOrig(1)).toBe(1);
    expect(m.modToOrig(3)).toBe(2);
    expect(m.modToOrig(4)).toBe(2);
  });

  it('不等长块内按比例落点且不出对侧区间', () => {
    const m = createBlockLineMapper([{ origStart: 2, origEnd: 4, modStart: 2, modEnd: 3 }]);
    expect(m.origToMod(2)).toBe(2);
    expect(m.origToMod(4)).toBe(3);
    const mid = m.origToMod(3);
    expect(mid).toBeGreaterThanOrEqual(2);
    expect(mid).toBeLessThanOrEqual(3);
  });
});

describe('computeHiddenRanges', () => {
  it('无块时长游程掐头去尾(默认上下文 3)', () => {
    const r = computeHiddenRanges([], 10, 10);
    expect(r.original).toEqual([{ start: 4, end: 7 }]);
    expect(r.modified).toEqual([{ start: 4, end: 7 }]);
  });

  it('短游程(≤2×context)全部保留', () => {
    const r = computeHiddenRanges([], 5, 5);
    expect(r.original).toEqual([]);
    expect(r.modified).toEqual([]);
  });

  it('块两侧游程各自隐藏,块行永不隐藏', () => {
    const r = computeHiddenRanges(
      [{ origStart: 10, origEnd: 10, modStart: 10, modEnd: 10 }],
      20,
      20,
    );
    expect(r.original).toEqual([
      { start: 4, end: 6 },
      { start: 14, end: 17 },
    ]);
    expect(r.modified).toEqual([
      { start: 4, end: 6 },
      { start: 14, end: 17 },
    ]);
  });

  it('纯新增块:空侧游程不切分(锚点无可见行),消费侧正常切分', () => {
    // 原始 10 行全等价(锚点在第 4 行后不断开):[1,10] 掐头去尾藏 [4,7];
    // 修改侧变更行切开 [1,4] 与 [7,12],均太短不藏
    const r = computeHiddenRanges(
      [{ origStart: null, origEnd: null, modStart: 5, modEnd: 6 }],
      10,
      12,
    );
    expect(r.original).toEqual([{ start: 4, end: 7 }]);
    expect(r.modified).toEqual([]);
  });
});

describe('computeAlignmentZones', () => {
  it('无块或等长块不垫', () => {
    expect(computeAlignmentZones([])).toEqual({ original: [], modified: [] });
    expect(computeAlignmentZones([{ origStart: 2, origEnd: 2, modStart: 5, modEnd: 5 }])).toEqual({
      original: [],
      modified: [],
    });
  });

  it('原始侧长则在修改侧块末垫出行数差', () => {
    // 原始 2~4(3 行) ↔ 修改 2~2(1 行):修改侧第 2 行后垫 2 行
    const r = computeAlignmentZones([{ origStart: 2, origEnd: 4, modStart: 2, modEnd: 2 }]);
    expect(r.original).toEqual([]);
    expect(r.modified).toEqual([{ afterLineNumber: 2, heightInLines: 2 }]);
  });

  it('纯新增块在原始侧锚点垫出整段高度(含文件首行前锚点 0)', () => {
    const r = computeAlignmentZones([{ origStart: null, origEnd: null, modStart: 1, modEnd: 2 }]);
    expect(r.original).toEqual([{ afterLineNumber: 0, heightInLines: 2 }]);
    expect(r.modified).toEqual([]);
  });

  it('纯删除块在修改侧锚点垫块,多块按序产出', () => {
    const r = computeAlignmentZones([
      { origStart: 3, origEnd: 4, modStart: null, modEnd: null },
      { origStart: 10, origEnd: 10, modStart: 8, modEnd: 12 },
    ]);
    // 首块:修改侧锚点 = 消费 2 行后 → 第 2 行后垫 2 行
    expect(r.modified[0]).toEqual({ afterLineNumber: 2, heightInLines: 2 });
    // 次块原始 1 行 vs 修改 5 行 → 原始侧第 10 行后垫 4 行
    expect(r.original).toEqual([{ afterLineNumber: 10, heightInLines: 4 }]);
  });

  it('与引擎产出联动:两侧净垫层等于全文行数差', () => {
    const original = 'a\nX1\nX2\nb\n';
    const modified = 'a\nY1\nb\nc\nd\n';
    const r = computeLineDiff(original, modified);
    const zones = computeAlignmentZones(r.blocks);
    const pad = (list: readonly { heightInLines: number }[]): number =>
      list.reduce((n, z) => n + z.heightInLines, 0);
    // 修改侧多 1 行 → 原始侧净多垫 1(分组形态不影响总量)
    expect(pad(zones.original) - pad(zones.modified)).toBe(1);
  });
});

describe('buildUnifiedPatchFromBlocks', () => {
  it('单修改块:文件头 + hunk 头 + 上下文/增删行', () => {
    const patch = buildUnifiedPatchFromBlocks('a\nold\nc\n', 'a\nnew\nc\n', [
      { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
    ]);
    expect(patch).toContain('--- original');
    expect(patch).toContain('+++ modified');
    expect(patch).toContain('@@ -1,3 +1,3 @@');
    expect(patch).toContain(' a');
    expect(patch).toContain('-old');
    expect(patch).toContain('+new');
    expect(patch).toContain(' c');
  });

  it('纯新增块:原始侧计数为 0(插入式 hunk 头)', () => {
    const patch = buildUnifiedPatchFromBlocks('a\nb\n', 'a\nb\nc\n', [
      { origStart: null, origEnd: null, modStart: 3, modEnd: 3 },
    ]);
    expect(patch).toContain('@@ -1,2 +1,3 @@');
    expect(patch).toContain('+c');
    // 删除体行(排除 `---` 文件头)不存在
    const deletions = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    expect(deletions).toHaveLength(0);
  });

  it('远距离两处修改按上下文拆成独立 hunk', () => {
    const orig = ['a', 'X', 'b', 'c', 'd', 'e', 'f', 'g', 'Y', 'h'].join('\n');
    const mod = ['a', 'X2', 'b', 'c', 'd', 'e', 'f', 'g', 'Y2', 'h'].join('\n');
    const patch = buildUnifiedPatchFromBlocks(
      orig,
      mod,
      [
        { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
        { origStart: 9, origEnd: 9, modStart: 9, modEnd: 9 },
      ],
      { context: 1 },
    );
    // hunk 头 `@@ -a,b +c,d @@` 行首恰出现一次
    expect(patch.match(/^@@ /gm)).toHaveLength(2);
    expect(patch).toContain('-X');
    expect(patch).toContain('+X2');
    expect(patch).toContain('-Y');
    expect(patch).toContain('+Y2');
  });

  it('相邻修改按上下文合并为单个 hunk', () => {
    const patch = buildUnifiedPatchFromBlocks('a\nX\nY\nb\n', 'a\nP\nQ\nb\n', [
      { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
      { origStart: 3, origEnd: 3, modStart: 3, modEnd: 3 },
    ]);
    expect(patch.match(/^@@ /gm)).toHaveLength(1);
  });

  it('无块时只有文件头(空补丁无差异体)', () => {
    const patch = buildUnifiedPatchFromBlocks('', '', [], {
      originalName: 'x',
      modifiedName: 'y',
    });
    expect(patch).toContain('--- x');
    expect(patch).toContain('+++ y');
    const body = patch
      .split('\n')
      .filter((l) => /^[-+]/.test(l))
      .filter((l) => !/^[-+]{3} /.test(l));
    expect(body).toHaveLength(0);
  });

  it('末尾缺换行时追加 No newline 标记', () => {
    const patch = buildUnifiedPatchFromBlocks('a\nold', 'a\nnew', [
      { origStart: 2, origEnd: 2, modStart: 2, modEnd: 2 },
    ]);
    expect(patch).toContain('-old\n\\ No newline at end of file');
    expect(patch).toContain('+new\n\\ No newline at end of file');
  });

  it('与 computeLineDiff 产出的块联动:替换/新增/删除全覆盖', () => {
    const r = computeLineDiff('x\ny\n', 'x\np\nq\nr\n');
    const patch = buildUnifiedPatchFromBlocks('x\ny\n', 'x\np\nq\nr\n', r.blocks);
    expect(patch).toContain('-y');
    expect(patch).toContain('+p');
    expect(patch).toContain('+r');
  });
});

describe('computeLineDiff 边缘 case (Unicode / EOL / 空白)', () => {
  it('代理对 emoji 列号按 UTF-16 码元计(a😀b→a😀c 的变更落在第 4 列)', () => {
    const r = computeLineDiff('a😀b', 'a😀c');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    // 公共前缀 'a😀' 占 3 个 UTF-16 码元(emoji 为代理对 = 2),故差异起列为 4
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 4, end: 5 }]);
    expect(r.modifiedDecos[0].wordSpans).toEqual([{ start: 4, end: 5 }]);
  });

  it('完全相同的多码元 emoji 串无差异(代理对不误拆)', () => {
    const s = '👨‍👩‍👧‍\n🏳️🌈\n';
    const r = computeLineDiff(s, s);
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.similarity).toBe(1);
  });

  it('全角与半角视为不同内容(非规范化不改字符)', () => {
    const r = computeLineDiff('Ａ\n', 'A\n');
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 });
    // 各为单字符(1 码元),整行差异 → 列区间 [1,2)
    expect(r.originalDecos[0].wordSpans).toEqual([{ start: 1, end: 2 }]);
  });

  it('ignoreWhitespace 下 CRLF + 行尾空白混排视为相同', () => {
    const r = computeLineDiff('a  \r\nb\t\r\n', 'a\r\nb\r\n', { ignoreWhitespace: true });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(r.originalDecos).toEqual([]);
  });

  it('ignoreEol 与 ignoreWhitespace 叠加:CRLF 尾空白差异全归零', () => {
    const r = computeLineDiff('foo \r\nbar\r\n', 'foo\nbar\n', {
      ignoreWhitespace: true,
      ignoreEol: true,
    });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it('删一个空行:纯删除精确落在末个空行,不向等行漂移', () => {
    // 原始 a + 3 空行 + b,修改侧 a + 2 空行 + b:jsdiff 把多出的空行归为纯删除(第 4 行)
    const r = computeLineDiff('a\n\n\n\nb\n', 'a\n\n\nb\n');
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(lines(r.originalDecos)).toEqual([4]);
    expect(r.modifiedDecos).toEqual([]);
    // 纯删除块只涉原始侧
    expect(r.blocks).toEqual([{ origStart: 4, origEnd: 4, modStart: null, modEnd: null }]);
    // 空行无词级区间
    expect(r.originalDecos[0].wordSpans).toEqual([]);
  });

  it('相似度:仅一行修改时高位,整体替换时 0', () => {
    const oneLine = computeLineDiff('a\nb\nc\nd\ne\n', 'a\nb\nX\nd\ne\n');
    expect(oneLine.degraded).toBe(false);
    expect(oneLine.similarity).toBeGreaterThan(0.5);
    // maxEditLength=0 强制降级 → 相似度归 0
    expect(computeLineDiff('a\nb\n', 'x\ny\n', { maxEditLength: 0 }).similarity).toBe(0);
  });
});
