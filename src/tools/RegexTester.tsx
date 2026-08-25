/**
 * 正则表达式测试工具 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:正则表达式 + 标志位
 * - 下方 ResizablePanelGroup 双栏工作区:
 *   左 = 测试文本编辑器(「测试」动作在工具栏);右 = 匹配结果列表
 *
 * 错误处理遵循新代约定:工具内联 alert 展示于结果区。
 */
import { useState, type JSX } from 'react';
import { ListChecks, Play, Regex } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
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

export function RegexTester({ toolId }: ToolProps): JSX.Element {
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
      setOutput(null);
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as RegexExtra | undefined;

  return (
    <div className="flex h-full flex-col gap-3" data-testid="regex-tester">
      <ConfigSection title="" searchAnchor="regex_tester:config">
        <ConfigRow icon={Regex} label="正则表达式" hint="Rust regex 语法">
          <Input
            id="pattern-input"
            placeholder="输入正则表达式..."
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="w-80 font-mono text-sm"
            data-testid="pattern"
          />
        </ConfigRow>
        <ConfigRow icon={ListChecks} label="标志位" hint="g / i / m / s / x;点击左栏工具栏「测试」执行">
          <Input
            id="flags-input"
            placeholder="标志位"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            className="w-24 font-mono text-sm"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左区:测试文本(「测试」动作在工具栏) */}
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="测试文本"
            placeholder="输入测试文本..."
            value={text}
            onChange={setText}
            language="plaintext"
            className="h-full"
            data-testid="input"
            searchAnchor="regex_tester:input"
            actions={
              <HeaderAction onClick={() => void handleTest()} disabled={loading || !pattern || !text}>
                <Play aria-hidden className="size-3.5" />
                {loading ? '测试中' : '测试'}
              </HeaderAction>
            }
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右区:匹配结果(内联错误 / 列表 / 空态) */}
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <div
            className="flex h-full flex-col overflow-hidden rounded-md border border-input bg-card"
            data-testid="output"
            data-search-anchor="regex_tester:output"
          >
            <div className="flex items-center justify-between border-b border-input px-2 py-0.5">
              <span className="pl-1 text-xs font-medium">匹配结果</span>
              {extra && (
                <span className="pr-1 text-xs text-muted-foreground">
                  {extra.match_count} 个匹配
                </span>
              )}
            </div>
            {error ? (
              <div
                role="alert"
                className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            ) : extra ? (
              <ScrollArea className="min-h-0 flex-1" data-testid="output-list">
                <ul className="space-y-2 p-3 text-sm">
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
              <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                输入正则与测试文本后点击「测试」
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */
function formatError(e: unknown): string {
  if (e instanceof CommandError) {
    return e.code ? `${e.code}: ${e.message}` : e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
