/**
 * 文本统计 —— 字符/词数/行数/字节 即时统计(纯前端,useMemo 实时计算)。
 *
 * 结构(与 HashCalculator 一致):顶部配置卡说明 + ResizablePanelGroup
 * 左输入编辑器 / 右统计结果列表(可整体复制)。
 */
import { useMemo, useState, type JSX } from 'react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { computeStats, type TextStats } from './text-statistics-utils';
import type { ToolProps } from './registry';

const ROWS: ReadonlyArray<{ key: keyof TextStats; label: string }> = [
  { key: 'chars', label: '字符数' },
  { key: 'charsNoSpaces', label: '字符数(不含空白)' },
  { key: 'words', label: '词数' },
  { key: 'lines', label: '行数' },
  { key: 'bytes', label: '字节数(UTF-8)' },
];

export function TextStatistics({ toolId }: ToolProps): JSX.Element {
  const [text, setText] = useState('');
  const stats = useMemo(() => computeStats(text), [text]);
  const summary = ROWS.map((r) => `${r.label}: ${stats[r.key]}`).join('\n');

  // 全局快捷键契约:实时统计无「执行」概念;Ctrl+L 清空输入,Ctrl+Shift+C 复制汇总
  useToolShortcutActions(toolId, {
    clearInput: () => setText(''),
    copyOutput: text ? () => void copyTextWithFeedback(summary) : undefined,
  });

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-statistics">
      <ConfigSection title="" searchAnchor="text_statistics:config">
        <p className="px-4 py-2 text-xs text-muted-foreground">
          输入内容后即时统计,全部在本机完成。
        </p>
      </ConfigSection>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={55} minSize={20}>
          <CodeEditor
            title="输入"
            value={text}
            onChange={(v) => setText(v)}
            showClear
            language="plaintext"
            searchAnchor="text_statistics:input"
            data-testid="input"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={45} minSize={20}>
          <div
            className="flex h-full flex-col"
            data-testid="output"
            data-search-anchor="text_statistics:output"
          >
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="flex-1 text-xs font-medium text-muted-foreground">统计结果</span>
              <CopyAction text={summary} testId="copy-stats" />
            </div>
            <div className="flex-1 overflow-auto p-3">
              <dl className="grid gap-2">
                {ROWS.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center justify-between rounded border px-3 py-1.5"
                  >
                    <dt className="text-xs text-muted-foreground">{r.label}</dt>
                    <dd className="font-mono text-sm" data-testid={`stat-${r.key}`}>
                      {stats[r.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
