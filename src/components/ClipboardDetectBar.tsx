/**
 * 剪贴板智能检测提示条 —— Smart Detection 的被动呈现层
 *
 * App 层在窗口聚焦时探测剪贴板(开关开启时),本组件订阅 uiStore 的探测结果:
 * 命中时在主工作区顶部渲染一条可关闭的提示,列出建议工具,点击即
 * requestHandoff 预填剪贴板原文 + openTool 跳转,免去手动粘贴。
 * 与命令面板的 detected 组互补:面板是主动唤起,本条是被动可见。
 */

import { useMemo, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, X } from 'lucide-react';
import { getCatalogEntry, pickText, type CatalogEntry } from '@/lib/tool-catalog';
import type { DetectionResult } from '@/lib/clipboard-detect';
import { requestHandoff } from '@/store/handoffStore';
import { useUiStore } from '@/store/uiStore';

export function ClipboardDetectBar(): JSX.Element | null {
  const { t } = useTranslation();
  const detectedTools = useUiStore((s) => s.detectedTools);
  const detectedText = useUiStore((s) => s.detectedText);
  const detectDismissed = useUiStore((s) => s.detectDismissed);
  const dismissDetect = useUiStore((s) => s.dismissDetect);
  const openTool = useUiStore((s) => s.openTool);

  /** 目录中存在的建议条目(带可跳转工具名) */
  const entries = useMemo(
    () =>
      detectedTools
        .map((d) => ({ detection: d, entry: getCatalogEntry(d.toolId) }))
        .filter((x): x is { detection: DetectionResult; entry: CatalogEntry } => x.entry !== null),
    [detectedTools],
  );

  if (detectDismissed || detectedTools.length === 0 || entries.length === 0) return null;

  const openWithPrefill = (toolId: string): void => {
    // 先写 handoff 再切工具:目标工具经 useToolHandoff 在激活时消费
    if (detectedText) requestHandoff(toolId, detectedText);
    openTool(toolId);
  };

  return (
    <div
      data-testid="clipboard-detect-bar"
      data-search-anchor="clipboard:detect-bar"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-primary/5 px-4 py-1.5"
    >
      <ClipboardCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="shrink-0 text-xs text-muted-foreground">{t('chrome.detect.bar_label')}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entries.slice(0, 3).map(({ detection, entry }) => (
          <button
            key={detection.toolId}
            type="button"
            data-testid="detect-chip"
            onClick={() => openWithPrefill(detection.toolId)}
            className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
            title={t(detection.reason)}
          >
            {t(detection.reason)}
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="font-medium">{pickText(entry.name)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="detect-bar-close"
        aria-label={t('chrome.detect.bar_dismiss')}
        onClick={dismissDetect}
        className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
