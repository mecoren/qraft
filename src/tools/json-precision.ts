/**
 * JSON 大数字精度检测(纯前端,字符串感知)
 *
 * 背景:JSON.parse/serde_json 都把数字按 IEEE 754 双精度(f64)解析:
 * - 超出 Number.MAX_SAFE_INTEGER(2^53-1)的整数会静默取整丢低位;
 * - 有效数字超 ~17 位的小数被舍入;
 * - 超出 f64 范围的指数(JSON.parse 给 Infinity / null)。
 * 「格式化器」不该默默改写用户数据 —— 检测到上述数字时如实警示,
 * 交由用户决定是否在意(lossless-json 式的原样保留需要换解析器,留待后续)。
 *
 * 实现为对源文本的字符串感知扫描:数字 token 只在字符串字面量之外识别,
 * 不依赖解析后的值(解析那一刻精度就已经丢了,源文本才是唯一真相)。
 */

/** 精度问题分类(前端展示用) */
export interface PrecisionIssue {
  /** 原始数字字面量 */
  raw: string;
  /** bigint:超安全整数/溢出指数;decimal:有效数字超 f64 精度 */
  kind: 'bigint' | 'decimal';
  /** 1-based 行列 */
  line: number;
  column: number;
}

/** 报告条数上限:警示用,枚举全量无意义 */
const MAX_ISSUES = 20;
/** f64 十进制有效数字精度上限(15~17 位,17 保守判定) */
const F64_SIGNIFICANT_DIGITS = 17;

/**
 * 扫描 JSON 源文本,检出会丢精度的大数字。
 * 非数字文本/空文本返回空数组;仅识别字符串字面量之外的数字 token。
 */
export function findJsonPrecisionIssues(text: string): PrecisionIssue[] {
  const issues: PrecisionIssue[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const pos = (): { line: number; column: number } => ({ line, column });

  const advance = (ch: string): void => {
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // 字符串字面量:整体跳过(内容里的数字不算)
    if (ch === '"') {
      i++;
      advance('"');
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') {
          i += 2;
          advance(c);
          if (i <= text.length) advance(text[i - 1] ?? '');
          continue;
        }
        if (c === '"') {
          i++;
          advance('"');
          break;
        }
        advance(c);
        i++;
      }
      continue;
    }

    // 数字 token 起点:JSON 数字必以 - 或 0-9 开头(不存在前导 + )
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = pos();
      let j = i;
      if (text[j] === '-') j++;
      while (j < text.length && /[0-9]/.test(text[j])) j++;
      // 小数部分
      if (text[j] === '.') {
        j++;
        while (j < text.length && /[0-9]/.test(text[j])) j++;
      }
      // 指数部分
      if (text[j] === 'e' || text[j] === 'E') {
        j++;
        if (text[j] === '+' || text[j] === '-') j++;
        while (j < text.length && /[0-9]/.test(text[j])) j++;
      }
      const raw = text.slice(i, j);
      const issue = classifyNumber(raw, start);
      if (issue && issues.length < MAX_ISSUES) issues.push(issue);
      // 推进行列计
      for (let k = 0; k < raw.length; k++) advance(raw[k]);
      i = j;
      continue;
    }

    advance(ch);
    i++;
  }

  return issues;
}

/** 判定单个数字字面量的精度风险;安全数字返回 null */
function classifyNumber(raw: string, at: { line: number; column: number }): PrecisionIssue | null {
  // 去符号后分析
  const body = raw.startsWith('-') ? raw.slice(1) : raw;
  const mantissaPart = body.split(/[eE]/)[0];
  const expPart = body.includes('e') || body.includes('E') ? body.split(/[eE]/)[1] : null;

  // 指数值(解析后的数量级):超出 f64 最大值约 1.8e308 即溢出
  if (expPart !== null) {
    const exp = Number.parseInt(expPart.replace('+', ''), 10);
    if (!Number.isNaN(exp) && Math.abs(exp) > 308) {
      return { raw, kind: 'bigint', line: at.line, column: at.column };
    }
  }

  // 整数:超出 MAX_SAFE_INTEGER 判丢精度(负号不影响量级)
  const isInteger = !mantissaPart.includes('.') && expPart === null;
  if (isInteger) {
    const n = Number(mantissaPart);
    if (!Number.isNaN(n) && Math.abs(n) > Number.MAX_SAFE_INTEGER) {
      return { raw, kind: 'bigint', line: at.line, column: at.column };
    }
    return null;
  }

  // 小数:有效数字位数(去小数点)超 f64 精度即存在舍入
  const significant = mantissaPart
    .replace('.', '')
    .replace(/^0+(?=\d)/, '')
    .replace(/^-/, '');
  if (significant.length > F64_SIGNIFICANT_DIGITS) {
    return { raw, kind: 'decimal', line: at.line, column: at.column };
  }
  return null;
}
