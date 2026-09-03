/**
 * CopyAction —— 编辑器工具栏「复制」按钮(LineEditor actions 插槽用)
 *
 * 反馈逻辑统一走 copyTextWithFeedback(成功 toast + 预览/失败报错)。
 */

import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { copyTextWithFeedback } from '@/lib/toast-alert';

export function CopyAction({ text, testId }: { text: string; testId?: string }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid={testId}
      title={t('chrome.copy')}
      aria-label={t('chrome.copy')}
      onClick={() => {
        void copyTextWithFeedback(text);
      }}
      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Copy aria-hidden className="size-3.5" />
      {t('chrome.copy')}
    </button>
  );
}
