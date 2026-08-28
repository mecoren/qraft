# 工具弹出新窗口（Tool Pop-out Window）实施计划

## Summary

为 Qraft 的全部工具增加「在新窗口打开」能力（对标 DevToys 2.0 的 pop-out 行为）：主窗口保持不变，任意工具可弹出为独立 OS 窗口；弹出窗口是**快照式独立实例**（打开时从 localStorage 持久层载入状态，窗口间不实时同步，各自写回持久层，最后写入者胜出）。提供三处触发入口（标题栏按钮、命令面板、侧栏右键菜单），窗口尺寸按工具可配置，Tauri 与 Web 两种运行模式均可工作并处理失败场景。

## 用户已确认的决策

1. **状态一致性**：快照式独立窗口（DevToys 模式），不做实时双向同步。
2. **触发入口**：标题栏按钮 + 命令面板 + 侧栏右键菜单，三处。
3. **文档**：实现前在 `prd/tool-popout-window/` 生成 requirements.md + design.md。

## 研究结论（同类实现）

- **DevToys 2.0**：工具标题栏提供 pop-out 图标按钮；新窗口是完全独立的应用实例，各自持有状态、互不实时同步；与本项目「工具目录 + 懒加载注册表」架构天然契合。
- **Tauri v2 多窗口**：运行时经 `WebviewWindow`（`@tauri-apps/api/webviewWindow`）创建窗口并加载同源 URL；同源下多窗口**共享 localStorage**，且 zustand persist 的工具 store 在挂载时自动从 localStorage 水合 —— 这正是「快照式」可以零侵入实现的原因（工具组件现有 hydrate 逻辑不变）。
- **权限模型**：Tauri capability 按窗口 label 匹配，新窗口 label 必须被某 capability 的 `windows` 数组覆盖，否则 IPC 全部失效（现有 9 个 capability 均只含 `main`）。

## Current State Analysis

