/**
 * JSON <> YAML 转换工具 —— yaml 库,双向实时转换
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, IndentIncrease } from 'lucide-react';
import YAML from 'yaml';
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

type Direction = 'json2yaml' | 'yaml2json';

export function convertJsonYaml(input: string, direction: Direction, indent: number): string {
  if (direction === 'json2yaml') {
    const value: unknown = JSON.parse(input);
    return YAML.stringify(value, { indent });
  }
  const value: unknown = YAML.parse(input);
  return JSON.stringify(value, null, indent);
}

export function JsonYamlConverter(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('json2yaml');
  const [indent, setIndent] = useState('2');
  // 大文档 YAML/JSON 互转较慢:defer 输入优先,转换低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      return convertJsonYaml(deferredInput, direction, Number(indent));
    } catch (e) {
      return t('tools.json_yaml_converter.convert_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [deferredInput, direction, indent, t]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="json-yaml-converter"
    >
      <ConfigSection title="" searchAnchor="json_yaml_converter:config">
        <ConfigRow
          icon={ArrowLeftRight}
          label={t('tools.json_yaml_converter.direction_label')}
          hint={t('tools.json_yaml_converter.direction_hint')}
        >
          <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <SelectTrigger data-testid="jy-direction" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json2yaml">
                {t('tools.json_yaml_converter.json_to_yaml')}
              </SelectItem>
              <SelectItem value="yaml2json">
                {t('tools.json_yaml_converter.yaml_to_json')}
              </SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={IndentIncrease} label={t('tools.json_yaml_converter.indent')}>
          <Select value={indent} onValueChange={setIndent}>
            <SelectTrigger data-testid="jy-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">{t('tools.json_yaml_converter.indent_2')}</SelectItem>
              <SelectItem value="4">{t('tools.json_yaml_converter.indent_4')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={direction === 'json2yaml' ? 'JSON' : 'YAML'}
            language={direction === 'json2yaml' ? 'json' : 'yaml'}
            value={input}
            onChange={setInput}
            data-testid="jy-input"
            // 只保留右侧边框(朝向中间分隔缝),外三边由外层 shell 卡片提供
            className="h-full rounded-none border-0 border-r"
            searchAnchor="json_yaml_converter:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title={direction === 'json2yaml' ? 'YAML' : 'JSON'}
            language={direction === 'json2yaml' ? 'yaml' : 'json'}
            value={output}
            readOnly
            data-testid="jy-output"
            // 对称:只保留左侧边框(朝向中间分隔缝),理由同输入侧
            className="h-full rounded-none border-0 border-l"
            searchAnchor="json_yaml_converter:output"
            actions={<CopyAction text={output} testId="jy-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
