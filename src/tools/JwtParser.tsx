import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

// JwtParser 输出 extra 字段结构,镜像 Rust 端 jwt_parser.rs 的 extra Map
interface JwtExtra {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  expires_at?: string;
}

export function JwtParser({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [extra, setExtra] = useState<JwtExtra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params: {} },
      });
      setExtra(result.extra as JwtExtra | null);
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
        <Label>JWT Token</Label>
        <Textarea
          placeholder="Paste JWT token here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <Button onClick={handleParse} disabled={loading || !text}>
          {loading ? 'Parsing...' : 'Parse'}
        </Button>
      </div>

      <div className="flex flex-col gap-2 overflow-auto">
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : extra ? (
          <>
            <div className="flex flex-col gap-1">
              <Label>Header</Label>
              <Textarea
                readOnly
                value={JSON.stringify(extra.header, null, 2)}
                className="font-mono text-sm"
                data-testid="header"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Payload</Label>
              <Textarea
                readOnly
                value={JSON.stringify(extra.payload, null, 2)}
                className="font-mono text-sm"
                data-testid="payload"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Signature</Label>
              <Textarea
                readOnly
                value={extra.signature}
                className="font-mono text-sm"
                data-testid="signature"
              />
            </div>
            {extra.expires_at && (
              <div className="text-xs text-muted-foreground">Expires at: {extra.expires_at}</div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Parse a JWT to see its parts
          </div>
        )}
      </div>
    </div>
  );
}
