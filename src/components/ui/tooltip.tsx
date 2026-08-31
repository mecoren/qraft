import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    // 样式与查找组件(Ctrl+F)自绘浮层完全一致(text-xs/无动画/实心背景),
    // 见 hint-tooltip-layer.ts;sideOffset 默认对齐浮层间距 HINT_GAP=6。
    // 背景必须实心 bg-popover:tooltip 会浮在标题栏等 Mica 透出区,
    // 半透明的 bg-popover-layer 在这些区域会显形为透明。
    // 阴影用内联 var(--shadow-card-hover):shadow-md utility 在本应用
    // 解析为全透明(Tailwind v4 已知问题),内联 token 与 .md-fn-popover 同源
    style={{ boxShadow: 'var(--shadow-card-hover)' }}
    className={cn(
      'z-50 rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
