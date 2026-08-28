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
}: {
  /** 卡片标题;缺省用「配置」;传入空字符串时不渲染标题文字(仅保留无障碍名称) */
  title?: string;
  children: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('chrome.config_card.title');
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
  label: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
}): JSX.Element {
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
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
