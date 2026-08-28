# 工具样式统一 —— 需求文档

## 需求理解

以 JSON 格式化器（JsonFormatter）和文本编辑器（EditorWorkbench）为样式基准，将 src/tools 下其余工具的 UI 风格统一到同一套视觉规范：外层 shell 卡片、工具栏、面板边框、确认交互四要素对齐，消除 `bg-card shadow-card` 平铺布局与基准样式并存导致的视觉割裂。

## 背景

- 2026-08-28 完成 TextCompare 重构后，全仓库共有 3 个工具符合基准样式（JsonFormatter、CodeEditor、TextCompare）。
- 其余 29 个工具（3 个部分对齐 + 26 个完全不一致）普遍使用 `flex h-full flex-col gap-3` 平铺根布局 + 内部 `rounded-lg bg-card shadow-card` 小卡片，与基准的「外层 shell 卡片 `rounded-lg border-border bg-background shadow-sm`」层级相反。
- 面板边框混用 `border-input`/`rounded-md`，基准统一为 `border-border`。

## 范围

### 基准样式定义（参照 JsonFormatter.tsx L643-651 / EditorWorkbench.tsx L923-986）

| 要素 | 规范 |
| --- | --- |
| 外层 shell 卡片 | `flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm` |
| 多文档 Tab 栏（仅文档型工具） | `h-9 border-b border-border bg-background-layer`，激活 Tab `border-t-2 border-t-primary bg-card`，VSCode 风格全高 Tab |
| 工具栏 | `flex items-center gap-1 border-b border-border px-3 py-2`，紧凑图标按钮（text-xs，rounded px-1.5 py-1） |
| 面板分隔 | `border-border` / `border-input`（侧栏），内嵌面板 `rounded-none border-0 border-l/r` 避免双层圆角 |
| 确认交互 | 锚定小 Popover（禁止居中 AlertDialog/modal） |

### 工具分级

- **A级（仅需 shell 统一，无 Tab）**：简单表单/计算类工具。统一外层卡片、边框 token、去 `shadow-card`；内部结构不动。
- **B级（shell + 工具栏对齐）**：有编辑器或双栏布局的工具。配置区收进卡片内工具栏，面板边框统一。
- **C级（完整对齐：shell + Tab + 工具栏）**：文档型/多实例工具，需要多文档 Tab。工作量大，需单独排期。

### 非目标

- 不改变任何工具的功能逻辑、快捷键行为、store 数据结构。
- 不为所有工具强加 Tab 栏——仅 C 级工具需要。
- 不涉及 i18n 文案变更（除非 C 级新增 Tab 需要新键）。

## 验收标准

1. A/B 级工具根元素为 shell 卡片类名（或嵌入模式下等价结构），无 `shadow-card` 外层卡片。
2. 面板/边框统一使用 `border-border`（侧栏可用 `border-input`），无 `rounded-md border-input` 主面板残留。
3. 现有全部测试（959+）、typecheck、ESLint 通过。
4. 深浅色主题下视觉抽检无回归。
