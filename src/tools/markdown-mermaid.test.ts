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
});
