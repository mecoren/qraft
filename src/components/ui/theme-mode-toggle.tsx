/**
 * 主题模式切换按钮
 *
 * 职责:
 * - 在 light / dark / system 三种模式间循环切换
 * - 通过 setThemeMode 持久化到 localStorage 并应用主题
 * - 监听 storage 事件,多窗口同步状态
 *
 * 设计说明:
 * - variant="sidebar":侧栏样式(全宽,带文字标签)
 * - variant="ghost":默认图标按钮(紧凑,仅显示图标)
 * - variant="default":主色背景按钮
 *
 * 与 wait-home 的差异:无 wait-home 的设备同步逻辑,仅本地 storage 事件
 */

import { forwardRef, useEffect, useState, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Monitor } from 'lucide-react';
import { type ThemeMode, getStoredThemeMode, setThemeMode } from '@/lib/color-theme';
import { cn } from '@/lib/utils';

const MODE_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

const MODE_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/** 模式 → i18n 键(MODE_LABEL 模式),组件层翻译 */
const MODE_LABEL_KEYS: Record<ThemeMode, string> = {
  light: 'chrome.theme_mode.light',
  dark: 'chrome.theme_mode.dark',
  system: 'chrome.theme_mode.system',
};

export interface ThemeModeToggleProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onClick'> {
  variant?: 'default' | 'ghost' | 'sidebar';
}

export const ThemeModeToggle = forwardRef<HTMLButtonElement, ThemeModeToggleProps>(
  function ThemeModeToggle({ className, variant = 'ghost', ...props }, ref) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode());

    // 监听 storage 事件:其他窗口修改主题模式时同步本组件状态
    useEffect(() => {
      const handleStorage = (e: StorageEvent) => {
        if (e.key === 'theme_mode') {
          setMode(getStoredThemeMode());
        }
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const handleClick = () => {
      const nextIndex = (MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length;
      const next = MODE_CYCLE[nextIndex];
      setMode(next);
      setThemeMode(next);
    };

    const Icon = MODE_ICONS[mode];
    const label = t(MODE_LABEL_KEYS[mode]);
    const toggleAria = t('chrome.theme_mode.toggle_aria', { mode: label });

    // 侧栏样式:全宽按钮,图标 + 文字
    if (variant === 'sidebar') {
      return (
        <button
          ref={ref}
          type="button"
          onClick={handleClick}
          aria-label={toggleAria}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            className,
          )}
          {...props}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Icon className="size-4" />
          </span>
          <span className="truncate">{label}</span>
        </button>
      );
    }

    // 默认/ghost 样式:紧凑图标按钮
    return (
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        aria-label={toggleAria}
        title={label}
        className={cn(
          'flex items-center justify-center rounded-md text-sm text-foreground transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          variant === 'default' &&
            'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
          'h-8 w-8',
          className,
        )}
        {...props}
      >
        <Icon className="size-4" />
      </button>
    );
  },
);
