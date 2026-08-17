---
name: default-text-editor-sidebar-recents-removal
overview: 让 Qraft 启动默认直接进入文本编辑器(替代欢迎页),侧边栏删除「最近使用」区域,并在「所有工具」正下方新增固定「文本编辑器」菜单项(其余分类/收藏夹保留)。
todos:
  - id: add-shared-constant
    content: 在 tool-catalog.ts 导出 DEFAULT_TOOL_ID 常量,并让 App.tsx 复用该常量
    status: completed
  - id: default-open-editor
    content: 修改 uiStore 初始 view 为 tool、toolStateStore 初始 currentToolId 为 DEFAULT_TOOL_ID,实现启动即进入文本编辑器
    status: completed
    dependencies:
      - add-shared-constant
  - id: sidebar-adjust
    content: 重构 Sidebar:删除最近使用渲染(展开态与折叠态 rail),在「所有工具」下方新增固定文本编辑器菜单项,更新头注释
    status: completed
    dependencies:
      - add-shared-constant
  - id: tests-verify
    content: 用 [skill:test-driven-development] 更新 store 初始值断言与 App 侧边栏结构测试,运行 pnpm test 与 typecheck 验证
    status: completed
    dependencies:
      - default-open-editor
      - sidebar-adjust
---

## 产品概述

对 qraft 应用的启动行为与侧边栏导航进行调整:启动默认进入文本编辑器,简化侧边栏导航结构。

## 核心功能

- 应用每次启动默认直接打开「文本编辑器」工具页(替代现有欢迎页)
- 删除侧边栏中的「最近使用」区域(展开态前 3 项与折叠态 rail 图标)
- 在侧边栏「所有工具」菜单项正下方新增一个固定的「文本编辑器」菜单项
- 其余侧边栏内容(工具分类分组、收藏夹、底部管理扩展/设置)全部保留

## 边界说明

- 仅删除侧边栏的「最近使用」;欢迎页 WelcomePage 中的「最近使用」KPI 卡片与区块不在本次改动范围,保持原样
- 底层 store 中 recents 记录逻辑保留(欢迎页仍使用),仅侧边栏不再展示

## 技术栈

- 前端:React + TypeScript + Zustand(persist 中间件)、Tauri 2
- 测试:Vitest + Testing Library
- 无新增依赖,全部复用现有模式

## 实现方案

### 核心思路

1. **默认打开文本编辑器**:通过修改两个 store 的初始值实现 —— uiStore 初始 `view: 'tool'`,toolStateStore 初始 `currentToolId: 'text_editor'`。由于 `partialize` 不持久化 view/currentToolId,每次启动都会回到这两个初始值,即每次启动都进入文本编辑器。ToolPanel 通过静态目录 `getCatalogEntry('text_editor')` + registry 懒加载 `CodeEditor` 渲染,不依赖 Rust 端 tool_list,方案可行。
2. **侧边栏调整**:在 Sidebar 中删除 recents 相关渲染逻辑(展开态 recentEntries、折叠态 railTools),并在「所有工具」NavItem 正下方插入固定的文本编辑器 NavItem;折叠态 rail 在「所有工具」按钮下方同步插入固定 RailButton。图标/名称通过 `getCatalogEntry(DEFAULT_TOOL_ID)` 获取,与工具目录保持一致。
3. **共享常量**:在 tool-catalog.ts 导出 `DEFAULT_TOOL_ID = 'text_editor'`,供两个 store、Sidebar、App.tsx 统一引用,避免 'text_editor' 字符串多处硬编码;App.tsx 现有 `TEXT_EDITOR_TOOL_ID` 改为复用该常量。

### 关键决策

- **不删除 store 中 recents 字段**:欢迎页仍依赖 recents 展示,只做 UI 层隐藏,最小化改动面、避免破坏 welcome 页功能
- **复用现有 NavItem/RailButton 组件与 getCatalogEntry 机制**:不引入新组件模式,保持代码一致性
- **active 状态**:文本编辑器菜单项用 `isToolActive(DEFAULT_TOOL_ID)` 判断高亮,与现有工具高亮逻辑一致

### 性能与可靠性

- 无性能风险:仅删减渲染节点 + 新增 1 个静态菜单项,无额外订阅或计算
- 启动路径无竞态:store 初始值在组件树挂载前已就绪,TextEditor 懒加载走既有 Suspense 通道
- 测试兼容:现有测试(App.test.tsx / integration.smoke.test.tsx / Titlebar.test.tsx / toolStateStore.test.ts)均在 beforeEach 显式 setState 复位初始值,不依赖默认值,改动安全

## 实现注意事项

- `goWelcome` 仍保留(「所有工具」菜单项点击回欢迎页),此时 `selectTool(null)` 清空当前工具,与现有逻辑一致
- Esc 快捷键 `close_panel` 回退逻辑 `currentToolId ? 'tool' : 'welcome'` 不受影响(默认 currentToolId 非空,回退到工具页)
- 文件头注释(第 2-13 行)需同步更新,移除「最近使用」相关描述
- 启动兜底拉取待打开文件的 effect 不受影响,仍会通过 `openTool('text_editor')` 切换

## 架构设计

改动仅涉及 UI 状态初始化与侧边栏组件,不引入新架构层,沿用现有「store 状态驱动 → 组件渲染」模式:

```
uiStore(view: 'tool') + toolStateStore(currentToolId: 'text_editor')
        │ 启动初始值
        ▼
App.tsx 渲染 ToolPanel(text_editor) + Sidebar
        │
        ▼
Sidebar: 所有工具 → 文本编辑器(固定) → 收藏夹 → 分类分组
```

## 目录结构

```
src/
├── lib/
│   └── tool-catalog.ts      # [MODIFY] 新增导出 DEFAULT_TOOL_ID = 'text_editor' 共享常量
├── store/
│   ├── uiStore.ts           # [MODIFY] 初始 view: 'welcome' → 'tool';引用 DEFAULT_TOOL_ID(如需要)
│   └── toolStateStore.ts    # [MODIFY] 初始 currentToolId: null → DEFAULT_TOOL_ID
├── components/
│   └── layout/
│       └── Sidebar.tsx      # [MODIFY] 删除最近使用渲染(展开态+折叠态)、新增固定文本编辑器菜单项、更新头注释
├── App.tsx                  # [MODIFY] TEXT_EDITOR_TOOL_ID 复用 tool-catalog 的 DEFAULT_TOOL_ID
└── 测试文件
    ├── store/toolStateStore.test.ts  # [MODIFY] 新增初始值断言(currentToolId === 'text_editor')
    └── App.test.tsx                  # [MODIFY] 新增:侧边栏「所有工具」下方有「文本编辑器」按钮;recents 有值时侧边栏不渲染「最近使用」
```

## Agent Extensions

### Skill

- **test-driven-development**
- 用途:在修改 store 初始值与 Sidebar 结构前,先为默认打开文本编辑器、侧边栏菜单结构编写/更新测试用例,确保行为可验证
- 预期结果:新增 toolStateStore 初始值断言与 App 侧边栏结构断言,全部通过