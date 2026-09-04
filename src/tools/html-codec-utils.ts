/**
 * HTML 文本编码/解码纯逻辑
 *
 * 编码模式(对标 DevToys / commons-text StringEscapeUtils):
 * - minimal:仅 & < > " '(防注入最小集合)
 * - nonAscii:minimal + 非 ASCII 码点转数字实体(保持输出纯 ASCII)
 * - all:全部可转义字符均转命名实体
 *
 * 解码:自实现命名实体表 + 数字实体,不依赖 DOMParser
 * (jsdom 的 DOMParser 实体行为与浏览器不一致,自实现保证可测可移植)。
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML 4.0 常用命名实体 → 字符(解码表,覆盖 &nbsp; &copy; 等) */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  dagger: '\u2020',
  permil: '\u2030',
  larr: '\u2190',
  uarr: '\u2191',
  rarr: '\u2192',
  darr: '\u2193',
  harr: '\u2194',
  infin: '\u221e',
  ne: '\u2260',
  le: '\u2264',
  ge: '\u2265',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  deg: '\u00b0',
  micro: '\u00b5',
  para: '\u00b6',
  sect: '\u00a7',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  sup1: '\u00b9',
  sup2: '\u00b2',
  sup3: '\u00b3',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  szlig: '\u00df',
  agrave: '\u00e0',
  aacute: '\u00e1',
  eacute: '\u00e9',
  egrave: '\u00e8',
  ugrave: '\u00f9',
  uacute: '\u00fa',
  ccedil: '\u00e7',
  auml: '\u00e4',
  ouml: '\u00f6',
  uuml: '\u00fc',
  Alpha: '\u0391',
  Beta: '\u0392',
  Gamma: '\u0393',
  Delta: '\u0394',
  Omega: '\u03a9',
  alpha: '\u03b1',
  beta: '\u03b2',
  gamma: '\u03b3',
  delta: '\u03b4',
  omega: '\u03c9',
  pi: '\u03c0',
};

/** all 模式额外转义的可打印字符(命名实体) */
const FULL_ESCAPE_MAP: Record<string, string> = {
  ...ESCAPE_MAP,
  '\u00a0': '&nbsp;',
  '\u00a9': '&copy;',
  '\u00ae': '&reg;',
  '\u2122': '&trade;',
  '\u2026': '&hellip;',
  '\u2014': '&mdash;',
  '\u2013': '&ndash;',
  '\u2018': '&lsquo;',
  '\u2019': '&rsquo;',
  '\u201c': '&ldquo;',
  '\u201d': '&rdquo;',
  '\u2022': '&bull;',
  '\u2190': '&larr;',
  '\u2191': '&uarr;',
  '\u2192': '&rarr;',
  '\u2193': '&darr;',
  '\u2194': '&harr;',
  '\u221e': '&infin;',
  '\u00b1': '&plusmn;',
  '\u00d7': '&times;',
  '\u00f7': '&divide;',
  '\u00b0': '&deg;',
  '\u00a3': '&pound;',
  '\u00a5': '&yen;',
  '\u20ac': '&euro;',
  '\u00a2': '&cent;',
  '\u00a7': '&sect;',
  '\u00b6': '&para;',
  '\u00b7': '&middot;',
  '\u00ab': '&laquo;',
  '\u00bb': '&raquo;',
  '\u00bd': '&frac12;',
  '\u00bc': '&frac14;',
  '\u00be': '&frac34;',
  '\u00b9': '&sup1;',
  '\u00b2': '&sup2;',
  '\u00b3': '&sup3;',
  '\u00a1': '&iexcl;',
  '\u00bf': '&iquest;',
};

export type HtmlEncodeMode = 'minimal' | 'nonAscii' | 'all';

export function encodeHtml(input: string, mode: HtmlEncodeMode = 'minimal'): string {
  if (mode === 'minimal') {
    return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
  }
  if (mode === 'nonAscii') {
    // ASCII 区间断言为有意设计(输出纯 ASCII);\x00 仅作区间端点
    // eslint-disable-next-line no-control-regex
    return input.replace(/[&<>"']|[^\x00-\x7f]/gu, (ch) => {
      if (ESCAPE_MAP[ch]) return ESCAPE_MAP[ch];
      const cp = ch.codePointAt(0)!;
      return cp > 0xffff
        ? `&#x${cp.toString(16).toUpperCase()};`
        : `&#${cp};`;
    });
  }
  // all:命名实体优先,无命名的码点转数字实体
  return input.replace(/[&<>"']|[\u0080-\uffff]|\S/gu, (ch) => {
    if (FULL_ESCAPE_MAP[ch]) return FULL_ESCAPE_MAP[ch];
    const cp = ch.codePointAt(0)!;
    return cp > 0xffff ? `&#x${cp.toString(16).toUpperCase()};` : `&#${cp};`;
  });
}

export function decodeHtml(input: string): string {
  // 实体格式:&name; &#NNN; &#xHHH;(分号可省略的常见宽松形式:&amp &lt &gt &quot)
  return input.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const num = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        // 代理区/越界码点返回 U+FFFD 替换字符
        if (Number.isNaN(num) || num < 0 || num > 0x10ffff || (num >= 0xd800 && num <= 0xdfff)) {
          return '\ufffd';
        }
        return String.fromCodePoint(num);
      }
      const named = NAMED_ENTITIES[body];
      if (named !== undefined) return named;
      return match; // 未知实体原样保留
    },
  );
}

/** roundtrip 校验:minimal 编码后解码应还原原文 */
export function isReversible(input: string, mode: HtmlEncodeMode): boolean {
  return decodeHtml(encodeHtml(input, mode)) === input;
}
