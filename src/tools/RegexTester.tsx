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
import { useTranslation } from 'react-i18next';
import { ListChecks, Play, Regex } from 'lucide-react';
import { formatError } from '@/lib/format-error';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { invokeCommand } from '@/lib/ipc';
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
  const { t } = useTranslation();
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
        <ConfigRow
          icon={Regex}
          label={t('tools.regex_tester.pattern_label')}
          hint={t('tools.regex_tester.pattern_hint')}
        >
          <Input
            id="pattern-input"
            placeholder={t('tools.regex_tester.pattern_placeholder')}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="w-80 font-mono text-sm"
            data-testid="pattern"
          />
        </ConfigRow>
        <ConfigRow
          icon={ListChecks}
          label={t('tools.regex_tester.flags_label')}
          hint={t('tools.regex_tester.flags_hint')}
        >
          <Input
            id="flags-input"
            placeholder={t('tools.regex_tester.flags_placeholder')}
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
            title={t('tools.regex_tester.text_title')}
            placeholder={t('tools.regex_tester.text_placeholder')}
            value={text}
            onChange={setText}
            language="plaintext"
            className="h-full"
            data-testid="input"
            searchAnchor="regex_tester:input"
            actions={
              <HeaderAction
                onClick={() => void handleTest()}
                disabled={loading || !pattern || !text}
              >
                <Play aria-hidden className="size-3.5" />
                {loading ? t('tools.regex_tester.testing') : t('tools.regex_tester.test')}
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
              <span className="pl-1 text-xs font-medium">
                {t('tools.regex_tester.result_title')}
              </span>
              {extra && (
                <span className="pr-1 text-xs text-muted-foreground">
                  {t('tools.regex_tester.match_count', { count: extra.match_count })}
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
                          {t('tools.regex_tester.groups_label')}{' '}
                          {m.groups.map((g, gi) => (
                            <span key={gi} className="font-mono">
                              [{gi + 1}]={g ?? t('tools.regex_tester.group_empty')}{' '}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                  {extra.matches.length === 0 && (
                    <li className="text-sm text-muted-foreground">
                      {t('tools.regex_tester.no_matches')}
                    </li>
                  )}
                </ul>
              </ScrollArea>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                {t('tools.regex_tester.empty_state')}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */
