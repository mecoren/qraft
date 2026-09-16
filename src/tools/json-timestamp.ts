/**
 * JSON 内时间戳批量互转(纯前端,零依赖)
 *
 * 对照 Json Assistant 的 Convert timestamps to readable time /
 * Convert times to timestamp(单个 hover 转换 + 全局批量),本模块做
 * "全局批量"的纯函数核心:递归扫描叶子值,时间戳 ↔ 可读时间整体改写。
 *
 * 约定:
 * - 时间戳判定区间:[1e9, 1e13),即 2001-09-09(秒)至 2286 年(毫秒);
 *   10 位(1e9..1e12)按秒,13 位(≥1e12)按毫秒;区间外数字视为普通数值。
 * - 数字与纯数字字符串都认(接口里两种形态都常见);转换后统一为字符串
 *   (时间戳→时间)或数字毫秒(时间→时间戳),与 Json Assistant 示例一致。
 * - 时间→时间戳仅认 `YYYY-MM-DD[ T]HH:mm:ss` 与 ISO 8601(经 Date.parse
 *   兜底,无效日期不转);纯日期(`YYYY-MM-DD`)不转 —— 与版本号/短横线串
 *   区分度不足,误转代价高于漏转(与 json-infer 的保守口径一致)。
 * - 不变更输入(返回新结构),调用方决定写回;输出时间为本地时区。
 */

export interface TimestampConvertResult {
  /** 转换后的值(无转换时与输入深相等的新结构) */
  value: unknown;
  /** 成功转换的叶子数 */
  count: number;
}

/** 时间戳数值区间下限(秒,2001-09-09) */
const MIN_TS = 1_000_000_000;
/** 时间戳数值区间上限(毫秒,2286 年附近) */
const MAX_TS = 10_000_000_000_000;
/** ≥1e12 按毫秒计,以下按秒计 */
const MS_THRESHOLD = 1_000_000_000_000;

/** 纯数字字符串(10~13 位,时间戳常见形态) */
const DIGITS_RE = /^-?\d{10,13}$/;
/** `YYYY-MM-DD HH:mm:ss`(空格/T 分隔,秒可省) */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
/** ISO 8601 前缀(`YYYY-MM-DDT…`,时区/毫秒不限,交 Date.parse 细判) */
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 本地时区 `YYYY-MM-DD HH:mm:ss` */
function formatLocal(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** 数值转毫秒:区间外返回 null(视为普通数字,不转) */
function toMillis(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs < MIN_TS || abs >= MAX_TS) return null;
  const truncated = Math.trunc(n);
  return abs >= MS_THRESHOLD ? truncated : truncated * 1000;
}

function convertToDateNode(value: unknown, counter: { count: number }): unknown {
  if (typeof value === 'number' || (typeof value === 'string' && DIGITS_RE.test(value.trim()))) {
    const ms = toMillis(typeof value === 'number' ? value : Number(value.trim()));
    if (ms !== null) {
      counter.count++;
      return formatLocal(ms);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertToDateNode(item, counter));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = convertToDateNode(child, counter);
    }
    return out;
  }
  return value;
}

/**
 * 时间戳 → 可读时间(`YYYY-MM-DD HH:mm:ss`,本地时区)。
 * 数字变字符串,纯数字字符串同样转换;区间外数字与非时间文本原样保留。
 */
export function convertTimestampsToDates(value: unknown): TimestampConvertResult {
  const counter = { count: 0 };
  return { value: convertToDateNode(value, counter), count: counter.count };
}

/** 时间文本转毫秒时间戳;不认的文本返回 null */
function parseDateTime(s: string): number | null {
  const trimmed = s.trim();
  // 仅认两种确凿形态,不把 Date.parse 的宽容口径(如 "Mar 15 2020")
  // leak 进来 —— 误转普通文本的代价高于漏转
  if (!DATETIME_RE.test(trimmed) && !ISO_PREFIX_RE.test(trimmed)) return null;
  // `YYYY-MM-DD HH:mm:ss` 的空格分隔部分引擎不认,统一换 T 再解析
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function convertToTsNode(value: unknown, counter: { count: number }): unknown {
  if (typeof value === 'string') {
    const ms = parseDateTime(value);
    if (ms !== null) {
      counter.count++;
      return ms;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertToTsNode(item, counter));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = convertToTsNode(child, counter);
    }
    return out;
  }
  return value;
}

/**
 * 可读时间 → 毫秒时间戳(数字)。
 * 仅转换确凿的时间形态;普通字符串、纯日期、已是数字的值原样保留。
 */
export function convertDatesToTimestamps(value: unknown): TimestampConvertResult {
  const counter = { count: 0 };
  return { value: convertToTsNode(value, counter), count: counter.count };
}
