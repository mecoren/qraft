---
name: qraft-sidebar-titlebar-refresh
overview: 参考 wait-home 桌面端视觉，对 qraft 的侧边栏（宽度/分组/交互微调）与 Windows 标题栏（对齐/间距/背景/hover 微调）进行局部改造，保留 qraft 现有设计体系（渐变指示条、mica 材质、工具导航结构）。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 紧凑
    - 半透明 Mica
    - 柔和渐变高亮
    - 桌面原生质感
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 14px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - '#3B82F6'
      - '#60A5FA'
    background:
      - '#1E1E2E'
      - '#F5F5F7'
    text:
      - '#E4E4E7'
      - '#A1A1AA'
    functional:
      - '#E81123'
      - '#22C55E'
      - '#F59E0B'
todos:
  - id: sidebar-width-highlight
    content: 调整 Sidebar.tsx 宽度（展开 224px/折叠 56px）并微调活动项渐变指示条与 hover/背景透明度，保持 testId 与功能结构不变
    status: completed
  - id: titlebar-styling
    content: 调整 Titlebar.tsx 与 globals.css 标题栏样式（高度 36px、对齐/间距/背景/hover），同步 window-controls 按钮尺寸 48×36px
    status: completed
  - id: verify-no-regression
    content: 用 [skill:test-driven-development] 运行 pnpm test 与 tsc --noEmit 验证无回归，手动确认拖拽/双击最大化/主题切换正常
    status: completed
    dependencies:
      - sidebar-width-highlight
      - titlebar-styling
---

## 产品概述

参照 wait-home 桌面应用的截图视觉，对 qraft 的侧边栏与 Windows 标题栏进行视觉风格调整，使其更紧凑、更精致，同时完全保留 qraft 现有功能结构与 mica 半透明材质体系。

## 核心功能

- 侧边栏展开态宽度 264px → 224px、折叠态 52px → 56px，同步收紧内边距与间距
- 保留活动项左侧 3px 渐变指示条（ui-dashboard-refresh 既有成果），仅微调 hover 背景与透明度
- 标题栏保持"左侧 logo+标题、右侧三窗口控制按钮"现有结构，仅调整高度、对齐、间距、背景与 hover 反馈
- 保留侧栏全部功能：7 个工具分类分组、收藏夹、最近使用、搜索过滤、管理扩展入口、底部主题切换、折叠态图标栏与 Popover 浮层
- 保留标题栏拖拽移动、双击最大化、macOS 红绿灯兼容、窗口控制按钮 hover 红底白字等既有行为

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui（沿用现有）
- 桌面壳：Tauri 2（`data-tauri-drag-region`、`@tauri-apps/api/window`）
- 测试：Vitest + Testing Library（沿用现有 `pnpm test`）

## 实现方案

### 总体策略

本次为**视觉样式局部调整**，不改动组件结构、数据流与状态管理：仅修改 `Sidebar.tsx`、`Titlebar.tsx`、`window-controls.tsx` 的样式类与 `globals.css` 的 `.titlebar*` / `.window-control*` 选择器。颜色全部复用现有 design-tokens（`--sidebar-*`、`--bg-titlebar`、`--muted-foreground` 等），不新增硬编码色值，保证深浅色主题与 Mica 三层透明度体系（L1 窗口底 / L2 结构层 / L3 内容层）不受破坏。

### 关键决策

