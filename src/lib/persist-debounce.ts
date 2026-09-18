/**
 * 工具文档/工作区落盘的防抖窗口计算。
 *
 * 这些工具的持久化是「整份载荷全量重写」(config_set 一次覆盖整个 key),
 * 载荷越大单次写越贵:KB 级用短窗口尽快落盘,MB 级把连续编辑合并成一次
 * 磁盘写以降低写放大。代价是极端情况下最多丢失一个窗口内的编辑,
 * 对工具输入这类可重录内容可接受(窗口关闭与组件卸载仍有立即冲刷兜底)。
 */

/** 按载荷总字符数自适应的持久化防抖间隔(ms) */
export function persistDelayFor(totalChars: number): number {
  if (totalChars > 1024 * 1024) return 5000;
  if (totalChars > 256 * 1024) return 2000;
  return 500;
}
