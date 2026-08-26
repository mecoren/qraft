/**
 * 内容搜索结果面板(纯展示):
 * 顶部摘要 + 单个只读 Monaco 编辑器汇总全部命中行(等宽对齐、可选中复制)。
 * 合成文本自带「行号:」前缀,编辑器关闭自身行号避免双重显示。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';
import { CodeEditor } from '@/components/ui/code-editor';
import type { SearchReport } from './types';

/** i18n 翻译函数签名(组件内传 react-i18next 的 t,保证语言切换后重算) */
type TranslateFn = typeof translate;

interface Props {
  report: SearchReport;
}

/** 把分组结果合成为纯文本文档:每文件一段,行内带 L行号: 列 前缀 */
export function composeSearchText(report: SearchReport, tr: TranslateFn = translate): string {
  const parts: string[] = [];
  for (const file of report.results) {
    parts.push(
      tr('tools.folder_analyzer.match_group_header', {
        path: file.path,
        count: file.match_count,
      }),
    );
    for (const m of file.matches) {
      parts.push(`L${m.line_number}:C${m.column}  ${m.preview}`);
    }
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

export function SearchResultsPanel({ report }: Props) {
  const { t } = useTranslation();
  const text = useMemo(() => composeSearchText(report, t), [report, t]);
  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="search-results">
      <div className="text-sm text-muted-foreground" data-testid="search-summary">
        {t('tools.folder_analyzer.search_summary', {
          pattern: report.pattern,
          matches: report.total_matches,
          files: report.files_with_matches,
        })}
        {report.truncated ? t('tools.folder_analyzer.search_truncated') : ''}
        {report.cancelled ? t('tools.folder_analyzer.search_cancelled') : ''}
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
