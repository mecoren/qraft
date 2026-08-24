/**
 * 扫描结果面板:概览卡片 + 分类明细(shadcn Card/Tabs/Table,纯展示)。
 */
import { useState } from 'react';
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
import { humanBytes, zhCategory, type FileCategory, type ScanReport } from './types';

interface Props {
  report: ScanReport;
}

type TabKey = 'ext' | 'category' | 'text' | 'largest';

const TABS: ReadonlyArray<[TabKey, string]> = [
  ['ext', '按扩展名'],
  ['category', '按类别'],
  ['text', '文本行数/字数'],
  ['largest', '最大文件'],
];

export function ScanResultsPanel({ report }: Props) {
  const [tab, setTab] = useState<TabKey>('ext');
  const tm = report.text_metrics;
  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="scan-results">
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="文件总数" value={String(report.total_files)} testId="scan-total-files" />
        <StatCard label="目录数" value={String(report.total_dirs)} testId="scan-total-dirs" />
        <StatCard label="总大小" value={humanBytes(report.total_bytes)} testId="scan-total-size" />
        <StatCard label="耗时" value={`${report.elapsed_ms} ms`} testId="scan-elapsed" />
      </div>

      {(report.truncated || report.cancelled) && (
        <Alert role="status" data-testid="scan-partial-warning">
          <AlertDescription className="text-sm">
            {report.truncated ? '结果被截断(超过条目上限),' : ''}
            {report.cancelled ? '已被用户取消,' : ''}以下为部分统计。
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {TABS.map(([key, label]) => (
            <TabsTrigger key={key} value={key} data-testid={`scan-tab-${key}`}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border" data-testid="scan-table-wrap">
        {tab === 'ext' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">扩展名</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="pr-3 text-right">大小</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_extension.map((e) => (
                <TableRow key={e.ext} data-testid={`scan-ext-row-${e.ext}`}>
                  <TableCell className="pl-3 font-mono">{e.ext || '(无扩展名)'}</TableCell>
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
                <TableHead className="pl-3">类别</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="pr-3 text-right">大小</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_category.map((c) => (
                <TableRow key={c.category} data-testid={`scan-cat-row-${c.category}`}>
                  <TableCell className="pl-3">{zhCategory(c.category as FileCategory)}</TableCell>
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
                <TableHead className="pl-3">扩展名</TableHead>
                <TableHead className="text-right">文件</TableHead>
                <TableHead className="text-right">行数</TableHead>
                <TableHead className="pr-3 text-right">字数</TableHead>
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
            覆盖 {tm.files_analyzed} 个文本文件 · 共 {tm.lines} 行 / {tm.words} 词 /{' '}
            {tm.chars} 字符
            {tm.files_skipped_large > 0 && ` · ${tm.files_skipped_large} 个超大文件跳过`}
            {tm.files_skipped_binary > 0 && ` · ${tm.files_skipped_binary} 个二进制跳过`}
          </div>
        )}

        {tab === 'largest' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">文件</TableHead>
                <TableHead className="pr-3 text-right">大小</TableHead>
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
