/**
 * Markdown 预览偏好 Store
 *
 * 职责:
 * - 排版主题 / 视图模式 / 大纲开关 / 滚动同步开关的持久化(zustand persist)
 * - 草稿自动保存:内容较大,不走 zustand persist(避免每次按键序列化全量状态),
 *   由组件防抖直写 DRAFT_STORAGE_KEY
 * - 首次使用(无草稿 key)时提供示例文档,展示全部排版能力
 */

import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';

/** 排版主题 ID(对应 globals.css 中 .md-theme-* 类) */
export type MdThemeId = 'typora' | 'github' | 'newsprint' | 'pixyll' | 'night';

/** 视图模式:仅编辑 / 分屏(Typora 概念的源码+预览)/ 仅预览 */
export type MdViewMode = 'edit' | 'split' | 'preview';

export const THEME_ITEMS: ReadonlyArray<{ id: MdThemeId; label: string }> = [
  { id: 'typora', label: 'Qraft 默认' },
  { id: 'github', label: 'GitHub' },
  { id: 'newsprint', label: 'Newsprint' },
  { id: 'pixyll', label: 'Pixyll' },
  { id: 'night', label: 'Night' },
];

/** Night 主题为固定深色(OLED),深浅判定需叠加此条件 */
export function isThemeInherentlyDark(themeId: MdThemeId): boolean {
  return themeId === 'night';
}

export const DRAFT_STORAGE_KEY = 'qraft_markdown_draft';

interface MarkdownPreviewState {
  themeId: MdThemeId;
  viewMode: MdViewMode;
  outlineOpen: boolean;
  syncScroll: boolean;
  /** 打字机模式:输入时滚动保持光标行居中(Typora 行为) */
  typewriterMode: boolean;

  setThemeId: (themeId: MdThemeId) => void;
  setViewMode: (viewMode: MdViewMode) => void;
  toggleOutline: () => void;
  setSyncScroll: (syncScroll: boolean) => void;
  setTypewriterMode: (typewriterMode: boolean) => void;
}

export const useMarkdownPreviewStore = create<MarkdownPreviewState>()(
  persist(
    (set) => ({
      themeId: 'typora',
      viewMode: 'split',
      outlineOpen: true,
      syncScroll: true,
      typewriterMode: false,

      setThemeId: (themeId) => set({ themeId }),
      setViewMode: (viewMode) => set({ viewMode }),
      toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
      setSyncScroll: (syncScroll) => set({ syncScroll }),
      setTypewriterMode: (typewriterMode) => set({ typewriterMode }),
    }),
    {
      name: 'qraft_markdown_preview_v1',
    },
  ),
);

/** 首次进入工具时的示例文档(覆盖全部增强语法) */
export const SAMPLE_MARKDOWN = `# Qraft Markdown 预览

> 参考 Typora 排版设计的增强型预览:代码高亮、数学公式、图表、大纲导航一应俱全。

[toc]

## 基础排版

支持 **加粗**、*斜体*、~~删除线~~、\`行内代码\`,以及 [链接](https://example.com)。
上标 x^2^ 与下标 H~2~O 也已就绪。

## 任务列表

- [x] 支持 GFM 任务列表
- [ ] 待办事项可以勾选展示

## 表格

| 特性     | 状态 | 备注           |
| -------- | ---- | -------------- |
| 代码高亮 | ✅   | highlight.js   |
| 数学公式 | ✅   | KaTeX          |
| 图表     | ✅   | Mermaid        |

## 代码块

\`\`\`typescript
interface User {
  name: string;
  age?: number;
}

const greet = (user: User): string => \`Hello, \${user.name}!\`;
\`\`\`

## 数学公式

行内公式 $E = mc^2$,块级公式:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## 图表

\`\`\`mermaid
graph LR
  A[Markdown] --> B{渲染引擎}
  B --> C[HTML]
  B --> D[Mermaid SVG]
\`\`\`

## 脚注

Qraft 是一个本地优先的开发者工具箱[^1]。

[^1]: 数据完全保存在本地,详见项目 README。
`;

// ============================================================
// 实时状态 Store(ephemeral,不持久化)
//
// 光标 / 选区统计 / 当前章节属于高频更新信号:
// 若挂在组件 state 上,每次移动光标或滚动都会整树 re-render(含预览 article)。
// 改为模块级 vanilla store,由 StatusBar / OutlinePanel 局部订阅,
// 高频信号只重渲染对应小部件。
// ============================================================

export interface MdLiveState {
  /** 编辑器光标行列(1-based) */
  cursor: { line: number; column: number };
  /** 非空选区的字数统计;无选区为 null */
  selection: { words: number; chars: number } | null;
  /** 预览滚动位置对应的当前章节标题 id */
  activeHeadingId: string | null;
}

export const mdLiveStore = createStore<MdLiveState>(() => ({
  cursor: { line: 1, column: 1 },
  selection: null,
  activeHeadingId: null,
}));

/** 更新光标(Monaco onDidChangeCursorPosition 调用) */
export function setMdCursor(line: number, column: number): void {
  mdLiveStore.setState({ cursor: { line, column } });
}

/** 更新选区统计(空选区传 null) */
export function setMdSelection(selection: MdLiveState['selection']): void {
  mdLiveStore.setState({ selection });
}

/** 更新当前章节(activeHeading 计算 rAF 内调用) */
export function setMdActiveHeading(id: string | null): void {
  if (mdLiveStore.getState().activeHeadingId !== id) {
    mdLiveStore.setState({ activeHeadingId: id });
  }
}
