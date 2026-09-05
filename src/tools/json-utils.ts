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
import {
  json5ToJson,
  propertiesToJson,
  tomlToJson,
  urlParamsToJson,
  yamlToJson,
} from './parse-any-format';

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

/**
 * 输入格式的运行时标识(parseSmart 嗅探结果 / JsonFormatter 输入语言高亮)。
 * 与 DataFormatId(json-formats 输出方向)互为镜像,额外含 json 自身。
 */
export type InputFormatId = 'json' | 'xml' | 'yaml' | 'toml' | 'json5' | 'properties' | 'urlparams';

/**
 * 嗅探输入文本的数据格式(轻量启发,仅看结构特征,不做完整解析)。
 * 判定规则保守:特征不明确时返回 null(按 JSON 处理),宁可解析失败报错
 * 也不把破损 JSON 误判成别的格式静默吞掉。
 * - XML:以 `<` 开头
 * - URL 参数:以 `?`/`#` 开头,或无空白且含未转义 `=`/`&` 的 k=v 串
 * - Properties:无 JSON/YAML 结构字符({}[]<>、序列符 `- `、文档符 ---),
 *   至少一行含未转义 `=`,且每行有 `=`/`:` 分隔(仅 `:` 分隔的文本视作
 *   YAML 而非 properties:两者文本同形,YAML 的标量类型推断更符合直觉)
 * - TOML:非空行(忽略注释)全部为 `[table]` / `[[table]]` 头或含未转义
 *   `=` 的键值对,且不含 {} 结构符
 * - YAML / JSON5:无可靠结构特征,由 parseSmart 在 JSON 解析失败后回退尝试
 */
export function sniffInputFormat(text: string): InputFormatId | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<')) return 'xml';

  // URL 参数:前导 ?/#,或单行无空白 k=v(含 &)
  if (/^[?#]/.test(trimmed)) return 'urlparams';
  if (!/\s/.test(trimmed) && /=|&/.test(trimmed) && !/^[[{]/.test(trimmed)) return 'urlparams';

  // 含 JSON / flow-YAML 结构特征的内容不进入 Properties / TOML 判定:
  // {} 结构符、文档符 ---/...、YAML 锚点/引用/标签(&x *x !x 需为空格后首词)
  if (/[{}]|^(---|\.\.\.)|[&*!]\S* /m.test(trimmed)) return null;

  // 按行分析(Properties / TOML 判定共用);去掉注释与空行
  const lines = trimmed
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('!'));
  if (lines.length === 0) return null;
  // YAML 序列行(- 开头)不属于 Properties / TOML
  if (lines.some((l) => l.startsWith('- ') || l === '-')) return null;

  const isTableHeader = (l: string): boolean =>
    l.startsWith('[') && /^\[\[.+\]\]$|^\[.+\]$/.test(l);
  const hasUnescapedEq = (l: string): boolean => /(?<![\\])=/.test(l);
  const hasUnescapedColon = (l: string): boolean => /(?<![\\]):/.test(l);
  /** TOML 惯例键值行:`key = value`(= 两侧留空;properties 惯例为紧贴 `k=v`) */
  const hasSpacedEq = (l: string): boolean => /(?<![\\\s]) = /.test(l);

  const hasTableHeader = lines.some(isTableHeader);
  const hasTomlKv = lines.some(hasSpacedEq);
  // TOML:出现 [table] 头或 ` = ` 键值行,且每行都是头/键值对(未转义 =)
  if (hasTableHeader || hasTomlKv) {
    const isToml = lines.every((l) => isTableHeader(l) || hasUnescapedEq(l));
    return isToml ? 'toml' : null;
  }

  // Properties:每行都有未转义 = / : / 空白分隔,且至少一行含 =
  // (仅 `:` 分隔的文本视作 YAML:两者同形时 YAML 的类型推断更符合直觉)
  const everyHasSeparator = lines.every(
    (l) => hasUnescapedEq(l) || hasUnescapedColon(l) || /(?<![\\])[ \t]/.test(l),
  );
  if (everyHasSeparator && lines.some(hasUnescapedEq)) return 'properties';

  return null;
}

/**
 * 智能解析:任意支持格式(XML / YAML / TOML / JSON5 / Properties / URL 参数)
 * 输入自动转为 JSON 值;无法嗅探的按 JSON 解析(JSON.parse 失败再回退
 * YAML / JSON5,覆盖两者无结构特征的常规写法)。
 * 解析失败抛出 SyntaxError / ParseFormatError,由调用方把错误写入输出框。
 */
export function parseSmart(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new SyntaxError('Unexpected end of JSON input');
  const sniffed = sniffInputFormat(trimmed);
  switch (sniffed) {
    case 'xml':
      return xmlToJson(trimmed);
    case 'urlparams':
      return urlParamsToJson(trimmed);
    case 'properties':
      return propertiesToJson(trimmed);
    case 'toml':
      return tomlToJson(trimmed);
    default:
      break;
  }
  try {
    return JSON.parse(trimmed);
  } catch (jsonError) {
    // YAML / JSON5 无可靠结构特征,仅当 JSON 解析失败时回退:
    // - 以 { / [ 开头(类 JSON 轮廓):破损 JSON 与 JSON5 同形,回退 JSON5;
    //   不再走 YAML(其流式语法过宽,会把 {bad json} 静默吞成映射)
    // - 其余:先 YAML(常规粘贴),再 JSON5
    // 两者都失败时如实抛出原始 JSON 错误(用户最可能的意图仍是 JSON)
    if (/^[[{]/.test(trimmed)) {
      try {
        return json5ToJson(trimmed);
      } catch {
        throw jsonError;
      }
    }
    try {
      return yamlToJson(trimmed);
    } catch {
      try {
        return json5ToJson(trimmed);
      } catch {
        throw jsonError;
      }
    }
  }
}
