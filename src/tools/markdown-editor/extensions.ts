/**
 * Markdown 编辑器 TipTap 自定义扩展。
 *
 * 逐项对齐旧预览管线(markdown-core.ts)的 Typora/Obsidian 语法,策略按
 * tiptap-spike.test.ts 的实测证据分三档:
 * - 数据安全(必做):alert(防转义改写)、```math/mermaid(围栏直通自定义节点)。
 * - 所见(渲染):KaTeX 公式、Mermaid SVG(复用 markdown-mermaid)、代码高亮走
 *   CodeBlockLowlight、图片 =WxH 显示尺寸。
 * - 文本安全即延期:==mark==、^sup^/~sub~、:emoji:、`[toc]` 保持纯文本往返,
 *   不丢数据,暂不渲染(见文件尾 NOTE)。
 *
 * 小体量纯函数(slug/图片尺寸)就地复制而不 import ../markdown-core:
 * 后者会拖入 marked + hljs + KaTeX 整条旧管线进编辑器 chunk。
 */
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import katex from 'katex';
import Image from '@tiptap/extension-image';
import { renderMermaidIn, rerenderMermaidIn } from '../markdown-mermaid';
import { resolveMdAssetUrl } from '../markdown-image-assets';

// ============================================================
// 小体量纯函数(自 markdown-core 复制,保持编辑器 chunk 独立)
// ============================================================

/** GitHub 风格 slug(中文可用),与旧大纲锚点同口径 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/\s+/g, '-');
}

/** 解析图片 title 末尾 =WxH(Typora 语法);未知侧为 undefined */
export function parseImageSizeTitle(title: string | null): {
  title: string | null;
  width?: string;
  height?: string;
} {
  if (!title) return { title: null };
  const match = /^(.*)\s*=\s*(\d*)x(\d*)\s*$/.exec(title);
  if (!match || (match[2] === '' && match[3] === '')) return { title };
  const rest = (match[1] ?? '').trim();
  return {
    title: rest || null,
    width: match[2] === '' ? undefined : match[2],
    height: match[3] === '' ? undefined : match[3],
  };
}

/** markdown-it 插件函数用到的最小结构类型(避免直引 markdown-it 包) */
interface MdToken {
  type: string;
  content: string;
  info: string;
  attrs: Array<[string, string]> | null;
}
interface MdInlineState {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): MdToken;
}
interface MdRenderer {
  rules: Record<string, (...args: never[]) => string>;
}
interface MdInstance {
  inline: {
    ruler: { push(name: string, fn: (state: MdInlineState, silent: boolean) => boolean): void };
  };
  block: { ruler: { before(a: string, b: string, fn: unknown): void } };
  renderer: MdRenderer;
  __qraftSetup?: boolean;
}

/** setup() 在每次 parse 都执行,同一 md 实例只装一次插件 */
function onceSetup(md: MdInstance, fn: (md: MdInstance) => void): void {
  if (md.__qraftSetup) return;
  md.__qraftSetup = true;
  fn(md);
}

// ============================================================
// GitHub Alert(> [!NOTE] 等 5 类)
// ============================================================

const ALERT_META: Readonly<Record<string, { label: string; icon: string }>> = {
  note: { label: 'Note', icon: 'ℹ' },
  tip: { label: 'Tip', icon: '💡' },
  important: { label: 'Important', icon: '❗' },
  warning: { label: 'Warning', icon: '⚠' },
  caution: { label: 'Caution', icon: '⛔' },
};

export const ALERT_TYPES = Object.keys(ALERT_META);

