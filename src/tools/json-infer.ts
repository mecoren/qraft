/**
 * 字符串叶子值的内容类型推断(纯函数,零依赖):
 * 对「看起来是 URL / 十六进制颜色 / ISO 8601 日期时间」的字符串给出标签,
 * 供树视图行尾 chip 预览。只对确凿形态返回非 null —— 推断是增强展示,
 * 误报比漏报更伤信任(如把 "notepad.exe" 标成颜色)。
 */

export type InferredKind = 'url' | 'color' | 'date';

export interface InferredContent {
  kind: InferredKind;
  /** 颜色类:规范化后的 CSS 可用色值(供色块渲染);其余为 null */
  cssColor: string | null;
}

/** URL:http/https 协议开头;不以裸域名猜测(误报率高且无导航价值) */
const URL_RE = /^https?:\/\/\S+$/i;

/** 十六进制颜色:#RGB / #RGBA / #RRGGBB / #RRGGBBAA,大小写不敏感 */
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * ISO 8601 日期或日期时间:
 * 完整形态 2006-01-02 / 2006-01-02T15:04:05(.sss)?(Z | ±HH:MM)?
 * 仅日期不带时间不推断(与"版本号"等短横线串区分度不足)。
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * 推断字符串叶子值的内容类型;无确凿匹配返回 null。
 * 输入先 trim 再判定,但返回的 cssColor 保留原值(色块与复制都应对用户原值)。
 */
export function inferContent(value: unknown): InferredContent | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;

  if (URL_RE.test(s)) return { kind: 'url', cssColor: null };

  if (HEX_COLOR_RE.test(s)) {
    // 4/8 位含 alpha 的形态转成 CSS 可解析的 rgba 等价写法不必要:
    // 现代浏览器 style 直接支持 #RRGGBBAA / #RGBA,原值即合法 CSS 色
    return { kind: 'color', cssColor: s.toLowerCase() };
  }

  if (ISO_DATETIME_RE.test(s)) return { kind: 'date', cssColor: null };

  return null;
}
