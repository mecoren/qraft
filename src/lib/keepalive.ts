/**
 * 工具页 keepalive 容量管理(加权 LRU)。
 *
 * 背景:ToolPanel 对访问过的工具全部常驻挂载(display:none 切显隐),其中编辑器类
 * 工具各自持有 Monaco 实例(单个数十 MB 级)。无上限驻留会在长会话中击穿
 * 「空闲内存 <150MB」目标,因此限制同时挂载的工具数量,超出时淘汰最久未访问者。
 *
 * 语义:最近访问的工具排在数组末尾;容量超限从头(最旧)淘汰,但当前工具永不淘汰,
 * 且至少保留 1 个。被淘汰工具的组件卸载、Monaco dispose;其输入状态凡存于
 * zustand store 者(如 jsonFormatterStore)切回自动恢复,纯本地 state 者重置——
 * 这是内存目标的必要取舍。
 *
 * 加权:重型工具(catalog `heavy: true`,内嵌 Monaco)按 2 个名额计权,轻工具
 * 1 个 —— 单位名额的内存成本等价化,同样的容量上限下 Monaco 实例数减半。
 */

import { getCatalogEntry } from '@/lib/tool-catalog';

/** 同时挂载的最大名额数(重工具占 2):覆盖一次典型多工具交叉比对会话,同时约束 Monaco 实例总量 */
export const MAX_KEEPALIVE_SLOTS = 10;

/** 单个工具占用的名额数 */
export function toolSlots(toolId: string): number {
  return getCatalogEntry(toolId)?.heavy ? 2 : 1;
}

/**
 * 计算已访问列表占用的总名额。
 * 未知 id(测试/异常路径)按 1 计。
 */
export function totalSlots(visited: readonly string[]): number {
  return visited.reduce((sum, id) => sum + toolSlots(id), 0);
}

export function pushVisited(visited: string[], toolId: string, max: number): string[] {
  // 移除既有同名项再追加 → 兼具「去重」与「刷新最近使用位序」两个语义
  const next = visited.filter((id) => id !== toolId);
  next.push(toolId);
  const cap = Math.max(max, 1);
  // 名额制容量:超限即从最旧端逐个淘汰(跳过当前工具),直到名额回归上限
  while (totalSlots(next) > cap && next.length > 1) {
    const oldestIdx = next.findIndex((id) => id !== toolId);
    next.splice(oldestIdx === -1 ? 0 : oldestIdx, 1);
    // 兜底:只剩当前工具时停止(即使它一个就超上限)
    if (next.length === 1) break;
  }
  return next;
}
