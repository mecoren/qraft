/**
 * Markdown 渲染核心(纯逻辑,无 DOM 依赖 —— 可在 Web Worker 中运行)
 *
 * 职责与 markdown-render.ts 相同(见该文件头部文档),差异仅一点:
 * 本模块**不做 DOMPurify 消毒**(其依赖 window),返回未消毒 HTML,
 * 由主线程的 markdown-render.ts / markdown-render-client.ts 统一消毒。
 *
 * hljs 语言分层:常用语言(javascript/typescript/xml/css/json/markdown/
 * bash/python/plaintext)随模块同步注册;其余扩展语言经
 * loadExtendedLanguages() 动态加载注册 —— 未加载期间对应围栏降级为
 * 纯转义展示,加载完成后的下一轮渲染自动恢复高亮。
 */

import {
  lexer as markedLexer,
  Marked,
  type Tokens,
  type Token,
  type TokenizerThis,
  type RendererThis,
} from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import markdownLang from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';

// ============================================================
// highlight.js 语言注册
// ============================================================

type HljsLanguageModule = Parameters<typeof hljs.registerLanguage>[1];

const CORE_LANG_MODULES: ReadonlyArray<readonly [string, HljsLanguageModule]> = [
  ['bash', bash],
  ['css', css],
  ['javascript', javascript],
  ['json', json],
  ['markdown', markdownLang],
  ['plaintext', plaintext],
  ['python', python],
  ['typescript', typescript],
  ['xml', xml],
];

for (const [name, mod] of CORE_LANG_MODULES) {
  hljs.registerLanguage(name, mod);
}

let extendedLoadStarted = false;

/**
 * 动态加载并注册扩展语言(c/cpp/rust/go/java 等约 22 种)。
 * 幂等;Vite 会把整组 import 打为单个懒加载 chunk,
 * 在组件挂载后/Worker 启动时调用即可,不阻塞首次渲染。
 */
export async function loadExtendedLanguages(): Promise<void> {
  if (extendedLoadStarted) return;
  extendedLoadStarted = true;
  const modules = await Promise.all([
    import('highlight.js/lib/languages/c'),
    import('highlight.js/lib/languages/cpp'),
    import('highlight.js/lib/languages/csharp'),
    import('highlight.js/lib/languages/dart'),
    import('highlight.js/lib/languages/diff'),
    import('highlight.js/lib/languages/dockerfile'),
    import('highlight.js/lib/languages/go'),
    import('highlight.js/lib/languages/graphql'),
    import('highlight.js/lib/languages/ini'),
    import('highlight.js/lib/languages/java'),
    import('highlight.js/lib/languages/kotlin'),
    import('highlight.js/lib/languages/less'),
    import('highlight.js/lib/languages/lua'),
    import('highlight.js/lib/languages/makefile'),
    import('highlight.js/lib/languages/php'),
    import('highlight.js/lib/languages/powershell'),
    import('highlight.js/lib/languages/ruby'),
    import('highlight.js/lib/languages/rust'),
    import('highlight.js/lib/languages/scss'),
    import('highlight.js/lib/languages/sql'),
    import('highlight.js/lib/languages/swift'),
    import('highlight.js/lib/languages/yaml'),
  ]);
  const names = [
    'c',
    'cpp',
    'csharp',
    'dart',
    'diff',
    'dockerfile',
    'go',
    'graphql',
    'ini',
    'java',
    'kotlin',
    'less',
    'lua',
    'makefile',
    'php',
    'powershell',
    'ruby',
    'rust',
    'scss',
    'sql',
    'swift',
    'yaml',
  ] as const;
  for (const [index, name] of names.entries()) {
    hljs.registerLanguage(name, modules[index]?.default as HljsLanguageModule);
  }
}

/** Markdown 围栏语言标识 → hljs 语言名别名表 */
const LANG_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  svelte: 'xml',
  svg: 'xml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  toml: 'ini',
  conf: 'ini',
  cfg: 'ini',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  golang: 'go',
  kt: 'kotlin',
  kts: 'kotlin',
  rs: 'rust',
  md: 'markdown',
  mdx: 'markdown',
  docker: 'dockerfile',
  gql: 'graphql',
  ps: 'powershell',
  ps1: 'powershell',
  patch: 'diff',
  make: 'makefile',
  text: 'plaintext',
  txt: 'plaintext',
  log: 'plaintext',
};

