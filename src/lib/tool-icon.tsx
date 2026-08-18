/**
 * 工具图标解析器
 *
 * 将 Rust 端下发的 lucide-react 图标名(字符串)解析为 React 组件。
 * 解析失败时回退到调用方提供的 fallback 图标(通常为分类图标)。
 *
 * 设计说明:
 * - ToolMetadata.icon 为 lucide-react 的 PascalCase 图标名(如 "Braces"、"Hash")
 * - lucide-react 导出 `icons` 对象(名称 → 组件),用于按名动态解析
 * - 该模块供 SideNav / ToolPanel 复用,避免重复解析逻辑
 *
 * ToolIcon 组件:封装 resolveToolIcon 为声明式组件,避免在父组件 render 中
 * 通过 `const Comp = resolveToolIcon(...)` 创建组件变量(触发 react-x/static-components)。
 */

import { createElement, type JSX } from 'react';
import { icons, type LucideIcon, type LucideProps } from 'lucide-react';

const ICON_REGISTRY = icons as unknown as Record<string, LucideIcon>;

export function resolveToolIcon(name: string | undefined | null, fallback: LucideIcon): LucideIcon {
  if (name && typeof ICON_REGISTRY[name] === 'function') {
    return ICON_REGISTRY[name];
  }
  return fallback;
}

/**
 * 声明式工具图标组件。
 * 在内部解析图标名并通过 createElement 渲染,避免在 render 中
 * 创建组件变量(触发 react-x/static-components 规则)。
 */
export function ToolIcon({
  name,
  fallback,
  ...props
}: {
  name: string | undefined | null;
  fallback: LucideIcon;
} & LucideProps): JSX.Element {
  return createElement(resolveToolIcon(name, fallback), props);
}
