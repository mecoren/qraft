/**
 * YAML 格式化器 —— yaml 包(YAML 1.2)Document 级往返,保留注释/锚点/块标量/多文档
 *
 * 支持:缩进(2/4 空格/压缩)、键排序、错误行列定位(点击跳转输入侧)。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownAZ, IndentIncrease } from 'lucide-react';
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
import {
  formatYaml,
  inspectYaml,
  type YamlFormatError,
  type YamlIndentMode,
} from './yaml-format-utils';
import type { ToolProps } from './registry';

export function YamlFormatter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<YamlIndentMode>('2');
  const [sortKeys, setSortKeys] = useState(false);
  // 大文档解析较重:defer 输入优先,格式化低优先级追赶
  const deferredInput = useDeferredValue(input);

  const result = useMemo(() => {
    if (!deferredInput.trim()) return { output: '', error: null as YamlFormatError | null };
    try {
      return { output: formatYaml(deferredInput, mode, sortKeys), error: null };
    } catch (e) {
      return {
        output: '',
        error: e as YamlFormatError,
      };
    }
  }, [deferredInput, mode, sortKeys]);

  const { output, error } = result;

  // 解析成功时的轻量统计(键数/深度/文档数),失败为 null
  const stats = useMemo(
    () => (output && !error ? inspectYaml(deferredInput) : null),
    [output, error, deferredInput],
  );

  const errorLabel = useMemo(() => {
    if (!error) return null;
    const loc =
      error.line !== null && error.column !== null ? `L${error.line}:C${error.column}` : null;
    return loc ? `${loc} ${error.message}` : error.message;
  }, [error]);

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 XmlFormatter/SqlFormatter 基准):配置区 + 横向双栏工作区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="yaml-formatter"
    >
      <ConfigSection title="" searchAnchor="yaml_formatter:config">
        <ConfigRow icon={IndentIncrease} label={t('tools.yaml_formatter.indent')}>
          <Select value={mode} onValueChange={(v) => setMode(v as YamlIndentMode)}>
            <SelectTrigger data-testid="yaml-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">{t('tools.yaml_formatter.indent_2')}</SelectItem>
              <SelectItem value="4">{t('tools.yaml_formatter.indent_4')}</SelectItem>
              <SelectItem value="minify">{t('tools.yaml_formatter.indent_minify')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={ArrowDownAZ}
          label={t('tools.yaml_formatter.sort_keys')}
          hint={t('tools.yaml_formatter.sort_keys_hint')}
        >
          <Switch
            data-testid="yaml-sort-keys"
            aria-label={t('tools.yaml_formatter.sort_keys')}
            checked={sortKeys}
            onCheckedChange={setSortKeys}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.yaml_formatter.input_title')}
            language="yaml"
            value={input}
            onChange={setInput}
            data-testid="yamlfmt-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="yaml_formatter:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.yaml_formatter.output_title')}
            language="yaml"
            value={
              error
                ? t('tools.yaml_formatter.format_failed', { message: errorLabel ?? '' })
                : output
            }
            readOnly
            data-testid="yamlfmt-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="yaml_formatter:output"
            actions={
              <>
                {error?.line !== null && error?.line !== undefined && (
                  <span
                    data-testid="yamlfmt-error-loc"
                    className="shrink-0 text-xs text-destructive"
                  >
                    {error.line !== null && error.column !== null
                      ? `L${error.line}:C${error.column}`
                      : ''}
                  </span>
                )}
                {stats && (
                  <span
                    data-testid="yamlfmt-stats"
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  >
                    {t('tools.yaml_formatter.stats', {
                      docs: stats.documents,
                      keys: stats.keys,
                      depth: stats.depth,
                    })}
                  </span>
                )}
                {output && <CopyAction text={output} testId="yamlfmt-copy" />}
                {output && (
                  <SendToMenu text={output} currentToolId={toolId} testId="yamlfmt-send" />
                )}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