/** 归一化围栏语言标识;返回 hljs 语言名,null 表示当前不可用(纯转义展示) */
export function resolveHighlightLang(lang?: string): string | null {
  if (!lang) return null;
  const tag =
    lang
      .trim()
      .toLowerCase()
      .split(/[\s,:{]/)[0] ?? '';
  if (!tag || tag === 'mermaid') return null;
  const mapped = LANG_ALIASES[tag] ?? tag;
  return hljs.getLanguage(mapped) ? mapped : null;
}

/** HTML 转义(用于代码文本/属性值) */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Slug 与大纲提取
// ============================================================

export interface OutlineItem {
  /** 渲染 HTML 中标题元素的 id(slug,已去重) */
  id: string;
  /** 纯文本标题 */
  text: string;
  /** 标题级别 1-6 */
  level: number;
  /** 源文本行号(1-based),供编辑器联动跳转 */
  line: number;
}

/** 去除行内 Markdown 标记,得到近似纯文本(供大纲/slug 使用) */
function cleanInlineText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim();
}

/**
 * GitHub 风格 slug:保留 Unicode 字母数字(中文可用),其余标点折叠为连字符。
 * 与去重计数配合生成稳定锚点 id。
 */
export function slugifyText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/\s+/g, '-');
}

/** slug 去重器:同名追加 -1/-2 后缀 */
class Slugger {
  private counts = new Map<string, number>();

  slug(text: string): string {
    const base = slugifyText(text) || 'heading';
    const seen = this.counts.get(base) ?? 0;
    this.counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  }
}

/**
 * 渲染期收集的标题元数据(由 renderer.heading 在解析时按文档序写入)。
 * 大纲的 id/text/level 以渲染结果为唯一事实源,保证与 HTML 锚点一致。
 */
export interface HeadingMeta {
  id: string;
  text: string;
  level: number;
}

/**
 * 从源文本提取各标题的起始行号(与渲染器产出顺序一一对应)。
 *
 * 行号通过 token.raw 在源文本中的顺序定位(indexOf 推进指针)计算,
 * 并递归下钻 list/blockquote 等嵌套 tokens,与 marked 的渲染展开顺序一致。
 *
 * @param source 预处理后的源文本(必须与传给渲染器的一致)
 */
export function extractHeadingLines(source: string): number[] {
  const lines: number[] = [];
  let searchFrom = 0;

  const visit = (token: Token): void => {
    if (token.type === 'heading') {
      const idx = source.indexOf(token.raw, searchFrom);
      const line = idx === -1 ? 1 : source.slice(0, idx).split('\n').length;
      lines.push(line);
      if (idx !== -1) searchFrom = idx + token.raw.length;
      return;
    }
    for (const key of ['tokens', 'items'] as const) {
      const nested = (token as unknown as Record<string, unknown>)[key];
      if (Array.isArray(nested)) {
        for (const child of nested as Token[]) visit(child);
      }
    }
  };

  try {
    for (const token of markedLexer(source)) visit(token);
  } catch {
    // 词法异常时返回已收集部分
  }
  return lines;
}

/** 由大纲构建 [toc] 目录 HTML(递归嵌套列表,容忍跳级标题) */
export function buildTocHtml(outline: OutlineItem[]): string {
  if (outline.length === 0) return '';
  let cursor = 0;

  const buildLevel = (level: number): string => {
    const items: string[] = [];
    while (cursor < outline.length && outline[cursor].level >= level) {
      const node = outline[cursor];
      if (node.level > level) {
        // 跳级(如 h1 后直接 h3):降一级继续消费
        items.push(`<ul>${buildLevel(level + 1)}</ul>`);
        continue;
      }
      cursor += 1;
      let children = '';
      if (cursor < outline.length && outline[cursor].level > level) {
        children = `<ul>${buildLevel(level + 1)}</ul>`;
      }
      items.push(`<li><a href="#${node.id}">${escapeHtml(node.text)}</a>${children}</li>`);
    }
    return items.join('');
  };

  const topLevel = outline[0]?.level ?? 1;
  return `<nav class="md-toc" data-md-toc="true"><ul>${buildLevel(topLevel)}</ul></nav>`;
}

// ============================================================
// KaTeX 数学公式扩展($..$ 行内 / $$..$$ 块级)
// ============================================================

import katex from 'katex';

/**
 * KaTeX 渲染结果缓存:同一公式在两阶段渲染的每轮全量解析中重复出现,
 * 以 tex 为键直接复用 HTML,消除重复 renderToString 开销。
 */
const katexCache = new Map<string, string>();
const KATEX_CACHE_LIMIT = 400;

