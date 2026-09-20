/**
 * JSON 结构统计(纯前端,单次遍历)
 *
 * 市面 JSON 工具的普遍空白项:节点/键/深度/顶层键统计一次遍历即可得,
 * 成本极低而信息量大(文档规模、嵌套深度、顶层形态一目了然)。
 * 与 meta 对齐配合使用:后端路径由 Rust 回填 OutputMeta,前端路径由
 * JsonFormatter 同构计算,统计则两条路径共用本模块。
 */

/** 统计结果;containers 含根容器 */
export interface JsonStats {
  /** 对象节点总数(含根对象与嵌套对象) */
  objects: number;
  /** 数组节点总数 */
  arrays: number;
  /** 对象键总数(所有层级) */
  keys: number;
  /** 叶子值总数(标量,含 null;空容器不产叶) */
  leaves: number;
  /** 最大嵌套深度(树高:最深链节点数,根算 1) */
  maxDepth: number;
  /** 根对象的键名列表(展示上限截断,仅根为对象时非空) */
  topLevelKeys: string[];
}

/** 顶层键展示上限:过宽文档截断为摘要,避免标题栏被撑爆 */
const MAX_TOP_LEVEL_KEYS = 100;
/** 单文档节点访问上限:防御构造性巨文档(如百万元素数组),超限停止累计 */
const MAX_VISIT_NODES = 2_000_000;

/**
 * 单次遍历收集 JSON 结构统计。
 * 深度语义:树高 = 最深链的节点数,根算 1(容器与叶子都计深)。
 * 迭代 + 显式栈(不用递归):深嵌套文档不会爆调用栈;节点配额超限时
 * 停止累计并如实返回已统计部分(统计是展示信息,不值得为它卡 UI)。
 */
export function collectJsonStats(value: unknown): JsonStats {
  const stats: JsonStats = {
    objects: 0,
    arrays: 0,
    keys: 0,
    leaves: 0,
    maxDepth: 0,
    topLevelKeys: [],
  };
  let visited = 0;

  // 显式栈元素:[值, 深度];任何根(含标量)深度都从 1 起
  const stack: Array<[unknown, number]> = [[value, 1]];

  while (stack.length > 0) {
    if (visited >= MAX_VISIT_NODES) break;
    const [v, depth] = stack.pop()!;
    visited++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (Array.isArray(v)) {
      stats.arrays++;
      for (const item of v) {
        if (visited + stack.length >= MAX_VISIT_NODES) break;
        stack.push([item, depth + 1]);
      }
      continue;
    }
    if (v !== null && typeof v === 'object') {
      stats.objects++;
      const entries = Object.entries(v as Record<string, unknown>);
      stats.keys += entries.length;
      if (depth === 1 && stats.topLevelKeys.length === 0) {
        // 根对象键列表:先判 length === 0 保证只记根(嵌套对象 depth > 1)
        stats.topLevelKeys = entries.slice(0, MAX_TOP_LEVEL_KEYS).map(([k]) => k);
      }
      for (const [, item] of entries) {
        if (visited + stack.length >= MAX_VISIT_NODES) break;
        stack.push([item, depth + 1]);
      }
      continue;
    }
    // 标量(含 null):叶子
    stats.leaves++;
  }

  return stats;
}

/**
 * 解析后端 `ToolOutput.extra` 里的 `stats`(Rust `collect_stats` 与本模块同口径产出)。
 * 结构不受信任,逐字段守卫;任一字段缺失或类型不符即返回 null,由调用方回落到
 * 本地 `collectJsonStats`(旧版后端 / 非 JSON 输入路径)。
 */
export function parseFormatterExtra(raw: unknown): JsonStats | null {
  if (!isRecord(raw) || !isRecord(raw.stats)) return null;
  const stats = raw.stats;
  const { objects, arrays, keys, leaves, maxDepth, topLevelKeys } = stats;
  if (
    !isCount(objects) ||
    !isCount(arrays) ||
    !isCount(keys) ||
    !isCount(leaves) ||
    !isCount(maxDepth) ||
    !Array.isArray(topLevelKeys) ||
    !topLevelKeys.every((k): k is string => typeof k === 'string')
  ) {
    return null;
  }
  return { objects, arrays, keys, leaves, maxDepth, topLevelKeys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
