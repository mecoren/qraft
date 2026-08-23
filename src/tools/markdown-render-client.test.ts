import { describe, expect, it } from 'vitest';
import { renderMarkdownAsync } from './markdown-render-client';
import { renderMarkdown } from './markdown-render';

describe('markdown-render-client', () => {
  // jsdom 无 Worker 构造器:客户端应立即走同步回退路径,
  // 且返回结果与直接调用 renderMarkdown 完全一致(含消毒)
  it('Worker 不可用时回退同步渲染,结果与 sync 路径一致', async () => {
    const source = '# Hello\n\n```js\nconst a = 1;\n```\n\n<script>alert(1)</script>';
    const viaClient = await renderMarkdownAsync(source, false);
    const viaSync = renderMarkdown(source);
    expect(viaClient).toEqual(viaSync);
    expect(viaClient.html).toContain('<h1 id="hello">');
    expect(viaClient.html).not.toContain('<script');
  });

  it('fast 模式参数透传(无高亮 span)', async () => {
    const source = '```js\nconst a = 1;\n```';
    const result = await renderMarkdownAsync(source, true);
    expect(result.html).not.toMatch(/hljs-keyword/);
    expect(result.outline).toEqual([]);
  });

  it('空输入返回空结果', async () => {
    const result = await renderMarkdownAsync('', false);
    expect(result).toEqual({ html: '', outline: [], hasMermaid: false });
  });
});
