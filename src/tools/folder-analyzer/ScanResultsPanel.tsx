/** 扫描结果面板:概览 + 分类明细(纯展示)。 */
import { useState } from 'react';
import { humanBytes, zhCategory, type ExtStat, type FileCategory } from './types';

interface Props {
  report: import('./types').ScanReport;
}

type TabKey = 'ext' | 'category' | 'text' | 'largest';

export function ScanResultsPanel({ report }: Props) {
  const [tab, setTab] = useState<TabKey>('ext');
  const tabs: Array<[TabKey, string]> = [
    ['ext', '按扩展名'],
    ['category', '按类别'],
    ['text', '文本行数/字数'],
    ['largest', '最大文件'],
  ];
  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="grid grid-cols-4 gap-2">
        <Card label="文件总数" value={String(report.total_files)} testId="scan-total-files" />
        <Card label="目录数" value={String(report.total_dirs)} testId="scan-total-dirs" />
        <Card label="总大小" value={humanBytes(report.total_bytes)} testId="scan-total-size" />
        <Card label="耗时" value={`${report.elapsed_ms} ms`} testId="scan-elapsed" />
      </div>

      {(report.truncated || report.cancelled) && (
        <div role="status" className="text-sm text-yellow-600 dark:text-yellow-400">
          {report.truncated ? '结果被截断(超过条目上限),' : ''}
          {report.cancelled ? '已被用户取消,' : ''}以下为部分统计。
        </div>
      )}

      <div className="flex gap-2 text-sm">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key ? 'font-semibold underline underline-offset-4' : 'text-muted-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ext' && (
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left py-1">扩展名</th>
              <th className="text-right">数量</th>
              <th className="text-right">大小</th>
            </tr>
          </thead>
          <tbody>
            {report.by_extension.map((e: ExtStat) => (
              <tr key={e.ext} data-testid={`scan-ext-row-${e.ext}`}>
                <td className="py-1 font-mono">{e.ext || '(无扩展名)'}</td>
                <td className="text-right">{e.files}</td>
                <td className="text-right">{humanBytes(e.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'category' && (
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left py-1">类别</th>
              <th className="text-right">数量</th>
              <th className="text-right">大小</th>
            </tr>
          </thead>
          <tbody>
            {report.by_category.map((c) => (
              <tr key={c.category} data-testid={`scan-cat-row-${c.category}`}>
                <td className="py-1">{zhCategory(c.category as FileCategory)}</td>
                <td className="text-right">{c.files}</td>
                <td className="text-right">{humanBytes(c.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'text' && report.text_metrics && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex gap-4 text-muted-foreground">
            <span>覆盖 {report.text_metrics.files_analyzed} 个文本文件</span>
            <span>
              共 {report.text_metrics.lines} 行 · {report.text_metrics.words} 词 ·{' '}
              {report.text_metrics.chars} 字符
            </span>
          </div>
          <table className="text-sm w-full">
            <thead>
              <tr>
                <th className="text-left py-1">扩展名</th>
                <th className="text-right">文件</th>
                <th className="text-right">行数</th>
                <th className="text-right">字数</th>
              </tr>
            </thead>
            <tbody>
              {report.text_metrics.by_extension.map((e) => (
                <tr key={e.ext} data-testid={`scan-text-row-${e.ext}`}>
                  <td className="py-1 font-mono">{e.ext}</td>
                  <td className="text-right">{e.files}</td>
                  <td className="text-right">{e.lines}</td>
                  <td className="text-right">{e.words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'largest' && (
        <ul className="text-sm font-mono space-y-1">
          {report.largest_files.map((f) => (
            <li key={f.path} className="flex justify-between gap-4">
              <span className="truncate" title={f.path}>
                {f.path}
              </span>
              <span>{humanBytes(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
