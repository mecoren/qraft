---
name: upgrade-vscode-editor-workspace
overview: 将「文本编辑器」工具从单编辑器重建为 VSCode 风格工作区：左栏「打开的编辑器」列表 + 顶部多 Tab 切换 + 主区 Monaco 编辑器 + 右上操作栏 + 右下完整状态栏 + 语言选择。工作区元数据（含每个 Tab 的标题/语言/最近修改的路径等）通过新增 Tauri IPC 持久化到 app data dir；已打开的本地文件内容仅按需通过 `fs_read_file` 读取，不在内存中复制，仅未保存改动暂存在前端 store。Tab 与内容须在重新打开应用后自动恢复。
---

## 产品概述

将现有的「文本编辑器」工具（单文件、顶部 13 个语言按钮）重构为 **VSCode 风格的工作区编辑器**：左侧「打开的编辑器」列表 + 顶部多 Tab（每文件一个）+ 中央满屏 Monaco 编辑区 + 右下角状态栏（行/列、字符数、可点击切换语言），并支持打开/保存本地文本文件、跨应用重启持久化（Tab 列表与文件内容均保留）。

## 核心功能

- **多文件工作区**：任意时刻可在「打开的编辑器」里查看所有已打开 Tab，点击 Tab 或左侧条目均可激活
- **多 Tab 切换**：顶栏 Tab 横向排列，标题 + 文件未保存圆点 `•` + 关闭 × 按钮；活跃 Tab 视觉高亮（顶部 2px 主色条 + 加亮文本）
- **打开本地文件**：通过 `@tauri-apps/plugin-dialog` 弹原生「打开」对话框，拿到绝对路径后用 `fs_read_file` 读取，并自动推断语言（按扩展名映射 → Monaco language id）
- **保存**：已绑定路径的 Tab 直接 `fs_write_file`；未保存的脏 Tab 弹「另存为」对话框走 `fs_save_bytes` 或新建 path 走 `fs_write_file`
- **新建 untitled Tab**：独立空白 Tab（无 path），用户编辑后归类为脏；保存时弹保存对话框
- **关闭 Tab**：从顶栏 × 按钮或左侧右键菜单；激活态自动跳到相邻 Tab，关闭最后一个回到欢迎区
- **跨重启持久化**：Rust 端 `JsonConfigStore` 用 `editor_workspace_v1` 这个 key 存 `Workspace { tabs, activeTabId }`（包含每个 Tab 的 id/title/path/language/content/savedContent）；重启时 store 自动 hydrate 还原 Tab 列表与最近内容
- **语言切换**：底栏右下角语言徽章可点击，弹 Radix Dialog 列出全部已支持语言（含 Monaco 运行时注册的）；顶部快速栏保留 13 种常用语言快捷按钮（沿用现有 LANGUAGES）
- **状态栏**：左侧实时显示「行 N, 列 N / 已选择 K」；右侧显示字符数 + 当前语言徽章（点击打开语言选择器）
- **未保存标记**：编辑器 onChange 时把 Tab 标记 `dirty=true`，标题前显示 `•`；保存成功清 dirty 并同步 savedContent 快照
- **保持 VSCode 风格**：复用 `fixedTheme={VSCODE_THEME_NAME}`、行号、当前行高亮、括号配对着色、缩略图

## 边界

- **纯前端为主**，Rust 后端**无任何代码改动**：复用现有 `config_get_all` / `config_set` 持久化 workspace 元数据；复用 `fs_read_file` / `fs_write_file` / `fs_save_bytes` 做文件 IO；`fs.json` capabilities 已授权 `dialog:allow-open` / `dialog:allow-save`
- **不做完整文件资源管理器**：仅做「打开的编辑器」列表（用户文字重点强调），不做文件夹树/文件夹选择/文件监听
- **不做拆分编辑器 / 多窗口**
- **不做文件系统路径变更检测**：用户外部改名后重启读到新内容或报错提示
- 复用现有 `CodeEditor` UI 组件与 `VSCODE_THEME_NAME`，**完全不修改** `src/components/ui/code-editor.tsx`

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS（沿用项目既有技术栈）
- 编辑器内核：Monaco Editor 0.56（项目已有 `monaco-editor@^0.56.0` + `@monaco-editor/react@^4.7.0`，VSCode 编辑器内核，无需引入 microsoft/vscode 仓库）
- 状态管理：zustand 5（项目已用）
- UI 组件库：shadcn/Radix UI（项目已封装 `Dialog`/`Tabs`/`ScrollArea`/`Select`/`Tooltip` 等）
- 文件对话框：`@tauri-apps/plugin-dialog@^2.7.2`（package.json 已装，前端首次启用）
- 持久化：复用 Rust 端 `JsonConfigStore` + 前端 `safeInvoke('config_get_all' | 'config_set', ...)`，不新建独立 Store
- 测试：Vitest + Testing Library + jsdom（沿用既有测试栈）

## 实现方案

整体按「**数据层（schema + store）→ 表现层（UI 子组件）→ 整合层（主组件 + Tauri 集成）**」顺序推进，复用 `CodeEditor` UI 组件与 Rust `JsonConfigStore`/`fs` IPC：

### 1. 数据层

**`schema.ts`** 定义类型：

```ts
export type EditorLanguage = 'plaintext'|'json'|'html'|...  // 沿用 code-editor
export interface EditorTab {
  id: string;                 // UUID
  title: string;              // 顶栏/左栏显示名（filename 或 untitled-N）
  path: string | null;        // 本地文件绝对路径；untitled 时为 null
  language: EditorLanguage;
  content: string;            // 当前文本（含未保存改动）
  savedContent: string;       // 上次保存的快照，对比得 dirty
}
export interface Workspace {
  tabs: EditorTab[];
  activeTabId: string | null;
  leftSidebarVisible: boolean;
}
export const DEFAULT_WORKSPACE: Workspace = { tabs: [], activeTabId: null, leftSidebarVisible: true };
```

**`languageMap.ts`** 扩展名 → 语言 id 映射（如 `.json` → `'json'`, `.ts` → `'typescript'`, `.md` → `'markdown'`, `.py` → `'plaintext'`, 等等）；并导出顶栏快捷栏用的 `LANGUAGES` 常量。

**`useEditorWorkspaceStore.ts`** zustand store：

- 状态：`workspace: Workspace`，`ready: boolean`（标记是否已从 IPC hydrate）
- 动作：`openLocalFile(path, content)` / `newBlankTab()` / `closeTab(id)` / `switchTab(id)` / `setTabContent(id, content)` / `setTabLanguage(id, lang)` / `saveTab(id, content)` / `toggleLeftSidebar()` / `persistNow()`
- **持久化策略**：store **不挂 `persist` 中间件**，而是依赖一个 `useEffect([workspace])` 在 `ready` 之后每次 workspace 变更调用 `safeInvoke('config_set', { key: 'editor_workspace_v1', value: workspace })`；启动时调用 `loadConfig()` 后用 `config.toolPrefs.editor_workspace_v1`（或顶层 key）还原
- 实际上为了避免破坏 `DEFAULT_USER_CONFIG` 的 TS 形状，可以新增独立 IPC（但避免）—— 选用最简方案：在 `config_get_all` 返回的顶层 UserConfig 上加一个 optional `editor_workspace_v1?: Workspace` 字段；不需要 Rust 改动，因为 `config_get_all` 直接返回 JSON 序列化对象，前端 TypeScript 类型放宽即可。或者在 store 端用 `Record