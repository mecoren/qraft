'use client';

import * as React from 'react';
import { type DialogProps } from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover-layer text-popover-foreground',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

/** CommandDialog 追加的槽位:header= 顶部搜索区(缺省渲染默认 CommandInput);
 *  footer= 底部提示条;contentClassName= 宽度等 DialogContent 定制透传;
 *  shouldFilter= 是否由 cmdk 自身按 value 过滤(SearchDialog 走外部过滤需为 false);
 *  hideCloseButton= 是否隐藏右上角关闭钮(EditorLanguagePicker 等仿 Quick Pick 无关闭钮);
 *  contentTestId= 透传到 DialogContent 的 data-testid。 */
type CommandDialogExtraProps = {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
  shouldFilter?: boolean;
  hideCloseButton?: boolean;
  contentTestId?: string;
};

const CommandDialog = ({
  children,
  header,
  footer,
  contentClassName,
  shouldFilter,
  hideCloseButton,
  contentTestId,
  ...props
}: DialogProps & CommandDialogExtraProps) => {
  return (
    <Dialog {...props}>
      <DialogContent
        data-testid={contentTestId}
        hideCloseButton={hideCloseButton}
        className={cn(
          'flex h-[min(60vh,560px)] flex-col gap-0 overflow-hidden p-0 shadow-lg',
          contentClassName,
        )}
      >
          {/* 行内边距/图标尺寸不再由外壳强制(后代选择器优先级会压过
           * CommandItem 自身 className),统一走 CommandItem 默认紧凑样式,
           * 与 VSCode Quick Pick 的满宽紧凑行一致 */}
          <Command
            shouldFilter={shouldFilter}
            className="flex h-full w-full shrink flex-col overflow-hidden [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-11"
          >
          {/* 顶部输入区固定不滚;下方结果区由 CommandList 弹性占满并在固定高度内滚动 */}
          <div className="shrink-0">{header ?? <CommandInput />}</div>
          {children}
          {footer}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
    /** 输入框外层容器的 className 透传(默认 flex items-center border-b px-3) */
    wrapperClassName?: string;
    /** 输入框前导内容(缺省为 Search 图标):SearchDialog 用它嵌入「功能/文本」模式切换 */
    leading?: React.ReactNode;
  }
>(({ className, wrapperClassName, leading, ...props }, ref) => (
  <div className={cn('flex items-center border-b px-3', wrapperClassName)} cmdk-input-wrapper="">
    {leading ?? <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />}
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  // 原生滚动(非 Radix ScrollArea):
  // - 滚动条走 globals.css 全局美化样式(::-webkit-scrollbar token 化),与
  //   设置面板 / 编辑器列表等所有区域观感一致(Radix 自绘悬浮滑块仅 hover 可见)
  // - 少一层 ResizeObserver/滑块 transform 开销,长列表(系统字体 ~数百项)更流畅
  // - 轨道可点击翻页、拖拽行为与原生一致,不再出现「点击轨道穿透关闭弹层」
  // 在 CommandDialog 内,父级为固定高度 flex 列,故默认 flex-1 min-h-0 弹性占满并在
  // 固定高度内滚动(顶部输入区保持固定)。独立使用(无固定高度父级)时退化为内容自适应。
  <CommandPrimitive.List
    ref={ref}
    className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
};
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
