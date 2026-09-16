/**
 * 嵌套 JSON 字符串展开(纯前端,零依赖)
 *
 * 背景:接口返回里常见双重编码的 JSON —— 字符串叶子本身又是一段 JSON
 * 文本,如 `{"address": "{\"city\": \"杭州\"}"}`。对照 Json Assistant 的
 * Expand nested JSON(单个 hover 转换 + 全局批量),本模块做"全局批量"
 * 的纯函数核心:递归扫描,把能解析为对象/数组的字符串叶子原地展开。
 *
 * 约束:
 * - 仅展开解析结果为对象/数组的字符串;"123"/"true" 这类标量字符串保持
 *   原样(展开会静默改变字段类型,属意外行为)。
 * - 深度上限防病态自嵌套;输入不做变更(返回新结构),调用方决定写回。
 */

export interface NestedExpandResult {
  /** 展开后的值(无展开时与输入深相等的新结构) */
  value: unknown;
  /** 成功展开的字符串叶子数 */
  count: number;
}

/** 递归展开深度上限:正常嵌套远到不了,上限只防构造性输入 */
const MAX_DEPTH = 10;

function expandNode(value: unknown, depth: number, counter: { count: number }): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (depth < MAX_DEPTH && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object') {
          counter.count++;
          return expandNode(parsed, depth + 1, counter);
        }
      } catch {
        // 不是合法 JSON:保持原字符串,不报不猜
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandNode(item, depth, counter));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = expandNode(child, depth, counter);
    }
    return out;
  }
  return value;
}

/**
 * 递归展开值内全部嵌套 JSON 字符串(对象/数组形态)。
 * 纯函数:不变更输入;count 为 0 时调用方应如实提示"无嵌套可展"。
 */
export function expandNestedJson(value: unknown): NestedExpandResult {
  const counter = { count: 0 };
  return { value: expandNode(value, 0, counter), count: counter.count };
}
