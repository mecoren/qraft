import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { applyEditedTexts, rewriteParagraphs } from './docxEdit';

/** 构造最小 document.xml(带可选段落属性 / run 样式) */
function docXml(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraphs.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body>
</w:document>`;
}

async function zipWithDocument(xml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('rewriteParagraphs', () => {
  it('替换目标段落的 runs 为单 run,保留 pPr 与首个 rPr', () => {
    const xml = docXml([
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>old A</w:t></w:r><w:r><w:t>more</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>keep B</w:t></w:r></w:p>',
    ]);
    const { next, replaced } = rewriteParagraphs(xml, ['new A', null]);
    expect(replaced).toBe(1);
    // 段落属性保留、runs 收敛为单 run、继承首 run 加粗
    expect(next).toContain('<w:jc w:val="center"/>');
    expect(next).toContain('<w:b/>');
    expect(next).toContain('<w:t xml:space="preserve">new A</w:t>');
    expect(next).not.toContain('old A');
    // 未编辑段落原样
    expect(next).toContain('keep B');
  });

  it('XML 特殊字符转义', () => {
    const xml = docXml(['<w:p><w:r><w:t>x</w:t></w:r></w:p>']);
    const { next } = rewriteParagraphs(xml, ['a < b & c > d']);
    expect(next).toContain('a &lt; b &amp; c &gt; d');
  });

  it('texts 不足时后续段落原样保留', () => {
    const xml = docXml([
      '<w:p><w:r><w:t>one</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>two</w:t></w:r></w:p>',
    ]);
    const { next, replaced } = rewriteParagraphs(xml, ['ONE']);
    expect(replaced).toBe(1);
    expect(next).toContain('ONE');
    expect(next).toContain('two');
  });

  it('全部 null 时零替换、XML 不变', () => {
    const xml = docXml(['<w:p><w:r><w:t>same</w:t></w:r></w:p>']);
    const { next, replaced } = rewriteParagraphs(xml, [null]);
    expect(replaced).toBe(0);
    expect(next).toBe(xml);
  });

  it('自闭合 <w:p/> 不参与替换也不破坏结构', () => {
    const xml = docXml(['<w:p/>', '<w:p><w:r><w:t>x</w:t></w:r></w:p>']);
    // 自闭合段落不渲染为 <p>,不占 UI 段落序:texts[0] 对应首个非自闭合段落
    const { next, replaced } = rewriteParagraphs(xml, ['y']);
    expect(replaced).toBe(1);
    // 自闭合段落仍原样在产物里
    expect(next).toContain('<w:p/>');
    expect(next).toContain('>y<');
  });
});

describe('applyEditedTexts', () => {
  it('重打包后的 zip 可解析,document.xml 为替换后内容', async () => {
    const bytes = await zipWithDocument(
      docXml(['<w:p><w:r><w:t>hello</w:t></w:r></w:p>', '<w:p><w:r><w:t>world</w:t></w:r></w:p>']),
    );
    const out = await applyEditedTexts(bytes, ['HELLO', null]);
    const zip = await JSZip.loadAsync(out);
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('HELLO');
    expect(xml).toContain('world');
    expect(xml).not.toContain('hello');
  });

  it('零替换时返回原字节(不重打包)', async () => {
    const bytes = await zipWithDocument(docXml(['<w:p><w:r><w:t>same</w:t></w:r></w:p>']));
    const out = await applyEditedTexts(bytes, [null]);
    expect(out).toBe(bytes);
  });

  it('缺 word/document.xml 时抛错', async () => {
    const zip = new JSZip();
    zip.file('other.txt', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(applyEditedTexts(bytes, ['a'])).rejects.toThrow('document.xml');
  });
});
