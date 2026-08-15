---
name: editor-context-menu
overview: 为文本编辑器工作区的顶栏 Tab、左栏「打开的编辑器」列表接入 shadcn ContextMenu 右键菜单（含关闭/保存/复制路径/固定/在文件资源管理器中显示等 MVP 项），并将 Monaco 编辑器区原生右键菜单通过 CSS 改造为 shadcn 风格。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - VSCode 风格
    - shadcn 组件规范
    - popover 浮层
    - 紧凑列表
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 13px
      weight: 500
    subheading:
      size: 12px
      weight: 400
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#3B82F6"
      - "#60A5FA"
    background:
      - var(--popover-layer)
      - var(--background)
      - var(--card)
    text:
      - var(--popover-foreground)
      - var(--muted-foreground)
    functional:
      - var(--accent)
      - var(--destructive)
      - var(--border)
todos:
  - id: setup-context-menu
    content: 使用 [skill:shadcn] 安装 @radix-ui/react-context-menu 并新建 context-menu.tsx 组件
    status: completed
  - id: schema-pinned-store
    content: 使用 [skill:test-driven-development] 扩展 schema 增加 pinned 字段并实现 store 批量关闭动作
    status: completed
  - id: rust-reveal
    content: 新增 Rust fs_reveal_in_explorer 命令并注册，fileOps.ts 增加前端封装
    status: completed
  - id: tab-menu-tabsbar
    content: 新建共享 TabContextMenu 组件并接入 EditorTabsBar（pinned 排序与图标）
    status: completed
    dependencies:
      - setup-context-menu
      - schema-pinned-store
  - id: sidebar-workbench
    content: EditorLeftSidebar 接入右键菜单，EditorWorkbench 接线处理器并扩展 UnsavedDialog 批量确认
    status: completed
    dependencies:
      - tab-menu-tabsbar
      - rust-reveal
  - id: monaco-menu-style
    content: 在 globals.css 中将 Monaco 编辑器右键菜单样式改造为 shadcn 风格
    status: completed
  - id: tests-review
    content: 补充 store 与组件测试、lint/typecheck，使用 [skill:requesting-code-review] 审查改动
    status: completed
    dependencies:
      - schema-pinned-store
      - sidebar-workbench
      - monaco-menu-style
---

## 产品概述

为文本编辑器工作区（VSCode 风格多文件编辑器）的**标签 Tab 栏**、**左侧「打开的编辑器」文件列表**、**编辑器页面**三处添加右键菜单支持，使用 shadcn Context Menu 组件进行改造，交互与视觉对齐 VSCode 右键菜单。

## 核心功能

- **Tab 栏右键菜单**（参考 Tab 截图）：关闭、关闭其他、关闭右侧、关闭已保存、全部关闭、固定/取消固定、在文件资源管理器中显示、复制路径、复制相对路径（置灰）、保存（显示 Ctrl+S 快捷键）。
- **文件列表右键菜单**（参考文件列表截图）：与 Tab 菜单共用同一套菜单项，作用于被右键的文件，含关闭按钮、未保存标记、hover 交互保留。
- **编辑器页面**：保留 Monaco 原生右键菜单功能，仅将其视觉样式改造为 shadcn 风格（圆角、边框、popover 背景、hover 高亮、快捷键配色）。
- **固定（Pinned）Tab**：支持固定/取消固定，固定 Tab 显示 Pin 图标并排在最前，且**不被**「全部关闭/关闭其他/关闭右侧/关闭已保存」批量关闭（对齐 VSCode 语义），只能显式逐 Tab 关闭。
- **在文件资源管理器中显示**：新增后端命令，跨平台（Windows `explorer /select`、macOS `open -R`、Linux `xdg-open`）在系统文件管理器中定位该文件。
- **未保存确认**：批量关闭（关闭其他/关闭右侧/全部关闭）涉及未保存 Tab 时弹出确认对话框，保存/放弃/取消流程与现有行为一致。
- **不实现**：「重新打开编辑器的方式」「拆分/移动到新窗口」「将文件添加到聊天」等无底层能力的菜单项不显示，避免无效菜单。

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS v4 + tw-animate-css（沿用现有工程）
- 组件：shadcn Context Menu —— `pnpm add @radix-ui/react-context-menu` + 新建 `src/components/ui/context-menu.tsx`（参照现有 `dropdown-menu.tsx` 风格与 shadcn 官方文档 API）
- 后端：Tauri 2 + Rust（新增 `fs_reveal_in_explorer` 命令，`std::process::Command` 平台差异化实现，不引入新依赖）

## 实现方案

### 1. shadcn context-menu 组件接入

