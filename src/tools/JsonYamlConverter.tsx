/**
 * JSON <> YAML 转换工具 —— yaml 库,双向实时转换
 */

import { useMemo, useState, type JSX } from 'react';
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
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('json2yaml');
  const [indent, setIndent] = useState('2');

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return convertJsonYaml(input, direction, Number(indent));
    } catch (e) {
      return `转换失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [input, direction, indent]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="json-yaml-converter">
      <ConfigSection>
        <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择转换方向">
          <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <SelectTrigger data-testid="jy-direction" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json2yaml">JSON 转 YAML</SelectItem>
              <SelectItem value="yaml2json">YAML 转 JSON</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={IndentIncrease} label="缩进">
          <Select value={indent} onValueChange={setIndent}>
            <SelectTrigger data-testid="jy-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 个空格</SelectItem>
              <SelectItem value="4">4 个空格</SelectItem>
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
            className="h-full"
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
            className="h-full"
            actions={<CopyAction text={output} testId="jy-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
