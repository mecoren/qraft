'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Info,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** 深色主题集合,与 code-editor.tsx 的 DARK_PALETTES 保持一致 */
const DARK_PALETTES = new Set([
  'obsidian',
  'deep-sea',
  'twilight',
  'emerald-night',
  'custom',
]);

/**
 * 读取当前主题模式(light/dark),根据 <html data-palette> 推断
 *
 * 监听 data-palette 属性变化,主题切换时同步 Toaster 主题。
 */
function useSonnerTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const palette = document.documentElement.dataset.palette ?? 'daylight';
    return DARK_PALETTES.has(palette) ? 'dark' : 'light';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const palette = document.documentElement.dataset.palette ?? 'daylight';
      setTheme(DARK_PALETTES.has(palette) ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSonnerTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // 右上方显示 —— 与 shadcn Radix Alert 在工具栏右上角展示的语义一致
      position="top-right"
      icons={{
        success: <CheckCircle2 className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <AlertCircle className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      toastOptions={{
        // 双行结构:左侧图标 + 右侧标题/描述,与 shadcn Alert 风格一致
        // 通过 gap-x / 标题字号提升层次感;description 用 muted-foreground
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover-layer group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:grid group-[.toaster]:grid-cols-[auto_1fr] group-[.toaster]:items-start group-[.toaster]:gap-x-3 group-[.toaster]:gap-y-1',
          // 让默认图标(图标已被 icons 渲染成 sonner 自带的 <svg> 节点)靠左对齐
          icon: 'group-[.toast]:col-start-1 group-[.toast]:row-span-2 group-[.toast]:mt-0.5',
          // 标题列(sonner 在 description 存在时把主消息包到 .title;此处简单把主消息也拉成标题样式)
          title:
            'group-[.toast]:col-start-2 group-[.toast]:row-start-1 group-[.toast]:font-medium group-[.toast]:text-sm group-[.toast]:text-foreground group-[.toast]:leading-none group-[.toast]:tracking-tight',
          description:
            'group-[.toast]:col-start-2 group-[.toast]:row-start-2 group-[.toast]:text-sm group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };