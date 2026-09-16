/**
 * Markdown 编辑器偏好 Store
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
import { getLocale } from '@/i18n';

/** 排版主题 ID(对应 globals.css 中 .md-theme-* 类) */
export type MdThemeId = 'typora' | 'github' | 'newsprint' | 'pixyll' | 'night';

/** 视图模式:仅编辑 / 分屏(Typora 概念的源码+预览)/ 仅预览(文本编辑器 .md 分屏用) */
export type MdViewMode = 'edit' | 'split' | 'preview';

/** Markdown 编辑器编辑模式:所见即所得 / Monaco 源码(本工具独占,不影响工作台) */
export type MdEditorMode = 'wysiwyg' | 'source';

/**
 * 正文栏宽模式(所见视图专有):
 * - adaptive:铺满编辑区可用宽度(宽表格 / 长代码行)
 * - narrow:收敛为限宽居中阅读栏(≈700px,长文写作)
 * 与排版主题正交:主题只定字体与行高,栏宽由该设置覆盖主题自带宽度。
 */
export type MdContentWidthMode = 'adaptive' | 'narrow';

/** 主题显示名单存 i18n 键,由组件层翻译(MODE_LABEL 模式) */
export const THEME_ITEMS: ReadonlyArray<{ id: MdThemeId; labelKey: string }> = [
  { id: 'typora', labelKey: 'tools.markdown_editor.theme_qraft' },
  { id: 'github', labelKey: 'tools.markdown_editor.theme_github' },
  { id: 'newsprint', labelKey: 'tools.markdown_editor.theme_newsprint' },
  { id: 'pixyll', labelKey: 'tools.markdown_editor.theme_pixyll' },
  { id: 'night', labelKey: 'tools.markdown_editor.theme_night' },
];

/** Night 主题为固定深色(OLED),深浅判定需叠加此条件 */
export function isThemeInherentlyDark(themeId: MdThemeId): boolean {
  return themeId === 'night';
}

export const DRAFT_STORAGE_KEY = 'qraft_markdown_draft';

interface MarkdownEditorState {
  themeId: MdThemeId;
  viewMode: MdViewMode;
  /** 所见/源码编辑模式(本工具独占,持久化;旧数据缺省所见) */
  editorMode: MdEditorMode;
  /** 正文栏宽模式(持久化;旧数据缺省窄屏阅读栏,与既有默认观感一致) */
  contentWidth: MdContentWidthMode;
  outlineOpen: boolean;
  /**
   * 大纲列表折叠态:头部按钮只收起/展开标题列表,侧栏卡片保持占位
   * (与 outlineOpen 的整栏显隐正交)
   */
  outlineListOpen: boolean;
  syncScroll: boolean;
  /** 打字机模式:输入时滚动保持光标行居中(Typora 行为) */
  typewriterMode: boolean;
  /** 聚焦模式:非当前段落淡化(Typora/MarkText 写作模式) */
  focusMode: boolean;
  /**
   * 加载远程图片(http(s) 引用)。默认关闭:Local-First 原则下预览不主动
   * 出网,开启后 WebView 才会请求远程图床
   */
  loadRemoteImages: boolean;

  setThemeId: (themeId: MdThemeId) => void;
  setViewMode: (viewMode: MdViewMode) => void;
  setEditorMode: (editorMode: MdEditorMode) => void;
  setContentWidth: (contentWidth: MdContentWidthMode) => void;
  toggleOutline: () => void;
  toggleOutlineList: () => void;
  setOutlineOpen: (outlineOpen: boolean) => void;
  /** 大纲卡宽度(px):分隔条拖拽写入,持久化(文本编辑器侧栏同机制) */
  outlineWidth: number;
  setOutlineWidth: (outlineWidth: number) => void;
  setSyncScroll: (syncScroll: boolean) => void;
  setTypewriterMode: (typewriterMode: boolean) => void;
  setFocusMode: (focusMode: boolean) => void;
  setLoadRemoteImages: (loadRemoteImages: boolean) => void;
}

export const useMarkdownEditorStore = create<MarkdownEditorState>()(
  persist(
    (set) => ({
      themeId: 'typora',
      viewMode: 'split',
      editorMode: 'wysiwyg',
      contentWidth: 'narrow',
      outlineOpen: true,
      outlineListOpen: true,
      // 默认 208px;分隔条拖拽写入,持久化
      outlineWidth: 208,
      syncScroll: true,
      typewriterMode: false,
      focusMode: false,
      loadRemoteImages: false,

      setThemeId: (themeId) => set({ themeId }),
      setViewMode: (viewMode) => set({ viewMode }),
      setEditorMode: (editorMode) => set({ editorMode }),
      setContentWidth: (contentWidth) => set({ contentWidth }),
      toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
      toggleOutlineList: () => set((s) => ({ outlineListOpen: !s.outlineListOpen })),
      setOutlineOpen: (outlineOpen) => set({ outlineOpen }),
      setOutlineWidth: (outlineWidth) => set({ outlineWidth }),
      setSyncScroll: (syncScroll) => set({ syncScroll }),
      setTypewriterMode: (typewriterMode) => set({ typewriterMode }),
      setFocusMode: (focusMode) => set({ focusMode }),
      setLoadRemoteImages: (loadRemoteImages) => set({ loadRemoteImages }),
    }),
    {
      name: 'qraft_markdown_preview_v1',
    },
  ),
);

/**
 * 首次进入工具时的示例文档(覆盖全部增强语法)。
 * 属于编辑器内容而非 chrome 文案,故以双模板 + locale 选择器实现,
 * 不走 i18n 片段(保持源码可读);草稿一旦落盘即以用户内容为准。
 */
const SAMPLE_MARKDOWN_ZH = `# Qraft Markdown 预览

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

const SAMPLE_MARKDOWN_EN = `# Qraft Markdown Preview

> An enhanced preview inspired by Typora's layout: code highlighting, math,
> diagrams and outline navigation out of the box.

[toc]

## Basic formatting

Supports **bold**, *italic*, ~~strikethrough~~, \`inline code\`,
and [links](https://example.com).
Superscript x^2^ and subscript H~2~O are ready too.

## Task list

- [x] GFM task lists supported
- [ ] Todos can be checked off

## Table

| Feature        | Status | Note         |
| -------------- | ------ | ------------ |
| Code highlight | ✅     | highlight.js |
| Math           | ✅     | KaTeX        |
| Diagrams       | ✅     | Mermaid      |

## Code block

\`\`\`typescript
interface User {
  name: string;
  age?: number;
}

const greet = (user: User): string => \`Hello, \${user.name}!\`;
\`\`\`

## Math

Inline math $E = mc^2$, block math:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Diagrams

\`\`\`mermaid
graph LR
  A[Markdown] --> B{Render engine}
  B --> C[HTML]
  B --> D[Mermaid SVG]
\`\`\`

## Footnotes

Qraft is a local-first developer toolbox[^1].

[^1]: All data stays on your device; see the project README.
`;

/** 按当前语言取示例文档(仅首次无草稿时调用一次) */
export function getSampleMarkdown(): string {
  return getLocale() === 'en-US' ? SAMPLE_MARKDOWN_EN : SAMPLE_MARKDOWN_ZH;
}

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
