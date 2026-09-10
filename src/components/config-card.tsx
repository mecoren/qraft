/**
 * 配置卡片 —— DevToys 风格「配置」区共享组件
 *
 * 用法:
 * <ConfigSection>
 *   <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择转换方向">...控件...</ConfigRow>
 * </ConfigSection>
 */

import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ConfigSection({
  title,
  children,
  className,
  searchAnchor,
  headerAction,
  headerTestId,
}: {
  /** 卡片标题;缺省用「配置」;传入空字符串时不渲染标题文字(仅保留无障碍名称) */
  title?: string;
  children: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
  /** 标题行右侧动作(如折叠/展开切换按钮);传入时标题恒渲染(独立紧凑标题行) */
  headerAction?: ReactNode;
  /** 标题行的 data-testid(配合 headerAction 断言) */
  headerTestId?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('chrome.config_card.title');
  if (headerAction) {
    // 紧凑标题行变体:标题居左 + 动作居右,整行 h-7 低于配置行
    // (py-2.5),带下边线与后续行分隔;适合「配置 + 展开/收起」这类顶栏
    return (
      <section
        aria-label={resolvedTitle || t('chrome.config_card.title')}
        className={className}
        data-search-anchor={searchAnchor}
      >
        <div
          className="flex h-7 items-center justify-between border-b border-border px-3"
          data-testid={headerTestId}
        >
          <h2 className="text-xs font-semibold text-foreground">{resolvedTitle}</h2>
          {headerAction}
        </div>
        <div className="divide-y divide-border border-b border-border">{children}</div>
      </section>
    );
  }
  return (
    <section
      aria-label={resolvedTitle || t('chrome.config_card.title')}
      className={className}
      data-search-anchor={searchAnchor}
    >
      {resolvedTitle ? (
        <h2 className="mb-1.5 text-body-sm font-semibold">{resolvedTitle}</h2>
      ) : null}
      {/* 扁平配置区:作为工具 shell 卡片内的顶部区块,不再自带独立卡片外观
          (圆角/边框/阴影由外层 shell 提供,这里只用 border-b 与主内容区分隔) */}
      <div className="divide-y divide-border border-b border-border">{children}</div>
    </section>
  );
}

export function ConfigRow({
  icon: Icon,
  label,
  hint,
  children,
  className,
  searchAnchor,
}: {
  icon?: LucideIcon;
  /** 行小标题(左侧提示);缺省时控件列占满整行 */
  label?: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
}): JSX.Element {
  // 左右布局的防压零宽契约:
  // - label 列 w-fit + shrink-0(不参与压缩),max-w-40 + truncate 兜住
  //   超长文案;控件再多也压不瘪左侧提示(曾因 flex-1 被压成 0 宽逐字竖排);
  // - 控件列 flex-1 + flex-wrap:超出横向空间自动换行,而不挤压 label。
  //   换行后行高自然增高,后续行由 ConfigSection 的 divide-y 分隔。
  // - 控件列 justify-end:窄控件(Select / Switch 等)沿右侧对齐,
  //   与 label 之间由 flex-1 的空隙自然隔开,是仓库既有的视觉基准。
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5', className)}
      data-search-anchor={searchAnchor}
    >
      {label !== undefined ? (
        <div className="flex w-fit max-w-40 shrink-0 items-center gap-2">
          {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
          <div className="min-w-0">
            <div className="truncate text-body-sm">{label}</div>
            {hint ? (
              <div className="truncate text-xs text-muted-foreground" title={hint}>
                {hint}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/**
 * 标题栏内动作按钮,与 CodeEditor 工具栏风格一致。
 * 用途:编辑器工具栏中的「执行 / 生成 / 测试」等主操作按钮
 * (参考 Base64Codec / JsonFormatter 的同名本地实现,收敛于此共享)。
 */
export function HeaderAction({
  onClick,
  disabled,
  testId,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
