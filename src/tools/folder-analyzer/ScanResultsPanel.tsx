/**
 * 扫描结果面板:概览卡片 + 分类明细(shadcn Card/Tabs/Table,纯展示)。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { humanBytes, categoryLabel, type FileCategory, type ScanReport } from './types';

interface Props {
  report: ScanReport;
}

type TabKey = 'ext' | 'category' | 'text' | 'largest';

const TABS: ReadonlyArray<[TabKey, string]> = [
  ['ext', 'tools.folder_analyzer.tab_by_ext'],
  ['category', 'tools.folder_analyzer.tab_by_category'],
  ['text', 'tools.folder_analyzer.tab_text_metrics'],
  ['largest', 'tools.folder_analyzer.tab_largest'],
];

export function ScanResultsPanel({ report }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('ext');
  const tm = report.text_metrics;
  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="scan-results">
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          label={t('tools.folder_analyzer.stat_total_files')}
          value={String(report.total_files)}
          testId="scan-total-files"
        />
        <StatCard
          label={t('tools.folder_analyzer.stat_total_dirs')}
          value={String(report.total_dirs)}
          testId="scan-total-dirs"
        />
        <StatCard
          label={t('tools.folder_analyzer.stat_total_size')}
          value={humanBytes(report.total_bytes)}
          testId="scan-total-size"
        />
        <StatCard
          label={t('tools.folder_analyzer.stat_elapsed')}
          value={`${report.elapsed_ms} ms`}
          testId="scan-elapsed"
        />
      </div>

      {(report.truncated || report.cancelled) && (
        <Alert role="status" data-testid="scan-partial-warning">
          <AlertDescription className="text-sm">
            {report.truncated ? t('tools.folder_analyzer.partial_truncated') : ''}
            {report.cancelled ? t('tools.folder_analyzer.partial_cancelled') : ''}
            {t('tools.folder_analyzer.partial_suffix')}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {TABS.map(([key, labelKey]) => (
            <TabsTrigger key={key} value={key} data-testid={`scan-tab-${key}`}>
              {t(labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border" data-testid="scan-table-wrap">
        {tab === 'ext' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">{t('tools.folder_analyzer.col_ext')}</TableHead>
                <TableHead className="text-right">{t('tools.folder_analyzer.col_count')}</TableHead>
                <TableHead className="pr-3 text-right">
                  {t('tools.folder_analyzer.col_size')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_extension.map((e) => (
                <TableRow key={e.ext} data-testid={`scan-ext-row-${e.ext}`}>
                  <TableCell className="pl-3 font-mono">
                    {e.ext || t('tools.folder_analyzer.no_ext')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.files}</TableCell>
                  <TableCell className="pr-3 text-right tabular-nums">
                    {humanBytes(e.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === 'category' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">{t('tools.folder_analyzer.col_category')}</TableHead>
                <TableHead className="text-right">{t('tools.folder_analyzer.col_count')}</TableHead>
                <TableHead className="pr-3 text-right">
                  {t('tools.folder_analyzer.col_size')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_category.map((c) => (
                <TableRow key={c.category} data-testid={`scan-cat-row-${c.category}`}>
                  <TableCell className="pl-3">
                    {categoryLabel(c.category as FileCategory)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.files}</TableCell>
                  <TableCell className="pr-3 text-right tabular-nums">
                    {humanBytes(c.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === 'text' && tm && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">{t('tools.folder_analyzer.col_ext')}</TableHead>
                <TableHead className="text-right">{t('tools.folder_analyzer.col_files')}</TableHead>
                <TableHead className="text-right">{t('tools.folder_analyzer.col_lines')}</TableHead>
                <TableHead className="pr-3 text-right">
                  {t('tools.folder_analyzer.col_words')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tm.by_extension.map((e) => (
                <TableRow key={e.ext} data-testid={`scan-text-row-${e.ext}`}>
                  <TableCell className="pl-3 font-mono">{e.ext}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.files}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.lines}</TableCell>
                  <TableCell className="pr-3 text-right tabular-nums">{e.words}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === 'text' && tm && (
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            {t('tools.folder_analyzer.text_summary', {
              analyzed: tm.files_analyzed,
              lines: tm.lines,
              words: tm.words,
              chars: tm.chars,
            })}
            {tm.files_skipped_large > 0 &&
              ` · ${t('tools.folder_analyzer.text_skipped_large', { count: tm.files_skipped_large })}`}
            {tm.files_skipped_binary > 0 &&
              ` · ${t('tools.folder_analyzer.text_skipped_binary', {
                count: tm.files_skipped_binary,
              })}`}
          </div>
        )}

        {tab === 'largest' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">{t('tools.folder_analyzer.col_file_path')}</TableHead>
                <TableHead className="pr-3 text-right">
                  {t('tools.folder_analyzer.col_size')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.largest_files.map((f) => (
                <TableRow key={f.path} data-testid={`scan-largest-row`}>
                  <TableCell className="pl-3 font-mono">
                    <span className="block max-w-[60ch] truncate" title={f.path}>
                      {f.path}
                    </span>
                  </TableCell>
                  <TableCell className="pr-3 text-right tabular-nums">
                    {humanBytes(f.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card className="py-3">
      <CardHeader className="px-3">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        <div className="text-lg font-semibold tabular-nums" data-testid={testId}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
