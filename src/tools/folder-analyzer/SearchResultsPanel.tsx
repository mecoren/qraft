/** 内容搜索结果面板(纯展示)。 */
import type { SearchReport } from './types';

interface Props {
  report: SearchReport;
}

export function SearchResultsPanel({ report }: Props) {
  return (
    <div className="flex flex-col gap-3 min-h-0" data-testid="search-results">
      <div className="text-sm text-muted-foreground" data-testid="search-summary">
        「{report.pattern}」共 {report.total_matches} 处匹配 / {report.files_with_matches} 个文件
        {report.truncated ? '(已截断)' : ''}
        {report.cancelled ? '(已取消)' : ''}
      </div>
      {report.results.map((file) => (
        <div key={file.path} className="rounded-md border p-3 text-sm">
          <div className="flex justify-between font-mono">
            <span className="truncate" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0">{file.match_count} 处</span>
          </div>
          <ul className="mt-2 space-y-1">
            {file.matches.map((m) => (
              <li key={`${file.path}:${m.line_number}:${m.column}`} className="flex gap-3">
                <span className="text-muted-foreground shrink-0">
                  L{m.line_number}:C{m.column}
                </span>
                <code className="truncate">{m.preview}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
