import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

// UrlCodec 参数契约:action=encode|decode,component 控制使用 encodeURI 还是 encodeURIComponent 字符集
interface UrlCodecParams {
  action: 'encode' | 'decode';
  component: boolean;
}

export function UrlCodec({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [action, setAction] = useState<'encode' | 'decode'>('encode');
  const [component, setComponent] = useState(false);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleExecute() {
    setLoading(true);
    setError(null);
    try {
      const params: UrlCodecParams = { action, component };
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
        <Label>Input</Label>
        <Textarea
          placeholder="Enter text..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="url-action" className="text-xs">
              Action
            </Label>
            <Select value={action} onValueChange={(v) => setAction(v as 'encode' | 'decode')}>
              <SelectTrigger id="url-action" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="encode">Encode</SelectItem>
                <SelectItem value="decode">Decode</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="url-component"
              aria-label="Component"
              checked={component}
              onCheckedChange={setComponent}
            />
            <Label htmlFor="url-component" className="text-xs">
              Component
            </Label>
          </div>
          <Button onClick={handleExecute} disabled={loading || !text}>
            {loading ? 'Running...' : 'Execute'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Output</Label>
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} → {output.meta.output_bytes} bytes ·{' '}
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
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
