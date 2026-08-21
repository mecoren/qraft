---
name: qraft-global-search
overview: 为 Qraft 新增 VSCode 风格的全局搜索功能：弹窗式大搜索面板，Ctrl+Shift+F（可配置）唤起，可搜索所有工具/功能内的文本内容，点击结果跳转到对应工具内部位置并高亮。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 弹窗浮层
    - 分组结果列表
    - 深色主题
    - accent 高亮
    - 平滑微动画
    - 键盘导航
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
      - var(--sidebar-primary)
      - var(--destructive)
todos:
  - id: search-infra
    content: 新增 search-index.ts（工具/区块/设置/页面条目 + searchIndex）、searchStore、useSearchJump hook、高亮 CSS，并在 config.ts 新增 global_search 快捷键（默认 Ctrl+Shift+F）
    status: completed
  - id: search-tests
    content: 用 [skill:test-driven-development] 编写并跑通 search-index 与 searchStore 单元测试
    status: completed
    dependencies:
      - search-infra
  - id: search-dialog
    content: 实现 SearchDialog 弹窗搜索面板（分组结果/键盘导航/面包屑），接入 App 快捷键与 Esc 关闭，遵循 [skill:shadcn] 组件规范
    status: completed
    dependencies:
      - search-infra
      - search-tests
  - id: anchor-marking
    content: 为 ConfigSection/ConfigRow/CodeEditor 增加 searchAnchor prop，并为全部工具组件、WelcomePage/ExtensionsPage 标注锚点
    status: completed
    dependencies:
      - search-infra
  - id: settings-jump
    content: SettingsPanel 增加「全局搜索」快捷键项并标注设置字段锚点，SettingsDialog 订阅 searchStore 切换菜单并定位高亮
    status: completed
    dependencies:
      - search-infra
  - id: verify-polish
    content: 补齐 SearchDialog 交互测试，运行 lint/typecheck/test 全量验证，并用 [skill:requesting-code-review] 审查改动
    status: completed
    dependencies:
      - search-dialog
      - anchor-marking
      - settings-jump
---

## 产品概述

新增全局搜索功能（参考 VSCode 全局搜索）：可搜索当前应用所有功能的文本内容，包括工具名称/描述/关键词、工具内部区块标题（配置/输入/输出）、配置项标签、操作按钮文字、设置分区与字段、应用页面标题。点击搜索结果即可跳转到对应工具栏的具体位置并高亮，视觉风格符合项目现有样式体系。

## 核心功能

- 弹窗式大搜索面板：居中浮层，顶部搜索框 + 分组结果列表（工具 / 工具区块 / 设置 / 页面），参考 VSCode 搜索结果布局，不挤占主布局
- 搜索覆盖全量功能文本：全部工具目录条目、每个工具内部主要区块与操作、设置 6 大分区及主要设置字段、应用页面（欢迎/历史/管理扩展/关于）
- 点击结果跳转 + 高亮：打开对应工具并滚动到目标区块（配置区、输入/输出编辑器、操作按钮等），目标元素短暂高亮闪烁后自动消退
- 快捷键：Ctrl+Shift+F 打开全局搜索，Esc 关闭；快捷键加入「设置 → 快捷键」面板，可自定义或禁用（沿用项目 ShortcutBinding 惯例）
- 键盘交互：结果列表支持 ↑↓ 方向键导航 + Enter 跳转，结果项展示归属面包屑（工具名 → 区块名）

## 技术栈

- 复用现有栈：React 19 + TypeScript + Tailwind v4 + shadcn/ui 风格组件 + zustand + vitest（不引入新依赖）
- 弹窗与输入框复用现有 `Dialog`/`Command`（cmdk）封装（`src/components/ui/dialog.tsx`、`command.tsx`），与 CommandPalette 保持一致的交互模式

## 实现方案

### 1. 搜索索引（静态声明，`src/lib/search-index.ts` [NEW]）

