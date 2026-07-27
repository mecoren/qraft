import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Label } from '@/components/ui/label';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

// JsonMinifier 调用参数为空对象(无 indent/sort_keys 等),保持与 Rust 端 params 契约一致
interface JsonMinifierParams {
  [key: string]: never;
}

export function JsonMinifier({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleMinify() {
    setLoading(true);
    setError(null);
    try {
      const params: JsonMinifierParams = {};
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
        <Button onClick={handleMinify} disabled={loading || !text}>
          {loading ? '压缩中...' : '压缩'}
        </Button>
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
