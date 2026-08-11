/**
 * ButtonGroup —— shadcn/ui 官方实现移植
 *
 * 完全对齐 https://www.shadcn.com.cn/docs/components/radix/button-group
 * 的结构与类名。核心机制:
 *
 * - 容器用 `has-[>[data-slot=button-group-separator]]` 等 :has() 选择器,
 *   精确地把「直接子按钮」与「子组 / 分隔符 / 文本」区分开。
 * - 圆角分发:容器默认把组内所有按钮圆角清零
 *   (`[&>[data-slot=button]]:rounded-none`),再通过 :first-child /
 *   :last-child 给整组首末两个真实按钮补回与 Button 一致的圆角
 *   (rounded-l-md / rounded-r-md,跟随项目 --radius 体系),
 *   与 shadcn 官方 ButtonGroup 默认行为逐字一致。
 * - 组内按钮用 `-ml-px` 让相邻 border 重叠为同一条线(视觉无缝)。
 * - 嵌套:子 ButtonGroup 是独立 flex 容器,父容器通过
 *   `has-[>[data-slot=button-group]]:gap-2` 在子组之间生成 gap。
 * - 分隔符:ButtonGroupSeparator 复用现有 Separator,data-slot 标记后
 *   由父容器识别并擦掉相邻按钮圆角。
 */

import type { ComponentProps, JSX } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const buttonGroupVariants = cva(
  'flex w-fit items-stretch ' +
    '[&>*]:focus-visible:relative [&>*]:focus-visible:z-10 ' +
    // 默认清掉所有直接子按钮的圆角,由 :first/:last-child 补回首末
    '[&>[data-slot=button]]:rounded-none ' +
    '[&>[data-slot=button]:first-child]:rounded-l-md ' +
    '[&>[data-slot=button]:last-child]:rounded-r-md ' +
    // 中间按钮向右叠 1px,让相邻 border 重合成同一条线
    '[&>[data-slot=button]:not(:first-child)]:-ml-px ' +
    // hover/focus 时提升 z-index,避免被两侧按钮边框遮住
    '[&>[data-slot=button]:hover]:z-10 [&>[data-slot=button]:focus-visible]:z-10 ' +
    // 分隔符
    '[&>[data-slot=button-group-separator]]:bg-border ' +
    'has-[>[data-slot=button-group-separator]]: ' +
    'has-[>[data-slot=button-group-separator]]:[&>[data-slot=button]]:rounded-none ' +
    // 嵌套 ButtonGroup → 组间 gap
    'has-[>[data-slot=button-group]]:gap-2 ' +
    // 文本共存 → 间隙与图标尺寸
    'has-[[data-slot=button-group-text]]:gap-2 ' +
    "has-[[data-slot=button-group-text]]:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      orientation: {
        horizontal: 'flex-row',
        vertical: 'flex-col',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  },
);

interface ButtonGroupProps
  extends ComponentProps<'div'>,
    VariantProps<typeof buttonGroupVariants> {}

/** 按钮组容器;自动应用 ARIA role 与方向 data 属性 */
function ButtonGroup({
  className,
  orientation,
  ...props
}: ButtonGroupProps): JSX.Element {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation ?? 'horizontal'}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}

/** 按钮组内嵌的文本标签(常用作前缀/单位) */
interface ButtonGroupTextProps extends ComponentProps<'div'> {
  /** 透传为其他元素(典型场景:把内部节点渲染为 Label) */
  asChild?: boolean;
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: ButtonGroupTextProps): JSX.Element {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      data-slot="button-group-text"
      className={cn(
        'flex items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground shadow-xs',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 按钮组内的视觉分隔符(复用通用 Separator)。
 *
 * 水平按钮组内为一条竖线;垂直按钮组内为一条横线。
 * data-slot 标记使父 ButtonGroup 能精确擦掉相邻按钮圆角。
 */
function ButtonGroupSeparator({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof Separator>): JSX.Element {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      decorative
      className={cn(
        '!h-auto self-stretch',
        orientation === 'vertical' ? 'mx-0 !w-px' : 'my-0 !h-px',
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants };
