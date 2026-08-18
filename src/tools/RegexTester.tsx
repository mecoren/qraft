import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodeEditor } from '@/components/ui/code-editor';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface RegexParams {
  pattern: string;
  flags: string;
}

interface RegexMatch {
  match: string;
  index: number;
  groups: (string | null)[];
}

interface RegexExtra {
  matches: RegexMatch[];
  match_count: number;
}

export function RegexTester({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTest() {
    setLoading(true);
    setError(null);
    try {
      const params: RegexParams = { pattern, flags };
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

  const extra = output?.extra as RegexExtra | undefined;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="grid grid-cols-[1fr_120px_auto] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pattern-input" className="text-xs">
            正则表达式
          </Label>
          <Input
            id="pattern-input"
            placeholder="输入正则表达式..."
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="font-mono text-sm"
            data-testid="pattern"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="flags-input" className="text-xs">
            标志位
          </Label>
          <Input
            id="flags-input"
            placeholder="标志位"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <Button onClick={handleTest} disabled={loading || !pattern || !text}>
          {loading ? '测试中...' : '测试'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1">
        <div className="flex flex-col gap-2">
          <Label>测试文本</Label>
          <CodeEditor
            placeholder="输入测试文本..."
            value={text}
            onChange={setText}
            language="plaintext"
            className="flex-1"
            data-testid="input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>匹配结果</Label>
            {extra && (
              <span className="text-xs text-muted-foreground">{extra.match_count} 个匹配</span>
            )}
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : extra ? (
            <ScrollArea className="flex-1 rounded-md border p-3" data-testid="output">
              <ul className="space-y-2 text-sm">
                {extra.matches.map((m, i) => (
                  <li key={i} className="border-b pb-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{i + 1} @{m.index}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                        {m.match}
                      </code>
                    </div>
                    {m.groups.length > 0 && (
                      <div className="mt-1 pl-4 text-xs text-muted-foreground">
                        分组:{' '}
                        {m.groups.map((g, gi) => (
                          <span key={gi} className="font-mono">
                            [{gi + 1}]={g ?? '<无>'}{' '}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
                {extra.matches.length === 0 && (
                  <li className="text-sm text-muted-foreground">未找到匹配项。</li>
                )}
              </ul>
            </ScrollArea>
          ) : (
            <CodeEditor
              readOnly
              value=""
              language="plaintext"
              className="flex-1"
              data-testid="output"
            />
          )}
        </div>
      </div>
    </div>
  );
}
