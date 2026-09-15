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

import { useEffect, useLayoutEffect } from 'react';
import { create } from 'zustand';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMenu } from '@/types/tool-menu';

interface ToolMenusState {
  /** 注册菜单的工具 id;null 表示当前无任何工具贡献菜单 */
  ownerToolId: string | null;
  /** 贡献的菜单集合;为空数组表示无菜单 */
  menus: ToolMenu[];
  /** 设置菜单(挂载时调用,需携带工具 id 以便 Titlebar 判断归属) */
  setMenus: (toolId: string, menus: ToolMenu[]) => void;
  /** 清空菜单(卸载时调用);携带工具 id 时只清自己的注册 */
  clear: (toolId?: string) => void;
  /**
   * 归属工具的最近一次菜单注册(toolId → menus)。
   * 组件 keepalive 常驻:切走时菜单被其他工具覆盖,切回时组件不会重新
   * 挂载、useLayoutEffect 不会重跑,菜单栏因此丢失 —— 由模块级的
   * currentToolId 订阅把归属工具的最近注册重放回去(见文件尾部)。
   */
  registry: Map<string, ToolMenu[]>;
}

export const useToolMenusStore = create<ToolMenusState>((set, get) => ({
  ownerToolId: null,
  menus: [],
  registry: new Map<string, ToolMenu[]>(),
  setMenus: (toolId, menus) => {
    get().registry.set(toolId, menus);
    // 归属工具正是激活工具时才落到 menus(否则等激活订阅重放);
    // 但挂载顺序上组件先于 Titlebar 订阅,直接设置保持首挂载即注册的
    // 原有行为 —— 归属非激活的场景由激活订阅纠正
    set({ ownerToolId: toolId, menus });
  },
  clear: (toolId) => {
    if (toolId === undefined) {
      // 无条件清空(测试隔离用):状态与注册表一起重置
      get().registry.clear();
      set({ ownerToolId: null, menus: [] });
      return;
    }
    // keepalive 下多工具并存:仅清自己的注册;且仅当自己正是当前归属时
    // 才清掉展示,防止已隐藏工具的卸载把新激活工具刚注册的菜单抹掉
    get().registry.delete(toolId);
    if (get().ownerToolId === toolId) set({ ownerToolId: null, menus: [] });
  },
}));

// 激活工具切换时重放其最近一次菜单注册(keepalive 切回修复):
// 后挂载工具的 setMenus 会覆盖 store 里的 menus,先挂载的工具切回时
// 不会重新挂载,只有这里把它的注册重放回去
if (typeof window !== 'undefined') {
  let lastActive: string | null | undefined;
  useToolStateStore.subscribe((s) => {
    if (s.currentToolId === lastActive) return;
    lastActive = s.currentToolId;
    if (s.currentToolId === null) return;
    const menus = useToolMenusStore.getState().registry.get(s.currentToolId);
    // 有注册的工具被激活:重放(若归属已是它且内容未变,重放幂等);
    // 未注册菜单的工具激活:清掉上一归属的展示(Titlebar 的归属校验
    // 本就会隐藏,显式清空保持 store 状态与展示一致)
    if (menus) useToolMenusStore.setState({ ownerToolId: s.currentToolId, menus });
    else useToolMenusStore.setState({ ownerToolId: null, menus: [] });
  });
}

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
  // 菜单写入放在 useLayoutEffect:
  // - 旧实现采用「render 期间同步 setMenus」,React 18/19 开发模式会告警
  //   "Cannot update a component (Titlebar) while rendering a different component"
  //   —— 渲染期间更新另一个订阅组件违反了 React 渲染规则
  // - useLayoutEffect 在 commit 后、浏览器 paint 前执行,store 写入后 Titlebar
  //   会在同一帧内完成更新,同样保证「首屏即可见菜单」且无闪烁;
  //   只读菜单(memo 稳定)时不会重复触发,行为更优
  useLayoutEffect(() => {
    useToolMenusStore.getState().setMenus(toolId, menus);
  }, [toolId, menus]);

  // unmount 清理:effect cleanup 是唯一可靠的「组件卸载时执行」机制;
  // 空依赖数组在卸载时执行 cleanup,menus 变更由上面的 useLayoutEffect 处理。
  // 携带 toolId:keepalive 下已隐藏工具的卸载(LRU 淘汰)不应清掉
  // 其他归属工具的注册(见 store.clear 说明)
  useEffect(() => {
    return () => {
      useToolMenusStore.getState().clear(toolId);
    };
  }, [toolId]);
}