export const AlertBlock = Node.create({
  name: 'alertBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: { default: 'note' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-alert-type]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const type = String(HTMLAttributes['data-alert-type'] ?? 'note');
    // 标题行(图标+Note/Tip..)由 tiptap.css 按 [data-alert-type] ::before 注入,
    // 不进 content 流,避免序列化时把标题文本写回 Markdown
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: `markdown-alert markdown-alert-${type}` }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          this: { editor: Editor },
          state: { write(s: string): void },
          node: { attrs: { type: string } },
        ) {
          // 子内容经同一 serializer 全量渲染(列表/代码/嵌套不丢格式),
          // 再逐行加 > 前缀;inner 由编辑器实例的 serializer 产出
          const editor = this.editor as unknown as {
            storage: { markdown: { serializer: { serialize(n: unknown): string } } };
            schema: { nodes: { doc: { create(a: null, c: unknown): unknown } } };
          };
          const docNode = editor.schema.nodes.doc.create(
            null,
            (node as unknown as { content: unknown }).content,
          );
          const inner = editor.storage.markdown.serializer.serialize(docNode).trimEnd();
          state.write(`> [!${String(node.attrs.type).toUpperCase()}]\n`);
          if (inner) {
            for (const line of inner.split('\n')) state.write(`> ${line}\n`);
          }
        },
        parse: {
          // markdown-it 把 alert 渲染成普通 blockquote;在此识别 marker
          // 并换成 div[data-alert-type],后续走标准 parseDOM
          updateDOM(element: HTMLElement) {
            for (const bq of Array.from(element.querySelectorAll('blockquote'))) {
              const first = bq.firstElementChild;
              if (!first || first.tagName !== 'P') continue;
              const match = /^\[!(note|tip|important|warning|caution)\]/i.exec(
                first.textContent ?? '',
              );
              if (!match) continue;
              const type = (match[1] ?? 'note').toLowerCase();
              const textNode = first.firstChild;
              // window.Node:此处 Node 是 TipTap 类名,DOM 常量必须走 window
              if (textNode && textNode.nodeType === 3) {
                textNode.textContent = (textNode.textContent ?? '').replace(/^\[!\w+\]\s*\n?/, '');
                if (!textNode.textContent) textNode.remove();
              }
              if (first.textContent === '') first.remove();
              const div = document.createElement('div');
              div.setAttribute('data-alert-type', type);
              while (bq.firstChild) div.appendChild(bq.firstChild);
              bq.replaceWith(div);
            }
          },
        },
      },
    };
  },
});

// ============================================================
// 渲染态切换小件:渲染输出 ↔ 源码 textarea(公式/图表共用)
// ============================================================

function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

interface ToggleViewOptions {
  node: { attrs: Record<string, unknown>; textContent: string; type: { name: string } };
  editor: {
    isEditable: boolean;
    commands: {
      command(
        fn: (props: {
          tr: { setNodeMarkup(pos: number, t: unknown, a: unknown): unknown };
        }) => boolean,
      ): boolean;
    };
  };
  getPos: () => number | undefined;
  className: string;
  renderInto: (box: HTMLElement, dark: boolean) => void;
  rerenderInto?: (box: HTMLElement, dark: boolean) => void;
  sourceLabel: string;
  commit: (text: string) => Record<string, unknown> | null;
}

/**
 * 只读渲染块 + 单击切源码 textarea(blur/Escape 提交)。
 * 公式与 Mermaid 共用:两处实现犯不着各写一套。
 */
function createToggleNodeView(opts: ToggleViewOptions): NodeView {
  const { node, editor, getPos, className, renderInto, rerenderInto, sourceLabel, commit } = opts;
  const dom = document.createElement('div');
  dom.className = className;
  const box = document.createElement('div');
  box.className = `${className}-body`;
  const bar = document.createElement('div');
  bar.className = `${className}-bar`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `${className}-toggle`;
  toggle.textContent = sourceLabel;
  bar.appendChild(toggle);
  const area = document.createElement('textarea');
  area.className = `${className}-source`;
  area.style.display = 'none';
  dom.append(box, bar, area);

  let darkObserver: MutationObserver | null = null;
  const paint = (): void => {
    renderInto(box, isDarkTheme());
  };
  paint();

  if (rerenderInto !== undefined) {
    darkObserver = new MutationObserver(() => rerenderInto(box, isDarkTheme()));
    darkObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  toggle.addEventListener('click', () => {
    const showing = area.style.display !== 'none';
    area.style.display = showing ? 'none' : '';
    box.style.display = showing ? '' : 'none';
    if (!showing) {
      area.value = node.textContent || String(node.attrs['code'] ?? node.attrs['tex'] ?? '');
      area.focus();
    } else {
      paint();
    }
  });
  const submit = (save: boolean): void => {
    if (save) {
      const next = commit(area.value);
      const pos = getPos();
      if (next && pos !== undefined) {
        editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
          return true;
        });
        paint();
      }
    }
    area.style.display = 'none';
    box.style.display = '';
  };
  area.addEventListener('blur', () => submit(true));
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') submit(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(true);
  });

  return {
    dom,
    update(updated: { type: { name: string } }) {
      if (updated.type.name !== node.type.name) return false;
      paint();
      return true;
    },
    destroy() {
      darkObserver?.disconnect();
    },
  } as unknown as NodeView;
}

// ============================================================
// KaTeX 公式:行内 $..$ / 块级 $$..$$ / ```math 围栏
// ============================================================

