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
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      className={cn(
        'flex h-full w-full gap-1 data-[panel-group-direction=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

const ResizablePanel = ResizablePrimitive.Panel;

function ResizableHandle({
  // react-resizable-panels v4 的 Separator 不再需要单独渲染拖拽手柄,
  // 该 prop 仅保留用于向后兼容 API 调用方,实际不渲染任何内容。
  _withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      className={cn(
        // 中间不渲染任何图标/组件。4px 宽点击区,默认完全透明(中间无分割线);
        // 悬浮/聚焦/拖拽时高亮为一条主色线,指示「此处可拖动」(与工作台左栏分隔条一致)。
        // 注意:react-resizable-panels v4 的拖拽状态属性是 data-separator(取值 active/hover/focus),
        // 旧版 shadcn 的 data-resize-handle-state 在该版本中不存在。
        'relative flex h-full w-1 shrink-0 items-center justify-center self-stretch bg-transparent outline-none transition-colors',
        'hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary',
        'focus-visible:ring-1 focus-visible:ring-ring',
        // 纵向分隔条(横向细线)
        'data-[panel-group-direction=vertical]:h-1 data-[panel-group-direction=vertical]:w-full',
        className,
      )}
      {...props}
    />
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
