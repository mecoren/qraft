import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './markdown-paste';

describe('htmlToMarkdown', () => {
  it('标题/加粗/斜体/链接转换', () => {
    const md = htmlToMarkdown(
      '<h2>标题</h2><p><strong>粗</strong><em>斜</em><a href="https://x.y">链</a></p>',
    );
    expect(md).toContain('## 标题');
    expect(md).toContain('**粗**');
    expect(md).toContain('*斜*');
    expect(md).toContain('[链](https://x.y)');
  });

  it('GFM 表格与删除线', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' +
        '<del>删除</del>',
    );
    expect(md).toContain('| A | B |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('~删除~');
  });

  it('列表与任务列表', () => {
    const md = htmlToMarkdown(
      '<ul><li>普通项</li></ul>' +
        '<ul class="contains-task-list"><li><input type="checkbox" checked>已完成</li></ul>',
    );
    expect(md).toMatch(/-\s+普通项/);
    expect(md).toMatch(/-\s+\[x\]\s+已完成/);
  });

  it('围栏代码块', () => {
    const md = htmlToMarkdown('<pre><code>const a = 1;</code></pre>');
    expect(md).toContain('```\nconst a = 1;\n```');
  });

  it('script/style 被移除;空输入与异常输入返回空串', () => {
    expect(htmlToMarkdown('<script>alert(1)</script><p>ok</p>')).toBe('ok');
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });
});
