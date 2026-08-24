/**
 * 内容搜索结果面板(纯展示):
 * 顶部摘要 + 单个只读 Monaco 编辑器汇总全部命中行(等宽对齐、可选中复制)。
 * 合成文本自带「行号:」前缀,编辑器关闭自身行号避免双重显示。
 */
import { useMemo } from 'react';
import { CodeEditor } from '@/components/ui/code-editor';
import type { SearchReport } from './types';

interface Props {
  report: SearchReport;
}

/** 把分组结果合成为纯文本文档:每文件一段,行内带 L行号: 列 前缀 */
export function composeSearchText(report: SearchReport): string {
  const parts: string[] = [];
  for (const file of report.results) {
    parts.push(`// ${file.path} · ${file.match_count} 处匹配`);
    for (const m of file.matches) {
      parts.push(`L${m.line_number}:C${m.column}  ${m.preview}`);
    }
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

export function SearchResultsPanel({ report }: Props) {
  const text = useMemo(() => composeSearchText(report), [report]);
  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="search-results">
      <div className="text-sm text-muted-foreground" data-testid="search-summary">
        「{report.pattern}」共 {report.total_matches} 处匹配 / {report.files_with_matches} 个文件
        {report.truncated ? '(已截断)' : ''}
        {report.cancelled ? '(已取消)' : ''}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border" data-testid="search-results-editor">
        <CodeEditor
          value={text}
          readOnly
          language="plaintext"
          lineNumbers={false}
          showStatusBar={false}
          showPaste={false}
          showOpenFile={false}
          showClear={false}
          embedded
          className="h-full"
          data-testid="search-editor"
        />
      </div>
    </div>
  );
}
