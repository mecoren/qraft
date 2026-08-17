/**
 * 配置卡片 —— DevToys 风格「配置」区共享组件
 *
 * 用法:
 * <ConfigSection>
 *   <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择转换方向">...控件...</ConfigRow>
 * </ConfigSection>
 */

import type { JSX, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ConfigSection({
  title = '配置',
  children,
  className,
}: {
  /** 卡片标题;传入空字符串时不渲染标题文字(仅保留无障碍名称) */
  title?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section aria-label={title || '配置'} className={className}>
      {title ? <h2 className="mb-1.5 text-body-sm font-semibold">{title}</h2> : null}
      <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
        {children}
      </div>
    </section>
  );
}

export function ConfigRow({
  icon: Icon,
  label,
  hint,
  children,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-2.5', className)}>
      {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      <div className="min-w-0 flex-1">
        <div className="text-body-sm">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
