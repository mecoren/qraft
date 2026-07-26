import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

interface ColorParams {
  from_format: 'hex' | 'rgb' | 'hsl';
}

interface ColorExtra {
  hex: string;
  rgb: string;
  hsl: string;
}

export function ColorConverter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [fromFormat, setFromFormat] = useState<'hex' | 'rgb' | 'hsl'>('hex');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: ColorParams = { from_format: fromFormat };
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

  const extra = output?.extra as ColorExtra | undefined;

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="color-input" className="text-xs">
            Color value
          </Label>
          <Input
            id="color-input"
            placeholder="Enter color value..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-sm"
            data-testid="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="format-select" className="text-xs">
            From format
          </Label>
          <Select
            value={fromFormat}
            onValueChange={(v) => setFromFormat(v as 'hex' | 'rgb' | 'hsl')}
          >
            <SelectTrigger id="format-select" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hex">HEX</SelectItem>
              <SelectItem value="rgb">RGB</SelectItem>
              <SelectItem value="hsl">HSL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleConvert} disabled={loading || !text}>
          {loading ? 'Converting...' : 'Convert'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {extra && (
        <div className="grid grid-cols-2 gap-4 flex-1" data-testid="output">
          <div className="flex flex-col gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold text-muted-foreground">Preview</div>
              <div
                className="mt-2 h-24 rounded-md border"
                style={{ backgroundColor: extra.hex }}
                aria-label={`color swatch ${extra.hex}`}
              />
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="grid grid-cols-[60px_1fr_auto] gap-x-3 gap-y-2">
                <span className="font-semibold">HEX</span>
                <code className="font-mono">{extra.hex}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.hex)}
                >
                  Copy
                </button>
                <span className="font-semibold">RGB</span>
                <code className="font-mono">{extra.rgb}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.rgb)}
                >
                  Copy
                </button>
                <span className="font-semibold">HSL</span>
                <code className="font-mono">{extra.hsl}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.hsl)}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
          />
        </div>
      )}
    </div>
  );
}
