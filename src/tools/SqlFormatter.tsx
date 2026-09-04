/**
 * SQL 格式化器 —— 基于 sql-formatter
 *
 * 支持:12 种方言、缩进(2/4 空格/Tab)、关键字大小写、
 * 压缩(minify,单行去除多余空白)、表达式括号与换行风格、逗号位置。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, IndentIncrease, CaseUpper, Braces } from 'lucide-react';
import { format, type SqlLanguage } from 'sql-formatter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import type { ToolProps } from './registry';

const DIALECTS: Array<{ value: SqlLanguage; labelKey: string }> = [
  { value: 'sql', labelKey: 'tools.sql_formatter.dialect_standard_sql' },
  { value: 'mysql', labelKey: 'tools.sql_formatter.dialect_mysql' },
  { value: 'postgresql', labelKey: 'tools.sql_formatter.dialect_postgresql' },
  { value: 'sqlite', labelKey: 'tools.sql_formatter.dialect_sqlite' },
  { value: 'mariadb', labelKey: 'tools.sql_formatter.dialect_mariadb' },
  { value: 'transactsql', labelKey: 'tools.sql_formatter.dialect_transactsql' },
  { value: 'plsql', labelKey: 'tools.sql_formatter.dialect_plsql' },
  { value: 'bigquery', labelKey: 'tools.sql_formatter.dialect_bigquery' },
  { value: 'db2', labelKey: 'tools.sql_formatter.dialect_db2' },
  { value: 'hive', labelKey: 'tools.sql_formatter.dialect_hive' },
  { value: 'singlestoredb', labelKey: 'tools.sql_formatter.dialect_singlestoredb' },
  { value: 'trino', labelKey: 'tools.sql_formatter.dialect_trino' },
];

type IndentMode = '2' | '4' | 'tab';

export function SqlFormatter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlLanguage>('sql');
  const [indent, setIndent] = useState<IndentMode>('2');
  const [keywordCase, setKeywordCase] = useState<'upper' | 'lower' | 'preserve'>('upper');
  const [minify, setMinify] = useState(false);
  // sql-formatter 对长 SQL 词法分析较重:defer 输入优先,格式化低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      if (minify) {
        // 压缩:格式化后把所有空白序列折叠为单空格,去行尾分号前空白
        const formatted = format(deferredInput, {
          language: dialect,
          tabWidth: 2,
          keywordCase,
        });
        return formatted.replace(/\s+/g, ' ').trim();
      }
      return format(deferredInput, {
        language: dialect,
        tabWidth: indent === 'tab' ? 1 : Number(indent),
        useTabs: indent === 'tab',
        keywordCase,
      });
    } catch (e) {
      return t('tools.sql_formatter.format_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [deferredInput, dialect, indent, keywordCase, minify, t]);

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 横向双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="sql-formatter"
    >
      <ConfigSection title="" searchAnchor="sql_formatter:config">
        <ConfigRow
          icon={Database}
          label={t('tools.sql_formatter.language')}
          hint={t('tools.sql_formatter.language_hint')}
        >
          <Select value={dialect} onValueChange={(v) => setDialect(v as SqlLanguage)}>
            <SelectTrigger data-testid="sql-dialect" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIALECTS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {t(d.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        {!minify && (
          <ConfigRow icon={IndentIncrease} label={t('tools.sql_formatter.indent')}>
            <Select value={indent} onValueChange={(v) => setIndent(v as IndentMode)}>
              <SelectTrigger data-testid="sql-indent" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">{t('tools.sql_formatter.indent_2')}</SelectItem>
                <SelectItem value="4">{t('tools.sql_formatter.indent_4')}</SelectItem>
                <SelectItem value="tab">{t('tools.sql_formatter.indent_tab')}</SelectItem>
              </SelectContent>
            </Select>
          </ConfigRow>
        )}
        <ConfigRow icon={CaseUpper} label={t('tools.sql_formatter.keyword_case')}>
          <Select
            value={keywordCase}
            onValueChange={(v) => setKeywordCase(v as 'upper' | 'lower' | 'preserve')}
          >
            <SelectTrigger data-testid="sql-case" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upper">{t('tools.sql_formatter.case_upper')}</SelectItem>
              <SelectItem value="lower">{t('tools.sql_formatter.case_lower')}</SelectItem>
              <SelectItem value="preserve">{t('tools.sql_formatter.case_preserve')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={Braces}
          label={t('tools.sql_formatter.label_minify')}
          hint={t('tools.sql_formatter.hint_minify')}
        >
          <Switch
            data-testid="sql-minify"
            aria-label={t('tools.sql_formatter.label_minify')}
            checked={minify}
            onCheckedChange={setMinify}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.sql_formatter.input_title')}
            language="sql"
            value={input}
            onChange={setInput}
            data-testid="sql-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="sql_formatter:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.sql_formatter.output_title')}
            language="sql"
            value={output}
            readOnly
            data-testid="sql-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="sql_formatter:output"
            actions={
              <>
                {output && <CopyAction text={output} testId="sql-copy" />}
                {output && (
                  <SendToMenu text={output} currentToolId={toolId} testId="sql-send" />
                )}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
