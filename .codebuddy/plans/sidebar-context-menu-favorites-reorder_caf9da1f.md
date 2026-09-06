---
name: sidebar-context-menu-favorites-reorder
overview: 为侧边栏所有工具条目增加右键上下文菜单（收藏/取消收藏），并支持在收藏夹内手动调整收藏顺序（上移/下移）。
todos:
  - id: write-tests
    content: 用 [skill:test-driven-development] 编写 uiStore.moveFavorite 与 Sidebar 右键菜单测试
    status: completed
  - id: implement-store
    content: 实现 uiStore.moveFavorite 越界安全的相邻交换 action
    status: completed
    dependencies:
      - write-tests
  - id: implement-sidebar-menu
    content: Sidebar 增加 NavItem contextMenu prop 与 ToolContextMenu，接入收藏/取消/上移/下移并更新空态文案
    status: completed
    dependencies:
      - implement-store
  - id: verify-and-review
    content: 运行全量测试与 lint 确认无回归，用 [skill:requesting-code-review] 审查改动
    status: completed
    dependencies:
      - implement-sidebar-menu
---

## 功能概述

为应用侧边栏增加「右键上下文菜单」交互，支持工具的收藏管理（收藏/取消收藏）与收藏夹内手动排序（上移/下移）。

## 核心功能

- 所有工具条目（分类内、收藏夹内、搜索结果、固定的文本编辑器）支持右键弹出菜单
- 菜单动态显示：未收藏的工具显示「收藏」，已收藏的工具显示「取消收藏」，操作实时生效并持久化（localStorage）
- 收藏夹分组内的条目额外显示「上移」「下移」菜单项，用于手动调整收藏顺序；首项「上移」、末项「下移」自动禁用
- 非工具条目（所有工具、管理扩展、设置）不弹右键菜单
- 更新收藏夹空态提示文案（原"在工具页点击「收藏」按钮添加"已过时，实际无该按钮）
- 收藏顺序变更同步反映在侧栏「收藏夹」分组与欢迎页收藏区（两者均按 favorites 数组顺序渲染）

## 技术栈

- 复用现有栈：React + TypeScript + Zustand + Radix UI
- 直接复用已存在的 `src/components/ui/context-menu.tsx`（Radix ContextMenu 完整组件族，样式与设计令牌一致）

## 实现方案

### 核心策略

1. **store 层**：`uiStore` 已有 `favorites: string[]`（按插入顺序持久化）与 `toggleFavorite(toolId)`，但全库无 UI 调用。新增 `moveFavorite(toolId, direction)` action，在数组内做相邻交换，越界直接返回原状态；收藏/取消/移动后侧栏与欢迎页因订阅同一 favorites 数组自动实时更新，无需额外联动。
2. **组件层**：`NavItem` 增加可选 `contextMenu?: React.ReactNode` prop——有值时用 `<ContextMenu><ContextMenuTrigger asChild>` 包裹现有按钮（保持按钮语义与既有测试兼容），菜单内容经 Portal 渲染，点击菜单项不会触发 NavItem 的 onClick。
3. 新增 `ToolContextMenu` 辅助组件统一构建工具条目菜单：收藏/取消收藏（动态文案）+ 收藏夹条目追加分隔线与上移/下移（按在 favorites 中的索引判断禁用态）。仅工具条目传入 contextMenu，非工具条目不传。

### 关键设计点

- 右键菜单内不包「打开工具」操作——打开仍由左键 NavItem onClick 承担，职责单一
- 上移/下移仅在条目当前位于 favorites 数组中时显示（收藏夹分组与"已收藏的搜索结果/分类条目"共用同一判断）
- 不做拖拽排序（复杂度高、与现有代码风格不符），右键菜单式排序更轻量且可测试

### 性能与可靠性

- `moveFavorite` 为 O(n) 数组拷贝 + O(1) 交换，收藏夹规模极小（用户手动收藏），无性能瓶颈
- 菜单禁用态由索引计算，随 favorites 变化自动更新，无额外订阅开销

## 文件变更

```
src/store/uiStore.ts                          # [MODIFY] 新增 moveFavorite(toolId, direction) action（越界安全）
src/components/layout/Sidebar.tsx             # [MODIFY] NavItem 增 contextMenu prop；新增 ToolContextMenu；工具条目接入右键菜单；更新收藏夹空态文案
src/components/layout/Sidebar.test.tsx        # [NEW] 独立测试文件：右键收藏/取消收藏/上移下移/禁用态/搜索态右键/非工具条目无菜单
```

## 实现要点

- `ContextMenuTrigger` 必须用 `asChild` 包裹 NavItem 按钮，避免新增 DOM 层级破坏现有 `within(sidebar).getByRole('button')` 查询
- `moveFavorite` 边界：`indexOf === -1` 或目标越界时直接返回原 state，不做任何修改
- 测试中用 `user.pointer({ keys: '[MouseRight]' })` 或 `fireEvent.contextMenu` 触发右键；`App.test.tsx` 既有用例无需改动
- 保持 TDD：先写测试（red），再实现（green）

## Agent 扩展

### Skill

- **test-driven-development**
- 用途：为本功能先编写 `moveFavorite` 与右键菜单交互的测试用例，再实现代码
- 预期结果：Sidebar.test.tsx 覆盖收藏/取消收藏/上移下移/禁用态/搜索态右键/非工具无菜单，全部通过
- **requesting-code-review**
- 用途：实现完成后对改动文件进行代码审查，确认需求满足、无回归
- 预期结果：审查通过，既有 App.test.tsx、Titlebar.test.tsx 等用例无回归，lint 无新增错误
