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
  stacked = false,
}: {
  icon?: LucideIcon;
  /** 行小标题;stacked 布局下可缺省(如分组名已并入控件 aria-label 的纯按钮排) */
  label?: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
  /**
   * 纵向堆叠布局:label(+hint)独占一行小标题,控件独占下一行满宽。
   * 适用于控件很宽的行(如文本处理工具的多组转换按钮)——默认左右布局里
   * 控件列 shrink-0 会把 label 列(min-w-0 flex-1)压成 0 宽,文字逐字竖排。
   * label 缺省时不渲染小标题行,控件直接从行首铺开。
   */
  stacked?: boolean;
}): JSX.Element {
  if (stacked) {
    return (
      <div
        className={cn('flex-col items-stretch gap-1.5 px-4 py-2', className)}
        data-search-anchor={searchAnchor}
      >
        {label ? (
          <div className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
            <span className="text-body-sm">{label}</span>
            {hint ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={cn('flex items-center gap-3 px-4 py-2.5', className)}
      data-search-anchor={searchAnchor}
    >
      {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      <div className="min-w-0 flex-1">
        <div className="text-body-sm">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
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
