/**
 * 单文件解析面板(纯展示):键值详情 + 只读 Monaco 内容预览(按扩展名高亮)。
 */
import { Fragment } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { writeClipboardText } from '@/lib/clipboard';
import { inferLanguageFromPath } from '@/tools/code-editor-workspace/languageMap';
import { humanBytes, categoryLabel, type FileInspectReport } from './types';

interface Props {
  report: FileInspectReport;
}

export function FileInspectPanel({ report }: Props) {
  const { t } = useTranslation();
  const rows: Array<[string, string, string?]> = [
    [t('tools.folder_analyzer.field_path'), report.path],
    [
      t('tools.folder_analyzer.field_type'),
      report.magic
        ? t('tools.folder_analyzer.type_with_magic', {
            category: categoryLabel(report.category),
            magic: report.magic,
          })
        : categoryLabel(report.category),
    ],
    [
      t('tools.folder_analyzer.field_size'),
      t('tools.folder_analyzer.size_detail', {
        human: humanBytes(report.size_bytes),
        bytes: report.size_bytes,
      }),
    ],
    ...(report.is_text
      ? ([
          [t('tools.folder_analyzer.field_encoding'), report.encoding ?? '-'],
          [
            t('tools.folder_analyzer.field_counts'),
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
                  title={t('tools.folder_analyzer.copy_sha_title')}
                  aria-label={t('tools.folder_analyzer.copy_sha_title')}
                  data-testid="inspect-copy-sha"
                  onClick={() => {
                    void writeClipboardText(copyValue);
                    toast.success(t('tools.folder_analyzer.toast_sha_copied'));
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
