/**
 * JSONPath 测试器 —— 基于 jsonpath-plus
 *
 * 输入 JSON + JSONPath 表达式,实时输出匹配结果数组。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { Parentheses } from 'lucide-react';
import { JSONPath } from 'jsonpath-plus';
import { Input } from '@/components/ui/input';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

export function JsonPathTester(_props: ToolProps): JSX.Element {
  const [json, setJson] = useState('');
  const [path, setPath] = useState('$.');
  // 大文档下 JSON.parse + JSONPath 全量执行可达百毫秒级:defer 让输入框保持跟手,
  // 重计算在低优先级渲染中追赶(useDeferredValue 项目既有模式,见 DuplicateDetector)
  const deferredJson = useDeferredValue(json);

  const result = useMemo(() => {
    if (!deferredJson.trim()) return '';
    let data: unknown;
    try {
      data = JSON.parse(deferredJson);
    } catch (e) {
      return `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!path.trim()) return '';
    try {
      const out = JSONPath({ path, json: data as object, wrap: true });
      return JSON.stringify(out, null, 2);
    } catch (e) {
      return `JSONPath 表达式错误: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferredJson, path]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="jsonpath-tester">
      <section aria-label="JSONPath 表达式" data-search-anchor="jsonpath_tester:expression">
        <h2 className="mb-1.5 text-body-sm font-semibold">JSONPath 表达式</h2>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
          <Parentheses aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="$.store.book[*].author"
            aria-label="JSONPath 表达式"
            data-testid="jsonpath-expr"
            className="h-7 border-0 bg-transparent px-1 font-mono text-body-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </section>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输入 JSON"
            language="json"
            value={json}
            onChange={setJson}
            data-testid="jsonpath-json"
            className="h-full"
            searchAnchor="jsonpath_tester:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="测试结果"
            language="json"
            value={result}
            readOnly
            data-testid="jsonpath-result"
            className="h-full"
            searchAnchor="jsonpath_tester:output"
            actions={<CopyAction text={result} testId="jsonpath-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
