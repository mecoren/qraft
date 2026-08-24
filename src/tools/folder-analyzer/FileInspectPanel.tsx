/** 单文件解析面板(纯展示)。 */
import { Fragment } from 'react';
import { zhCategory, type FileCategory, type FileInspectReport } from './types';

interface Props {
  report: FileInspectReport;
}

export function FileInspectPanel({ report }: Props) {
  const rows: Array<[string, string]> = [
    ['路径', report.path],
    ['类型', `${zhCategoryOf(report.category)}${report.magic ? `(魔数:${report.magic})` : ''}`],
    ['大小', `${report.size_bytes} 字节`],
    ...(report.is_text
      ? ([
          ['编码', report.encoding ?? '-'],
          [
            '行数 / 词数 / 字符',
            `${report.lines ?? 0} / ${report.words ?? 0} / ${report.chars ?? 0}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ['SHA-256', report.sha256],
  ];
  return (
    <div className="flex flex-col gap-4 min-h-0" data-testid="inspect-panel">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <FragmentRow key={k} k={k} v={v} />
        ))}
      </dl>
      {report.preview.length > 0 && (
        <div className="min-h-0 overflow-auto rounded-md border p-3">
          <pre className="text-xs leading-5">{report.preview.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}

function zhCategoryOf(c: FileCategory): string {
  return zhCategory(c);
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <Fragment>
      <dt className="text-muted-foreground whitespace-nowrap">{k}</dt>
      <dd className="font-mono break-all">{v}</dd>
    </Fragment>
  );
}
