# 工具弹出新窗口 —— 设计文档

## 1. 总体方案

对标 DevToys 2.0 pop-out：主窗口不变，任意工具可弹出为独立 OS 窗口。弹窗加载同一个前端入口（`index.html?popout=<toolId>`），启动时按 query 分支渲染轻量根组件 `PopoutApp`（最小标题栏 + 工具工作区），而非完整 `App`。

```
main window ──点击弹出──▶ openToolInNewWindow(toolId)
                            │ Tauri: WebviewWindow('popout-<toolId>', url=index.html?popout=<toolId>)
                            │ Web:   window.open('?popout=<toolId>')
                            ▼
        main.tsx 解析 ?popout= ──有效──▶ <PopoutApp toolId=… />
                              └─无效/缺省─▶ <App />（现有主窗口）
```

## 2. 关键技术决策

### 2.1 快照式状态一致性（不做实时同步）

- 工具状态由各工具 zustand persist store 持久化到 localStorage；Tauri 多窗口同源共享 localStorage，弹窗内组件挂载时沿用现有水合逻辑即可拿到主窗口最近一次落盘的快照。
- 因此**弹窗零侵入**：不新增状态同步协议、不处理回环/冲突合并；各窗口写回持久层，最后写入者胜出。
- 放弃的方案：Tauri 事件/BroadcastChannel 双向同步 —— 需要处理循环回环、冲突合并、高频事件性能，复杂度与收益不匹配（用户已确认快照式）。

### 2.2 运行时创建窗口（WebviewWindow）

- 使用 `@tauri-apps/api/webviewWindow` 的 `WebviewWindow`，label = `popout-${toolId}`（每工具单实例，天然防重）。
- 创建前先 `getAllWebviewWindows()`（或 `WebviewWindow.getByLabel`）查重：已存在 → `unminimize()` + `setFocus()`。
- Tauri API 经**动态 import** 引入：纯 Web 构建不打包 Tauri 运行时；`isTauriRuntime()` 判定走 `window.open` 回退。

### 2.3 Tauri capability 按窗口 label 匹配

- 现有 9 个 capability 文件（tool/fs/clipboard/shell/dialog/config/history/ip/updater + default）的 `windows` 均只有 `main`，弹窗窗口若不被覆盖则全部 IPC 失效。
- 方案：所有 capability 的 `windows` 数组追加 `"popout-*"` 通配；`default.json` 追加 `core:webview:allow-create-webview-window`（主窗口创建弹窗所需）与 `core:window:allow-set-focus`。
- 弹窗本身创建时声明 `decorations: false`，复用现有 `WindowControls`（min/max/close 已含 aria-label 与 IPC 权限调用）。

### 2.4 启动分支（main.tsx）

- 渲染前解析 `new URLSearchParams(location.search).get('popout')`，并校验 `TOOL_CATALOG` 中存在同 id 且非 `special` 的条目。
- 主题/字体/平台类/i18n/PROD 右键菜单抑制等启动逻辑两条路径共用，位置不变；空闲预取仅主窗口执行。

### 2.5 弹窗根组件 PopoutApp

- 最小标题栏：工具图标 + 名称（`pickText`）+ `data-tauri-drag-region` + `WindowControls`；视觉类名对齐主窗口 `.titlebar` 体系。
- 工具区：复用 `getToolComponent` + `catalogToMetadata` + Suspense 加载态（与 ToolPanel 同一视觉语言），`createElement` 注入 `ToolProps`。
- 订阅事件：`tool_progress/tool_chunk/tool_completed/tool_failed`（后端工具流式回调，与 App 同机制）+ `config_changed`（语言/主题热更新）；**不订阅** `app:open-file`、不挂 Sidebar/CommandPalette/全局快捷键/Smart Detection。
- 非法 toolId → 居中提示（复用 `chrome.tool_panel.not_found`）。

## 3. 模块与文件清单

| 文件 | 变更 |
| --- | --- |
| `src/lib/popout-window.ts`（新增） | `openToolInNewWindow`：查重/聚焦、Tauri 建窗、Web 回退、失败 toast |
| `src/PopoutApp.tsx`（新增） | 弹窗根组件（标题栏 + 工具区 + 事件订阅） |
| `src/main.tsx` | 启动分支渲染 PopoutApp / App |
| `src/lib/tool-catalog.ts` | `CatalogEntry` 增加 `popoutSize?`；text_compare/text_editor 1100×720、markdown_preview 1000×720 |
| `src/components/layout/Titlebar.tsx` | 工具名右侧弹出按钮 |
| `src/components/CommandPalette.tsx` | 「在新窗口打开当前工具」动作项 |
| `src/components/layout/Sidebar.tsx` | 工具右键菜单「在新窗口打开」项 |
| `src/i18n/locales/zh-CN.json` / `en-US.json` | 新增 5 个 `chrome.*` 键 |
| `src-tauri/capabilities/*.json`（9 个） | `windows` 追加 `popout-*`；default.json 追加 2 个权限 |
| 测试：`popout-window.test.ts`、Titlebar/Sidebar/PopoutApp 用例 | 见 §5 |

## 4. 错误处理

- Tauri 建窗 reject → `toast.error(chrome.toast.popout_failed)`。
- Web `window.open` 返回 null（被拦截）→ `toast.warning(chrome.toast.popout_blocked)`。
- `openToolInNewWindow` 全程 try/catch，不向调用方抛异常（三处入口均为 fire-and-forget）。

## 5. 测试策略

- **popout-window.test.ts**（mock `__TAURI_INTERNALS__` 与 webviewWindow 模块）：
  - 已存在 label → 仅 unminimize+setFocus，不创建；
  - 不存在 → 以正确 label/url/尺寸创建；
  - 创建 reject → error toast；
  - Web 模式 open 返回 null → warning toast；返回 window 对象 → 无 toast。
- **组件测试**：Titlebar 弹出按钮渲染 + 回调；Sidebar 菜单项；PopoutApp 有效/非法 toolId 冒烟。
- **门禁**：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿；手动验证清单见实施计划。

## 6. 已知限制（明示不做）

- 多窗口同时编辑同一工具：最后写入者胜出，不实时同步。
- 弹窗数量不设上限；Monaco 重型工具多开内存开销属预期。
- 文件关联/拖放仅进主窗口；弹窗不支持全局快捷键与命令面板。
