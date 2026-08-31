/**
 * 自定义标题栏
 *
 * - 全屏 Mica:Windows/Linux 关闭原生装饰后,Mica 覆盖到顶部
 * - macOS:保留原生红绿灯,左侧 78px 空间由 CSS .platform-mac .titlebar 处理
 * - 拖拽:data-tauri-drag-region 属性启用原生拖拽(无需自实现)
 * - 双击标题栏切换最大化(Tauri 内置)
 *
 * 布局:.titlebar(flex, 相对定位)
 *   → .titlebar-left(左段:应用 Logo + "Qraft" + 工具菜单栏[有菜单时,紧随品牌右侧])
 *   → .titlebar-fill(flex:1 拖拽填充区)
 *   → .titlebar-center(中段:当前工具图标 + 名称[工具页时] + 弹出新窗口按钮,绝对居中)
 *   → <WindowControls />
 *
 * 工具菜单栏:
 * - 工具组件挂载时调用 useToolMenus(toolId, ...) 注册自己的菜单(File / Edit / View)
 * - 页面/工具 keepalive 常驻,因此仅当「注册菜单的工具 === 当前激活工具」时,
 *   在品牌名右侧展示 ToolMenuBar;其他功能(欢迎页/历史/扩展/其他工具)一律不显示菜单栏
 * - 菜单栏归属左段(品牌区),与中段的功能名分离
 *
 * 拖拽适配:
 * - 菜单栏内的 Trigger / Content 已通过 .menubar-root 选择器置 no-drag,
 *   中段整体 pointer-events:none,仅直接子元素恢复交互,拖拽面积由 fill 维持
 */

import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { WindowControls } from '@/components/ui/window-controls';
import { Logo } from '@/components/Logo';
import { getCatalogEntry, pickText } from '@/lib/tool-catalog';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';
import { isPopoutSupported, openToolInNewWindow } from '@/lib/popout-window';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useToolMenusStore } from '@/store/toolMenubarStore';
import { ToolMenuBar } from './ToolMenuBar';

export function Titlebar(): JSX.Element {
  const { t } = useTranslation();
  const view = useUiStore((s) => s.view);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  // 当前激活工具是否注册了菜单(用于决定左段渲染菜单栏 vs 工具名)
  // 注意:页面/工具均为 keepalive(DOM 常驻),菜单可能由已切走的工具贡献,
  // 因此必须校验「注册菜单的工具 === 当前激活工具」,其他功能不显示菜单栏
  const menus = useToolMenusStore((s) => s.menus);
  const ownerToolId = useToolMenusStore((s) => s.ownerToolId);
  const hasMenus =
    view === 'tool' && currentToolId !== null && ownerToolId === currentToolId && menus.length > 0;
  // 仅工具页且已选中工具时,标题栏中段展示当前工具图标 + 名称(无菜单时降级显示)
  const entry = view === 'tool' && currentToolId ? getCatalogEntry(currentToolId) : null;
  // 提取为局部变量,符合 JSX PascalCase 组件约定
  const ToolIcon = entry?.icon;

  return (
    <header className="titlebar" data-testid="titlebar">
      {/* 左段:应用 Logo + 名称,右侧(有菜单时)为工具菜单栏 */}
      <div className="titlebar-left">
        <Logo className="size-4" />
        <span className="titlebar-title">Qraft</span>
        {hasMenus && <ToolMenuBar />}
      </div>

      {/* 拖拽填充区:撑满剩余宽度,维持标题栏可拖拽面积 */}
      <div className="titlebar-fill" data-tauri-drag-region />

      {/*
       * 中段提示走原生 title + 全局接管模块(global-title-tooltip):
       * 渲染为与查找组件(Ctrl+F)完全相同的浮层(HINT_LAYER,实心背景/
       * z-10000/fixed)。此前用 Radix Tooltip 在 Tauri 窗口内显示为
       * "透明",统一改用已验证可用的现有浮层机制
       */}
      <div className="titlebar-center">
        {entry && ToolIcon && (
          <button
            type="button"
            className="titlebar-tool"
            data-testid="titlebar-tool"
            title={pickText(entry.description)}
          >
            <ToolIcon aria-hidden className="size-4" strokeWidth={ICON_STROKE_WIDTH} />
            <span className="titlebar-title" data-testid="titlebar-tool-name">
              {pickText(entry.name)}
            </span>
          </button>
        )}
        {/* 弹出新窗口入口:工具名右侧,与 DevToys pop-out 对齐 */}
        {entry && currentToolId && isPopoutSupported(currentToolId) && (
          <button
            type="button"
            className="titlebar-tool"
            data-testid="titlebar-popout"
            aria-label={t('chrome.titlebar.popout')}
            title={t('chrome.titlebar.popout')}
            onClick={() => void openToolInNewWindow(currentToolId)}
          >
            <ExternalLink aria-hidden className="size-4" strokeWidth={ICON_STROKE_WIDTH} />
          </button>
        )}
      </div>

      <WindowControls />
    </header>
  );
}
