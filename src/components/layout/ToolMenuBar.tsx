/**
 * 工具菜单栏 —— 把当前工具注册的菜单渲染为 Menubar
 *
 * 职责:
 * - 订阅 useToolMenusStore.menus,在工具切换时自动反映
 * - 把声明式的 ToolMenu / ToolMenuGroup / ToolMenuItem 转换为 Radix Menubar JSX
 * - 保持 key / data-testid 稳定,便于测试与 React diff
 *
 * 不负责:
 * - 菜单数据来源(由 useToolMenus 在工具组件中声明)
 * - Titlebar 拖拽区(no-drag 由 menubar 组件内部样式接管)
 */

import { Fragment, type JSX } from 'react';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { useToolMenusStore } from '@/store/toolMenubarStore';
import type { ToolMenuGroup, ToolMenuItem } from '@/types/tool-menu';

/** 默认分隔符 testid(供 e2e 使用) */
const SEPARATOR_TESTID = 'menubar-separator';

/**
 * 把单个 ToolMenuItem 渲染成对应的 Menubar 子组件。
 *
 * - type === 'separator' → 渲染 MenubarSeparator
 * - type === 'checkbox'   → 渲染 MenubarCheckboxItem(选中态展示)
 * - 默认                  → MenubarItem(图标 + 文案 + 快捷键右对齐)
 */
function renderItem(item: ToolMenuItem): JSX.Element {
  // 分隔线优先(item 模式下 type 字段为 'separator' 时即按分隔线渲染)
  if (item.type === 'separator') {
    return (
      <MenubarSeparator
        key={`sep-${item.id}`}
        data-testid={item.testId ?? SEPARATOR_TESTID}
      />
    );
  }

  // checkbox 类型(预留,文本编辑器暂未使用,后续扩展可启用)
  if (item.type === 'checkbox') {
    return (
      <MenubarCheckboxItem
        key={item.id}
        disabled={item.disabled}
        onCheckedChange={() => item.onSelect()}
        data-testid={item.testId ?? `menubar-item-${item.id}`}
        checked={!!item.checked}
      >
        {item.icon ? <item.icon aria-hidden className="size-4" /> : null}
        <span>{item.label}</span>
        {item.shortcut ? <MenubarShortcut>{item.shortcut}</MenubarShortcut> : null}
      </MenubarCheckboxItem>
    );
  }

  // 普通菜单项
  const Icon = item.icon;
  return (
    <MenubarItem
      key={item.id}
      disabled={item.disabled}
      onSelect={item.onSelect}
      data-testid={item.testId ?? `menubar-item-${item.id}`}
    >
      {Icon ? <Icon aria-hidden className="size-4" /> : null}
      <span>{item.label}</span>
      {item.shortcut ? <MenubarShortcut>{item.shortcut}</MenubarShortcut> : null}
    </MenubarItem>
  );
}

/**
 * 渲染单个分组(组间插入分隔线)。
 * 空分组不渲染,也不渲染分隔线。
 */
function renderGroup(
  group: ToolMenuGroup,
  groupIndex: number,
  groupKey: string,
): JSX.Element | null {
  if (group.items.length === 0) return null;
  return (
    <Fragment key={`${groupKey}-${groupIndex}`}>
      {groupIndex > 0 ? <MenubarSeparator /> : null}
      {group.items.map((item) => renderItem(item))}
    </Fragment>
  );
}

/**
 * 工具菜单栏
 * - 当 store.menus 为空数组时,渲染 null(不占空间,与旧版本一致)
 * - 否则渲染为 Radix Menubar,左侧对齐 Titlebar-fill 区域
 */
export function ToolMenuBar(): JSX.Element | null {
  const menus = useToolMenusStore((s) => s.menus);
  if (menus.length === 0) return null;

  return (
    <Menubar data-testid="tool-menubar">
      {menus.map((menu) => (
        <MenubarMenu key={menu.id} value={menu.id}>
          <MenubarTrigger data-testid={`tool-menubar-trigger-${menu.id}`}>
            {menu.label}
          </MenubarTrigger>
          <MenubarContent>
            {menu.groups.map((group, idx) => renderGroup(group, idx, menu.id))}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}