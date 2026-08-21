/**
 * 搜索跳转信令 Store —— 跨组件协调「搜索结果 → 跳转 + 高亮」
 *
 * SearchDialog 选择结果后写入 target;App 层的 useSearchJump 与
 * SettingsDialog 订阅该 target 完成视图切换 / 菜单切换 / DOM 定位高亮,
 * 处理完成后调用 consume() 清空,避免重复触发。
 */

import { create } from 'zustand';
import type { SearchTarget } from '@/lib/search-index';

interface SearchStoreState {
  /** 待执行的跳转目标;null 表示空闲 */
  target: SearchTarget | null;
  /** 请求一次跳转(覆盖上一次未消费的目标) */
  requestJump: (target: SearchTarget) => void;
  /** 消费当前目标(跳转处理完成后调用) */
  consume: () => void;
}

export const useSearchStore = create<SearchStoreState>((set) => ({
  target: null,

  requestJump: (target) => set({ target }),

  consume: () => set({ target: null }),
}));
