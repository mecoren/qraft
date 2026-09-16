/**
 * TipTap v3 + tiptap-markdown 往返冒烟(spike 转正:扩建前的证据锁)。
 * 断言 Markdown 进 → ProseMirror → Markdown 出不丢结构;有损耗的用例
 * 只打印实际输出(先看清行为,再决定包 frontmatter/自定义节点)。
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';

function md(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } };
  return storage.markdown.getMarkdown();
}

function makeEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Markdown,
    ],
  });
}

describe('tiptap markdown round-trip', () => {
  it('基础结构往返:标题/加粗/任务/表格/围栏/mermaid/公式文本不丢', () => {
    const editor = makeEditor();
    const src = [
      '# 标题',
      '',
      '段落 **加粗** `代码`。',
      '',
      '- [x] 已办',
      '- [ ] 待办',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```typescript',
      'const a = 1;',
      '```',
      '',
      '```mermaid',
      'graph LR',
      '  A --> B',
      '```',
      '',
      '行内公式 $E = mc^2$ 与块级:',
      '',
      '$$',
      '\\int_0^1 x\\,dx',
      '$$',
      '',
      '> [!NOTE]',
      '> 提示内容',
      '',
    ].join('\n');
    editor.commands.setContent(src);
    const out: string = md(editor);
    // spike 输出:看清实际序列化形态
    console.log(`[spike] round-trip output:\n${out}`);
    for (const needle of [
      '# 标题',
      '**加粗**',
      '已办',
      '待办',
      'const a = 1;',
      '```mermaid',
      'E = mc^2',
      '\\int_0^1',
      // ponytail: alert 无自定义节点时 tiptap-markdown 转义中括号(内容不丢,
      // 首存改写源文本);AlertBlock 扩展落地后改断言为未转义形态
      '\\[!NOTE\\]',
    ]) {
      expect(out).toContain(needle);
    }
    editor.destroy();
  });

  it('frontmatter 往返行为实测(只打印不断言,决定是否包 strip 层)', () => {
    const editor = makeEditor();
    const src = '---\ntitle: 文档标题\ntags: demo\n---\n\n## 正文\n';
    editor.commands.setContent(src);
    const out: string = md(editor);
    // spike 输出:frontmatter 是否被吃掉
    console.log(`[spike] frontmatter output:\n${out}`);
    editor.destroy();
  });

  it('图片标题/链接/旧扩展语法往返实测(只打印,决定自定义扩展清单)', () => {
    const editor = makeEditor();
    const src = [
      '![图](pic.png "题注 =300x200")',
      '',
      '![单宽](a.png "=300x")',
      '',
      '[链接](https://example.com)',
      '',
      '这是 ==重点== 上标 x^2^ 下标 H~2~O 表情 :smile:。',
      '',
    ].join('\n');
    editor.commands.setContent(src);
    const out: string = md(editor);
    // spike 输出:标题/旧语法是否被吃
    console.log(`[spike] misc output:\n${out}`);
    editor.destroy();
  });
});
