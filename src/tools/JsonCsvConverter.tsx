/**
 * JSON↔CSV 转换器 —— 双向转换,纯前端即时计算。
 * JSON→CSV:对象数组展平一层后按 RFC 4180 序列化;
 * CSV→JSON:状态机解析,首行作表头。
 */
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Table } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import { t as translate } from '@/i18n';
import { jsonToCsv, csvToJson } from './json-csv-utils';
import type { ToolProps } from './registry';

type Direction = 'json_to_csv' | 'csv_to_json';

/** 展平一层:标量原样;对象/数组序列化为 JSON 字符串 */
function flattenOneLevel(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { value: value as never };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
  }
  return out;
}

function convert(direction: Direction, text: string): string {
  if (!text.trim()) return '';
  try {
    if (direction === 'json_to_csv') {
      const parsed: unknown = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed.map(flattenOneLevel) : [flattenOneLevel(parsed)];
      return jsonToCsv(arr);
    }
    return JSON.stringify(csvToJson(text, true), null, 2);
  } catch (e) {
    return translate('tools.json_csv_converter.convert_failed', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export function JsonCsvConverter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<Direction>('json_to_csv');
  const [text, setText] = useState('');
  // 大输入降优先级渲染,保持输入跟手
  const deferred = useDeferredValue(text);
  const output = useMemo(() => convert(direction, deferred), [direction, deferred]);

  useToolShortcutActions(toolId, {
    clearInput: () => setText(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    <div className="flex h-full flex-col gap-3" data-testid="json-csv-converter">
      <ConfigSection title="" searchAnchor="json_csv_converter:config">
        <ConfigRow
          icon={Table}
          label={t('tools.json_csv_converter.direction')}
          hint={t('tools.json_csv_converter.direction_hint')}
        >
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <TabsList>
              <TabsTrigger value="json_to_csv">JSON → CSV</TabsTrigger>
              <TabsTrigger value="csv_to_json">CSV → JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
      </ConfigSection>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20}>
          <CodeEditor
            title={
              direction === 'json_to_csv'
                ? t('tools.json_csv_converter.json_input')
                : t('tools.json_csv_converter.csv_input')
            }
            value={text}
            onChange={setText}
            showClear
            language="plaintext"
            data-testid="input"
            searchAnchor="json_csv_converter:input"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50} minSize={20}>
          <CodeEditor
            title={t('tools.json_csv_converter.output_title')}
            language={direction === 'csv_to_json' ? 'json' : 'plaintext'}
            readOnly
            value={output}
            data-testid="output"
            searchAnchor="json_csv_converter:output"
            actions={
              <>
                {output && <CopyAction text={output} testId="copy-output" />}
                {output && (
                  <SendToMenu text={output} currentToolId={toolId} testId="output-send" />
                )}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
