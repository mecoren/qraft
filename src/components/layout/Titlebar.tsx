/**
 * 自定义标题栏
 *
 * - 全屏 Mica:Windows/Linux 关闭原生装饰后,Mica 覆盖到顶部
 * - macOS:保留原生红绿灯,左侧 78px 空间由 CSS .platform-mac .titlebar 处理
 * - 拖拽:data-tauri-drag-region 属性启用原生拖拽(无需自实现)
 * - 双击标题栏切换最大化(Tauri 内置)
 *
 * 布局:.titlebar(flex) → .titlebar-drag(flex-1, 拖拽区) + <WindowControls />
 * 拖拽区与窗口控制按钮为兄弟节点,避免按钮嵌套在拖拽区内导致点击被拦截。
 */

import { type JSX } from 'react';
import { WindowControls } from '@/components/ui/window-controls';
import { Logo } from '@/components/Logo';

export function Titlebar(): JSX.Element {
  return (
    <header className="titlebar" data-testid="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <Logo className="size-4 text-muted-foreground" />
        <span className="titlebar-title">Qraft</span>
      </div>
      <WindowControls />
    </header>
  );
}
