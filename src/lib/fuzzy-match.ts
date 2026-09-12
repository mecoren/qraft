/**
 * 模糊匹配 —— 命令面板 / 全局搜索共用(fzf 风格简化打分)
 *
 * 设计口径:
 * - 子串包含(`includes`)优先保留:命中即最高档得分,匹配起始越早、
 *   目标越短得分越高——覆盖「json」「二维码」这类完整词查询的主路径。
 * - 子序列匹配兜底:查询字符按顺序散布出现在目标中即命中(如「jsf」
 *   命中 "json format"),覆盖缩写式查询;连续命中、词首(目标串中
 *   匹配位的前一字符非 ASCII 词字符,含空格/标点/CJK 之后)给奖励,
 *   长跳距给惩罚。
 * - 不引入 fuse.js:目标是「缩写 + 前缀」型的工具名检索,自实现约 60 行
 *   零依赖即可覆盖,且与 search-index 现有静态索引/分组协议零适配成本
 *   (PRD 18 登记的 P1 项,原计划 fuse.js,落地时按此口径收敛)。
 * - 大小写不敏感由调用方归一(统一 toLowerCase 后传入)。
 */

/** 匹配失败哨兵:比「任何成功得分」都小 */
export const NO_MATCH = -1;

/**
 * 词首判定:当前字符是 ASCII 词字符([a-z0-9]),且目标串中它前面的
 * 字符不是 ASCII 词字符(空格 / 标点 / CJK 之后)。CJK 本身无词边界概念,
 * 不参与词首奖励(中文查询走子串/子序列即可命中)。
 */
function isBoundary(prevTarget: string, cur: string): boolean {
  if (prevTarget === '') return true;
  return /[a-z0-9]/.test(cur) && !/[a-z0-9]/.test(prevTarget);
}

/**
 * 计算查询对目标的模糊匹配得分。
 *
 * @param query 已归一(小写)查询串
 * @param target 已归一(小写)目标串
 * @returns 得分(越大越相关);不匹配返回 `NO_MATCH`
 */
export function fuzzyScore(query: string, target: string): number {
  if (query === '') return 0;
  const qLen = query.length;
  const tLen = target.length;
  if (qLen > tLen) return NO_MATCH;

  // —— 子串包含:最高档(基础 100 分),起始越早 / 目标越短越相关 ——
  // 长度惩罚按 5 字/档:描述长的工具(matchText 拼接后普遍 200~400 字符)在
  // 10 字/档口径下直接吃满 20 分上限,与「JSON 数组到表格」这类短名工具拉开
  // 恒定 12 分,导致「json」查询把最常用的「JSON 格式化器」压到第三;改 5 字/档
  // 后长文本惩罚 ~6 分、短文本 ~19 分,名称命中率相近时短名仍优先但不至垄断
  const idx = target.indexOf(query);
  if (idx >= 0) {
    return 100 + Math.max(0, 40 - idx * 4) + Math.max(0, 20 - Math.floor(tLen / 5));
  }

  // —— 子序列:按序贪心扫描,逐字符打分 ——
  let score = 0;
  let ti = 0;
  let lastMatched = -1;
  let run = 0; // 连续命中长度(用于连续奖励)
  for (let qi = 0; qi < qLen; qi++) {
    const qc = query[qi];
    // 顺延扫描:同字符跳过目标中已消费位置,不回溯(子序列贪心对
    // 几十~几百条规模的排序足够;fzf 的精确最优在此收益不成比例)
    let found = -1;
    for (let tj = ti; tj < tLen; tj++) {
      if (target[tj] === qc) {
        found = tj;
        break;
      }
    }
    if (found < 0) return NO_MATCH;

    if (qi > 0 && found === lastMatched + 1) {
      run++;
      score += 4 * run; // 连续命中递增奖励(词干前缀的最强信号)
    } else {
      run = 0;
      score += 1;
    }
    // 词首:目标串中匹配位前一字符非 ASCII 词字符(含目标起始)
    if (isBoundary(found > 0 ? target[found - 1] : '', qc)) score += 6;
    if (found === 0) score += 4; // 目标起始命中
    if (lastMatched >= 0 && found - lastMatched - 1 > 8) score -= 2; // 长跳距轻微惩罚
    lastMatched = found;
    ti = found + 1;
  }
  // 目标越长越稀释相关度
  score += Math.max(0, 12 - Math.floor(tLen / 12));
  return score;
}

/**
 * 批量打分并按得分降序排序;不匹配项剔除。
 * 得分相同时保持原相对顺序(稳定排序),避免同分项跳动。
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  targetOf: (item: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...items];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = fuzzyScore(q, targetOf(item).toLowerCase());
    if (s !== NO_MATCH) scored.push({ item, score: s });
  }
  // Array.prototype.sort 为稳定实现:同分保持原顺序
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
