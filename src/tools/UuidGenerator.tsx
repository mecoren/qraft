/**
 * UUID 生成器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:版本 / 数量 / 格式(大写·连字符)三行
 * - 下方全高输出编辑器:「生成」动作在编辑器工具栏,结果区带「全部复制」
 *
 * 错误处理遵循新代约定:执行失败信息直接写入输出编辑器。
 */
import { useState, type JSX } from 'react';
import { Fingerprint, Hash, Play, Type } from 'lucide-react';
import { formatError } from '@/lib/format-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { invokeCommand } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface UuidParams {
  version: 'v4' | 'v7';
  count: number;
  uppercase: boolean;
  hyphens: boolean;
}

export function UuidGenerator({ toolId }: ToolProps): JSX.Element {
  const [version, setVersion] = useState<'v4' | 'v7'>('v4');
  const [count, setCount] = useState(1);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params: UuidParams = { version, count, uppercase, hyphens };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text: undefined, params },
      });
      setOutput(result.text ?? '');
    } catch (e) {
      setOutput(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3" data-testid="uuid-generator">
      <ConfigSection title="" searchAnchor="uuid_generator:config">
        <ConfigRow icon={Fingerprint} label="版本" hint="v4 随机 / v7 时间有序">
          <Select value={version} onValueChange={(v) => setVersion(v as 'v4' | 'v7')}>
            <SelectTrigger className="w-24" aria-label="版本">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="v4">v4</SelectItem>
              <SelectItem value="v7">v7</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={Hash} label="数量" hint="1 ~ 1000">
          <Input
            id="count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-24"
            aria-label="数量"
          />
        </ConfigRow>
        <ConfigRow icon={Type} label="格式" hint="大小写与连字符样式">
          <div className="flex items-center gap-2">
            <Switch id="uppercase" checked={uppercase} onCheckedChange={setUppercase} />
            <Label htmlFor="uppercase" className="text-xs">
              大写
            </Label>
          </div>
          <span className="h-4 w-px bg-border" aria-hidden />
          <div className="flex items-center gap-2">
            <Switch id="hyphens" checked={hyphens} onCheckedChange={setHyphens} />
            <Label htmlFor="hyphens" className="text-xs">
              连字符
            </Label>
          </div>
        </ConfigRow>
      </ConfigSection>

      <CodeEditor
        readOnly
        title="生成结果"
        language="plaintext"
        value={output}
        placeholder="点击上方「生成」按钮创建 UUID"
        className="min-h-0 flex-1"
        data-testid="output"
        searchAnchor="uuid_generator:output"
        actions={
          <>
            <HeaderAction onClick={() => void handleGenerate()} disabled={loading}>
              <Play aria-hidden className="size-3.5" />
              {loading ? '生成中' : '生成'}
            </HeaderAction>
            {output && <CopyAction text={output} testId="copy-all" />}
          </>
        }
      />
    </div>
  );
}

/** 把任意异常格式化为输出框可显示的错误文本(与其他新代工具一致) */

