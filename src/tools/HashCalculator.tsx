import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { CopyAction } from '@/components/copy-action';
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
  const [algorithm, setAlgorithm] = useState<'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3'>(
    'sha256',
  );
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
      <div className="flex items-center gap-4" data-search-anchor="hash_calculator:config">
        <div className="flex items-center gap-2">
          <Label htmlFor="algo-select" className="text-xs">
            算法
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
          {loading ? '计算中...' : '计算'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1">
        <div className="flex flex-col gap-2">
          <Label>输入文本</Label>
          <CodeEditor
            placeholder="输入待哈希的文本..."
            value={text}
            onChange={setText}
            language="plaintext"
            className="flex-1"
            data-testid="input"
            searchAnchor="hash_calculator:input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>哈希值</Label>
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
            <CodeEditor
              readOnly
              value={output?.text ?? ''}
              language="plaintext"
              className="flex-1"
              data-testid="output"
              searchAnchor="hash_calculator:output"
              actions={
                output?.text ? <CopyAction text={output.text} testId="copy-hash" /> : undefined
              }
            />
          )}
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} 字节 · {output.meta.duration_ms}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
