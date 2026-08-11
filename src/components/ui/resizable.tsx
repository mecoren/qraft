/**
 * Resizable —— shadcn/ui 风格的可拖拽面板布局
 *
 * 基于 react-resizable-panels v4(导出名:Group / Panel / Separator)。
 * 提供无障碍、可键盘操作的面板组,用于把「输入 / 输出」「A / B」等
 * 编辑框并排或上下组合,用户可拖动分隔条自由调整比例,看得更清楚。
 *
 * 用法:
 *   <ResizablePanelGroup orientation="horizontal">
 *     <ResizablePanel defaultSize={50} minSize={20}>左</ResizablePanel>
 *     <ResizableHandle withHandle />
 *     <ResizablePanel defaultSize={50} minSize={20}>右</ResizablePanel>
 *   </ResizablePanelGroup>
 */

import * as React from 'react';
import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      className={cn(
        'flex h-full w-full gap-3 data-[panel-group-direction=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

const ResizablePanel = ResizablePrimitive.Panel;

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      className={cn(
        // 横向分隔条(竖向细线),hover/拖拽时高亮为主题主色
        'relative flex w-px items-center justify-center bg-border outline-none transition-colors',
        'hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary',
        'focus-visible:ring-1 focus-visible:ring-ring',
        // 纵向分隔条(横向细线)
        'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
        '[&[data-panel-group-direction=vertical]>div]:rotate-90',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-muted text-muted-foreground">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