- 定义 `SearchEntry`：`{ id, kind: 'tool' | 'tool-section' | 'setting' | 'setting-field' | 'page', title, description?, keywords?, group, target }`
- `target` 结构：`{ view: AppView, toolId?, anchor?（完整锚点值 `${toolId}:${anchorKey}`）, settingsMenu? }`
- 条目来源：
- 工具级：由 `TOOL_CATALOG` 自动生成（name/description/keywords，含 special 页面）
- 工具区块级：`TOOL_ANCHORS` 静态清单，为每个工具声明 配置/输入/输出/关键操作按钮 锚点
- 设置级：`SETTING_ENTRIES` 声明 6 大分区（主题/字体/通用/文本编辑器/快捷键/更新）及主要字段
- 页面级：欢迎/历史/管理扩展/关于
- `searchIndex(query)`：大小写不敏感过滤，按 kind 分组返回，模块加载时预构建索引 Map，线性扫描（条目约 150 条，无性能压力）

### 2. 跳转与高亮机制

- `src/store/searchStore.ts` [NEW]：`{ target: SearchTarget | null, requestJump(t), consume() }`，作为跨组件跳转信令（SearchDialog → App/SettingsDialog）
- `src/hooks/useSearchJump.ts` [NEW]：App 挂载。订阅 target → `openTool`/`setView`/`SettingsDialog` 切菜单 → 等待目标渲染（requestAnimationFrame + setTimeout 兜底，适配 ToolPanel keepalive 的 display:none 切换）→ `document.querySelector('[data-search-anchor="..."]')` → `scrollIntoView({ block: 'center' })` → 添加高亮类 → 约 2s 后移除
- 高亮样式：`src/index.css` 新增 `.search-anchor-highlight`（主题色 ring + 背景闪烁 keyframes，使用项目 `--primary` token）

### 3. 锚点标注

- 统一组件增加可选 `searchAnchor` prop（渲染 `data-search-anchor`）：`ConfigSection`/`ConfigRow`（`src/components/config-card.tsx`）、`CodeEditor`（`src/components/ui/code-editor.tsx`）
- 各工具组件为声明过的锚点传值 `searchAnchor={`${toolId}:input`}` 等；SettingsPanel 各设置字段 Label/控件加锚点
- 锚点值全局唯一（`${toolId}:${anchorKey}`），避免跨工具/跨页面冲突

### 4. 搜索面板 `src/components/SearchDialog.tsx` [NEW]

- Dialog 大面板（max-w-3xl，参考 CommandPalette 结构）：顶部搜索框（放大镜图标 + 输入 + 快捷键提示），下方按 kind 分组的结果列表
- 结果项：图标 + 标题 + 描述 + 归属面包屑（分类/工具名 → 区块名）；选中态高亮；底部提示条（↑↓ 导航 / Enter 打开 / Esc 关闭）
- 键盘：↑↓ 循环导航、Enter 跳转、Esc 关闭（Radix Dialog 内置）；输入防抖 80ms 避免每键重扫

### 5. 快捷键接入

- `src/types/config.ts`：`ShortcutBinding` 新增 `global_search: string`，`DEFAULT_SHORTCUTS.global_search = 'Ctrl+Shift+F'`
- `src/components/SettingsPanel.tsx`：`SHORTCUT_KEYS` 新增「全局搜索」项（含 ShortcutInput 捕获，可清空禁用）
- `src/App.tsx`：`useShortcut('global_search', () => setSearchOpen(true))`，Esc 关闭已有 close_panel 逻辑需同步（优先级：SearchDialog 打开时优先关闭它）

### 6. 测试（遵循现有 vitest + testing-library 约定）

- `src/lib/search-index.test.ts` [NEW]：索引完整性（所有工具/区块/设置/页面可检索）、大小写/关键词匹配、分组正确
- `src/components/SearchDialog.test.tsx` [NEW]：打开/关闭、输入过滤、键盘导航、选择后触发 requestJump 与视图切换

## 性能与可靠性

- 索引静态构建 + 线性匹配，无重复遍历；结果列表量小，无需虚拟化
- 高亮定位单次 DOM 查询；锚点不存在时静默降级（仅跳转工具不定位），不报错
- 与现有 `Ctrl+F`（search，pending 未实现）不冲突；`Ctrl+Shift+F` 无现有绑定
- 所有修改向后兼容（新增可选 prop/枚举成员），不触碰无关逻辑

## 目录结构