function renderKatexInto(box: HTMLElement, tex: string, displayMode: boolean): void {
  try {
    box.innerHTML = katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      output: 'htmlAndMathml',
    });
  } catch {
    const code = document.createElement('code');
    code.className = 'md-math-error';
    code.textContent = tex;
    box.replaceChildren(code);
  }
}

function mathInlineRule(md: MdInstance): void {
  md.inline.ruler.push('qraft_math_inline', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== '$' || src[pos + 1] === '$' || /\s/.test(src[pos + 1] ?? '')) return false;
    let end = -1;
    for (let i = pos + 2; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '\n') return false;
      if (ch === '$' && src[i - 1] !== ' ' && src[i - 1] !== '\\') {
        end = i;
        break;
      }
    }
    if (end === -1) return false;
    const tex = src.slice(pos + 1, end);
    if (!tex || /^\s|\s$/.test(tex)) return false;
    if (!silent) {
      const token = state.push('qraft_math_inline', 'span', 0);
      token.attrs = [
        ['data-math-inline', ''],
        ['data-tex', encodeURIComponent(tex)],
      ];
      token.content = tex;
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.qraft_math_inline = (tokens, idx) => {
    const token = tokens[idx] as unknown as MdToken;
    return `<span data-math-inline="" data-tex="${encodeURIComponent(token.content)}"></span>`;
  };
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { tex: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-math-inline]',
        getAttrs: (el) => ({ tex: decodeURIComponent((el as HTMLElement).dataset.tex ?? '') }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'md-math-inline' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'md-math-inline md-math-live';
      const paint = (tex: string): void => {
        renderKatexInto(dom, tex, false);
        dom.title = tex;
      };
      paint(String(node.attrs.tex ?? ''));
      // 双击改 tex:写回节点 attr(与块级公式同一提交语义)
      const edit = (): void => {
        if (!editor.isEditable) return;
        const tex = String(node.attrs.tex ?? '');
        const input = document.createElement('input');
        input.value = tex;
        input.className = 'md-math-edit';
        dom.replaceChildren(input);
        input.focus();
        const done = (save: boolean): void => {
          const pos = (getPos as () => number | undefined)();
          if (save && pos !== undefined) {
            (editor as unknown as ToggleViewOptions['editor']).commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { tex: input.value });
              return true;
            });
            paint(input.value);
          } else {
            paint(tex);
          }
        };
        input.addEventListener('blur', () => done(true));
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') done(false);
          if (e.key === 'Enter') done(true);
        });
      };
      dom.addEventListener('dblclick', edit);
      return {
        dom,
        update(updated: { type: { name: string }; attrs: Record<string, unknown> }) {
          if (updated.type.name !== 'mathInline') return false;
          paint(String(updated.attrs.tex ?? ''));
          return true;
        },
      } as unknown as NodeView;
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void }, node: { attrs: { tex: string } }) {
          state.write(`$${node.attrs.tex}$`);
        },
        parse: {
          setup(markdownit: unknown) {
            onceSetup(markdownit as MdInstance, mathInlineRule);
          },
        },
      },
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return { tex: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-math-block]',
        getAttrs: (el) => ({ tex: decodeURIComponent((el as HTMLElement).dataset.tex ?? '') }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'md-math-block' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      createToggleNodeView({
        node: node as unknown as ToggleViewOptions['node'],
        editor: editor as unknown as ToggleViewOptions['editor'],
        getPos: getPos as () => number | undefined,
        className: 'md-math-live-block',
        renderInto: (box) => renderKatexInto(box, String(node.attrs.tex ?? ''), true),
        sourceLabel: 'TeX 源码',
        commit: (text) => ({ tex: text.trim() }),
      });
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void }, node: { attrs: { tex: string } }) {
          state.write(`$$\n${node.attrs.tex}\n$$`);
          (state as unknown as { closeBlock(): void }).closeBlock();
        },
        parse: {
          setup(markdownit: unknown) {
            onceSetup(markdownit as MdInstance, (md) => {
              mathInlineRule(md);
              // ```math 围栏 → 同一块级节点(旧 ```math 语义)
              const prev = md.renderer.rules.fence as unknown as
                ((...a: never[]) => string) | undefined;
              md.renderer.rules.fence = (...args: never[]) => {
                const tokens = args[0] as unknown as MdToken[];
                const idx = args[1] as unknown as number;
                const info = (tokens[idx]?.info ?? '').trim().split(/\s/)[0] ?? '';
                if (info === 'math') {
                  const tex = (tokens[idx]?.content ?? '').replace(/\s+$/, '');
                  return `<div data-math-block="" data-tex="${encodeURIComponent(tex)}"></div>`;
                }
                return prev?.(...args) ?? '';
              };
            });
          },
        },
      },
    };
  },
});

