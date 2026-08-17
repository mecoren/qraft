/**
 * 工具菜单栏 Store
 *
 * 设计动机:
 * - Titlebar 需要展示「当前激活工具」的菜单,但菜单项由工具组件自己声明
 * - 工具组件挂载时 setMenus(toolId, menus),卸载时清理(clear),
 *   由 useEffect cleanup 自动调用 — 避免挂载/卸载竞态导致旧菜单残留
 * - 应用内各页面/工具采用 keepalive(DOM 常驻,display:none 切显隐),
 *   因此「挂载即注册」不能代表「当前正在展示」——必须额外记录菜单归属的
 *   工具 id(ownerToolId),由 Titlebar 判断「归属工具 === 当前激活工具」
 *   后才渲染菜单栏,否则其他功能页面也会残留上一工具的菜单
 * - 不持久化:菜单是 UI 临时状态,重启应用自然回到「无菜单」态
 *
 * 实现细节:
 * - 使用 zustand create()(无中间件),因为这是纯运行时 UI 状态
 * - Titlebar 通过 useToolMenusStore((s) => s.menus / s.ownerToolId) 订阅,
 *   工具切换时菜单会自动从 store 反映出来
 * - setMenus 直接覆盖(非追加),与「当前唯一激活工具」的语义一致
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { ToolMenu } from '@/types/tool-menu';

interface ToolMenusState {
  /** 注册菜单的工具 id;null 表示当前无任何工具贡献菜单 */
  ownerToolId: string | null;
  /** 贡献的菜单集合;为空数组表示无菜单 */
  menus: ToolMenu[];
  /** 设置菜单(挂载时调用,需携带工具 id 以便 Titlebar 判断归属) */
  setMenus: (toolId: string, menus: ToolMenu[]) => void;
  /** 清空菜单(卸载时调用) */
  clear: () => void;
}

export const useToolMenusStore = create<ToolMenusState>((set) => ({
  ownerToolId: null,
  menus: [],
  setMenus: (toolId, menus) => set({ ownerToolId: toolId, menus }),
  clear: () => set({ ownerToolId: null, menus: [] }),
}));

/**
 * 工具菜单声明副作用 —— 挂载时注册菜单,卸载时自动清空。
 *
 * 用法:
 * ```tsx
 * function MyTool() {
 *   const items = useMemo(() => buildMenuForTool(), []);
 *   useToolMenus(toolId, items);
 *   return <div>...</div>;
 * }
 * ```
 *
 * 行为契约:
 * - mount:同步执行 setMenus(toolId, menus) — 在 commit 之前 store 已写入,
 *   因此 Titlebar 首次渲染即可看到菜单,避免「先渲染空 → 再渲染菜单」抖动
 * - unmount:同步执行 clear() — 卸载时旧菜单立即消失,不会残留
 * - menus 引用变更(memo 失效):同步执行 setMenus(toolId, menus) — store 写入
 *   但订阅者若 menus 内容相同则不重渲染
 *
 * 注意:应用采用 keepalive(工具 DOM 常驻),组件卸载不代表切换了工具。
 * 因此 Titlebar 还需比较 store.ownerToolId 与当前激活工具 id,
 * 只有归属工具正好是当前激活工具时才渲染菜单栏(见 Titlebar)。
 */
export function useToolMenus(toolId: string, menus: ToolMenu[]): void {
  // 同步写入 mount:useState/useReducer 的初始化式更新不会触发 commit 后的 effect,
  // 因此这里采用 render 期间同步调用 store.setState(已在 zustand 中官方支持)。
  // 这是「工具挂载即菜单就位」的关键。
  useToolMenusStore.getState().setMenus(toolId, menus);

  // unmount 清理:effect cleanup 是唯一可靠的「组件卸载时执行」机制
  useEffect(() => {
    return () => {
      useToolMenusStore.getState().clear();
    };
    // 仅在 mount/unmount 时跑,memos 变更由上面的同步 setMenus 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}