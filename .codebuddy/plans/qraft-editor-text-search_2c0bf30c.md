---
name: qraft-editor-text-search
overview: 在现有全局搜索面板中新增「文本内容」搜索模式（VSCode 风格）：搜索文本编辑器工作区已打开文件的内容，结果按文件分组展示匹配行，点击跳转打开对应文件、编辑器内全部匹配项黄色高亮（Monaco decorations）、定位到目标行并聚焦选中；与现有功能搜索分离，面板内 Tab 切换。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 弹窗浮层
    - VSCode 搜索风格
    - 文件分组结果
    - 橙黄匹配高亮
    - 深色主题
    - 模式切换胶囊
  fontSystem:
    fontFamily: PingFang SC, system-ui, sans-serif
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 14px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#3b82f6"
      - var(--primary)
    background:
      - var(--background)
      - var(--background-layer)
      - var(--accent)
    text:
      - var(--foreground)
      - var(--muted-foreground)
    functional:
      - rgba(234, 92, 0, 0.38)
      - var(--sidebar-primary)
todos:
  - id: text-search-core
    content: 用 [skill:test-driven-development] 实现 editor-text-search.ts 纯函数与 editor-search-registry.ts 注册表及测试
    status: completed
  - id: jump-text-branch
    content: 扩展 SearchTarget 与 useSearchJump 文本跳转分支（切 tab + decoration 高亮 + 定位）并补测试
    status: completed
    dependencies:
      - text-search-core
  - id: search-dialog-modes
    content: SearchDialog 增加功能/文本模式切换与文本结果渲染，遵循 [skill:shadcn] 组件规范并补测试
    status: completed
    dependencies:
      - jump-text-branch
  - id: editor-workspace-wiring
    content: EditorWorkbench 注册 tabId→editor 实例并在卸载时注销，新增 .search-text-match 高亮样式
    status: completed
    dependencies:
      - text-search-core
  - id: verify-review
    content: 运行 lint/typecheck/全量测试，用 [skill:requesting-code-review] 审查改动并修复问题
    status: completed
    dependencies:
      - search-dialog-modes
      - editor-workspace-wiring
---

## 产品概述

新增「编辑器文本全局搜索」：在现有全局搜索面板中增加 **文本搜索模式**，搜索文本编辑器工作区已打开文件（tabs）的实际文本内容，参考 VSCode 的「在文件中查找」交互 —— 结果按文件分组展示匹配行，点击后跳转到对应文件与行，编辑器内全部匹配项以 VSCode 搜索黄色背景高亮，并聚焦选中当前匹配。

## 核心功能

- 搜索面板内切换两种模式：「功能搜索」（现有工具/设置/页面标题搜索，保持不变）与「文本搜索」（编辑器文件内容），类似 VSCode 命令面板 vs 在文件中查找
- 文本搜索仅覆盖文本编辑器工作区已打开的文件（tabs），不包含其他工具组件的输入/输出框；基于各 tab 当前文本（含未保存改动）进行大小写不敏感匹配
- 结果按文件分组：文件名 + 匹配数；每组下列出匹配行（行号 + 行内容，匹配片段高亮）；空查询显示提示，无打开文件时显示引导文案
- 点击结果：切换到文本编辑器工具 → 激活对应 tab → 编辑器内所有匹配项 VSCode 风格黄色高亮（Monaco decoration）→ 滚动居中并聚焦选中该匹配行
- 原有功能搜索跳转（工具区块 DOM 锚点高亮）完全保留，两者互不干扰

## 技术栈

复用现有栈，不引入新依赖：React 19 + TypeScript + zustand + Monaco（@monaco-editor/react）+ cmdk + vitest。文本高亮使用 Monaco `editor.createDecorationsCollection()`（项目已有先例 `monaco-fold-summary.ts`），编辑器实例通过扩展现有全局注册表模式获取。

## 实现方案

### 1. 文本搜索纯函数 `src/lib/editor-text-search.ts` [NEW]

- `TextMatch { tabId, tabTitle, path, line, column, lineContent, matchStart, matchEnd }`；`TabGroup { tabId, tabTitle, path, count, matches }`
- `searchTabsText(tabs: readonly EditorTab[], query: string): TabGroup[]`
- 空 query 或空 tabs 返回 `[]`；大小写不敏感匹配
- 按 `content.split('\n')` 逐行扫描，每行用 `indexOf` 循环收集全部匹配；**按行聚合**（VSCode 同款：一行一条结果，行内多匹配在编辑器内全部高亮）
- 聚合为按 tab 分组，保持 tabs 原始顺序；`count` 为匹配行数
- 复杂度 O(总字符数)，单次线性扫描，结果量小无性能压力