function renderKatex(tex: string, displayMode: boolean): string {
  const cacheKey = `${displayMode ? 'B' : 'I'}:${tex}`;
  const cached = katexCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const inner = katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      output: 'htmlAndMathml',
    });
    const html = `<span class="${displayMode ? 'md-math-block' : 'md-math-inline'}">${inner}</span>`;
    if (katexCache.size >= KATEX_CACHE_LIMIT) katexCache.clear();
    katexCache.set(cacheKey, html);
    return html;
  } catch {
    // renderToString 配合 throwOnError:false 几乎不抛错;此处兜底原样输出(不缓存)
    return `<code class="md-math-error">${escapeHtml(tex)}</code>`;
  }
}

interface SimpleToken extends Tokens.Generic {
  type: string;
  raw: string;
  text: string;
}

const blockMathExtension = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('$$');
    return idx === -1 ? undefined : idx;
  },
  tokenizer(this: TokenizerThis, src: string): SimpleToken | undefined {
    const match = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    return { type: 'blockMath', raw: match[0], text: match[1].trim() };
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    return renderKatex(String(token.text), true);
  },
};

const inlineMathExtension = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.search(/\$(?!\s)/);
    return idx === -1 ? undefined : idx;
  },
  tokenizer(this: TokenizerThis, src: string): SimpleToken | undefined {
    // $ 后不得为空白,$ 前不得为空白(排除「价格 $5 和 $6」类货币误判)
    const match = /^\$(?!\s)((?:\\.|[^\\$])+?)(?<!\s)\$/.exec(src);
    if (!match) return undefined;
    return { type: 'inlineMath', raw: match[0], text: match[1] };
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    return renderKatex(String(token.text), false);
  },
};

// ============================================================
// 上标 / 下标扩展(Typora 语法:^x^ 与 ~x~)
// ============================================================

const superscriptExtension = {
  name: 'superscript',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('^');
    return idx === -1 ? undefined : idx;
  },
  tokenizer(this: TokenizerThis, src: string): SimpleToken | undefined {
    const match = /^\^([^\s^]+)\^/.exec(src);
    if (!match) return undefined;
    return { type: 'superscript', raw: match[0], text: match[1] };
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    return `<sup>${escapeHtml(String(token.text))}</sup>`;
  },
};

const subscriptExtension = {
  name: 'subscript',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('~');
    return idx === -1 ? undefined : idx;
  },
  tokenizer(this: TokenizerThis, src: string): SimpleToken | undefined {
    // 开头 ~ 后不能是 ~(marked 的 GFM del 允许单波浪线,必须先于其消费);
    // 词内下标(H~2~O)按 Typora 行为启用,故结尾不做 \w 断言
    const match = /^~(?![~\s])([^~\s]+)(?<!\s)~(?![~])/.exec(src);
    if (!match) return undefined;
    return { type: 'subscript', raw: match[0], text: match[1] };
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    return `<sub>${escapeHtml(String(token.text))}</sub>`;
  },
};

// ============================================================
// 脚注预处理([^label]: 定义 + [^label] 引用)
// ============================================================

/**
 * 仅对围栏代码块之外的分段应用变换:
 * 按 ``` / ~~~ 围栏切分,偶数下标段为普通文本,围栏标记与其后的代码体原样保留。
 */
