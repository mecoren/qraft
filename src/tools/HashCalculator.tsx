import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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

interface HashParams {
  algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3';
}

export function HashCalculator({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [algorithm, setAlgorithm] =
    useState<'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3'>('sha256');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);

  async function handleCompute() {
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const params: HashParams = { algorithm };
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
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="algo-select" className="text-xs">
            Algorithm
          </Label>
          <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as typeof algorithm)}>
            <SelectTrigger id="algo-select" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="md5">MD5</SelectItem>
              <SelectItem value="sha1">SHA-1</SelectItem>
              <SelectItem value="sha256">SHA-256</SelectItem>
              <SelectItem value="sha512">SHA-512</SelectItem>
              <SelectItem value="blake3">BLAKE3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCompute} disabled={loading || !text}>
          {loading ? 'Computing...' : 'Compute'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1">
        <div className="flex flex-col gap-2">
          <Label>Input Text</Label>
          <Textarea
            placeholder="Enter text to hash..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 font-mono text-sm"
            data-testid="input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Hash</Label>
          {progress && (
            <div className="flex flex-col gap-1">
              <Progress value={progress.percent} />
              <span className="text-xs text-muted-foreground">{progress.message}</span>
            </div>
          )}
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
              className="flex-1 font-mono text-sm break-all"
              data-testid="output"
            />
          )}
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} bytes · {output.meta.duration_ms}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
