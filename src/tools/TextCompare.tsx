/**
 * 文本比较工具 —— 对齐 DevToys 截图的旗舰页面
 *
 * 结构:
 * - 配置卡片:行内模式开关(关闭 / 开启)
 * - 编辑区:原始文本 / 修改后文本(LineEditor),中间可拖拽分隔
 * - 差异区:并排 diff 视图 + 统计(+新增 −删除 ~修改)+ 全屏弹窗
 * 编辑区与差异区之间同样可拖拽调整比例。
 */

import { useMemo, useState, type JSX } from 'react';
import { Columns2, Maximize2 } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { alignDiff, diffLines, summarizeDiff } from '@/lib/diff';
import { DiffView } from '@/tools/text-compare/DiffView';
import type { ToolProps } from './registry';

export function TextCompare(_props: ToolProps): JSX.Element {
  const [oldText, setOldText] = useState('');
  const [newText, setNewText] = useState('');
  const [inlineMode, setInlineMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const rows = useMemo(() => alignDiff(diffLines(oldText, newText)), [oldText, newText]);
  const stats = useMemo(() => summarizeDiff(rows), [rows]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-compare">
      {/* 配置 */}
      <section aria-label="配置">
        <h2 className="mb-1.5 text-body-sm font-semibold">配置</h2>
        <div className="rounded-lg border border-border bg-card shadow-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <Columns2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-body-sm">行内模式</span>
            <span className="text-xs text-muted-foreground">{inlineMode ? '开启' : '关闭'}</span>
            <Switch
              data-testid="inline-mode-switch"
              aria-label="行内模式"
              checked={inlineMode}
              onCheckedChange={setInlineMode}
            />
          </div>
        </div>
      </section>

      {/* 编辑区 + 差异区(垂直可拖拽) */}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={42} minSize={20} className="min-h-0">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 min-w-0">
              <CodeEditor
                title="原始文本"
                language="plaintext"
                value={oldText}
                onChange={setOldText}
                className="h-full"
                data-testid="old-editor"
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel minSize={15} className="min-h-0 min-w-0">
              <CodeEditor
                title="修改后文本"
                language="plaintext"
                value={newText}
                onChange={setNewText}
                className="h-full"
                data-testid="new-editor"
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel minSize={20} className="min-h-0">
          <section
            aria-label="差异"
            className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <div className="flex items-baseline gap-3">
                <span className="text-body-sm font-semibold">差异</span>
                {(stats.added > 0 || stats.removed > 0 || stats.modified > 0) && (
                  <span className="text-xs text-muted-foreground">
                    <span className="text-green-600 dark:text-green-400">+{stats.added}</span>
                    {'  '}
                    <span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
                    {'  '}
                    <span>~{stats.modified}</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                data-testid="diff-fullscreen"
                title="全屏查看差异"
                aria-label="全屏查看差异"
                onClick={() => setFullscreen(true)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Maximize2 aria-hidden className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <DiffView rows={rows} inline={inlineMode} className="h-full" />
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 全屏差异弹窗 */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[85vh] max-w-[90vw] flex-col">
          <DialogTitle className="text-sm font-semibold">差异</DialogTitle>
          <DialogDescription className="sr-only">原始文本与修改后文本的并排差异</DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <DiffView rows={rows} inline={inlineMode} className="h-full" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
