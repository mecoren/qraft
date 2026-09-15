'use client';

import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    /** 转发到内部 Viewport,供外部读取滚动容器(监听 scroll / 主动 scrollTo) */
    viewportRef?: React.Ref<React.ElementRef<typeof ScrollAreaPrimitive.Viewport>>;
    /** Viewport 额外样式,用于给悬浮滚动条预留空间(例如横向时 pb-3.5) */
    viewportClassName?: string;
    /** 内置滚动条方向,默认垂直;横向滚动内容传 'horizontal' */
    orientation?: 'vertical' | 'horizontal';
    /** 滚动条额外样式(通过 tailwind-merge 覆盖默认轨道/滑块尺寸),用于细悬浮条等特例 */
    scrollbarClassName?: string;
  }
>(
  (
    {
      className,
      children,
      viewportRef,
      viewportClassName,
      orientation = 'vertical',
      scrollbarClassName,
      ...props
    },
    ref,
  ) => {
    /** 内部持有 Viewport 节点:横向模式挂「滚轮→横滚」原生监听用 */
    const internalViewportRef = React.useRef<HTMLDivElement | null>(null);

    /** 合并内部 Viewport 引用与外部 viewportRef(函数 / 对象两种形态都要透传) */
    const composedViewportRef = React.useCallback(
      (node: HTMLDivElement | null): void => {
        internalViewportRef.current = node;
        if (typeof viewportRef === 'function') {
          viewportRef(node);
        } else if (viewportRef) {
          (viewportRef as { current: HTMLDivElement | null }).current = node;
        }
      },
      [viewportRef],
    );

    /**
     * 横向模式滚轮直通(Chrome 标签栏 / VSCode Tab 栏同款行为):
     * 鼠标悬浮在横向滚动区(工具 Tab 栏)上滚动滚轮,纵向 delta 直接转成
     * 横向滚动,用户无需按住 Shift 或瞄准悬浮细条。
     * - React 合成 onWheel 由 React 以 passive 方式挂载,preventDefault 无效,
     *   必须原生 addEventListener({ passive: false })
     * - 仅在确有横向溢出时劫持(无溢出不吞滚轮,放行给祖先滚动容器);
     *   已溢出时滚到两端也吞掉事件,避免滚动突然穿透到底下内容
     * - 触控板横扫(deltaY=0、deltaX≠0)落到同一通道
     * - Ctrl/Cmd+滚轮是缩放手势,不劫持
     * - 纵向模式(默认)不挂监听,滚轮行为完全原生
     */
    React.useEffect(() => {
      if (orientation !== 'horizontal') return;
      const viewport = internalViewportRef.current;
      if (!viewport) return;

      const handleWheel = (e: WheelEvent): void => {
        if (e.ctrlKey || e.metaKey) return;
        if (viewport.scrollWidth - viewport.clientWidth <= 1) return;
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        e.preventDefault();
        viewport.scrollLeft += delta;
      };

      viewport.addEventListener('wheel', handleWheel, { passive: false });
      return () => viewport.removeEventListener('wheel', handleWheel);
    }, [orientation]);

    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        className={cn('relative overflow-hidden', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={composedViewportRef}
          className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar orientation={orientation} className={scrollbarClassName} />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    );
  },
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    // 与全局滚动条美化保持一致:10px 轨道 + 主题色圆角滑块(2px 内缩),
    // hover 加深,深浅主题自动适配(--scrollbar-slider-* 由主题 token 提供)
    //
    // 滚动条是「悬浮」在内容之上的 overlay(absolute 定位,不占布局):
    // - 轨道 pointer-events-none:鼠标穿透,不会被滚动条「拦住」——
    //   被滚动条覆盖的区域(如 Tab 栏底部、列表边缘)仍可正常点击下方内容
    // - 滑块 pointer-events-auto:保持可拖拽
    className={cn(
      'group flex touch-none select-none transition-colors',
      // 轨道可穿透:悬浮滚动条不拦截下层内容的鼠标交互
      'pointer-events-none',
      orientation === 'vertical' && 'h-full w-3.5 p-[2px]',
      orientation === 'horizontal' && 'h-3.5 flex-col p-[2px]',
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      /**
       * data-slot:兜底 Tailwind v4 vite prod scan 漏掉任意值 utility 时,
       * globals.css 中 [data-slot='scroll-area-thumb'] 直接命中,避免滑块无色。
       * dev 模式不影响(prod 才能复现)。
       */
      data-slot="scroll-area-thumb"
      className="qraft-scroll-area-thumb pointer-events-auto relative flex-1 rounded-full bg-[var(--scrollbar-slider-bg)] transition-colors duration-300 group-hover:bg-[var(--scrollbar-slider-hover-bg)]"
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
