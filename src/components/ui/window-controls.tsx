/**
 * 窗口控制按钮组(最小化 / 最大化-还原 / 关闭)
 *
 * - Windows / Linux:渲染三按钮,命中区 46×32px(Win11 规范)
 * - macOS:渲染 null(使用原生红绿灯)
 * - 关闭按钮 hover 反色警示(--destructive 红底白图标)
 * - 最大化状态时图标切换为「还原」(两个重叠方块)
 *
 * 鼠标交互优化:hover 仅背景 alpha 提升,无缩放抖动;过渡 150ms。
 * 样式见 globals.css 的 .window-control 选择器。
 */

import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, X } from 'lucide-react';
import { closeWindow, minimize, toggleMaximize, useMaximized } from '@/lib/window';
import { useCustomWindowControls } from '@/lib/platform';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

export function WindowControls(): JSX.Element | null {
  const { t } = useTranslation();
  const maximized = useMaximized();

  // macOS 使用原生红绿灯,不渲染自绘按钮
  if (!useCustomWindowControls) return null;

  return (
    <div className="window-controls" data-testid="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label={t('chrome.window.minimize')}
        title={t('chrome.window.minimize')}
        onClick={() => void minimize()}
      >
        <Minus aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? t('chrome.window.restore') : t('chrome.window.maximize')}
        title={maximized ? t('chrome.window.restore') : t('chrome.window.maximize')}
        onClick={() => void toggleMaximize()}
        data-testid="window-toggle-maximize"
      >
        {maximized ? (
          <Copy aria-hidden className="size-3" strokeWidth={ICON_STROKE_WIDTH} />
        ) : (
          <Square aria-hidden className="size-3" strokeWidth={ICON_STROKE_WIDTH} />
        )}
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        aria-label={t('chrome.window.close')}
        title={t('chrome.window.close')}
        onClick={() => void closeWindow()}
      >
        <X aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
      </button>
    </div>
  );
}
