import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

interface JsonFormatterParams {
  indent: number;
  sort_keys: boolean;
}

export function JsonFormatter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [indent, setIndent] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFormat() {
    setLoading(true);
    setError(null);
    try {
      const params: JsonFormatterParams = { indent, sort_keys: sortKeys };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
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

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>输入 JSON</Label>
        <CodeEditor
          placeholder="在此粘贴 JSON..."
          value={text}
          onChange={setText}
          language="json"
          className="flex-1"
          data-testid="input"
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="indent-select" className="text-xs">
              缩进
            </Label>
            <Select value={String(indent)} onValueChange={(v) => setIndent(Number(v))}>
              <SelectTrigger id="indent-select" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sort-keys" checked={sortKeys} onCheckedChange={setSortKeys} />
            <Label htmlFor="sort-keys" className="text-xs">
              排序键名
            </Label>
          </div>
          <Button onClick={handleFormat} disabled={loading || !text}>
            {loading ? '格式化中...' : '格式化'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>输出</Label>
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} → {output.meta.output_bytes} 字节 ·{' '}
              {output.meta.duration_ms}ms
            </span>
          )}
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <CodeEditor
            readOnly
            value={output?.text ?? ''}
            language="json"
            className="flex-1"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
