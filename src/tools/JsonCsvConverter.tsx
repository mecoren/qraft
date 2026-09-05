/**
 * JSON↔CSV 转换器 —— 双向转换,纯前端即时计算。
 * JSON→CSV:对象数组展平(可选深展平 dot path)后按 RFC 4180 序列化;
 * CSV→JSON:状态机解析,首行作表头(可关),可选类型推断。
 * 支持自定义分隔符(逗号/分号/Tab/管道)与结果下载。
 */
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Table } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { downloadText } from '@/lib/file-utils';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import { t as translate } from '@/i18n';
import { csvToJson, flattenEntry, jsonToCsv, type CsvDelimiter } from './json-csv-utils';
import type { ToolProps } from './registry';

type Direction = 'json_to_csv' | 'csv_to_json';

const DELIMITERS: readonly { value: CsvDelimiter; label: string; key: string }[] = [
  { value: ',', label: ',', key: 'delimiter_comma' },
  { value: ';', label: ';', key: 'delimiter_semicolon' },
  { value: '\t', label: 'Tab', key: 'delimiter_tab' },
  { value: '|', label: '|', key: 'delimiter_pipe' },
];

function convert(
  direction: Direction,
  text: string,
  opts: {
    delimiter: CsvDelimiter;
    header: boolean;
    infer: boolean;
    deepFlatten: boolean;
  },
): string {
  if (!text.trim()) return '';
  try {
    if (direction === 'json_to_csv') {
      const parsed: unknown = JSON.parse(text);
      const arr = Array.isArray(parsed)
        ? parsed.map((v) => flattenEntry(v, opts.deepFlatten))
        : [flattenEntry(parsed, opts.deepFlatten)];
      return jsonToCsv(arr, opts.delimiter);
    }
    return JSON.stringify(
      csvToJson(text, { header: opts.header, delimiter: opts.delimiter, infer: opts.infer }),
      null,
      2,
    );
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
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [header, setHeader] = useState(true);
  const [infer, setInfer] = useState(false);
  const [deepFlatten, setDeepFlatten] = useState(false);
  // 大输入降优先级渲染,保持输入跟手
  const deferred = useDeferredValue(text);
  const output = useMemo(
    () => convert(direction, deferred, { delimiter, header, infer, deepFlatten }),
    [direction, deferred, delimiter, header, infer, deepFlatten],
  );

  useToolShortcutActions(toolId, {
    clearInput: () => setText(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  const outputTitle = t('tools.json_csv_converter.output_title');
  const download = (): void => {
    if (!output) return;
    if (direction === 'json_to_csv') {
      downloadText('converted.csv', output, 'text/csv');
    } else {
      downloadText('converted.json', output, 'application/json');
    }
  };

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="json-csv-converter"
    >
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
        <ConfigRow
          icon={Table}
          label={t('tools.json_csv_converter.delimiter')}
          hint={t('tools.json_csv_converter.delimiter_hint')}
        >
          <Select value={delimiter} onValueChange={(v) => setDelimiter(v as CsvDelimiter)}>
            <SelectTrigger
              className="w-40"
              aria-label={t('tools.json_csv_converter.delimiter')}
              data-testid="csv-delimiter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIMITERS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {t(`tools.json_csv_converter.${d.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        {direction === 'csv_to_json' && (
          <>
            <ConfigRow
              icon={Table}
              label={t('tools.json_csv_converter.first_row_header')}
              hint={t('tools.json_csv_converter.first_row_header_hint')}
            >
              <Switch
                checked={header}
                onCheckedChange={setHeader}
                aria-label={t('tools.json_csv_converter.first_row_header')}
                data-testid="csv-header"
              />
            </ConfigRow>
            <ConfigRow
              icon={Table}
              label={t('tools.json_csv_converter.type_inference')}
              hint={t('tools.json_csv_converter.type_inference_hint')}
            >
              <Switch
                checked={infer}
                onCheckedChange={setInfer}
                aria-label={t('tools.json_csv_converter.type_inference')}
                data-testid="csv-infer"
              />
            </ConfigRow>
          </>
        )}
        {direction === 'json_to_csv' && (
          <ConfigRow
            icon={Table}
            label={t('tools.json_csv_converter.deep_flatten')}
            hint={t('tools.json_csv_converter.deep_flatten_hint')}
          >
            <Switch
              checked={deepFlatten}
              onCheckedChange={setDeepFlatten}
              aria-label={t('tools.json_csv_converter.deep_flatten')}
              data-testid="csv-deep-flatten"
            />
          </ConfigRow>
        )}
      </ConfigSection>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20">
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
            // 只保留右侧边框(朝向中间分隔缝),外三边由外层 shell 卡片提供
            className="h-full rounded-none border-0 border-r"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="50" minSize="20">
          <CodeEditor
            title={outputTitle}
            language={direction === 'csv_to_json' ? 'json' : 'plaintext'}
            readOnly
            value={output}
            data-testid="output"
            searchAnchor="json_csv_converter:output"
            // 对称:只保留左侧边框(朝向中间分隔缝),理由同输入侧
            className="h-full rounded-none border-0 border-l"
            actions={
              <>
                {output && (
                  <HeaderAction onClick={download} testId="download-output">
                    <Download aria-hidden className="size-3.5" />
                    {t('tools.json_csv_converter.download')}
                  </HeaderAction>
                )}
                {output && <CopyAction text={output} testId="copy-output" />}
                {output && <SendToMenu text={output} currentToolId={toolId} testId="output-send" />}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
