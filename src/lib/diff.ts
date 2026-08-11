/**
 * 文本差异引擎 —— Myers O(ND) 行级 diff + 并排对齐 + 行内字符 diff
 *
 * 结构:
 * - diffLines(oldText, newText):行级差异序列(equal/add/remove)
 * - alignDiff(ops):把差异序列整理为并排视图行(左旧右新,remove+add 配对为修改行)
 * - inlineDiff(oldLine, newLine):行内字符级差异(供行内模式段级高亮)
 *
 * 性能保护:
 * - 行数总和超过 MAX_MYERS_LINES 或单行超过 MAX_INLINE_CHARS 时,
 *   退化为「整体删除 + 整体新增」/「整行标记变更」,避免 O(ND) 空间爆炸
 */

export type DiffOp = 'equal' | 'add' | 'remove';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

const MAX_MYERS_LINES = 20000;
const MAX_INLINE_CHARS = 800;

// ============================================================
// Myers 核心(泛型序列)
// ============================================================

/**
 * 对两个序列执行 Myers diff,返回操作序列。
 * equal 元素同时出现在两侧;remove 来自 a;add 来自 b。
 */
function myersDiff<T>(a: readonly T[], b: readonly T[]): Array<{ op: DiffOp; value: T }> {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value) => ({ op: 'add' as const, value }));
  if (m === 0) return a.map((value) => ({ op: 'remove' as const, value }));

  const max = n + m;
  // k → x 的最远到达;trace 记录每轮 d 之前的 V 快照用于回溯
  let v = new Map<number, number>();
  const trace: Array<Map<number, number>> = [];
  let foundD = -1;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v);
    const next = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      const prevKMinus = v.get(k - 1);
      const prevKPlus = v.get(k + 1);
      // 向下走(取 k+1 的 x)还是向右走(k-1 的 x + 1)
      let x: number;
      if (k === -d || (k !== d && (prevKMinus ?? -1) < (prevKPlus ?? -1))) {
        x = prevKPlus ?? 0;
      } else {
        x = (prevKMinus ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next.set(k, x);
      if (x >= n && y >= m) {
        foundD = d;
        break outer;
      }
    }
    v = next;
  }

  if (foundD === -1) {
    // 理论上不可达(最多 n+m 步必达);防御性回退
    return [
      ...a.map((value) => ({ op: 'remove' as const, value })),
      ...b.map((value) => ({ op: 'add' as const, value })),
    ];
  }

  // 回溯构造路径
  const result: Array<{ op: DiffOp; value: T }> = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    const prevKMinus = vPrev.get(k - 1);
    const prevKPlus = vPrev.get(k + 1);
    let prevK: number;
    if (k === -d || (k !== d && (prevKMinus ?? -1) < (prevKPlus ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    // 斜线回溯(equal)
    while (x > prevX && y > prevY) {
      result.push({ op: 'equal', value: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) {
      // 向下:add 来自 b
      result.push({ op: 'add', value: b[y - 1] });
      y--;
    } else {
      // 向右:remove 来自 a
      result.push({ op: 'remove', value: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    result.push({ op: 'equal', value: a[x - 1] });
    x--;
    y--;
  }
  return result.reverse();
}

// ============================================================
// 行级 diff
// ============================================================

/** 行级 diff;空文本按 0 行处理(而非 1 个空行) */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length === 0 ? [] : oldText.split('\n');
  const b = newText.length === 0 ? [] : newText.split('\n');
  if (a.length + b.length > MAX_MYERS_LINES) {
    return [
      ...a.map((text) => ({ op: 'remove' as const, text })),
      ...b.map((text) => ({ op: 'add' as const, text })),
    ];
  }
  return myersDiff(a, b).map(({ op, value }) => ({ op, text: value }));
}

// ============================================================
// 并排对齐模型
// ============================================================

export interface AlignedSide {
  /** 源文本行号(1 起);null 表示该侧无对应行 */
  lineNo: number | null;
  text: string;
  /** 该侧行的变更类型;equal 表示未变 */
  op: DiffOp;
  /** 与对侧配对为修改行(remove+add 同行) */
  paired: boolean;
}

export interface AlignedRow {
  left: AlignedSide | null;
  right: AlignedSide | null;
}

/**
 * 把差异序列整理为左右并排行:
 * - equal → 同一行两侧
 * - 连续 remove 块 + 紧随连续 add 块 → 按下标配对为修改行;多余的单独成行
 */
export function alignDiff(ops: readonly DiffLine[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let i = 0;

  while (i < ops.length) {
    const cur = ops[i];
    if (cur.op === 'equal') {
      rows.push({
        left: { lineNo: oldNo++, text: cur.text, op: 'equal', paired: false },
        right: { lineNo: newNo++, text: cur.text, op: 'equal', paired: false },
      });
      i++;
      continue;
    }

    // 收集连续 remove / add 块
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < ops.length && ops[i].op === 'remove') removes.push(ops[i++]);
    while (i < ops.length && ops[i].op === 'add') adds.push(ops[i++]);

    const pairCount = Math.min(removes.length, adds.length);
    for (let p = 0; p < pairCount; p++) {
      rows.push({
        left: { lineNo: oldNo++, text: removes[p].text, op: 'remove', paired: true },
        right: { lineNo: newNo++, text: adds[p].text, op: 'add', paired: true },
      });
    }
    for (let r = pairCount; r < removes.length; r++) {
      rows.push({
        left: { lineNo: oldNo++, text: removes[r].text, op: 'remove', paired: false },
        right: null,
      });
    }
    for (let aI = pairCount; aI < adds.length; aI++) {
      rows.push({
        left: null,
        right: { lineNo: newNo++, text: adds[aI].text, op: 'add', paired: false },
      });
    }
  }
  return rows;
}

// ============================================================
// 行内字符 diff
// ============================================================

export interface InlineSegment {
  text: string;
  changed: boolean;
}

/**
 * 行内字符级 diff,返回左右两侧的分段(changed 段用于强调底色)。
 * 超过 MAX_INLINE_CHARS 的行整行标记为 changed,避免长行性能问题。
 */
export function inlineDiff(
  oldLine: string,
  newLine: string,
): { left: InlineSegment[]; right: InlineSegment[] } {
  if (oldLine.length > MAX_INLINE_CHARS || newLine.length > MAX_INLINE_CHARS) {
    return {
      left: oldLine ? [{ text: oldLine, changed: true }] : [],
      right: newLine ? [{ text: newLine, changed: true }] : [],
    };
  }
  // 按 Unicode 码点切分,避免代理对被拆散
  const a = Array.from(oldLine);
  const b = Array.from(newLine);
  const ops = myersDiff(a, b);

  const left: InlineSegment[] = [];
  const right: InlineSegment[] = [];
  const pushSeg = (list: InlineSegment[], text: string, changed: boolean) => {
    if (!text) return;
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };

  for (const { op, value } of ops) {
    if (op === 'equal') {
      pushSeg(left, value, false);
      pushSeg(right, value, false);
    } else if (op === 'remove') {
      pushSeg(left, value, true);
    } else {
      pushSeg(right, value, true);
    }
  }
  return { left: cleanupSegments(left), right: cleanupSegments(right) };
}

/**
 * 语义清理:夹在两个 changed 段之间、长度 ≤ 2 码点的 equal 小岛并入 changed,
 * 避免 "world"→"qraft" 因偶然公共字符(如 r)产生碎片化高亮。
 */
function cleanupSegments(segments: InlineSegment[]): InlineSegment[] {
  if (segments.length < 3) return segments;
  const marked = segments.map((s) => ({ ...s }));
  for (let i = 1; i < marked.length - 1; i++) {
    const seg = marked[i];
    if (
      !seg.changed &&
      Array.from(seg.text).length <= 2 &&
      marked[i - 1].changed &&
      marked[i + 1].changed
    ) {
      seg.changed = true;
    }
  }
  // 重新合并相邻同状态段
  const merged: InlineSegment[] = [];
  for (const seg of marked) {
    const last = merged[merged.length - 1];
    if (last && last.changed === seg.changed) last.text += seg.text;
    else merged.push(seg);
  }
  return merged;
}

/** 汇总统计:新增行数 / 删除行数 / 修改对数 */
export function summarizeDiff(rows: readonly AlignedRow[]): {
  added: number;
  removed: number;
  modified: number;
} {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const row of rows) {
    if (row.left?.paired && row.right?.paired) modified++;
    else if (row.left && !row.right) removed++;
    else if (!row.left && row.right) added++;
  }
  return { added, removed, modified };
}