新建 `src/components/ui/context-menu.tsx`，导出 `ContextMenu / ContextMenuTrigger / ContextMenuContent / ContextMenuItem / ContextMenuCheckboxItem / ContextMenuLabel / ContextMenuSeparator / ContextMenuShortcut / ContextMenuPortal / ContextMenuGroup`。样式沿用 `dropdown-menu.tsx` 的既有约定：`bg-popover-layer`、`border`、`rounded-md`、`shadow-md`、`data-[state=open]:animate-in` 动画类、`[&_svg]:size-4` 图标类。

### 2. 数据模型扩展（固定 Tab）

`src/tools/code-editor-workspace/schema.ts` 的 `EditorTab` 增加 `pinned: boolean`（默认 false）；`sanitizeTab` 对缺失字段回退 `false`，保证旧持久化数据兼容。
`useEditorWorkspaceStore.ts` 新增动作：

- `togglePinTab(id)`：切换固定状态
- `closeOtherTabs(id)` / `closeRightTabs(id)` / `closeSavedTabs()`：批量关闭，**均跳过 pinned Tab**（对齐 VSCode：固定 Tab 只能显式关闭）；`closeAllTabs()` 同步改为跳过 pinned
- 说明：MVP 简化，「关闭右侧」按数组打开顺序计算并跳过 pinned（VSCode 按视觉顺序，固定 Tab 前置时会略有差异，属可接受取舍）

### 3. 后端「在文件资源管理器中显示」

`src-tauri/src/commands/fs.rs` 新增 `fs_reveal_in_explorer(path)`（含可测试的 inner 函数）：

- Windows：`explorer /select,<path>`（路径经 `Command::arg` 传递，天然处理空格）
- macOS：`open -R <path>`
- Linux：`xdg-open <父目录>`
- 仅揭示文件位置、不读写文件，不要求 AuthorizedPaths 授权，失败返回 `AppError`；在 `src-tauri/src/lib.rs` 的 `invoke_handler` 注册；前端 `fileOps.ts` 增加 `revealInExplorer(path)` 封装。

### 4. 共享右键菜单组件

新建 `src/tools/code-editor-workspace/TabContextMenu.tsx`，供 Tab 栏与文件列表复用同一套菜单。Props 传入目标 `tab`、全部 handlers（关闭/关闭其他/关闭右侧/关闭已保存/全部关闭/保存/固定/资源管理器/复制路径）与 `children`（触发元素），内部用 `ContextMenuTrigger asChild` 包裹。菜单项：

- 关闭 / 关闭其他 / 关闭右侧 / 关闭已保存 / 全部关闭（分隔线）
- 固定（`ContextMenuCheckboxItem checked={pinned}`，VSCode 勾选式）
- 在文件资源管理器中显示（`path` 为 null 时 disabled）
- 复制路径（`path` 为 null 时 disabled）、复制相对路径（始终 disabled，项目无工作区根目录概念）
- 分隔线、保存（`ContextMenuShortcut` 显示 Ctrl+S，对应真实绑定 `save_file`；其余项无真实快捷键，不显示伪快捷键）

### 5. Tab 栏与文件列表接入

`EditorTabsBar.tsx`：每个 Tab 外包 `TabContextMenu`；渲染时 `useMemo` 将 pinned Tab 排前；pinned Tab 显示 Pin 图标（lucide `Pin`），原有点击选中、中键关闭、dirty 圆点、hover 关闭按钮行为不变。
`EditorLeftSidebar.tsx`：每个列表项包 `TabContextMenu`（`ContextMenuTrigger asChild` 挂到列表按钮上，避免 button 嵌套），原交互不变。

### 6. 工作区接线与未保存确认

`EditorWorkbench.tsx` 实现各 handler（复用现有 `saveTabById` / `requestCloseTab` / `requestCloseAll` 逻辑）；复制路径用 `writeClipboardText` + toast 提示；批量关闭（关闭其他/右侧/全部）涉及 dirty Tab 时弹确认——扩展 `UnsavedDialog.tsx` 新增 `close-batch` 模式（复用现有弹窗结构，discard 后按 Workbench 记录的意图执行对应批量动作），`close-saved` 只关干净 Tab 无需确认。

### 7. Monaco 右键菜单样式 shadcn 化

`src/styles/globals.css` 中覆盖 Monaco 原生 context menu DOM 类（`.monaco-menu-container` / `.monaco-menu` / `.monaco-action-bar .action-item` / `.action-label` / `.keybinding` / `.separator`）：圆角、`bg-popover-layer` 背景、边框、hover 高亮（accent）、快捷键弱化配色，与 shadcn 视觉统一。不新增自定义菜单逻辑，保留 Monaco 原生右键功能。

## 架构设计

```
┌────────────────────────── EditorWorkbench ──────────────────────────┐
│  handlers(关闭/保存/固定/批量关闭/reveal/复制路径) + UnsavedDialog  │
└───────────────┬──────────────────────────────┬──────────────────────┘
        TabContextMenu(共享菜单内容)    │             │
        ▲                 ▲            │             │
   EditorTabsBar    EditorLeftSidebar  │       CodeEditor(Monaco)
   (pinned 排序/图标)  (文件列表)       │        └─ 原生右键,仅样式覆盖
        └────────────────┴────────────┴────────► store(zustand)
                    │                          (pinned / 批量关闭动作)
                    └────► fileOps ──► Rust fs_reveal_in_explorer
```