### 2. 编辑器实例按 tab 注册表 `src/lib/editor-search-registry.ts` [NEW]

EditorWorkbench 只有一个 Monaco 实例且切换 tab 时 `key` 变化导致重挂载，需维护 `tabId → editor 实例` 映射：

- `registerTabEditor(tabId, ed)` / `unregisterTabEditor(tabId)` / `getTabEditor(tabId)` / `clearTabEditors()`
- EditorWorkbench `handleEditorMount` 在现有 `registerActiveEditor` 基础上，额外用当前 `activeTab.id` 注册；卸载清理（沿用现有 `useEffect` 清理逻辑）

### 3. 跳转目标扩展与文本高亮

- `SearchTarget` 增加可选 `tabId?: string; textQuery?: string`（文本搜索跳转专用，`view:'tool', toolId:'text_editor'`）
- `useSearchJump` 增加文本跳转分支（target 含 `textQuery` 时）：

1. `openTool('text_editor')` + `switchTab(tabId)`
2. 重试等待编辑器实例挂载（复用 `scheduleHighlight` 的 120ms×20 重试模式）：`getTabEditor(tabId)` 非空且 `editor.getModel()` 就绪
3. 应用高亮：`editor.deltaDecorations(prevIds, matches.map(...))`，每个匹配 `{ range: new Range(line, col, line, col + len), options: { className: 'search-text-match' } }`，**模块级变量保存并清理上一次 decoration id 集合**（连续跳转不累积）
4. 定位：`editor.revealRangeInCenter(range)` + `editor.setSelection(range)` + `editor.focus()`
5. 编辑器内容变更（用户编辑）时自动清理 decoration：注册 `onDidChangeModelContent` 一次性监听或跳转时清理

- 文本跳转不走 DOM 锚点高亮，原功能搜索路径不变

### 4. SearchDialog 模式切换

- 顶部搜索框内加模式切换（`useState<SearchMode>('feature' | 'text')`，切换时重置 query）：两个按钮/胶囊 Tab「功能」「文本」，当前项用 accent 色高亮（参考 SettingsDialog 菜单激活态）
- 文本模式：
- placeholder/aria-label 变为「搜索编辑器文本...」
- 结果由 `searchTabsText(workspace.tabs, debounced)` 驱动（从 `useEditorWorkspaceStore` 读取 `workspace.tabs`）
- 渲染：文件分组（文件名 + 匹配数 badge）→ 匹配行（等宽行号列 + 缩进行内容，匹配片段用 `<mark>`/span 高亮）
- 空 query：提示「输入关键字搜索已打开文件的内容」；无 tab：「请先在文本编辑器中打开文件」
- 点击 → `requestJump({ view:'tool', toolId:'text_editor', tabId, textQuery })` → 关闭面板
- 功能模式保持现状；底部提示条与结果数两种模式复用
- cmdk 键盘导航在两种模式下均可用（文本结果项也作为 CommandItem）

### 5. 样式 `src/styles/globals.css` [MODIFY]

```css
.search-text-match { background: rgba(234, 92, 0, 0.38); border-radius: 2px; }
```

VSCode 搜索橙黄色半透明背景，深浅主题均可见；面板内匹配片段高亮使用相同色系。所有新样式基于项目 CSS 变量与半透明色，符合现有 DevToys 风格。

## 性能与可靠性

- 文本搜索为纯函数线性扫描，无重复遍历；结果列表量小无需虚拟化
- 编辑器实例按 tab 注册表为 Map 查询 O(1)；decoration 单次 delta 应用，模块级清理避免累积
- 跳转竞态防护：编辑器重挂载/懒加载用重试兜底（复用现有 2.4s 窗口），tab 已被关闭时静默降级（仅打开工具不定位）
- 向后兼容：`SearchTarget` 新增可选字段、SearchDialog 新增模式 state，原功能搜索路径零改动

## 目录结构

