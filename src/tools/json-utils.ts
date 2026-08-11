/**
 * JSON 工具共享纯函数
 *
 * 来源:原 JSON 增强工具(JsonEnhancer)的能力在合并进 JSON 格式化工具后,
 * 相关纯函数逻辑统一收敛到此模块,便于复用与单测。
 */

/** 递归对 JSON 对象的键做字典序排序(升/降),数组顺序与基本类型保持不变。 */
export function sortJsonKeys(value: unknown, descending = false): unknown {
  if (Array.isArray(value)) return value.map((v) => sortJsonKeys(v, descending));
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) =>
      descending ? b.localeCompare(a) : a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = sortJsonKeys((value as Record<string, unknown>)[k], descending);
    }
    return out;
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
  if (doc.querySelector('parsererror')) throw new Error('XML 解析失败');
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
