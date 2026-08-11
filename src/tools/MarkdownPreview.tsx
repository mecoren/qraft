/**
 * Markdown 预览 —— marked 渲染 + DOMPurify 消毒,类 GitHub 排版
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { CodeEditor } from '@/components/ui/code-editor';
import type { ToolProps } from './registry';

marked.setOptions({ gfm: true, breaks: false });

export function MarkdownPreview(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [html, setHtml] = useState('');

  const trimmed = useMemo(() => input, [input]);

  useEffect(() => {
    let cancelled = false;
    // 空输入也走 promise 链,避免在 effect 中同步 setState 触发级联渲染
    void Promise.resolve(marked.parse(trimmed)).then((raw) => {
      if (cancelled) return;
      setHtml(trimmed.trim() ? DOMPurify.sanitize(raw) : '');
    });
    return () => {
      cancelled = true;
    };
  }, [trimmed]);

  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-3" data-testid="markdown-preview">
      <CodeEditor
        title="Markdown"
        language="markdown"
        value={input}
        onChange={setInput}
        placeholder="# 标题&#10;&#10;- 列表项&#10;- **加粗** 与 *斜体*"
        data-testid="md-input"
        className="min-h-0"
      />
      <div className="flex min-h-0 flex-col">
        <h2 className="mb-1.5 text-body-sm font-semibold">预览</h2>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card px-5 py-4 shadow-card">
          {html ? (
            <article
              data-testid="md-preview"
              className="markdown-body"
              // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml -- 已经 DOMPurify 消毒
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">在左侧输入 Markdown 文本</p>
          )}
        </div>
      </div>
    </div>
  );
}
