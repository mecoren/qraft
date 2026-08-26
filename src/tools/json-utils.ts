/**
 * JSON 工具共享纯函数
 *
 * 来源:原 JSON 增强工具(JsonEnhancer)的能力在合并进 JSON 格式化工具后,
 * 相关纯函数逻辑统一收敛到此模块,便于复用与单测。
 */

/**
 * 键排序模式:
 * - alpha          大小写敏感字典序(逐字符码元比较)
 * - alpha-insensitive 忽略大小写字典序(同形时回退大小写敏感比较)
 * - natural        自然排序(数字段按数值比较,如 a2 < a10)
 * - length         按键长度(等长时回退字典序)
 * - hex            十六进制(把键中首个十六进制数字串按数值比较,失败回退字典序)
 * - reverse        反转(保持对象原键序并整体倒置)
 * - random         随机(洗牌)
 */
import { t } from '@/i18n';

export type JsonKeySortMode =
  'alpha' | 'alpha-insensitive' | 'natural' | 'length' | 'hex' | 'reverse' | 'random';

/** 递归对 JSON 对象的键做字典序排序(升/降),数组顺序与基本类型保持不变。 */
export function sortJsonKeys(value: unknown, descending = false): unknown {
  return sortJsonKeysBy(value, { mode: 'alpha', descending });
}

export interface JsonSortOptions {
  /** 排序模式,默认大小写敏感字典序 */
  mode?: JsonKeySortMode;
  /** 是否降序(仅参与排序类模式;reverse/random 忽略),默认 false */
  descending?: boolean;
}

/** 从键中提取首个十六进制数字串并解析为数值;无有效值返回 null */
function hexValueOf(key: string): number | null {
  const match = /0x[0-9a-f]+|[0-9a-f]{2,}/i.exec(key);
  if (!match) return null;
  const n = Number.parseInt(match[0].replace(/^0x/i, ''), 16);
  return Number.isNaN(n) ? null : n;
}

/** 自然排序分段:连续 ASCII 数字为一段,其余为一段,数字段按数值比较 */
function naturalCompare(a: string, b: string): number {
  const re = /\d+|\D+/g;
  const sa = a.match(re) ?? [];
  const sb = b.match(re) ?? [];
  const len = Math.min(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i];
    const y = sb[i];
    if (x === y) continue;
    const bothDigits = /^\d/.test(x) && /^\d/.test(y);
    if (bothDigits) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      // 数值相等但前导零不同:短的在前
      return x.length - y.length;
    }
    return x < y ? -1 : 1;
  }
  return sa.length - sb.length;
}

/** 构造指定模式与方向的键比较器(reverse/random 由调用方单独处理) */
function keyComparator(
  mode: JsonKeySortMode,
  descending: boolean,
): (a: string, b: string) => number {
  const flip = descending ? -1 : 1;
  switch (mode) {
    case 'alpha-insensitive':
      return (a, b) => {
        const la = a.toLowerCase();
        const lb = b.toLowerCase();
        if (la !== lb) return (la < lb ? -1 : 1) * flip;
        return (a < b ? -1 : a > b ? 1 : 0) * flip;
      };
    case 'natural':
      return (a, b) => {
        const d = naturalCompare(a, b);
        return d !== 0 ? d * flip : (a < b ? -1 : a > b ? 1 : 0) * flip;
      };
    case 'length':
      return (a, b) => {
        const d = a.length - b.length;
        if (d !== 0) return d * flip;
        return (a < b ? -1 : a > b ? 1 : 0) * flip;
      };
    case 'hex':
      return (a, b) => {
        const ha = hexValueOf(a);
        const hb = hexValueOf(b);
        if (ha !== null && hb !== null && ha !== hb) return (ha - hb) * flip;
        if (ha !== null && hb === null) return -1 * flip;
        if (ha === null && hb !== null) return 1 * flip;
        return (a < b ? -1 : a > b ? 1 : 0) * flip;
      };
    case 'alpha':
    default:
      return (a, b) => (a < b ? -1 : a > b ? 1 : 0) * flip;
  }
}

