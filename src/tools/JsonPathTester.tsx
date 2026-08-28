/**
 * JSONPath 测试器 —— 基于 jsonpath-plus
 *
 * 输入 JSON + JSONPath 表达式,实时输出匹配结果数组。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Parentheses } from 'lucide-react';
import { JSONPath } from 'jsonpath-plus';
import { Input } from '@/components/ui/input';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

export function JsonPathTester(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
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
      return t('tools.jsonpath_tester.parse_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
    if (!path.trim()) return '';
    try {
      const out = JSONPath({ path, json: data as object, wrap: true });
      return JSON.stringify(out, null, 2);
    } catch (e) {
      return t('tools.jsonpath_tester.expression_error', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [deferredJson, path, t]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):表达式输入作为顶部扁平区
    // (border-b 分隔,同 ConfigSection),下方纵向双编辑器贴边成区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="jsonpath-tester"
    >
      <section
        aria-label={t('tools.jsonpath_tester.expression_title')}
        data-search-anchor="jsonpath_tester:expression"
        className="border-b border-border px-4 py-2.5"
      >
        <h2 className="mb-1.5 text-body-sm font-semibold">
          {t('tools.jsonpath_tester.expression_title')}
        </h2>
        {/* 表达式输入:保留轻量卡片外观但去阴影,浮于扁平区内 */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
          <Parentheses aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="$.store.book[*].author"
            aria-label={t('tools.jsonpath_tester.expression_title')}
            data-testid="jsonpath-expr"
            className="h-7 border-0 bg-transparent px-1 font-mono text-body-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </section>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title={t('tools.jsonpath_tester.input_json_title')}
            language="json"
            value={json}
            onChange={setJson}
            data-testid="jsonpath-json"
            // 纵向堆叠:去掉编辑器自带边框/圆角,外框由外层 shell 卡片提供
            className="h-full rounded-none border-0"
            searchAnchor="jsonpath_tester:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title={t('tools.jsonpath_tester.result_title')}
            language="json"
            value={result}
            readOnly
            data-testid="jsonpath-result"
            // 纵向堆叠:同输入侧,外框由外层 shell 卡片提供
            className="h-full rounded-none border-0"
            searchAnchor="jsonpath_tester:output"
            actions={<CopyAction text={result} testId="jsonpath-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
