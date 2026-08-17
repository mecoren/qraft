/**
 * UI 状态 Store —— 视图导航 / 侧栏 / 收藏夹 / 最近使用
 *
 * 职责:
 * - 应用级视图切换:welcome(欢迎页) / tool(工具页) / settings / extensions / history
 * - 侧栏折叠状态与分类展开状态
 * - 收藏夹与最近使用列表(localStorage 持久化,重启恢复)
 *
 * 设计说明:
 * - 持久化仅保存用户数据(收藏/最近/侧栏偏好),视图本身不持久化,
 *   启动默认进入 tool 视图(当前工具由 toolStateStore 初始为文本编辑器)
 * - openTool 串联 toolStateStore.selectTool + 最近使用记录 + 视图切换,
 *   是打开工具的唯一入口(侧栏/欢迎页/命令面板共用)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useToolStateStore } from '@/store/toolStateStore';
import type { CatalogCategoryId } from '@/lib/tool-catalog';

export type AppView = 'welcome' | 'tool' | 'settings' | 'extensions' | 'history';

/** 最近使用列表上限 */
export const MAX_RECENTS = 12;

interface UiState {
  view: AppView;
  sidebarCollapsed: boolean;
  favorites: string[];
  recents: string[];
  expandedCategories: CatalogCategoryId[];

  setView: (view: AppView) => void;
  /** 打开工具:切换视图 + 选中工具 + 记录最近使用 */
  openTool: (toolId: string) => void;
  /** 返回欢迎页 */
  goWelcome: () => void;
  toggleSidebar: () => void;
  toggleFavorite: (toolId: string) => void;
  toggleCategory: (categoryId: CatalogCategoryId) => void;
  /** 展开指定分类(供折叠栏点击分类图标时使用) */
  expandCategory: (categoryId: CatalogCategoryId) => void;
  clearRecents: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      view: 'tool',
      sidebarCollapsed: false,
      favorites: [],
      recents: [],
      expandedCategories: [],

      setView: (view) => set({ view }),

      openTool: (toolId) => {
        useToolStateStore.getState().selectTool(toolId);
        set((s) => ({
          view: 'tool',
          recents: [toolId, ...s.recents.filter((id) => id !== toolId)].slice(0, MAX_RECENTS),
        }));
      },

      goWelcome: () => {
        useToolStateStore.getState().selectTool(null);
        set({ view: 'welcome' });
      },

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      toggleFavorite: (toolId) =>
        set((s) => ({
          favorites: s.favorites.includes(toolId)
            ? s.favorites.filter((id) => id !== toolId)
            : [...s.favorites, toolId],
        })),

      toggleCategory: (categoryId) =>
        set((s) => ({
          expandedCategories: s.expandedCategories.includes(categoryId)
            ? s.expandedCategories.filter((id) => id !== categoryId)
            : [...s.expandedCategories, categoryId],
        })),

      expandCategory: (categoryId) => {
        const { expandedCategories } = get();
        if (!expandedCategories.includes(categoryId)) {
          set({ expandedCategories: [...expandedCategories, categoryId] });
        }
      },

      clearRecents: () => set({ recents: [] }),
    }),
    {
      name: 'qraft_ui_v1',
      // 仅持久化用户数据;视图与展开态在会话内有效即可
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        favorites: s.favorites,
        recents: s.recents,
        expandedCategories: s.expandedCategories,
      }),
    },
  ),
);

/** 选择器:判断工具是否已收藏(供组件订阅) */
export const selectIsFavorite = (toolId: string) => (s: UiState) =>
  s.favorites.includes(toolId);
