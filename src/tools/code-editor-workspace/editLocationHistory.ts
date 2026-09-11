/**
 * 编辑位置历史 —— 编辑器「返回 / 前进上一个编辑位置」的导航栈
 *
 * 对标 VSCode location history / 浏览器后退-前进心智:
 * - 光标停留/切换 Tab 时记录位置(tabId + 行/列 + 视口首行);
 * - 同一 Tab 内连续记录间隔小于 EDIT_GAP_MS 视为同一段编辑(时间合并),
 *   避免「每敲一个字符就入栈一条」;跳转超过 JUMP_MIN_LINES 行或跨 Tab
 *   立即分条(VSCode 同款节流思路);
 * - Alt+Left 后退:弹栈进入前进栈,恢复位置(跨 Tab 则切换激活);
 * - Alt+Right 前进:对称操作;
 * - 栈容量上限 HISTORY_MAX,超限丢最旧。
 *
 * 纯模块单例(非 React 状态):编辑器工作台卸载不清空 —— 位置历史是
 * 会话级导航记忆,与 Tab 快照(recentlyClosed)不同类。
 */

/** 一次编辑位置记录 */
export interface EditLocation {
  /** 目标 Tab id */
  tabId: string;
  /** 行号(1-based) */
  line: number;
  /** 列号(1-based) */
  column: number;
  /** 记录时刻(epoch 毫秒,时间合并用) */
  atMs: number;
}

/** 连续记录的时间合并窗口:间隔内的记录视为同一段编辑,只保留最新位置 */
const EDIT_GAP_MS = 2000;

/** 同 Tab 跳转超过该行数立即分条(阅读跳转 vs 连续编辑的区分) */
const JUMP_MIN_LINES = 10;

/** 栈容量上限(后退栈;前进栈在每次新记录时清空,不额外封顶) */
const HISTORY_MAX = 100;

/** 当前游标之前的访问序列(后退可用);末元素为最近位置 */
const backStack: EditLocation[] = [];
/** 后退产生的「前进可用」位置序列;任何新记录会清空它(浏览器同款语义) */
const forwardStack: EditLocation[] = [];

/**
 * 推入一条位置记录(编辑器光标变化 / Tab 切换时调用)。
 *
 * 合并规则(满足任一则与栈顶合并为一条,保留最新位置):
 * - 同 Tab 且距栈顶记录不足 EDIT_GAP_MS;
 * - 同 Tab 且行距不足 JUMP_MIN_LINES(短距离移动视为同段)。
 * 跨 Tab 或长距离跳转恒分条。recordFor 由调用方记录后返回是否分条
 * 无需 —— 合并/分条对调用方透明。
 */
export function recordEditLocation(loc: Omit<EditLocation, 'atMs'>): void {
  const entry: EditLocation = { ...loc, atMs: Date.now() };
  const top = backStack[backStack.length - 1];
  if (top && top.tabId === loc.tabId) {
    const withinGap = entry.atMs - top.atMs < EDIT_GAP_MS;
    const nearby = Math.abs(loc.line - top.line) < JUMP_MIN_LINES;
    if (withinGap || nearby) {
      backStack[backStack.length - 1] = entry;
      return;
    }
  }
  backStack.push(entry);
  if (backStack.length > HISTORY_MAX) backStack.splice(0, backStack.length - HISTORY_MAX);
  // 新的编辑序列开启:前进栈作废(浏览器后退后再编辑,无法再前进)
  forwardStack.length = 0;
}

/**
 * 后退到上一个位置:弹 backStack 栈顶入 forwardStack。
 * 返回目标位置;无历史返回 null。
 */
export function goBackEditLocation(): EditLocation | null {
  const current = backStack.pop();
  if (!current) return null;
  forwardStack.push(current);
  return backStack[backStack.length - 1] ?? null;
}

/**
 * 前进到下一个位置:弹 forwardStack 栈顶入 backStack。
 * 返回目标位置;无可前进返回 null。
 */
export function goForwardEditLocation(): EditLocation | null {
  const next = forwardStack.pop();
  if (!next) return null;
  backStack.push(next);
  return next;
}

/** 后退栈深度(测试 / 调试用) */
export function editLocationBackCount(): number {
  return backStack.length;
}

/** 前进栈深度(测试 / 调试用) */
export function editLocationForwardCount(): number {
  return forwardStack.length;
}

/** 清空两栈(测试用) */
export function resetEditLocationHistory(): void {
  backStack.length = 0;
  forwardStack.length = 0;
}
