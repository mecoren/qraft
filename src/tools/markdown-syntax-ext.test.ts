/**
 * Markdown 渲染核心 —— 扩展语法专项测试
 *
 * 覆盖:GitHub alerts、==高亮==、```math 围栏、$`..`$ 行内公式、
 * front matter 属性表、emoji 短码。均走 renderMarkdownCore(未消毒层,
 * 断言不含 DOMPurify 干扰;消毒覆盖在 markdown-render.test.ts)。
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdownCore } from './markdown-core';

describe('GitHub alerts', () => {
  it('5 类 alert 渲染为 markdown-alert 容器(含类型类名与标题)', () => {
    const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    for (const type of types) {
      const { html } = renderMarkdownCore(`> [!${type}]\n> content here\n`);
      expect(html).toContain(`class="markdown-alert markdown-alert-${type.toLowerCase()}"`);
      expect(html).toContain('markdown-alert-title');
      expect(html).toContain('content here');
    }
  });

  it('类型标识符大小写不敏感([!note] 同 [!NOTE])', () => {
    const { html } = renderMarkdownCore('> [!note]\n> 内容\n');
    expect(html).toContain('markdown-alert-note');
  });

  it('alert 内容支持嵌套 markdown(列表/加粗)', () => {
    const { html } = renderMarkdownCore('> [!TIP]\n> - **加粗**条目\n> - 普通\n');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>加粗</strong>');
  });

  it('未知类型回落为普通引用块(不吞内容)', () => {
    const { html } = renderMarkdownCore('> [!UNKNOWN]\n> 内容\n');
    expect(html).not.toContain('markdown-alert');
    expect(html).toContain('内容');
  });

  it('alert 后紧跟的普通段落不被吞', () => {
    const { html } = renderMarkdownCore('> [!NOTE]\n> 内容\n\n普通段落\n');
    expect(html).toContain('markdown-alert');
    expect(html).toContain('普通段落');
  });
});

describe('==高亮== 扩展', () => {
  it('词内高亮渲染为 mark.md-mark', () => {
    const { html } = renderMarkdownCore('这是 ==重点== 内容');
    expect(html).toContain('<mark class="md-mark">重点</mark>');
  });

  it('未闭合或单词 == 原样保留(时间线 12==34 不触发)', () => {
    const { html } = renderMarkdownCore('a == b 且 c == d');
    expect(html).toContain('==');
    expect(html).not.toContain('<mark');
  });
});

describe('```math 围栏与 $`..`$ 行内公式', () => {
  it('```math 围栏渲染为块级公式(KaTeX)', () => {
    const { html } = renderMarkdownCore('```math\nE = mc^2\n```');
    expect(html).toContain('md-math-block');
    expect(html).toContain('katex');
  });

  it('$`..`$ 渲染为行内公式', () => {
    const { html } = renderMarkdownCore('行内 $`a+b`$ 公式');
    expect(html).toContain('md-math-inline');
    expect(html).toContain('katex');
  });
});

describe('front matter', () => {
  it('首行 --- 的 YAML 头渲染为属性表,正文不受影响', () => {
    const { html, outline } = renderMarkdownCore(
      '---\ntitle: 文档标题\ntags: demo\n---\n\n## 正文标题\n',
    );
    expect(html).toContain('md-frontmatter');
    expect(html).toContain('<th>title</th>');
    expect(html).toContain('<td>文档标题</td>');
    expect(html).toContain('正文标题');
    // front matter 不产生大纲条目
    expect(outline.map((o) => o.text)).toEqual(['正文标题']);
  });

  it('非首行 --- 不触发 front matter 剥离', () => {
    const { html } = renderMarkdownCore('段落\n\n---\n\ntitle: x\n');
    expect(html).not.toContain('md-frontmatter');
  });

  it('未闭合 front matter(无第二个 ---)原样渲染', () => {
    const { html } = renderMarkdownCore('---\ntitle: x\n');
    expect(html).not.toContain('md-frontmatter');
  });
});

describe('emoji 短码', () => {
  it(':smile: 等短码替换为 emoji 字符', () => {
    const { html } = renderMarkdownCore('开心 :smile: 火箭 :rocket:');
    expect(html).toContain('😄');
    expect(html).toContain('🚀');
  });

  it('未收录短码与普通冒号文本原样保留', () => {
    const { html } = renderMarkdownCore('时间 12:30 与 :unknown_code: 保留');
    expect(html).toContain('12:30');
    expect(html).toContain(':unknown_code:');
  });
});
