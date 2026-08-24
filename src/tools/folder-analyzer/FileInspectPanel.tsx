/**
 * 单文件解析面板(纯展示):键值详情 + 只读 Monaco 内容预览(按扩展名高亮)。
 */
import { Fragment } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { writeClipboardText } from '@/lib/clipboard';
import { inferLanguageFromPath } from '@/tools/code-editor-workspace/languageMap';
import { humanBytes, zhCategory, type FileInspectReport } from './types';

interface Props {
  report: FileInspectReport;
}

export function FileInspectPanel({ report }: Props) {
  const rows: Array<[string, string, string?]> = [
    ['路径', report.path],
    ['类型', `${zhCategory(report.category)}${report.magic ? `(魔数:${report.magic})` : ''}`],
    ['大小', `${humanBytes(report.size_bytes)}(${report.size_bytes} 字节)`],
    ...(report.is_text
      ? ([
          ['编码', report.encoding ?? '-'],
          [
            '行数 / 词数 / 字符',
            `${report.lines ?? 0} / ${report.words ?? 0} / ${report.chars ?? 0}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ['SHA-256', report.sha256, report.sha256],
  ];
  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="inspect-panel">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v, copyValue]) => (
          <Fragment key={k}>
            <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
            <dd className="flex items-center gap-2 break-all font-mono">
              <span className="min-w-0 break-all">{v}</span>
              {copyValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 shrink-0 p-0"
                  title="复制 SHA-256"
                  aria-label="复制 SHA-256"
                  data-testid="inspect-copy-sha"
                  onClick={() => {
                    void writeClipboardText(copyValue);
                    toast.success('已复制 SHA-256');
                  }}
                >
                  <Copy aria-hidden className="size-3.5" />
                </Button>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
      {report.preview.length > 0 && (
        <div
          className="flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-md border"
          data-testid="inspect-preview"
        >
          <CodeEditor
            value={report.preview.join('\n')}
            readOnly
            language={inferLanguageFromPath(report.path)}
            showStatusBar={false}
            showPaste={false}
            showOpenFile={false}
            showClear={false}
            embedded
            className="h-full"
            data-testid="inspect-preview-editor"
          />
        </div>
      )}
    </div>
  );
}
