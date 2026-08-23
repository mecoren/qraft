/**
 * 锚点式滚动同步(Typora 方案)
 *
 * 以「标题源行号 ↔ 预览元素 offsetTop」为锚点,在相邻锚点间做分段线性插值:
 * - 编辑器 → 预览:首行行号 → 插值得预览 scrollTop
 * - 预览 → 编辑器:scrollTop → 插值得浮点行号 → 换算 Monaco scrollTop
 * 相比整体比例映射,大代码块/图片造成的局部密度差异不再引发漂移。
 */

export interface ScrollSyncAnchor {
  /** 源文本行号(1-based) */
  line: number;
  /** 对应标题元素相对滚动容器的 offsetTop(px) */
  top: number;
}

/**
 * 构建同步锚点序列(按 line 与 top 均严格递增):
 * [文档起点] + 各标题锚点 + [文档终点(最大滚动位)]。
 * 无标题时退化为两点线性 = 整体比例映射,行为自然回退。
 */
export function buildSyncAnchors(options: {
  headings: ReadonlyArray<{ id: string; line: number }>;
  resolveTop: (id: string) => number | null;
  maxLine: number;
  maxScrollTop: number;
}): ScrollSyncAnchor[] {
  const { headings, resolveTop, maxLine, maxScrollTop } = options;
  const anchors: ScrollSyncAnchor[] = [{ line: 1, top: 0 }];
  let lastLine = 1;
  for (const heading of headings) {
    if (heading.line <= lastLine) continue;
    const top = resolveTop(heading.id);
    if (top === null || top <= anchors[anchors.length - 1].top) continue;
    anchors.push({ line: heading.line, top });
    lastLine = heading.line;
  }
  const endLine = Math.max(maxLine, lastLine + 1);
  const endTop = Math.max(maxScrollTop, anchors[anchors.length - 1].top);
  anchors.push({ line: endLine, top: endTop });
  return anchors;
}

/** 分段线性插值:x 落在第 i 段 [a,b] 内时映射到对应值;越界侧夹取到端点 */
export function mapAcrossAnchors(
  anchors: ReadonlyArray<ScrollSyncAnchor>,
  x: number,
  from: 'line' | 'top',
  to: 'line' | 'top',
): number {
  const count = anchors.length;
  if (count === 0) return 0;
  if (count === 1) return anchors[0][to];

  // 夹取到两端
  if (x <= anchors[0][from]) return anchors[0][to];
  const lastA = anchors[count - 1];
  if (x >= lastA[from]) return lastA[to];

  for (let i = 0; i < count - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (x >= a[from] && x <= b[from]) {
      const span = b[from] - a[from];
      if (span <= 0) return a[to];
      const t = (x - a[from]) / span;
      return a[to] + t * (b[to] - a[to]);
    }
  }
  return lastA[to];
}
