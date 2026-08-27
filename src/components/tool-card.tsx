/**
 * 工具卡片 —— 欢迎页 / 所有工具网格的统一卡片
 *
 * 视觉对齐 Dashboard 改版:
 * - 左侧 44×44 图标盒采用 primary 渐变 + 半透明 ring,作为视觉锚点
 * - hover:整卡轻微上浮 + 阴影加深 + 图标盒缩放 + 渐变光晕溢出
 * - 深色主题下卡片背景半透明,营造层次感
 */

import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { pickText, type CatalogEntry } from '@/lib/tool-catalog';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

export interface ToolCardProps {
  entry: CatalogEntry;
  onOpen: (id: string) => void;
  className?: string;
}

export function ToolCard({ entry, onOpen, className }: ToolCardProps): JSX.Element {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      title={pickText(entry.name)}
      className={cn(
        'group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border bg-card/90 p-3 text-left',
        'shadow-card transition-all duration-base ease-standard',
        'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        className,
      )}
    >
      {/* hover 时溢出的渐变光晕,absolute 在卡片底层 */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-base ease-standard group-hover:opacity-100"
        style={{
          background: 'radial-gradient(120px 80px at 10% 0%, var(--card-glow), transparent 70%)',
        }}
      />
      <span
        aria-hidden
        className={cn(
          'relative flex size-11 shrink-0 items-center justify-center rounded-lg',
          'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15',
          'transition-transform duration-base ease-standard group-hover:scale-105',
        )}
      >
        <Icon className="size-5" strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-sm font-semibold leading-tight">
          {pickText(entry.name)}
        </span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {pickText(entry.description)}
        </span>
      </span>
    </button>
  );
}