function mapOutsideFences(source: string, transform: (segment: string) => string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = '';
  for (const line of lines) {
    const fenceMatch = inFence ? null : /^(\s{0,3})(```|~~~)/.exec(line);
    if (fenceMatch && !inFence) {
      inFence = true;
      fenceMarker = fenceMatch[2];
      out.push(line);
      continue;
    }
    if (inFence && line.trim().startsWith(fenceMarker)) {
      inFence = false;
      fenceMarker = '';
      out.push(line);
      continue;
    }
    out.push(inFence ? line : transform(line));
  }
  return out.join('\n');
}

/** 收集脚注定义并从正文中移除;返回定义表与清理后的正文 */
function collectFootnoteDefs(source: string): { defs: Map<string, string>; body: string } {
  const defs = new Map<string, string>();
  const defPattern = /^[ \t]{0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
  const bodyLines: string[] = [];

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = defPattern.exec(lines[i] ?? '');
    if (!match) {
      bodyLines.push(lines[i] ?? '');
      continue;
    }
    const label = match[1];
    const contentParts: string[] = [match[2] ?? ''];
    // 后续缩进行(4 空格或 tab)视为脚注内容的延续
    let j = i + 1;
    while (j < lines.length) {
      const cont = /^(?: {4}|\t)(.*)$/.exec(lines[j] ?? '');
      if (!cont) break;
      contentParts.push(cont[1] ?? '');
      j += 1;
    }
    defs.set(label, contentParts.join('\n').trim());
    i = j - 1;
  }

  return { defs, body: bodyLines.join('\n') };
}

/**
 * 将正文中的脚注引用替换为带序号的上标链接。
 * 返回替换后的正文与按出现顺序排列的引用标签。
 */
function replaceFootnoteRefs(
  body: string,
  defs: Map<string, string>,
): { body: string; order: string[] } {
  const order: string[] = [];
  const replaced = mapOutsideFences(body, (line) =>
    line.replace(/\[\^([^\]\s]+)\]/g, (whole, label: string) => {
      if (!defs.has(label)) return whole;
      let index = order.indexOf(label);
      if (index === -1) {
        order.push(label);
        index = order.length - 1;
      }
      return (
        `<sup class="md-fn-ref" id="fnref-${escapeHtml(label)}">` +
        `<a href="#fn-${escapeHtml(label)}">${index + 1}</a></sup>`
      );
    }),
  );
  return { body: replaced, order };
}

/** 构建文末脚注区块 HTML */
function buildFootnotesHtml(defs: Map<string, string>, order: readonly string[]): string {
  if (order.length === 0) return '';
  const items = order.map((label) => {
    const content = defs.get(label) ?? '';
    return (
      `<li id="fn-${escapeHtml(label)}">` +
      `${content} <a class="md-fn-backref" href="#fnref-${escapeHtml(label)}" aria-label="返回脚注引用">↩</a></li>`
    );
  });
  return `<section class="md-footnotes"><hr><ol>\n${items.join('\n')}\n</ol></section>`;
}

// ============================================================
// 自定义 Renderer(代码块高亮 / Mermaid 占位 / 标题锚点)
// ============================================================

/** 复制按钮内联 SVG(lucide copy 图标路径) */
const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';

/**
 * 构建 RendererObject(纯对象而非 Renderer 子类):
 * marked v18 的 use() 会把实例的自有可枚举属性逐个注册为命名渲染器,
 * 子类携带业务字段(如 slug 去重器)会触发「renderer xxx does not exist」;
 * 闭包捕获 slugger 则完全避开该行为。
 *
 * @param fastHighlight true 时跳过 hljs 高亮(两阶段渲染的快速阶段,
 *   仅纯转义,布局尺寸与完整阶段一致,避免视觉跳动)
 */
function createRendererObject(slugs: Slugger, collected: HeadingMeta[], fastHighlight: boolean) {
  return {
    /** 标题:注入锚点 id + 悬停锚点链接,并记录元数据(大纲/[toc] 的唯一事实源) */
    heading(this: RendererThis, { tokens, depth }: Tokens.Heading): string {
      const html = this.parser.parseInline(tokens);
      const text = cleanInlineText(
        tokens.map((t) => ('text' in t ? String(t.text) : t.raw)).join(''),
      );
      const meta = { id: slugs.slug(text), text, level: depth };
      collected.push(meta);
      return (
        `<h${depth} id="${meta.id}">${html}` +
        `<a class="md-heading-anchor" href="#${meta.id}" aria-label="标题锚点">#</a></h${depth}>\n`
      );
    },

    /** 围栏代码块:mermaid → 占位容器;其余 → hljs 高亮 + 语言徽标 + 复制按钮 */
    code({ text, lang }: Tokens.Code): string {
      const langTag =
        lang
          ?.trim()
          .toLowerCase()
          .split(/[\s,:{]/)[0] ?? '';

      if (langTag === 'mermaid') {
        return (
          '<div class="md-mermaid" data-mermaid="' +
          encodeURIComponent(text) +
          `"><pre class="md-mermaid-src">${escapeHtml(text)}</pre></div>`
        );
      }

      const hljsLang = resolveHighlightLang(langTag);
      const highlighted =
        !fastHighlight && hljsLang !== null
          ? hljs.highlight(text, { language: hljsLang, ignoreIllegals: true }).value
          : escapeHtml(text);

      const langLabel = langTag || (hljsLang ?? '');
      const head = langLabel
        ? `<div class="md-code-head"><span class="md-code-lang">${escapeHtml(langLabel)}</span>` +
          `<button type="button" class="md-code-copy" data-md-copy="true" title="复制代码">${COPY_SVG}</button></div>`
        : '';

      return (
        '<div class="md-code">' +
        head +
        `<pre><code class="hljs${hljsLang ? ` language-${hljsLang}` : ''}">${highlighted}</code></pre></div>`
      );
    },
  };
}

// ============================================================
// Marked 实例组装(每次渲染新建实例,避免 use() 累积副作用)
// ============================================================

