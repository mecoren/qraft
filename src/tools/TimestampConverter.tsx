import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface TimestampParams {
  timezone: string;
}

interface TimestampExtra {
  unix_seconds: number;
  unix_millis: number;
  iso8601: string;
  local: string;
  relative: string;
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export function TimestampConverter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: TimestampParams = { timezone };
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

  const extra = output?.extra as TimestampExtra | undefined;

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="ts-input" className="text-xs">
            Input (Unix seconds / millis / date string)
          </Label>
          <Input
            id="ts-input"
            placeholder="Enter timestamp or date string..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-sm"
            data-testid="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tz-select" className="text-xs">
            Timezone
          </Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="tz-select" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
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
        <ScrollArea className="flex-1 rounded-md border p-4" data-testid="output">
          <dl className="grid grid-cols-[180px_1fr_auto] gap-x-4 gap-y-3 text-sm">
            <dt className="font-semibold">Unix (seconds)</dt>
            <dd className="font-mono">{extra.unix_seconds}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(String(extra.unix_seconds))}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Unix (millis)</dt>
            <dd className="font-mono">{extra.unix_millis}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(String(extra.unix_millis))}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">ISO 8601</dt>
            <dd className="font-mono break-all">{extra.iso8601}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(extra.iso8601)}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Local ({timezone})</dt>
            <dd className="font-mono break-all">{extra.local}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(extra.local)}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Relative</dt>
            <dd className="font-mono">{extra.relative}</dd>
            <dd />
          </dl>
        </ScrollArea>
      )}
    </div>
  );
}
