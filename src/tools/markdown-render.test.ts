import { describe, expect, it } from 'vitest';
import { buildTocHtml, computeDocStats, renderMarkdown, slugifyText } from './markdown-render';

describe('slugifyText', () => {
  it('保留中文并折叠空白为连字符', () => {
    expect(slugifyText('你好 世界')).toBe('你好-世界');
    expect(slugifyText('Hello, World!')).toBe('hello-world');
  });

  it('空 slug 输出空串(去重回退由 Slugger 负责)', () => {
    expect(slugifyText('???')).toBe('');
    // 经 renderMarkdown 后仍生成合法锚点
    const { html } = renderMarkdown('### ???');
    expect(html).toMatch(/<h3 id="heading">/);
  });
});

describe('renderMarkdown:标题锚点与大纲', () => {
  const source = '# 你好 世界\n\n## Section Two\n\n### Section Two';

  it('生成去重 slug 并写入 id', () => {
    const { html } = renderMarkdown(source);
    expect(html).toContain('<h1 id="你好-世界">');
    expect(html).toContain('id="section-two"');
    // 同名标题追加序号后缀
    expect(html).toContain('id="section-two-1"');
  });

  it('提取大纲:层级与首行行号', () => {
    const { outline } = renderMarkdown(source);
    expect(outline.map((o) => o.level)).toEqual([1, 2, 3]);
    expect(outline[0]).toMatchObject({ text: '你好 世界', line: 1 });
    expect(outline.map((o) => o.id)).toEqual(['你好-世界', 'section-two', 'section-two-1']);
  });

  it('标题内嵌悬停锚点链接', () => {
    const { html } = renderMarkdown('# Alpha');
    expect(html).toContain('<a class="md-heading-anchor" href="#alpha"');
  });

  it('大纲锚点与 HTML 锚点一致(含重名去重)', () => {
    const md = '## Same\n\n## Same';
    const { html, outline } = renderMarkdown(md);
    for (const item of outline) {
      expect(html).toContain(`id="${item.id}"`);
    }
  });

  it('大纲文本剥离行内标记', () => {
    const { outline } = renderMarkdown('# **Bold** and `code`');
    expect(outline[0]?.text).toBe('Bold and code');
  });
});

describe('renderMarkdown:[toc] 目录', () => {
  it('替换占位为嵌套目录卡片', () => {
    const { html } = renderMarkdown('[toc]\n\n# Alpha\n\n## Beta');
    expect(html).toContain('class="md-toc"');
    expect(html).toContain('href="#alpha">Alpha</a>');
    expect(html).toContain('href="#beta">Beta</a>');
    expect(html).toContain('<ul><li><a href="#alpha">');
    expect(html).not.toContain('md-toc-placeholder');
  });

  it('无标题时不残留占位', () => {
    const { html } = renderMarkdown('[toc]\n\nplain text');
    expect(html).not.toContain('md-toc-placeholder');
    expect(html).not.toContain('md-toc"');
  });

  it('buildTocHtml 容忍跳级(h1 后直接 h3)', () => {
    const toc = buildTocHtml([
      { id: 'a', text: 'A', level: 1, line: 1 },
      { id: 'c', text: 'C', level: 3, line: 2 },
      { id: 'b', text: 'B', level: 1, line: 3 },
    ]);
    expect(toc).toContain('href="#c"');
    // C 嵌套在 A 内,B 回到顶层
    expect(toc.indexOf('href="#c"')).toBeLessThan(toc.indexOf('href="#b"'));
    expect(toc.split('<ul>').length - 1).toBe(toc.split('</ul>').length - 1);
  });
});

