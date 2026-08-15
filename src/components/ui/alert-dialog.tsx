/**
 * AlertDialog —— shadcn new-york-v4 风格确认对话框
 *
 * API 与 shadcn 官方 alert-dialog 完全一致:
 *   AlertDialog / AlertDialogTrigger / AlertDialogContent / AlertDialogHeader /
 *   AlertDialogFooter / AlertDialogTitle / AlertDialogDescription /
 *   AlertDialogAction / AlertDialogCancel / AlertDialogOverlay / AlertDialogPortal
 *
 * 语义对齐官方:
 * - Action:点击「不」自动关闭对话框(由调用方在 onClick 里决定何时关闭)
 * - Cancel:点击「自动」关闭对话框(outline 样式,通常为安全操作)
 * - 两者用 buttonVariants 生成按钮样式,与项目 Button 组件一致
 *
 * 底层基于项目已有的 `@radix-ui/react-dialog`(官方 alert-dialog 依赖的
 * `@radix-ui/react-alert-dialog` 内部即复用 dialog 的行为;此处直接复用,
 * 避免新增依赖)。
 */
'use client';

import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-dialog';

import { type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

interface AlertDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> {
  /** 紧凑尺寸(默认 default → max-w-lg,sm → max-w-sm) */
  size?: 'default' | 'sm';
}

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(({ className, size = 'default', ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      data-slot="alert-dialog-content"
      data-size={size}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-0 overflow-hidden rounded-xl border bg-background shadow-lg duration-200',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        size === 'sm' ? 'sm:max-w-sm' : 'sm:max-w-lg',
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="alert-dialog-header"
    className={cn('flex flex-col gap-2 px-6 pt-6 pb-4 text-center sm:text-left', className)}
    {...props}
  />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="alert-dialog-footer"
    className={cn(
      'flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-6 py-3 sm:flex-row sm:justify-end sm:gap-2',
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    data-slot="alert-dialog-title"
    className={cn('text-lg font-semibold leading-none tracking-tight text-foreground', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    data-slot="alert-dialog-description"
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

/**
 * Action 按钮:默认实色,点击「不」自动关闭对话框。
 * 关闭时机由调用方在 onClick 中控制(如保存成功后关闭)。
 */
interface AlertDialogButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
  asChild?: boolean;
}

/**
 * Action 按钮:默认实色按钮,点击「不」自动关闭(关闭时机由调用方 onClick 控制)。
 * 用 DialogPrimitive.Close 包装保证点击关闭语义统一,调用方通过 onClick
 * 在外部逻辑完成后关闭对话框(UnsavedDialog 在 onSave/onDiscard 中控制)。
 */
const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Close>,
  AlertDialogButtonProps
>(({ className, variant = 'default', size = 'default', ...props }, ref) => (
  <AlertDialogPrimitive.Close
    ref={ref}
    data-slot="alert-dialog-action"
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
));
AlertDialogAction.displayName = 'AlertDialogAction';

/**
 * Cancel 按钮:outline 样式,点击「自动」关闭对话框。
 * 与 Action 同样基于 DialogPrimitive.Close,关闭时机由 Radix 自动处理。
 */
const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Close>,
  AlertDialogButtonProps
>(({ className, variant = 'outline', size = 'default', ...props }, ref) => (
  <AlertDialogPrimitive.Close
    ref={ref}
    data-slot="alert-dialog-cancel"
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = 'AlertDialogCancel';

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