const MARKED_EXTENSIONS = [
  blockMathExtension,
  inlineMathExtension,
  superscriptExtension,
  subscriptExtension,
];

function createMarked(slugs: Slugger, headings: HeadingMeta[], fastHighlight: boolean): Marked {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    extensions: MARKED_EXTENSIONS,
    renderer: createRendererObject(slugs, headings, fastHighlight),
  });
  return md;
}

// ============================================================
// 对外入口(未消毒)
// ============================================================

export interface RenderCoreResult {
  /** 未消毒 HTML —— 必须经 DOMPurify 消毒后才可注入 DOM */
  html: string;
  /** 大纲(标题树扁平列表) */
  outline: OutlineItem[];
  /** 是否包含 Mermaid 图表占位(组件据此懒加载 mermaid) */
  hasMermaid: boolean;
}

export interface RenderOptions {
  /**
   * 两阶段渲染的快速阶段:跳过 hljs 高亮(纯转义,布局尺寸不变),
   * 输入停顿后由组件再触发一次完整渲染。默认 false。
   */
  fastHighlight?: boolean;
}

/**
 * 渲染 Markdown 为带主题样式的 **未消毒** HTML 片段(Worker 安全)。
 *
 * 流程:TOC 占位替换 → 脚注预处理 → marked 渲染 → 注入目录/脚注区块。
 * 解析异常时降级为纯转义文本展示,保证输入任何内容都不抛错。
 */
export function renderMarkdownCore(source: string, options: RenderOptions = {}): RenderCoreResult {
  const { fastHighlight = false } = options;
  if (!source.trim()) return { html: '', outline: [], hasMermaid: false };

  const slugs = new Slugger();
  // 1. [toc] 占位:整行匹配替换为原始 HTML,marked 原样透传。
  //    注意结尾用 [ \t]*$:若用 \s*$ 会在 m 标志下吞掉行尾换行,
  //    使占位 div 与下一行合并为同一个 HTML 块,吸收后续标题
  const withTocPlaceholder = source.replace(
    /^[ \t]{0,3}\[(toc|目录)\][ \t]*$/gim,
    '<div class="md-toc-placeholder"></div>',
  );

  // 2. 脚注:收集定义 → 替换引用
  const { defs, body } = collectFootnoteDefs(withTocPlaceholder);
  const { body: withRefs, order } = replaceFootnoteRefs(body, defs);

  // 3. 正文渲染(同步):渲染器按文档序写入标题元数据;异常时纯文本兜底
  const headings: HeadingMeta[] = [];
  let rendered: string;
  try {
    rendered = createMarked(slugs, headings, fastHighlight).parse(withRefs, {
      async: false,
    }) as string;
  } catch {
    rendered = `<p>${escapeHtml(source)}</p>`;
  }

  // 4. 大纲 = 渲染器元数据 × 词法扫描行号(zip,保证锚点与 HTML 完全一致)
  const headingLines = extractHeadingLines(withRefs);
  const outline: OutlineItem[] = headings.map((h, index) => ({
    id: h.id,
    text: h.text,
    level: h.level,
    line: headingLines[index] ?? 1,
  }));

  // 5. 回填 [toc] 目录与文末脚注
  const tocHtml = buildTocHtml(outline);
  if (tocHtml) rendered = rendered.replace('<div class="md-toc-placeholder"></div>', () => tocHtml);
  else rendered = rendered.replace('<div class="md-toc-placeholder"></div>', '');
  rendered += buildFootnotesHtml(defs, order);

  return {
    html: rendered,
    outline,
    hasMermaid: rendered.includes('class="md-mermaid"'),
  };
}

// ============================================================
// 统计(Typora 风格状态栏)
// ============================================================

export interface DocStats {
  /** 字数:CJK 字符逐字计,拉丁连续串记一词 */
  words: number;
  /** 字符数(Unicode 码点) */
  chars: number;
  /** 行数 */
  lines: number;
  /** 预计阅读分钟数(≥1,空文档为 0) */
  readingMinutes: number;
}

export function computeDocStats(source: string): DocStats {
  const chars = [...source].length;
  const lines = source.length === 0 ? 1 : source.split('\n').length;
  if (!source.trim()) {
    return { words: 0, chars: 0, lines, readingMinutes: 0 };
  }
  const cjkCount = (source.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latinWords = (source.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) ?? []).length;
  const words = cjkCount + latinWords;
  const readingMinutes = Math.max(1, Math.ceil(words / 250));
  return { words, chars, lines, readingMinutes };
}