- 单窗口 Tauri v2 应用（`src-tauri/tauri.conf.json` 仅 `main` 窗口），React 19 + zustand。
- 工具注册：[registry.ts](file:///c:/Develop/project/00_AI/qraft/src/tools/registry.ts) 全量懒加载注册 40+ 工具，`getToolComponent(toolId)` 查找；渲染契约 `ToolProps { toolId, metadata }`。
- 渲染：[ToolPanel.tsx](file:///c:/Develop/project/00_AI/qraft/src/components/ToolPanel.tsx) keepalive 挂载；[App.tsx](file:///c:/Develop/project/00_AI/qraft/src/App.tsx) 全局订阅 `tool_progress/chunk/completed/failed`（后端工具的流式结果依赖它）与 `config_changed`。
- 元数据：[tool-catalog.ts](file:///c:/Develop/project/00_AI/qraft/src/lib/tool-catalog.ts) `CatalogEntry`（id/name/description/category/icon/keywords/backendId/special）。
- 入口：Titlebar 左段展示当前工具名 + ToolMenuBar；CommandPalette 按 `TOOL_CATALOG` 列工具；Sidebar 工具项有 ContextMenu（收藏/排序）。
- 持久化：各工具 store + uiStore 均为 zustand persist → localStorage，同源共享。
- 启动：[main.tsx](file:///c:/Develop/project/00_AI/qraft/src/main.tsx) 固定渲染 `App`，无按 URL 分支。
- 自定义标题栏体系已存在：`WindowControls`（min/max/close，含 aria-label）、`data-tauri-drag-region` 拖拽，可直接复用。

## Proposed Changes

### 0. PRD 文档（先行，用户已确认）

新建 `prd/tool-popout-window/requirements.md` 与 `design.md`（中文），内容：需求理解、关键技术决策（快照式一致性 / WebviewWindow 运行时建窗 / capability 扩展）、实现步骤、边界条件与风险（多窗口同 key 并发写、Monaco 在多窗口的内存开销、文件关联事件只进主窗口等）。

### 1. 弹窗核心模块（新建 `src/lib/popout-window.ts`）

- `openToolInNewWindow(toolId: string): Promise<void>`：
  - **Tauri 模式**（`'__TAURI_INTERNALS__' in window`）：
    - 窗口 label = `popout-${toolId}`（每工具单实例）。
    - 已存在 → `unminimize()` + `setFocus()` 聚焦复用，不重复创建。
    - 不存在 → `new WebviewWindow(label, { url: 'index.html?popout=<toolId>', title: 工具名, width/height: 取目录 `popoutSize` ?? 默认 900×640, minWidth: 480, minHeight: 360, center: true, resizable: true })`。
    - 创建失败（Promise reject）→ `toast.error`（i18n: `chrome.toast.popout_failed`）。
  - **Web 模式**（无 Tauri）：`window.open` 新标签页/窗口；返回 `null`（被浏览器拦截）→ `toast.warning`（i18n: `chrome.toast.popout_blocked`）。
  - 函数内用动态 `import('@tauri-apps/api/webviewWindow')` 保证纯 Web 构建不引入 Tauri 运行时依赖。

### 2. Tauri 权限扩展

- [default.json](file:///c:/Develop/project/00_AI/qraft/src-tauri/capabilities/default.json)（main 窗口权限）追加：`core:webview:allow-create-webview-window`、`core:window:allow-set-focus`。
- 全部 9 个 capability 文件（tool/fs/clipboard/shell/dialog/config/history/ip/updater）的 `windows` 数组追加 `"popout-*"`，使弹窗窗口获得与主窗口一致的 IPC 权限（工具执行、剪贴板、文件读写均需）。

### 3. 弹窗启动分支（新建 `src/PopoutApp.tsx` + 改 `main.tsx`）

- `main.tsx`：解析 `?popout=<toolId>`，校验 `TOOL_CATALOG` 存在且非 `special` → 渲染 `PopoutApp`，否则渲染 `App`。主题/字体/平台类/i18n 初始化逻辑共用（渲染前执行，现有代码位置不变）。
- `PopoutApp`（轻量根组件，结构对齐 App 但只保留弹窗所需）：
  - 最小标题栏：工具图标 + 名称（`pickText`）+ `data-tauri-drag-region` + 复用 `WindowControls`（装饰关闭 `decorations: false`，与主窗口视觉一致）。
  - 工具区：`createElement(getToolComponent(toolId), { toolId, metadata: catalogToMetadata(entry) })` + Suspense 加载态（复用 ToolPanel 的视觉语言）。
  - 订阅 `tool_progress/tool_chunk/tool_completed/tool_failed` + `config_changed`（后端工具的流式回调与语言/主题热更新必需）；**不订阅** `app:open-file`、不挂 Sidebar/CommandPalette/快捷键/Smart Detection。
  - 未识别 toolId → 居中提示（复用 `chrome.tool_panel.not_found`）。

### 4. 三处触发入口

- [Titlebar.tsx](file:///c:/Develop/project/00_AI/qraft/src/components/layout/Titlebar.tsx)：`entry && ToolIcon` 分支内、工具名（或 ToolMenuBar）右侧加图标按钮（lucide `ExternalLink`），`aria-label`/Tooltip 用 `chrome.titlebar.popout`，点击 `openToolInNewWindow(currentToolId)`；非工具视图不渲染。
- [CommandPalette.tsx](file:///c:/Develop/project/00_AI/qraft/src/components/CommandPalette.tsx)：新增动作项「在新窗口打开当前工具」（`chrome.palette.popout_current`），置于工具组之前，`currentToolId` 为空时隐藏 —— 提供纯键盘路径。
- [Sidebar.tsx](file:///c:/Develop/project/00_AI/qraft/src/components/layout/Sidebar.tsx) `ToolContextMenuContent`：非 `special` 工具追加「在新窗口打开」菜单项（`chrome.sidebar.popout`）。

### 5. 每工具窗口尺寸（改 `tool-catalog.ts`）

- `CatalogEntry` 增加可选字段 `popoutSize?: { width: number; height: number }`。
- 仅为明显需要大空间的工具配置：`text_compare` / `text_editor` 1100×720、`markdown_preview` 1000×720；其余走默认 900×640。尺寸为 Tauri 逻辑像素，随系统 DPI 自适应；窗口可缩放 + minWidth/minHeight 兜底，工具组件本身已是 flex 响应式布局。

### 6. i18n（改 `src/i18n/locales/zh-CN.json` + `en-US.json`）

新增 5 个 `chrome.*` 键：`chrome.titlebar.popout`（在新窗口打开）、`chrome.palette.popout_current`、`chrome.sidebar.popout`、`chrome.toast.popout_failed`、`chrome.toast.popout_blocked`（弹窗被浏览器拦截提示）。

## 假设与边界

- **每工具单实例**：重复弹出已打开的工具 = 聚焦已有窗口（DevToys 同行为）。
- **状态一致性边界**（用户已确认快照式）：多窗口同时编辑同一工具，各自写回 localStorage，最后写入者胜出；不做实时同步，设计文档中明示。
- **Monaco 内存**：弹窗是独立 WebView 进程级实例，长会话开多个重型工具窗口会增加内存 —— 属预期行为，不做限制。
- **文件关联/拖放打开**：仍只路由到主窗口编辑器（弹窗不订阅 `app:open-file`）。
- **浏览器 Dev 模式**：Web 模式走 `window.open` 回退；生产 Tauri 构建不受浏览器弹窗拦截影响。

## 实施顺序

1. 生成 `prd/tool-popout-window/requirements.md` + `design.md`。
2. `src/lib/popout-window.ts` + capability 权限扩展。
3. `src/PopoutApp.tsx` + `main.tsx` 启动分支。
4. 三处触发入口 + `tool-catalog.ts` 尺寸字段 + i18n 键。
5. 测试与全量验证。

## Verification

- **单测（vitest）**：
  - `popout-window.test.ts`：Tauri 模式 label 复用聚焦逻辑、创建失败 toast；Web 模式 `window.open` 返回 null → 拦截 toast。
  - Titlebar 弹出按钮渲染/回调、Sidebar 菜单项、PopoutApp 冒烟（有效/非法 toolId）。
- **全量门禁**：`pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿。
- **手动验证（`pnpm tauri dev`）**：
  1. 标题栏/命令面板/侧栏右键三入口均可弹出 text_compare 窗口，尺寸与标题栏正确；
  2. 弹窗内状态 = 主窗口持久化快照；编辑后关闭重开为编辑后状态；
  3. 重复弹出已打开工具 → 聚焦而非新建；
  4. 后端工具（如 hash_calculator）在弹窗内可正常执行出结果；
  5. Tab 键可达弹出按钮、屏幕阅读器朗读 aria-label、WindowControls 键盘可操作；
  6. `pnpm dev` 浏览器模式弹新标签页；拦截场景出现警告 toast。