describe('renderMarkdown:任务列表', () => {
  it('渲染 disabled checkbox 且勾选状态正确', () => {
    const { html } = renderMarkdown('- [x] done\n- [ ] todo');
    expect((html.match(/<input[^>]*type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
  });
});

describe('renderMarkdown:脚注', () => {
  const source = 'Qraft 本地优先[^ref]。再次引用[^ref]。\n\n[^ref]: 数据不出本机。';

  it('引用替换为带序号的上标链接', () => {
    const { html } = renderMarkdown(source);
    expect((html.match(/md-fn-ref/g) ?? []).length).toBe(2);
    expect(html).toContain('href="#fn-ref"');
    expect(html).toContain('>1</a>');
  });

  it('文末生成脚注区块与回链', () => {
    const { html } = renderMarkdown(source);
    expect(html).toContain('class="md-footnotes"');
    expect(html).toContain('数据不出本机。');
    expect(html).toContain('md-fn-backref');
  });

  it('未定义的引用原样保留', () => {
    const { html } = renderMarkdown('text [^missing] end');
    expect(html).toContain('[^missing]');
    expect(html).not.toContain('md-footnotes');
  });

  it('代码块内的脚注语法不被改写', () => {
    const { html } = renderMarkdown('```\nsee [^1]\n```');
    expect(html).toContain('[^1]');
    expect(html).not.toContain('md-fn-ref');
  });
});

describe('renderMarkdown:数学公式(KaTeX)', () => {
  it('行内公式渲染为 katex 标记且通过消毒', () => {
    const { html } = renderMarkdown('$E=mc^2$');
    expect(html).toContain('katex');
    expect(html).toContain('E=mc^2'.slice(0, 1)); // 公式内容存在
    expect(html).toContain('md-math-inline');
  });

  it('块级公式使用 md-math-block 包裹', () => {
    const { html } = renderMarkdown('$$\na^2+b^2=c^2\n$$');
    expect(html).toContain('md-math-block');
    expect(html).toContain('katex-display');
  });

  it('货币符号不误判为公式', () => {
    const { html } = renderMarkdown('价格 $5 和 $6');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
  });
});

describe('renderMarkdown:上标 / 下标 / 删除线', () => {
  it('^x^ 渲染 sup,~x~ 渲染 sub', () => {
    const { html } = renderMarkdown('x^2^ and H~2~O');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<sub>2</sub>');
  });

  it('~~x~~ 保持 GFM 删除线不被下标吞掉', () => {
    const { html } = renderMarkdown('~~deleted~~');
    expect(html).toContain('<del>deleted</del>');
    expect(html).not.toContain('<sub>');
  });
});

describe('renderMarkdown:代码高亮', () => {
  it('支持语言走 hljs 高亮并带 language-* 类', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('language-javascript');
    expect(html).toMatch(/hljs-(keyword|built_in|entity|variable)/);
  });

  it('代码卡片带语言徽标与复制按钮', () => {
    const { html } = renderMarkdown('```python\nprint(1)\n```');
    expect(html).toContain('md-code-lang');
    expect(html).toContain('>python</span>');
    expect(html).toMatch(/data-md-copy="true"/);
  });

  it('未知语言纯转义展示(无高亮 span)', () => {
    const { html } = renderMarkdown('```weirdlang\n<b>&raw\n```');
    expect(html).toContain('&lt;b&gt;&amp;raw');
    expect(html).not.toMatch(/hljs-keyword/);
  });

  it('mermaid 围栏输出占位容器,data 属性可逆化解码', () => {
    const def = 'graph LR\n  A-->B';
    const { html, hasMermaid } = renderMarkdown(`\`\`\`mermaid\n${def}\n\`\`\``);
    expect(hasMermaid).toBe(true);
    const match = /data-mermaid="([^"]+)"/.exec(html);
    expect(match).not.toBeNull();
    expect(decodeURIComponent(match![1])).toBe(def);
  });
});

describe('renderMarkdown:两阶段渲染(fast 模式)', () => {
  it('fast 模式跳过高亮但保留语言类与结构', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```', { fastHighlight: true });
    expect(html).toContain('language-javascript');
    expect(html).not.toMatch(/hljs-keyword|hljs-built_in/);
    // 语言徽标与复制按钮仍在(布局尺寸与完整阶段一致)
    expect(html).toContain('md-code-lang');
  });

  it('fast 模式下公式仍渲染(开销低,避免排版跳动)', () => {
    const { html } = renderMarkdown('$E=mc^2$', { fastHighlight: true });
    expect(html).toContain('katex');
  });

  it('fast 与完整模式的大纲一致(锚点稳定不跳动)', () => {
    const md = '# T1\n\n## T2\n\n```py\nx=1\n```';
    expect(renderMarkdown(md, { fastHighlight: true }).outline).toEqual(renderMarkdown(md).outline);
  });
});

describe('renderMarkdown:消毒', () => {
  it('移除 script 与事件属性,保留安全标签', () => {
    const { html } = renderMarkdown(
      'hello <script>alert(1)</script><img src="x.png" onerror="alert(1)">',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<img src="x.png">');
  });

  it('KaTeX 的 MathML/HTML 输出在白名单内存活', () => {
    const { html } = renderMarkdown('$\\frac{a}{b}$');
    expect(html).toContain('<math');
    expect(html).toContain('katex-html');
  });
});

describe('computeDocStats', () => {
  it('CJK 逐字计数 + 拉丁按词计数', () => {
    const stats = computeDocStats('你好世界 hello world\nsecond');
    expect(stats.words).toBe(4 + 3);
    expect(stats.lines).toBe(2);
    expect(stats.chars).toBeGreaterThan(0);
    expect(stats.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('空文档词数为 0、阅读时间为 0', () => {
    const stats = computeDocStats('');
    expect(stats.words).toBe(0);
    expect(stats.readingMinutes).toBe(0);
    expect(stats.lines).toBe(1);
  });
});
