/**
 * CopyAction —— 编辑器工具栏「复制」按钮(LineEditor actions 插槽用)
 *
 * 反馈逻辑统一走 copyTextWithFeedback(成功 toast + 预览/失败报错)。
 */

import type { JSX } from 'react';
import { Copy } from 'lucide-react';
import { copyTextWithFeedback } from '@/lib/toast-alert';

export function CopyAction({ text, testId }: { text: string; testId?: string }): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title="复制"
      aria-label="复制"
      onClick={() => {
        void copyTextWithFeedback(text);
      }}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Copy aria-hidden className="size-3.5" />
      复制
    </button>
  );
}
