'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
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
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
