import { describe, expect, it } from 'vitest';
import { joinFrontMatter, splitFrontMatter } from './markdown-doc';

describe('splitFrontMatter', () => {
  it('标准 front matter 剥离并可原样贴回', () => {
    const src = '---\ntitle: 文档\ntags: demo\n---\n\n## 正文\n';
    const { body, fence } = splitFrontMatter(src);
    expect(body).toBe('\n## 正文\n');
    expect(fence).toBe('---\ntitle: 文档\ntags: demo\n---');
    expect(joinFrontMatter(fence, body)).toBe(src);
  });

  it('无 front matter / 未闭合时原样返回', () => {
    expect(splitFrontMatter('## 正文\n')).toEqual({ body: '## 正文\n', fence: null });
    expect(splitFrontMatter('---\ntitle: x\n')).toEqual({
      body: '---\ntitle: x\n',
      fence: null,
    });
  });

  it('空正文贴回保留 fence 换行', () => {
    expect(joinFrontMatter('---\ntitle: x\n---', '')).toBe('---\ntitle: x\n---\n');
    expect(joinFrontMatter(null, 'a')).toBe('a');
  });
});