/**
 * 递归按指定模式对 JSON 对象的键排序。
 * 数组顺序保持不变(数组元素内的对象同样递归排序);基本类型原样返回。
 */
export function sortJsonKeysBy(value: unknown, options: JsonSortOptions = {}): unknown {
  const mode = options.mode ?? 'alpha';
  const descending = options.descending ?? false;

  const transformObject = (obj: Record<string, unknown>): Record<string, unknown> => {
    let keys: string[];
    if (mode === 'reverse') {
      keys = Object.keys(obj).reverse();
    } else if (mode === 'random') {
      keys = Object.keys(obj);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
    } else {
      keys = Object.keys(obj).sort(keyComparator(mode, descending));
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sortJsonKeysBy(obj[k], options);
    return out;
  };

  if (Array.isArray(value)) return value.map((v) => sortJsonKeysBy(v, options));
  if (value !== null && typeof value === 'object') {
    return transformObject(value as Record<string, unknown>);
  }
  return value;
}

/** XML Element → 普通 JS 对象(属性以 @ 前缀,文本为 #text) */
function xmlElementToObject(el: Element): unknown {
  const obj: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    obj[`@${attr.name}`] = attr.value;
  }
  const childElements = Array.from(el.children);
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();

  if (childElements.length === 0) {
    if (Object.keys(obj).length === 0) return text;
    if (text) obj['#text'] = text;
    return obj;
  }

  for (const child of childElements) {
    const converted = xmlElementToObject(child);
    const existing = obj[child.tagName];
    if (existing === undefined) {
      obj[child.tagName] = converted;
    } else if (Array.isArray(existing)) {
      existing.push(converted);
    } else {
      obj[child.tagName] = [existing, converted];
    }
  }
  if (text) obj['#text'] = text;
  return obj;
}

/** XML 文本 → JSON 值(根元素作为键,属性以 @ 前缀,文本为 #text) */
export function xmlToJson(xmlText: string): unknown {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('tools.json_formatter.xml_parse_failed'));
  return { [doc.documentElement.tagName]: xmlElementToObject(doc.documentElement) };
}

/** 由 JSON 值生成 TypeScript interface 文本 */
export function generateTsInterface(value: unknown, rootName = 'Root'): string {
  const interfaces: string[] = [];
  const used = new Set<string>();

  const typeName = (key: string): string => {
    const base = key.replace(/[^a-zA-Z0-9]/g, '') || 'Field';
    let name = base.charAt(0).toUpperCase() + base.slice(1);
    let i = 2;
    while (used.has(name)) name = `${base}${i++}`;
    used.add(name);
    return name;
  };

  const inferType = (v: unknown, key: string): string => {
    if (v === null) return 'null';
    if (Array.isArray(v)) {
      if (v.length === 0) return 'unknown[]';
      return `${inferType(v[0], key)}[]`;
    }
    switch (typeof v) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object': {
        const name = typeName(key);
        emit(v as Record<string, unknown>, name);
        return name;
      }
      default:
        return 'unknown';
    }
  };

  const emit = (obj: Record<string, unknown>, name: string): void => {
    const fields = Object.entries(obj)
      .map(([k, v]) => {
        const safe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return `  ${safe}: ${inferType(v, k)};`;
      })
      .join('\n');
    interfaces.unshift(`export interface ${name} {\n${fields}\n}`);
  };

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    used.add(rootName);
    emit(value as Record<string, unknown>, rootName);
  } else {
    const t = inferType(value, rootName);
    interfaces.unshift(`export type ${rootName} = ${t};`);
  }
  return interfaces.join('\n\n');
}

/** 智能解析:输入以 < 开头视为 XML(自动转 JSON),否则按 JSON 解析。 */
export function parseSmart(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) return xmlToJson(trimmed);
  return JSON.parse(trimmed);
}