// ============================================================
// Mermaid 图表(```mermaid 围栏 → SVG,附源码切换)
// ============================================================

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return { code: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid-block]',
        getAttrs: (el) => ({ code: decodeURIComponent((el as HTMLElement).dataset.code ?? '') }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'md-mermaid-live' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      createToggleNodeView({
        node: node as unknown as ToggleViewOptions['node'],
        editor: editor as unknown as ToggleViewOptions['editor'],
        getPos: getPos as () => number | undefined,
        className: 'md-mermaid-live',
        renderInto: (box, dark) => {
          const code = String(node.attrs.code ?? '');
          box.innerHTML =
            `<div class="md-mermaid" data-mermaid="${encodeURIComponent(code)}">` +
            `<pre class="md-mermaid-src"></pre></div>`;
          (box.querySelector('pre') as HTMLElement).textContent = code;
          void renderMermaidIn(box, dark);
        },
        rerenderInto: (box, dark) => {
          void rerenderMermaidIn(box, dark);
        },
        sourceLabel: '图表源码',
        commit: (text) => ({ code: text.replace(/\s+$/, '') }),
      });
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(s: string): void; text(t: string, escape: boolean): void },
          node: { attrs: { code: string } },
        ) {
          state.write('```mermaid\n');
          state.text(node.attrs.code, false);
          state.write('\n```');
          (state as unknown as { closeBlock(): void }).closeBlock();
        },
        parse: {
          setup(markdownit: unknown) {
            onceSetup(markdownit as MdInstance, (md) => {
              const prev = md.renderer.rules.fence as unknown as
                ((...a: never[]) => string) | undefined;
              md.renderer.rules.fence = (...args: never[]) => {
                const tokens = args[0] as unknown as MdToken[];
                const idx = args[1] as unknown as number;
                const info = (tokens[idx]?.info ?? '').trim().split(/\s/)[0] ?? '';
                if (info === 'mermaid') {
                  return `<div data-mermaid-block="" data-code="${encodeURIComponent(tokens[idx]?.content ?? '')}"></div>`;
                }
                return prev?.(...args) ?? '';
              };
            });
          },
        },
      },
    };
  },
});

// ============================================================
// 图片:Typora =WxH 显示尺寸 + 远程拦截(会话级放行)
// ============================================================

function isRemoteSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export const MdImage = Image.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const src = String(node.attrs.src ?? '');
      const { title, width, height } = parseImageSizeTitle(
        typeof node.attrs.title === 'string' ? node.attrs.title : null,
      );
      const dom = document.createElement('span');
      dom.className = 'md-img-live';

      // Local-First:默认不出网,http(s) 图首次渲染为占位 + 会话级放行按钮
      if (isRemoteSrc(src) && !node.attrs['dataAllowed']) {
        dom.className = 'md-img-blocked';
        const label = document.createElement('span');
        label.className = 'md-img-blocked-label';
        label.textContent = src;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-img-blocked-btn';
        btn.textContent = '加载远程图片(本次有效)';
        btn.addEventListener('click', () => {
          const pos = (getPos as () => number | undefined)();
          if (pos !== undefined && editor.isEditable) {
            (editor as unknown as ToggleViewOptions['editor']).commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataAllowed: true });
              return true;
            });
          }
        });
        dom.append(label, btn);
        return { dom } as unknown as NodeView;
      }

      const img = document.createElement('img');
      img.alt = String(node.attrs.alt ?? '');
      if (title) img.title = title;
      if (width !== undefined) img.width = Number(width);
      if (height !== undefined) img.height = Number(height);
      img.className = 'md-img-live-img';
      // mdasset: 本地资产解析为 data URL 显示(serialize 仍写回原引用);
      // data:/相对路径直接可用
      if (src.startsWith('mdasset:')) {
        img.alt = img.alt || src;
        void resolveMdAssetUrl(src.slice('mdasset:'.length)).then((url) => {
          if (url) img.src = url;
        });
      } else {
        img.src = src;
      }
      dom.appendChild(img);
      return { dom } as unknown as NodeView;
    };
  },
});

// NOTE(延期清单,文本往返已安全,见 spike misc 输出):
// - ==mark== / ^sup^ / :emoji: / [toc] 行:纯文本保存,不渲染。
// - H~2~O 类下标:tiptap-markdown 转义为 H\~2\~O(稳定,不再漂移)。
// - 图片 Ctrl+滚轮缩放 / lightbox:展示层 nicety,暂不做。