```
src/
├── lib/
│   ├── editor-text-search.ts        # [NEW] 文本搜索纯函数：TextMatch/TabGroup/searchTabsText
│   ├── editor-text-search.test.ts   # [NEW] 大小写/多行多匹配/中文/空查询/分组顺序测试
│   └── editor-search-registry.ts    # [NEW] tabId→Monaco 实例注册表
├── hooks/
│   ├── useSearchJump.ts             # [MODIFY] 文本跳转分支：切 tab + 重试等实例 + decoration 高亮 + 定位
│   └── useSearchJump.test.ts        # [MODIFY] 文本跳转分支测试（fake editor）
├── components/
│   ├── SearchDialog.tsx             # [MODIFY] 模式 Tab + 文本结果分组渲染 + 点击跳转
│   └── SearchDialog.test.tsx        # [MODIFY] 模式切换/文本渲染/requestJump 断言
├── tools/
│   └── code-editor-workspace/
│       └── EditorWorkbench.tsx      # [MODIFY] handleEditorMount 注册 tabId→editor；卸载注销
├── lib/
│   └── search-index.ts              # [MODIFY] SearchTarget 增加 tabId/textQuery 可选字段
└── styles/
    └── globals.css                  # [MODIFY] .search-text-match 装饰样式
```

## 关键结构

```ts
// src/lib/editor-text-search.ts
export interface TextMatch {
  tabId: string; tabTitle: string; path: string | null;
  line: number; column: number; lineContent: string;
  matchStart: number; matchEnd: number;
}
export interface TabGroup {
  tabId: string; tabTitle: string; path: string | null;
  count: number; matches: TextMatch[];
}
export function searchTabsText(tabs: readonly EditorTab[], query: string): TabGroup[];

// src/lib/editor-search-registry.ts
export function registerTabEditor(tabId: string, ed: editor.IStandaloneCodeEditor): void;
export function unregisterTabEditor(tabId: string): void;
export function getTabEditor(tabId: string): editor.IStandaloneCodeEditor | null;

// SearchTarget 扩展（src/lib/search-index.ts）
export interface SearchTarget {
  view: AppView; toolId?: string; anchor?: string; settingsMenu?: string;
  tabId?: string;      // 文本编辑器目标 tab
  textQuery?: string;  // 文本搜索跳转:编辑器内高亮用
}
```

## 设计风格

沿用现有全局搜索弹窗的视觉体系（居中浮层 max-w-3xl、深色主题、accent 高亮、平滑过渡），新增模式切换与 VSCode 风格文本结果列表：

- **模式切换**：搜索框前置两个胶囊 Tab「功能」「文本」，当前模式用项目 accent 色背景 + 文字高亮（参考 SettingsDialog 菜单激活态），切换时输入框内容清空并自动聚焦
- **功能模式**：保持现有分组结果列表不变
- **文本模式**：仿 VSCode 搜索面板 —— 每个文件为一个分组卡片（文件名 + 匹配数小徽章），下方匹配行按「行号 + 行内容」两列布局，行号用等宽字体与 muted 色，行内容中匹配片段用橙黄色背景 `<mark>` 高亮；空查询显示居中提示文案，无打开文件时显示引导
- **编辑器内高亮**：Monaco decoration 类 `.search-text-match` 使用 VSCode 搜索橙黄色半透明背景（rgba 234,92,0,0.38），深浅主题均清晰可见，跳转行滚动居中并聚焦选中
- 微交互：结果项 hover 背景变化、选中态 accent 指示、面板淡入缩放动画沿用现有 Dialog 行为

## Agent 扩展

### Skill

- **test-driven-development**
- Purpose: 为文本搜索纯函数、跳转分支与 SearchDialog 模式交互先写测试再实现，保证匹配规则、分组顺序与跳转行为可验证
- Expected outcome: editor-text-search / useSearchJump 文本分支 / SearchDialog 文本模式测试先行落地并通过
- **shadcn**
- Purpose: SearchDialog 模式切换与结果列表遵循项目现有 shadcn/ui 封装（Dialog、Command、badge）与 components.json 规范
- Expected outcome: 新增 UI 与现有组件风格一致，无样式回归
- **requesting-code-review**
- Purpose: 全部实现完成后派审查代理验证需求覆盖（范围/高亮/模式切换）、Monaco decoration 清理与无回归
- Expected outcome: 提交前完成一轮代码审查并修复发现的问题

### SubAgent

- **code-explorer**
- Purpose: 探索 EditorWorkbench 编辑器挂载/卸载时序与 Monaco 实例生命周期，确认 tabId 注册表接入点
- Expected outcome: 精确定位注册/注销代码位置，避免破坏现有 namingCaseCommand 注册表