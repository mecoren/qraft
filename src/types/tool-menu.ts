/**
 * 工具菜单贡献 —— 用于把工具自身的菜单注册到 Titlebar
 *
 * 设计动机:
 * - 每个工具(文本编辑器、Base64 编解码、JSON 格式化等)的菜单项不同;
 *   不应在 Titlebar 里硬编码「打开/新建/保存」这种仅对编辑器有意义的菜单
 * - 工具组件挂载时通过 useToolMenus() 声明自己的菜单集合,
 *   卸载时自动清理 — 与 React 生命周期对齐,避免内存泄漏
 * - 后续扩展新的工具时,只需在工具组件里调用 useToolMenus([...]),
 *   无需修改 Titlebar / AppShell
 *
 * 数据结构:
 * - ToolMenu       顶级菜单(File / Edit / View),包含若干组
 * - ToolMenuGroup  分组(组之间渲染分隔线,组内不渲染)
 * - ToolMenuItem   菜单项:label + 点击回调 + 可选 disabled / shortcut / icon / 渲染类型
 *   - type: 'item'(默认,可点击)、'separator'(渲染为分隔线,忽略其他字段)、'checkbox'(选中态)
 * - 注意:onSelect 必须保持稳定引用(useCallback),避免 Radix Menubar 反复 re-mount
 */

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** 工具菜单项 — 由工具自身实现,Titlebar 通过 store 读取后渲染 */
export interface ToolMenuItem {
  /** 唯一 id,用作 key + data-testid */
  id: string;
  /** 菜单项显示文案 */
  label: string;
  /** 点击回调(参数不适用,菜单触发即执行) */
  onSelect: () => void;
  /** 禁用(true 时灰色不可点) */
  disabled?: boolean;
  /** 右侧快捷键提示,如 "Ctrl+S" / "⌘N" */
  shortcut?: string;
  /** 前置图标 */
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  /** 渲染类型:item / separator / checkbox */
  type?: 'item' | 'separator' | 'checkbox';
  /** checkbox 类型时为选中状态 */
  checked?: boolean;
  /** 工具自定义:用于 e2e 测试 */
  testId?: string;
}

/** 菜单分组 — 一组内的 item 共享视觉,组之间自动插入分隔线 */
export interface ToolMenuGroup {
  items: ToolMenuItem[];
}

/** 顶级菜单 — 一个工具可注册多个(File / Edit / View) */
export interface ToolMenu {
  /** 唯一 id(供 key 使用),如 'file' / 'edit' */
  id: string;
  /** 触发器文案,中文/英文均可,如 '文件' / 'File' */
  label: string;
  /** 菜单分组数组 — 渲染时在组间插入分隔线 */
  groups: ToolMenuGroup[];
}