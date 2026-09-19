/**
 * 文件对比差异视图 —— 两个已打开文件的内容并排 Diff(直接嵌入主区域)
 *
 * - 渲染复用共享组件 TextDiffView(components/text-diff),与文本比较工具
 *   同一套观感:行级红绿背景 + 词级高亮 + gutter 色条 + 右缘标尺刻度 +
 *   差异统计 / 行内切换 / 滚动同步。
 * - 工具栏同样提供三个 ignore 开关(空白/大小写/换行),读写文本比较工具
 *   的同一份持久化偏好(textCompareStore.options),两处互相跟随。
 * - 两侧均可直接编辑,编辑内容实时写回对应文件 Tab(onChangeLeft/Right)。
 * - 语言按各文件扩展名分别推断(旧实现写死 plaintext,此处顺带修复),
 *   未识别扩展名回退纯文本。
 */
import { useEffect, type JSX } from 'react';
import { ArrowLeftRight, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TextDiffView } from '@/components/text-diff/TextDiffView';
import type { DiffSnapshot } from '@/components/text-diff/diff-utils';
import { useTextCompareStore } from '@/tools/textCompareStore';
import { inferLanguageFromPath } from './languageMap';
import type { EditorTab } from './schema';

export function FileCompareView({
  left,
  right,
  onChangeLeft,
  onChangeRight,
  onSwap,
  onExportPatch,
  onDiffSnapshot,
  'data-testid': dataTestId,
}: {
  left: EditorTab;
  right: EditorTab;
  /** 左侧(原文件)内容变化回调(写回对应 Tab) */
  onChangeLeft: (value: string) => void;
  /** 右侧(目标文件)内容变化回调(写回对应 Tab) */
  onChangeRight: (value: string) => void;
  /** 交换两侧(对比项左右 Tab id 互换) */
  onSwap: () => void;
  /** 导出统一格式补丁(.patch) */
  onExportPatch: () => void;
  /** 差异快照回调(导出补丁的新鲜度依据,透传 TextDiffView) */
  onDiffSnapshot?: (snapshot: DiffSnapshot) => void;
  'data-testid'?: string;
}): JSX.Element {
  const { t } = useTranslation();
  // 比较选项读写共享偏好(textCompareStore,独立 key 持久化):与文本比较
  // 工具的开关是同一份,两处切换互相跟随,重启保留
  const ignoreWhitespace = useTextCompareStore((s) => s.options.ignoreWhitespace);
  const ignoreCase = useTextCompareStore((s) => s.options.ignoreCase);
  const ignoreEol = useTextCompareStore((s) => s.options.ignoreEol);
  const ready = useTextCompareStore((s) => s.ready);
  const userTouched = useTextCompareStore((s) => s.userTouched);
  const setOptions = useTextCompareStore((s) => s.setOptions);

  // 文本比较工具未必挂载过:此处同样 hydrate(幂等),否则偏好读不到已存值;
  // 选项变更即时落盘(载荷极小;hydrate 前/用户未操作时不写)
  useEffect(() => {
    void useTextCompareStore.getState().hydrate();
  }, []);
  useEffect(() => {
    if (!ready || !userTouched) return;
    void useTextCompareStore.getState().persistOptions();
  }, [ignoreWhitespace, ignoreCase, ignoreEol, ready, userTouched]);

  return (
    <div data-testid={dataTestId} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <TextDiffView
        original={left.content}
        modified={right.content}
        onOriginalChange={onChangeLeft}
        onModifiedChange={onChangeRight}
        originalTitle={left.title}
        modifiedTitle={right.title}
        originalLanguage={inferLanguageFromPath(left.path ?? left.title)}
        modifiedLanguage={inferLanguageFromPath(right.path ?? right.title)}
        folding
        ignoreWhitespace={ignoreWhitespace}
        ignoreCase={ignoreCase}
        ignoreEol={ignoreEol}
        onDiffSnapshot={onDiffSnapshot}
        toolbarActions={
          <>
            <button
              type="button"
              data-testid={`${dataTestId}-ignore-ws`}
              aria-pressed={ignoreWhitespace}
              title={t('tools.text_compare.ignore_whitespace')}
              aria-label={t('tools.text_compare.ignore_whitespace')}
              onClick={() => setOptions({ ignoreWhitespace: !ignoreWhitespace })}
              className={cn(
                'flex items-center rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ignoreWhitespace ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span aria-hidden className="font-mono text-xs font-semibold">
                ␣≠
              </span>
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-ignore-case`}
              aria-pressed={ignoreCase}
              title={t('tools.text_compare.ignore_case')}
              aria-label={t('tools.text_compare.ignore_case')}
              onClick={() => setOptions({ ignoreCase: !ignoreCase })}
              className={cn(
                'flex items-center rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ignoreCase ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span aria-hidden className="font-mono text-xs font-semibold">
                Aa
              </span>
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-ignore-eol`}
              aria-pressed={ignoreEol}
              title={t('tools.text_compare.ignore_eol')}
              aria-label={t('tools.text_compare.ignore_eol')}
              onClick={() => setOptions({ ignoreEol: !ignoreEol })}
              className={cn(
                'flex items-center rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ignoreEol ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span aria-hidden className="font-mono text-xs font-semibold">
                ⇥≠
              </span>
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-swap-sides`}
              title={t('tools.text_compare.swap_sides')}
              aria-label={t('tools.text_compare.swap_sides')}
              onClick={onSwap}
              className="flex items-center rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeftRight aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-export-patch`}
              title={t('tools.text_compare.export_patch')}
              aria-label={t('tools.text_compare.export_patch')}
              onClick={onExportPatch}
              className="flex items-center rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Save aria-hidden className="size-3.5" />
            </button>
          </>
        }
        testIdPrefix={dataTestId ?? 'compare-view'}
      />
    </div>
  );
}
