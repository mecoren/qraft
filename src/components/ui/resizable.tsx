/**
 * Resizable —— shadcn/ui 风格的可拖拽面板布局
 *
 * 基于 react-resizable-panels v4(导出名:Group / Panel / Separator)。
 * 提供无障碍、可键盘操作的面板组,用于把「输入 / 输出」「A / B」等
 * 编辑框并排或上下组合,用户可拖动分隔条自由调整比例,看得更清楚。
 *
 * 用法:
 *   <ResizablePanelGroup orientation="horizontal">
 *     <ResizablePanel defaultSize="50" minSize="20">左</ResizablePanel>
 *     <ResizableHandle withHandle />
 *     <ResizablePanel defaultSize="50" minSize="20">右</ResizablePanel>
 *   </ResizablePanelGroup>
 *
 * 注意:v4 尺寸传参中数字按像素解释、无单位字符串按百分比解释,
 * 因此 defaultSize/minSize 一律传百分比字符串(数字是像素,与
 * v3 的百分比语义不同,直接迁移会得到错误的初始比例与最小值)。
 */

import * as React from 'react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

/** 组内方向由 React context 下发:Separator 据此切换横纵自身尺寸 */
const GroupOrientationContext = React.createContext<'horizontal' | 'vertical' | undefined>(
  undefined,
);

function ResizablePanelGroup({
  className,
  orientation,
  children,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      orientation={orientation}
      // v4 只在组元素上输出 data-group/data-separator,不携带方向信息;
      // 自行落一个 data-orientation 便于调试与测试定位(样式经 context 下发)
      data-orientation={orientation}
      className={cn(
        // 注意:根元素不能加 Tailwind 的 group class——否则分隔条内高亮线的
        // group-hover 会被整个工作区的悬停点亮(小蓝条常亮),高亮只能由
        // Separator 自身的 group 命中。分割间隙 2px(gap-0.5),与编辑器工作台
        // 左栏分隔一致,紧凑贴近 VSCode
        'flex h-full w-full gap-0.5',
        className,
      )}
      {...props}
    >
      <GroupOrientationContext value={orientation}>{children}</GroupOrientationContext>
    </ResizablePrimitive.Group>
  );
}

const ResizablePanel = ResizablePrimitive.Panel;

function ResizableHandle({
  // react-resizable-panels v4 的 Separator 不再需要单独渲染拖拽手柄,
  // 该 prop 仅保留用于向后兼容 API 调用方,实际不渲染任何内容。
  withHandle: _withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  const orientation = React.use(GroupOrientationContext);
  return (
    <ResizablePrimitive.Separator
      className={cn(
        // 2px 点击区,恰好填满 gap-0.5 分割空间,本身保持透明;
        // 高亮线由内层 div 渲染:固定 4px 不随点击区变窄,悬浮/聚焦/拖拽时
        // 显示为圆角主色线(与工作台左栏分隔条一致)。
        // 注意:react-resizable-panels v4 的拖拽状态属性是 data-separator(取值 active/hover/focus),
        // 旧版 shadcn 的 data-resize-handle-state 在该版本中不存在。
        'group relative flex shrink-0 items-center justify-center self-stretch bg-transparent outline-none',
        orientation === 'vertical' ? 'h-0.5 w-full' : 'h-full w-0.5',
        'focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {/* 4px 高亮线:h-full 和 w-full 填满 2px 点击区,再用 min-h/min-w 保证
          实际渲染 4px 不被压缩(min 类优先级高于宽高类),由父级居中向两侧各溢出 1px */}
      <div
        aria-hidden
        className={cn(
          'h-full w-full min-h-1 min-w-1 rounded-md transition-colors duration-150 ease-out',
          'group-hover:bg-primary group-focus-visible:bg-primary',
          'group-data-[separator=active]:bg-primary',
        )}
      />
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
