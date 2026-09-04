/**
 * XML 格式化纯逻辑:DOMParser 解析 + 递归序列化
 *
 * 增强(vs 旧版):
 * - 保留 XML 声明 / DOCTYPE / 处理指令 / 注释 / CDATA
 * - 声明保留原文(不硬编码 encoding=UTF-8)
 * - minify 后仍可逆(属性顺序、命名空间前缀保持不变)
 */

export type IndentMode = '2' | '4' | 'tab' | 'minify';

export function indentUnit(mode: IndentMode): string {
  if (mode === 'tab') return '\t';
  if (mode === 'minify') return '';
  return ' '.repeat(Number(mode));
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function escapeTextContent(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serializeNode(node: Node, unit: string, depth: number, attrsOnNewLine: boolean): string {
  const pad = unit ? unit.repeat(depth) : '';
  const nl = unit ? '\n' : '';

  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').trim();
    return text ? `${pad}${escapeTextContent(text)}${nl}` : '';
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return `${pad}<!--${node.textContent ?? ''}-->${nl}`;
  }
  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    return `${pad}<![CDATA[${node.textContent ?? ''}]]>${nl}`;
  }
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    return `${pad}<?${(node as ProcessingInstruction).target} ${node.textContent ?? ''}?>${nl}`;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const attrs = Array.from(el.attributes);
  let attrText = '';
  if (attrs.length > 0) {
    if (attrsOnNewLine && unit && attrs.length > 1) {
      const attrPad = unit.repeat(depth + 1);
      attrText = `\n${attrs.map((a) => `${attrPad}${a.name}="${escapeAttr(a.value)}"`).join('\n')}`;
    } else {
      attrText = ` ${attrs.map((a) => `${a.name}="${escapeAttr(a.value)}"`).join(' ')}`;
    }
  }

  const children = Array.from(el.childNodes).filter(
    (c) => c.nodeType !== Node.TEXT_NODE || (c.textContent ?? '').trim().length > 0,
  );

  if (children.length === 0) {
    return `${pad}<${el.tagName}${attrText} />${nl}`;
  }

  // 单文本子节点:同一行输出
  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    const text = escapeTextContent((children[0].textContent ?? '').trim());
    return `${pad}<${el.tagName}${attrText}>${text}</${el.tagName}>${nl}`;
  }

  const inner = children.map((c) => serializeNode(c, unit, depth + 1, attrsOnNewLine)).join('');
  return `${pad}<${el.tagName}${attrText}>${nl}${inner}${pad}</${el.tagName}>${nl}`;
}

/** 序列化文档级前置节点(声明/DOCTYPE/PI/注释) */
function serializeProlog(doc: Document, unit: string, source: string): string {
  const nl = unit ? '\n' : '';
  const parts: string[] = [];
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) break; // 根元素之前的部分
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const doctype = node as DocumentType & { internalSubset?: string };
      const hasIds = doctype.publicId || doctype.systemId;
      if (hasIds) {
        parts.push(
          `<!DOCTYPE ${doctype.name} PUBLIC "${doctype.publicId}" "${doctype.systemId}">${nl}`,
        );
      } else if (doctype.internalSubset) {
        parts.push(`<!DOCTYPE ${doctype.name} [${nl}${doctype.internalSubset}]>${nl}`);
      } else {
        parts.push(`<!DOCTYPE ${doctype.name}>${nl}`);
      }
    } else if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      const pi = node as ProcessingInstruction;
      parts.push(`<?${pi.target} ${pi.data}?>${nl}`);
    } else if (node.nodeType === Node.COMMENT_NODE) {
      parts.push(`<!--${node.textContent ?? ''}-->${nl}`);
    }
    // XML 声明(xml-stylesheet PI 之外的 <?xml ...?>)jsdom/浏览器不作为 PI 暴露,
    // 从原文中保留(避免硬编码 encoding)
  }
  // 原文含 XML 声明则保留原文首行
  const declMatch = source.match(/^\s*(<\?xml[^?]*\?>)/);
  if (declMatch) {
    parts.unshift(`${declMatch[1]}${nl}`);
  }
  return parts.join('');
}

/**
 * 格式化 XML;非法输入抛 Error(message 为浏览器解析器首行报错,
 * 或键名 tools.xml_formatter.parse_error 由组件层翻译)。
 */
export function formatXml(input: string, mode: IndentMode, attrsOnNewLine: boolean): string {
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    throw new Error(err.textContent?.trim().split('\n')[0] ?? 'tools.xml_formatter.parse_error');
  }
  const unit = indentUnit(mode);
  const prolog = serializeProlog(doc, unit, input);
  const body = serializeNode(doc.documentElement, unit, 0, attrsOnNewLine);
  return (prolog + body).trimEnd();
}
