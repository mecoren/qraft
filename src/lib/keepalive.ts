/**
 * 工具页 keepalive 容量管理(LRU)。
 *
 * 背景:ToolPanel 对访问过的工具全部常驻挂载(display:none 切显隐),其中编辑器类
 * 工具各自持有 Monaco 实例(单个数十 MB 级)。无上限驻留会在长会话中击穿
 * 「空闲内存 <150MB」目标,因此限制同时挂载的工具数量,超出时淘汰最久未访问者。
 *
 * 语义:最近访问的工具排在数组末尾;容量超限从头(最旧)淘汰,但当前工具永不淘汰,
 * 且至少保留 1 个。被淘汰工具的组件卸载、Monaco dispose;其输入状态凡存于
 * zustand store 者(如 jsonFormatterStore)切回自动恢复,纯本地 state 者重置——
 * 这是内存目标的必要取舍。
 */

/** 同时挂载的最大工具数:覆盖一次典型多工具交叉比对会话,同时约束 Monaco 实例总量 */
export const MAX_KEEPALIVE_TOOLS = 8;

export function pushVisited(visited: string[], toolId: string, max: number): string[] {
  // 移除既有同名项再追加 → 兼具「去重」与「刷新最近使用位序」两个语义
  const next = visited.filter((id) => id !== toolId);
  next.push(toolId);
  const cap = Math.max(max, 1);
  while (next.length > cap) {
    // 从头(最旧)找第一个非当前工具者淘汰;全是当前工具时保底保留 1 个
    const oldestIdx = next.findIndex((id) => id !== toolId);
    next.splice(oldestIdx === -1 ? 0 : oldestIdx, 1);
    if (next.length === 1) break;
  }
  return next;
}
