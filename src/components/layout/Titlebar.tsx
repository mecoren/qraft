/**
 * 自定义标题栏
 *
 * - 全屏 Mica:Windows/Linux 关闭原生装饰后,Mica 覆盖到顶部
 * - macOS:保留原生红绿灯,左侧 78px 空间由 CSS .platform-mac .titlebar 处理
 * - 拖拽:data-tauri-drag-region 属性启用原生拖拽(无需自实现)
 * - 双击标题栏切换最大化(Tauri 内置)
 *
 * 布局:.titlebar(flex, 相对定位)
 *   → .titlebar-left(左段:当前工具图标 + 名称,仅工具页显示;名称悬浮弹 Tooltip 描述)
 *   → .titlebar-fill(flex:1 拖拽填充区)
 *   → .titlebar-center(中段:Logo + "Qraft",绝对居中)
 *   → <WindowControls />
 * 工具左区不带 data-tauri-drag-region,避免拖拽拦截干扰 Tooltip 悬浮;拖拽面积由 fill 与 center 维持。
 */

import { type JSX } from 'react';
import { WindowControls } from '@/components/ui/window-controls';
import { Logo } from '@/components/Logo';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getCatalogEntry } from '@/lib/tool-catalog';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';

export function Titlebar(): JSX.Element {
  const view = useUiStore((s) => s.view);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  // 仅工具页且已选中工具时,标题栏左侧展示当前工具图标 + 名称
  const entry = view === 'tool' && currentToolId ? getCatalogEntry(currentToolId) : null;
  // 提取为局部变量,符合 JSX PascalCase 组件约定
  const ToolIcon = entry?.icon;

  return (
    <TooltipProvider delayDuration={500}>
      <header className="titlebar" data-testid="titlebar">
        {/* 左段:当前工具图标 + 名称,悬浮显示功能描述 */}
        <div className="titlebar-left">
          {entry && ToolIcon && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="titlebar-tool" data-testid="titlebar-tool">
                  <ToolIcon aria-hidden className="size-4" strokeWidth={ICON_STROKE_WIDTH} />
                  <span className="titlebar-title" data-testid="titlebar-tool-name">
                    {entry.name}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {entry.description}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* 拖拽填充区:撑满剩余宽度,维持标题栏可拖拽面积 */}
        <div className="titlebar-fill" data-tauri-drag-region />

        {/* 中段:应用 Logo + 名称,绝对居中 */}
        <div className="titlebar-center" data-tauri-drag-region>
          <Logo className="size-4 text-muted-foreground" />
          <span className="titlebar-title">Qraft</span>
        </div>

        <WindowControls />
      </header>
    </TooltipProvider>
  );
}
