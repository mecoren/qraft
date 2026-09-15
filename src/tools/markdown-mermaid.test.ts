import { describe, expect, it, vi, beforeEach } from 'vitest';

// mock mermaid 模块:render 返回可识别的伪 SVG,统计调用次数
const render = vi.fn(async (_id: string, definition: string) => ({
  svg: `<svg data-def="${definition}"></svg>`,
}));
const initialize = vi.fn();

vi.mock('mermaid', () => ({ default: { initialize, render } }));

import { clearMermaidSvgCache, renderMermaidIn, rerenderMermaidIn } from './markdown-mermaid';

/** 构建含 n 个相同定义占位容器的宿主元素 */
function hostWith(def: string, count = 1): HTMLElement {
  const host = document.createElement('div');
  const encoded = encodeURIComponent(def);
  for (let i = 0; i < count; i += 1) {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="md-mermaid" data-mermaid="${encoded}"><pre class="md-mermaid-src">${def}</pre></div>`,
    );
  }
  return host;
}

describe('markdown-mermaid 渲染缓存', () => {
  beforeEach(() => {
    clearMermaidSvgCache();
    render.mockClear();
    initialize.mockClear();
  });

  it('渲染后写入 svg 并标记完成', async () => {
    const host = hostWith('graph TD\nA-->B');
    await renderMermaidIn(host, false);
    expect(render).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.md-mermaid')?.innerHTML).toContain('<svg');
    expect(host.querySelector('.md-mermaid')?.getAttribute('data-md-done')).toBe('true');
  });

  it('同一定义二次渲染命中缓存,不再调用 api.render', async () => {
    await renderMermaidIn(hostWith('pie\n"a":1'), false);
    // 新容器(模拟编辑导致 innerHTML 重写)但定义未变
    await renderMermaidIn(hostWith('pie\n"a":1'), false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('不同主题(深浅切换)视为不同缓存键', async () => {
    await renderMermaidIn(hostWith('graph LR'), false);
    await rerenderMermaidIn(hostWith('graph LR'), true);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('语法错误的图表回退源码展示且不污染缓存', async () => {
    render.mockImplementationOnce(async () => {
      throw new Error('bad diagram');
    });
    const host = hostWith('broken def');
    await renderMermaidIn(host, false);
    expect(host.querySelector('.md-mermaid-error')).not.toBeNull();
    expect(host.querySelector('.md-mermaid-src')).not.toBeNull();

    // 第二次渲染(缓存未命中)重新尝试
    await rerenderMermaidIn(host, false);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('超条数上限后逐条淘汰:最近命中的热条目仍在,仅最旧冷条目重渲染', async () => {
    // svgCache 上限为 60 条:预填 60 张后访问首张(刷新位序),
    // 再写入第 61 张 → 最旧的次新图被淘汰,被刷新过的首张命中缓存
    const fill = Array.from({ length: 60 }, (_, i) => `fill-${i}`);
    await renderMermaidIn(hostWithN(fill), false);
    expect(render).toHaveBeenCalledTimes(60);

    // 刷新 fill-0 的位序(模拟最近一次渲染仍包含该图)
    await renderMermaidIn(hostWith('fill-0'), false);
    expect(render).toHaveBeenCalledTimes(60); // 命中,未重渲染

    // 第 61 张进缓存:最旧端 fill-1 被逐条挤掉,fill-0 因位序靠后存活
    await renderMermaidIn(hostWith('graph NEW'), false);
    expect(render).toHaveBeenCalledTimes(61);

    const afterEvict = hostWithN(['fill-0', 'fill-1', 'graph NEW']);
    await renderMermaidIn(afterEvict, false);
    // fill-0 命中(位序刷新救回);fill-1 被淘汰重渲染;NEW 命中
    expect(render).toHaveBeenCalledTimes(62); // 仅 fill-1 重跑
    expect(afterEvict.querySelectorAll('.md-mermaid-rendered')).toHaveLength(3);
  });
});

/** 构建含多个不同定义占位容器的宿主元素 */
function hostWithN(defs: string[]): HTMLElement {
  const host = document.createElement('div');
  for (const def of defs) {
    const encoded = encodeURIComponent(def);
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="md-mermaid" data-mermaid="${encoded}"><pre class="md-mermaid-src">${def}</pre></div>`,
    );
  }
  return host;
}
