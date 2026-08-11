/**
 * SQL 格式化器 —— 基于 sql-formatter
 *
 * 支持方言选择、缩进宽度、关键字大小写。
 */

import { useMemo, useState, type JSX } from 'react';
import { Database, IndentIncrease, CaseUpper } from 'lucide-react';
import { format, type SqlLanguage } from 'sql-formatter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

const DIALECTS: Array<{ value: SqlLanguage; label: string }> = [
  { value: 'sql', label: '标准 SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'transactsql', label: 'SQL Server (T-SQL)' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'bigquery', label: 'BigQuery' },
];

export function SqlFormatter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlLanguage>('sql');
  const [indent, setIndent] = useState('2');
  const [keywordCase, setKeywordCase] = useState<'upper' | 'lower' | 'preserve'>('upper');

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return format(input, {
        language: dialect,
        tabWidth: Number(indent),
        keywordCase,
      });
    } catch (e) {
      return `格式化失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [input, dialect, indent, keywordCase]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="sql-formatter">
      <ConfigSection>
        <ConfigRow icon={Database} label="语言" hint="选择 SQL 方言">
          <Select value={dialect} onValueChange={(v) => setDialect(v as SqlLanguage)}>
            <SelectTrigger data-testid="sql-dialect" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIALECTS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={IndentIncrease} label="缩进">
          <Select value={indent} onValueChange={setIndent}>
            <SelectTrigger data-testid="sql-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 个空格</SelectItem>
              <SelectItem value="4">4 个空格</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={CaseUpper} label="关键字大小写">
          <Select
            value={keywordCase}
            onValueChange={(v) => setKeywordCase(v as 'upper' | 'lower' | 'preserve')}
          >
            <SelectTrigger data-testid="sql-case" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upper">大写</SelectItem>
              <SelectItem value="lower">小写</SelectItem>
              <SelectItem value="preserve">保持原样</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入"
            language="sql"
            value={input}
            onChange={setInput}
            data-testid="sql-input"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输出"
            language="sql"
            value={output}
            readOnly
            data-testid="sql-output"
            className="h-full"
            actions={<CopyAction text={output} testId="sql-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