```
src/
├── lib/
│   └── search-index.ts           # [NEW] 搜索索引：SearchEntry 类型、TOOL_ANCHORS/SETTING_ENTRIES 声明、searchIndex(query)
├── store/
│   └── searchStore.ts            # [NEW] 跳转信令 store：requestJump/consume
├── hooks/
│   └── useSearchJump.ts          # [NEW] 跳转+高亮 hook：切视图/切菜单 → 等渲染 → scrollIntoView + 高亮类
├── components/
│   ├── SearchDialog.tsx          # [NEW] 弹窗式全局搜索面板（分组结果/键盘导航/面包屑）
│   ├── SearchDialog.test.tsx     # [NEW] 交互测试
│   ├── config-card.tsx           # [MODIFY] ConfigSection/ConfigRow 增加 searchAnchor prop
│   ├── SettingsPanel.tsx         # [MODIFY] SHORTCUT_KEYS 加「全局搜索」；设置字段加锚点
│   ├── SettingsDialog.tsx        # [MODIFY] 订阅 searchStore 切换左侧菜单并定位
│   └── ui/code-editor.tsx        # [MODIFY] CodeEditor 增加 searchAnchor prop
├── tools/                        # [MODIFY] 各工具组件为区块标注 searchAnchor（约 30 个）
│   ├── JsonFormatter.tsx / Base64Codec.tsx / TextProcessor.tsx / NumberBaseConverter.tsx /
│   │   PasswordGenerator.tsx / TimestampConverter.tsx / CodeEditor.tsx（工作区）等
├── pages/
│   ├── WelcomePage.tsx           # [MODIFY] 分区标题加锚点（最近使用/收藏夹/所有工具）
│   └── ExtensionsPage.tsx        # [MODIFY] 分区标题加锚点（内置扩展/第三方扩展）
├── App.tsx                       # [MODIFY] 挂载 SearchDialog + useSearchJump + global_search 快捷键
├── types/config.ts               # [MODIFY] ShortcutBinding 新增 global_search + 默认值
└── index.css                     # [MODIFY] .search-anchor-highlight 高亮动画
```

## 关键结构

```ts
// src/lib/search-index.ts
export type SearchEntryKind = 'tool' | 'tool-section' | 'setting' | 'setting-field' | 'page';
export interface SearchTarget {
  view: AppView;            // 'tool' | 'welcome' | 'settings' | 'history' | 'extensions' | 'about'
  toolId?: string;          // view === 'tool' 时必填
  anchor?: string;          // 完整锚点值 "${toolId}:${anchorKey}" 或设置字段锚点
  settingsMenu?: MenuId;    // 设置弹窗目标菜单（theme/font/general/editor/shortcuts/update）
}
export interface SearchEntry {
  id: string;
  kind: SearchEntryKind;
  title: string;
  description?: string;
  keywords: string[];
  group: string;            // 分组标题（分类名/工具名/分区名）
  target: SearchTarget;
}
export function searchIndex(query: string): Map<SearchEntryKind, SearchEntry[]>;
```

## 设计风格

弹窗式大搜索面板，参考 VSCode 全局搜索的布局层次，同时贴合项目现有的 DevToys 风格深色主题体系。面板以 Radix Dialog 浮层承载，宽度约 max-w-3xl，顶部为搜索输入区（放大镜图标 + 输入框 + 右侧快捷键提示），下方为按「工具 / 工具区块 / 设置 / 页面」分组的滚动结果列表；每组带小号分组标题，结果项由图标、标题、描述、右侧归属面包屑组成，选中项使用项目 accent 色背景 + 左侧指示条高亮；底部固定提示条展示键盘操作说明。打开/关闭使用项目现有 Dialog 的淡入缩放动画。高亮跳转时目标元素呈现主题色 ring 包裹 + 背景短暂闪烁动画，随后自动消退，与现有 sidebar 激活指示条的渐变风格一致。

## Agent 扩展

### Skill

- **test-driven-development**
- Purpose: 在实现搜索索引与跳转逻辑前先编写测试，保证索引完整性、匹配规则与跳转行为可验证
- Expected outcome: searchIndex 单元测试与 SearchDialog 交互测试先行落地并通过
- **shadcn**
- Purpose: 弹窗与结果列表复用/调整 shadcn 风格组件（Dialog、Command），遵循项目 components.json 规范
- Expected outcome: SearchDialog 组件与项目现有 shadcn/ui 封装风格一致，无样式回归
- **requesting-code-review**
- Purpose: 全部实现完成后审查改动，验证需求覆盖、样式一致性与无回归
- Expected outcome: 提交前完成一轮代码审查并修复发现的问题