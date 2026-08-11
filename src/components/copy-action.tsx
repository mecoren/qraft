/**
 * CopyAction —— 编辑器工具栏「复制」按钮(LineEditor actions 插槽用)
 */

import type { JSX } from 'react';
import { Copy } from 'lucide-react';
import { writeClipboardText } from '@/lib/clipboard';
import { showAlert } from '@/lib/toast-alert';

export function CopyAction({ text, testId }: { text: string; testId?: string }): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title="复制"
      aria-label="复制"
      onClick={() => {
        if (!text) return;
        void writeClipboardText(text).then((ok) => {
          if (ok) {
            showAlert({
              variant: 'success',
              title: '已复制到剪贴板',
              description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
            });
          } else {
            showAlert({ variant: 'destructive', title: '复制失败' });
          }
        });
      }}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Copy aria-hidden className="size-3.5" />
      复制
    </button>
  );
}
