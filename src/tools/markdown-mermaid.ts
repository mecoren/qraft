/**
 * Mermaid 图表懒渲染
 *
 * 职责:
 * - 懒加载 mermaid ESM(仅当文档包含 ```mermaid 代码块时才下载该 chunk)
 * - 将 markdown-render.ts 输出的 .md-mermaid 占位容器替换为 SVG
 * - 跟随应用深浅色切换重新初始化主题并重绘
 *
 * 设计说明:
 * - initialize 的 theme 在加载时按 dark 参数设定;深浅切换走 rerenderMermaid 全量重绘,
 *   避免 mermaid 运行时热切主题的历史脏状态问题
 * - securityLevel 保持默认 'strict',mermaid 内部会对图定义做净化
 */

import { t } from '@/i18n';

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let loadedTheme: 'dark' | 'default' | null = null;

/**
 * 渲染结果缓存:键 = 图定义 + 主题。
 * 任一处编辑导致预览 HTML 整体重写时,未修改的图表可即时回填,
 * 避免每次输入停顿都对全部图表重跑 api.render(单图 50~200ms)。
 */
const svgCache = new Map<string, string>();
const SVG_CACHE_LIMIT = 60;

/** 清空渲染缓存(测试用) */
export function clearMermaidSvgCache(): void {
  svgCache.clear();
}

function cacheKey(definition: string, dark: boolean): string {
  return `${dark ? 'D' : 'L'}:${definition}`;
}

async function loadMermaid(dark: boolean): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const api = mod.default as unknown as MermaidApi;
      return api;
    });
  }
  const api = await mermaidPromise;
  const theme = dark ? 'dark' : 'default';
  if (loadedTheme !== theme) {
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit',
    });
    loadedTheme = theme;
  }
  return api;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 重置容器为源码占位(重绘前调用) */
function resetBlock(block: HTMLElement): void {
  delete block.dataset.mdDone;
  block.classList.remove('md-mermaid-rendered', 'md-mermaid-error');
  const code = decodeURIComponent(block.dataset.mermaid ?? '');
  block.innerHTML = `<pre class="md-mermaid-src">${escapeText(code)}</pre>`;
}

/**
 * 渲染 root 下所有未处理的 .md-mermaid 占位。
 * 单块失败不阻塞其余图表,失败块展示源码 + 错误提示。
 */
export async function renderMermaidIn(root: HTMLElement, dark: boolean): Promise<void> {
  const pending = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid'));
  if (pending.length === 0) return;

  let api: MermaidApi;
  try {
    api = await loadMermaid(dark);
  } catch {
    for (const block of pending) {
      block.classList.add('md-mermaid-error');
      block.insertAdjacentHTML(
        'beforeend',
        `<p class="md-mermaid-msg">${t('tools.markdown_preview.mermaid_load_failed')}</p>`,
      );
    }
    return;
  }

  for (const [index, block] of pending.entries()) {
    if (block.dataset.mdDone === 'true') continue;
    const code = decodeURIComponent(block.dataset.mermaid ?? '');
    if (!code.trim()) continue;

    // 缓存命中:直接回填,跳过 api.render
    const key = cacheKey(code, dark);
    const cachedSvg = svgCache.get(key);
    if (cachedSvg !== undefined) {
      block.innerHTML = cachedSvg;
      block.classList.add('md-mermaid-rendered');
      block.dataset.mdDone = 'true';
      continue;
    }

    block.dataset.mdDone = 'true';
    try {
      const { svg } = await api.render(`qraft-mmd-${Date.now()}-${index}`, code);
      if (svgCache.size >= SVG_CACHE_LIMIT) svgCache.clear();
      svgCache.set(key, svg);
      block.innerHTML = svg;
      block.classList.add('md-mermaid-rendered');
    } catch {
      resetBlock(block);
      block.dataset.mdDone = 'true';
      block.classList.add('md-mermaid-error');
      block.insertAdjacentHTML(
        'beforeend',
        `<p class="md-mermaid-msg">${t('tools.markdown_preview.mermaid_syntax_error')}</p>`,
      );
    }
  }
}

/** 深浅色切换后全量重绘(先复位占位再渲染,保证主题正确) */
export async function rerenderMermaidIn(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid'));
  for (const block of blocks) resetBlock(block);
  await renderMermaidIn(root, dark);
}