1. **侧边栏宽度**：展开 `w-64`(264px) → `w-56`(224px)；折叠 `w-[52px]` → `w-14`(56px)。内部 padding（`p-1.5` 等）与导航项行高保持不变，仅压缩侧栏占宽，为主区留出更多空间。所有 `testId`（`sidebar` / `sidebar-rail` / `nav-cat-*` / `nav-settings` 等）与 `aria-label` 保持原样，避免破坏 `App.test.tsx` 与 `integration.smoke.test.tsx` 的断言。
2. **活动项高亮**：`NavItem` 活动态保留左侧 3px 渐变指示条（`--sidebar-primary` → 透明），背景由 `bg-sidebar-accent` 微调为更高透明度（约 `/80`），hover 背景从 `/60` 微调为更柔和；`RailButton` 折叠态顶部 2px 渐变条保留。此为纯样式类微调，无逻辑变更。
3. **标题栏**：保持 `.titlebar → .titlebar-drag + WindowControls` 结构不变；高度 32px → 36px（贴近 wait-home `h-9`），`.window-control` 命中区 46×32px → 48×36px（贴近 wait-home `w-12`）；`titlebar-drag` 内 logo 与标题的对齐、间距微调；背景沿用 `--bg-titlebar` 半透明，hover 反馈沿用现有 alpha 提升机制。macOS `.platform-mac .titlebar` 78px 红绿灯留白规则不动。
4. **性能与回归**：全部改动为静态样式，无新增运行时开销；不引入新依赖、不重构布局结构。完成改动后运行 `pnpm test` 与 `tsc --noEmit` 验证无回归。

## 实施注意事项

- `src/App.tsx` 的顶层布局（`Titlebar` + `Sidebar` + `main`）无需改动，flex 自适应天然兼容新宽度。
- `globals.css` 中 `.titlebar`（高度 32px）、`.window-control`（46×32px）需与组件改动同步，避免 CSS 与 TSX 不一致。
- 折叠态 `w-14`(56px) 下，`RailButton` 的 `size-9`(36px) 图标按钮仍居中显示，无需调整内部尺寸。
- 不要触碰 `uiStore.ts` 的持久化 key（`qraft_ui_v1`）与 `sidebarCollapsed` 逻辑，保证折叠状态跨重启恢复正常。

## 目录结构

```
qraft/src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx      # [MODIFY] 展开 w-56(224px)/折叠 w-14(56px)；NavItem 活动态背景与 hover 透明度微调
│   │   └── Titlebar.tsx     # [MODIFY] 内部对齐/间距微调；logo 尺寸与标题字号贴合新高度
│   └── ui/
│       └── window-controls.tsx  # [MODIFY] 按钮尺寸类由 CSS 控制为主，组件本身仅确认图标/aria 不变
└── styles/
    └── globals.css          # [MODIFY] .titlebar 高度 32→36px；.window-control 46×32→48×36px；hover 透明度微调
```

## 关键代码结构

无需新增接口或类型。改动集中在 Tailwind 类名与 CSS 选择器数值，组件签名（`Sidebar()` / `Titlebar()` / `WindowControls()`）与 props 全部保持原样。

## 设计风格

参照 wait-home 截图的现代紧凑风格，在保留 qraft 既有 Mica 云母材质与渐变指示条体系的前提下做局部视觉优化：

- 侧边栏：展开 224px / 折叠 56px，整体更紧凑；活动项保留左侧 3px 主色渐变指示条与柔和背景高亮，hover 背景透明度调低使过渡更细腻；分组标题、收藏夹、底部入口间距微调，与截图的分组节奏一致
- 标题栏：36px 高度（贴近截图饱满感）；左侧 logo + 应用名"Qraft"保持左对齐，右侧最小化/最大化/关闭三按钮 hover 背景淡出、关闭按钮红底白字警示；窗口按钮命中区 48×36px，符合 Windows 桌面习惯
- 背景沿用 L2 半透明材质（深色约 70-75%、亮色约 80-85%），让 Mica 透出，保证结构层与内容层层次分明

## Agent Extensions

### Skill

- **test-driven-development**
- 用途：侧边栏宽度与高亮样式调整完成后，运行现有测试套件（`pnpm test`）验证组件行为（导航/折叠/展开分类/命令面板）无回归；对于本次纯样式改动，以"既有测试全绿 + tsc 类型检查通过"作为完成门槛
- 预期产出：`pnpm test` 全部用例通过、`tsc --noEmit` 无类型错误，确认样式改动未破坏任何功能断言
