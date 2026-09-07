/**
 * Word(docx)编辑导出 —— jszip 重打包 document.xml(纯逻辑,便于单测)
 *
 * 编辑边界(「简易编辑」,与 Excel 单元格文本编辑同口径):
 * - 用户在 docx-preview 渲染的分页纸张上直接改段落文本(contenteditable);
 * - 导出时按「段落对位」把编辑后的纯文本写回 word/document.xml:
 *   渲染 DOM 的每个 <p> 依序对应 document.xml 中的一个 <w:p>;
 *   该段落的所有 runs(<w:r>)替换为单个 run,继承原段第一个 run 的
 *   <w:rPr>(尽量保留字体样式);段落属性 <w:pPr> 原样不动。
 * - 段落属性无法逐字映射(一个 <w:p> 可渲染为多个视觉块,含表格/列表的
 *   文档段落序会偏移):按「文本可对位的段落」处理,对不上位的段落原样
 *   保留——宁可不改,不写错位内容。
 *
 * 字符安全:XML 特殊字符(& < >)按 OOXML 语义转义后写入 <w:t xml:space="preserve">。
 */
import JSZip from 'jszip';

/** 逐段落编辑结果:UI 收集的段落纯文本(与渲染 <p> 序对位;null = 跳过该段) */
export type EditedParagraphTexts = readonly (string | null)[];

/**
 * 把编辑后的段落文本写回 docx 字节,重打包为新的 docx。
 *
 * @param bytes 原 docx 字节(ZIP 完整读入)
 * @param texts 编辑后的段落文本(下标 = 渲染段落序;null 表示未改动)
 * @returns 新 docx 字节;原 XML 解析失败时抛错
 */
export async function applyEditedTexts(
  bytes: Uint8Array,
  texts: EditedParagraphTexts,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('word/document.xml not found');
  const xml = await docFile.async('string');

  const { next, replaced } = rewriteParagraphs(xml, texts);
  if (replaced === 0) {
    // 没有可对位段落:原样返回(等价于未编辑导出,由调用方决定是否提示)
    return bytes;
  }
  zip.file('word/document.xml', next);
  void replaced;
  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * 重写 document.xml 的段落文本。
 * 每个 <w:p> 体内的 <w:r>…</w:r> 序列替换为单个 run;未提供新文本
 * (texts[i] 为 null 或下标耗尽)的段落原样保留。
 * 段落序只按非自闭合段落计——自闭合 <w:p/> 不渲染为 <p>,若计入会令
 * XML 段落与 UI 渲染段落错位(编辑写到错误段落)。
 * 返回 { next: 新 XML, replaced: 实际替换的段落数 }。
 */
export function rewriteParagraphs(
  xml: string,
  texts: EditedParagraphTexts,
): { next: string; replaced: number } {
  // <w:p …> 与 </w:p> 成对扫描;自闭合 <w:p/> 不匹配(无文本,且若消耗下标
  // 会令后续段落对位错乱)
  const open = /<w:p(?:\s[^>]*[^/>])?>/g;
  let replaced = 0;
  let index = 0; // 段落序(与渲染 <p> 对位)
  let out = '';
  let cursor = 0;
  for (const m of xml.matchAll(open)) {
    const pStart = m.index ?? 0;
    const pEnd = xml.indexOf('</w:p>', pStart);
    if (pEnd === -1) break;
    const body = xml.slice(pStart, pEnd + '</w:p>'.length);
    const text = texts[index];
    index += 1;
    out += xml.slice(cursor, pStart);
    if (text === undefined || text === null) {
      out += body; // 无编辑:原样保留
    } else {
      const rewritten = replaceRuns(body, text);
      out += rewritten.ok ? rewritten.xml : body;
      if (rewritten.ok) replaced += 1;
    }
    cursor = pEnd + '</w:p>'.length;
  }
  out += xml.slice(cursor);
  return { next: out, replaced };
}

/** 单段替换:保留 <w:pPr>,首个 run 的 <w:rPr> 续用,runs 收敛为单个文本 run */
function replaceRuns(
  paragraphXml: string,
  text: string,
): { ok: boolean; xml: string } {
  const openTagEnd = paragraphXml.indexOf('>') + 1;
  const openTag = paragraphXml.slice(0, openTagEnd); // <w:p> 或带属性的 <w:p …>
  // 段落属性:整体保留(<w:pPr>…</w:pPr> 与自闭合两种形态)
  const pPr = /<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr(?:\s[^>]*)?\/>/.exec(
    paragraphXml.slice(openTagEnd),
  );
  const pPrXml = pPr ? pPr[0] : '';
  // 首 run 样式:第一个 <w:rPr>…</w:rPr>(含段落属性后任意位置)续用到新 run
  const firstRPr = /<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/.exec(paragraphXml);
  const rPrXml = firstRPr ? firstRPr[0] : '';
  const escaped = escapeXmlText(text);
  const next = `${openTag}${pPrXml}<w:r>${rPrXml}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
  return { ok: true, xml: next };
}

/** OOXML 文本节点转义(& 与 <;> 转义是保险但不必要,保持最小集合) */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
