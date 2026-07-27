import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface UuidParams {
  version: 'v4' | 'v7';
  count: number;
  uppercase: boolean;
  hyphens: boolean;
}

export function UuidGenerator({ toolId }: ToolProps) {
  const [version, setVersion] = useState<'v4' | 'v7'>('v4');
  const [count, setCount] = useState(1);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const params: UuidParams = { version, count, uppercase, hyphens };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text: undefined, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAll() {
    if (output?.text) {
      await navigator.clipboard.writeText(output.text);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">版本</Label>
          <Select value={version} onValueChange={(v) => setVersion(v as 'v4' | 'v7')}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="v4">v4</SelectItem>
              <SelectItem value="v7">v7</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="count-input" className="text-xs">
            数量
          </Label>
          <Input
            id="count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-24"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="uppercase" checked={uppercase} onCheckedChange={setUppercase} />
          <Label htmlFor="uppercase" className="text-xs">
            大写
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hyphens" checked={hyphens} onCheckedChange={setHyphens} />
          <Label htmlFor="hyphens" className="text-xs">
            连字符
          </Label>
        </div>
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? '生成中...' : '生成'}
        </Button>
        {output?.text && (
          <Button variant="secondary" onClick={handleCopyAll}>
            全部复制
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <ScrollArea className="flex-1 rounded-md border p-3 font-mono text-sm" data-testid="output">
        <pre className="whitespace-pre-wrap">{output?.text ?? ''}</pre>
      </ScrollArea>
    </div>
  );
}