## 目录结构

```
src/
├── components/ui/
│   └── context-menu.tsx          # [NEW] shadcn ContextMenu 组件(参照 dropdown-menu.tsx + 官方文档 API)
├── tools/code-editor-workspace/
│   ├── schema.ts                 # [MODIFY] EditorTab 增加 pinned:boolean;sanitizeTab 回退 false
│   ├── useEditorWorkspaceStore.ts# [MODIFY] togglePinTab/closeOtherTabs/closeRightTabs/closeSavedTabs;closeAllTabs 跳过 pinned
│   ├── useEditorWorkspaceStore.test.ts # [MODIFY] 新增 pinned 与批量关闭动作单测
│   ├── TabContextMenu.tsx        # [NEW] 共享右键菜单组件(Tab 栏/文件列表复用)
│   ├── EditorTabsBar.tsx         # [MODIFY] 接入 TabContextMenu;pinned 排序与 Pin 图标
│   ├── EditorLeftSidebar.tsx     # [MODIFY] 接入 TabContextMenu
│   ├── EditorWorkbench.tsx       # [MODIFY] 菜单 handlers 接线;批量关闭意图 + 确认
│   ├── UnsavedDialog.tsx         # [MODIFY] 新增 close-batch 模式(批量关闭确认)
│   └── fileOps.ts                # [MODIFY] 新增 revealInExplorer(path) 封装
├── styles/globals.css            # [MODIFY] Monaco 原生右键菜单样式 shadcn 化
src-tauri/src/
├── commands/fs.rs                # [MODIFY] 新增 fs_reveal_in_explorer(平台差异化 + 可测试 inner)
└── lib.rs                        # [MODIFY] invoke_handler 注册新命令
package.json                      # [MODIFY] 增加 @radix-ui/react-context-menu 依赖
```

## 关键接口

```ts
// schema.ts 扩展
interface EditorTab {
  // ...现有字段
  pinned: boolean; // 固定 Tab,不会被批量关闭;旧数据 sanitize 回退 false
}

// useEditorWorkspaceStore.ts 新动作
togglePinTab: (id: string) => void;
closeOtherTabs: (id: string) => void;   // 跳过 pinned
closeRightTabs: (id: string) => void;   // 按数组顺序,跳过 pinned
closeSavedTabs: () => void;             // 只关 content === savedContent 且非 pinned

// TabContextMenu.tsx
interface TabContextMenuProps {
  tab: EditorTab;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseSaved: () => void;
  onCloseAll: () => void;
  onTogglePin: () => void;
  onSave: () => void;
  onRevealInExplorer: () => void;
  onCopyPath: () => void;
  children: React.ReactNode; // ContextMenuTrigger asChild 包住的触发元素
}
```

```rust
// src-tauri/src/commands/fs.rs
#[tauri::command]
pub async fn fs_reveal_in_explorer(
    path: String,
) -> Result<CommandResponse<()>, AppError> {
    fs_reveal_in_explorer_inner(&path)
}
```

## 设计风格

采用 VSCode 风格右键菜单 + shadcn 组件视觉规范。菜单面板使用 `bg-popover-layer` 背景、细边框、圆角与柔和阴影，菜单项 hover 高亮（accent 色）、图标与文字对齐、快捷键右对齐弱化显示，分隔线分隔分组。Tab 栏与文件列表的右键菜单共用同一视觉体系，固定 Tab 以 Pin 图标 + 前置排序体现状态。Monaco 编辑器右键菜单通过 CSS 变量覆盖实现同款 shadcn 视觉，保证三处右键菜单视觉统一。

## Agent Extensions

### Skill

- **shadcn**
- Purpose: 按 shadcn 标准流程添加 Context Menu 组件（安装依赖、生成 `context-menu.tsx` 并核对官方 API）
- Expected outcome: 新增组件与现有 dropdown-menu.tsx 风格一致，API 与 shadcn 文档对齐，可被 Tab/列表/编辑器样式复用
- **test-driven-development**
- Purpose: 为 store 的 pinned 与批量关闭动作先写测试再实现，保证固定 Tab 语义正确
- Expected outcome: useEditorWorkspaceStore.test.ts 覆盖 togglePinTab/closeOtherTabs/closeRightTabs/closeSavedTabs/closeAllTabs 跳过 pinned 的行为
- **requesting-code-review**
- Purpose: 全部实现完成后对改动进行代码审查，验证菜单交互、固定语义与样式改造符合需求
- Expected outcome: 发现并修正边界问题（如 pinned 与未保存确认的交互、菜单 disabled 逻辑、Monaco 样式覆盖遗漏）