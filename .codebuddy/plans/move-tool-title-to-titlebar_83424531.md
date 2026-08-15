---
name: move-tool-title-to-titlebar
overview: 将工具页当前工具的图标+名称(悬浮显示描述)移入窗口标题栏左方显示,Logo 与 "Qraft" 移到标题栏正中,并移除 ToolPanel 原顶部大标题区。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 深色 Mica 材质
    - DevToys 工具风格
    - 克制极简导航
    - 平滑悬浮动画
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 13px
      weight: 500
    subheading:
      size: 13px
      weight: 500
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4C8DFF"
      - "#3D7BFF"
    background:
      - "#1E1F24"
      - "#23252B"
      - "#2A2C33"
    text:
      - "#F4F5F7"
      - "#9BA0A8"
    functional:
      - "#4ADE80"
      - "#FBBF24"
      - "#F87171"
todos:
  - id: update-tests
    content: 按 TDD 先更新 ToolPanel.test.tsx(移除 h1 断言、keepalive 改用 input 数量断言)并新增 Titlebar.test.tsx(工具态/欢迎态/Tooltip 描述)
    status: completed
  - id: refactor-titlebar
    content: 改造 Titlebar.tsx 为左工具标题+Tooltip/中 Logo 绝对居中/右 WindowControls 三段布局,订阅 view 与 currentToolId
    status: completed
    dependencies:
      - update-tests
  - id: strip-toolpanel-header
    content: 删除 ToolPanel.tsx 顶部 header 与收藏相关代码,清理导入,工作区顶到标题栏下方
    status: completed
    dependencies:
      - update-tests
  - id: extend-titlebar-css
    content: 在 globals.css 新增 .titlebar-left/.titlebar-center/.titlebar-fill/.titlebar-tool 样式,保留红绿灯留白与 Mica 材质
    status: completed
    dependencies:
      - refactor-titlebar
  - id: verify
    content: 运行 vitest 与 lint 验证全量测试通过,确认无回归
    status: completed
    dependencies:
      - refactor-titlebar
      - strip-toolpanel-header
      - extend-titlebar-css
---

## 产品概述

将工具页顶部原有的"图标 + 标题 + 描述"区域迁移到最上方 Windows 标题栏左方:图标 + 工具名显示在标题栏左缘,鼠标悬浮工具名时以 Tooltip 显示该功能描述;原有的应用图标(Logo)与名称"Qraft"显示在标题栏正中间。

## 澄清结果(用户已确认)

1. 左方标题规则:仅工具页显示——只有 view=tool 且 currentToolId 存在时,标题栏左方显示当前工具图标 + 名称;欢迎页 / 设置弹窗 / 历史 / 扩展等其他页面,左侧不显示工具标题,只保留中间的 Qraft Logo。
2. 原头部处理:完全移除——删除 ToolPanel 顶部 header(图标盒 + 大标题 + 描述 + 收藏按钮,约 75px 高度),工具工作区直接顶到标题栏下方。

## 核心功能

- 标题栏三段式布局:左(当前工具图标 + 名称,仅工具页显示)→ 中(Qraft Logo + 应用名,绝对居中)→ 右(WindowControls 不变)
- 鼠标悬浮工具名显示对应功能描述(Tooltip)
- 工具工作区移除原头部后直接顶到标题栏下方,内容可用空间增加约 75px

## 技术栈

- 沿用项目现有技术栈,不引入新依赖:React + TypeScript + Zustand + Radix UI Tooltip + Tailwind CSS
- 工具元数据源:`src/lib/tool-catalog.ts` 的 `getCatalogEntry(id)` 返回 `CatalogEntry { id, name, description, icon: LucideIcon, keywords }`

## 实现方案

### Titlebar 三段式改造

- 订阅 `useUiStore((s) => s.view)` 与 `useToolStateStore((s) => s.currentToolId)`;当 `view === 'tool' && currentToolId` 时调用 `getCatalogEntry(currentToolId)` 获取元数据,渲染图标(size-4)+ 工具名(复用 `.titlebar-title`)。
- 工具名包裹 Radix `<Tooltip>`(`TooltipProvider` 在 Titlebar 内局部包裹,不改 App.tsx 根结构),`TooltipContent` 显示 `entry.description`。
- 中间 Logo + "Qraft" 保持原样,用绝对定位居中(`left:50%; transform:translateX(-50%)`),保证视觉正中央、不受左右内容宽度影响。
- 拖拽区处理:工具区容器不带 `data-tauri-drag-region`(避免 Tauri 拖拽拦截干扰 Tooltip 的 hover 事件),左右两侧用 `flex-1` 拖拽填充区维持拖拽面积;中间 Logo 区可保留拖拽属性;macOS `.platform-mac .titlebar` 左侧 78px 红绿灯留白不变。

### ToolPanel 移除头部

- 删除整个 `<header>`(图标盒 + h1 标题 + 描述 + 收藏按钮);同步移除不再使用的导入(`Star`、`toggleFavorite`/`isFavorite` 订阅、`ICON_STROKE_WIDTH`)。
- 工作区外层容器保留 `px-6 pb-5`、去掉顶部内边距,内容直接顶到标题栏;`catalogToMetadata`、visited keepalive、Suspense 懒加载逻辑全部保留。

### 样式扩展

- 保留 `.titlebar`(36px、flex、Mica 背景、border-bottom)与 `.platform-mac .titlebar`;新增 `.titlebar-left`(flex、min-width:0、padding-left)、`.titlebar-center`(绝对居中、flex、gap)、`.titlebar-fill`(flex:1 拖拽填充)、`.titlebar-tool`(hover 态背景微提升)。

### 性能与可靠性

- Titlebar 仅订阅两个 zustand selector,变更时仅重渲染标题栏;元数据来自静态 Map 查询 O(1),无性能瓶颈。
- ToolPanel 移除 header 不影响 keepalive 机制(visited 列表与懒加载逻辑不变),切换工具的数据保留行为不受影响。

## 涉及文件

```
project-root/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Titlebar.tsx      # [MODIFY] 三段式布局:左工具图标+名称+Tooltip/中 Logo+Qraft 绝对居中/右 WindowControls;订阅 view+currentToolId;局部包裹 TooltipProvider
│   │   │   └── Titlebar.test.tsx # [NEW] 新增测试:工具态显示工具名、欢迎态不显示、hover 弹出描述 Tooltip
│   │   ├── ToolPanel.tsx         # [MODIFY] 删除顶部 header 与收藏相关代码;工作区顶到标题栏;保留 keepalive/Suspense/catalogToMetadata
│   │   └── ToolPanel.test.tsx    # [MODIFY] 删除 h1 标题断言;keepalive 用例改用 getAllByTestId('input') 数量断言
│   └── styles/
│       └── globals.css           # [MODIFY] 新增 .titlebar-left/.titlebar-center/.titlebar-fill/.titlebar-tool;保留红绿灯留白与 Mica 材质
```

## 设计风格

沿用项目现有 Obsidian 深色 Mica 主题与 DevToys 风格,不引入新视觉语言。标题栏保持 36px 高度、半透明 L2 材质与底部 1px 边框;左侧工具区使用小尺寸图标(size-4)+ 轻量文字,与中间 Qraft 品牌标题同字号但以 muted-foreground 区分层级,形成"工具信息居左、品牌居中"的克制导航感;悬浮工具名时弹出带边框、阴影与 zoom-in 动画的 Radix Tooltip 显示完整功能描述,延续现有全局提示交互。

## 布局与交互

- 左区:工具图标 + 名称,hover 背景 alpha 微提升,悬浮 0.5s 后弹出 Tooltip 显示描述。
- 中区:Logo + "Qraft",绝对居中,保持可拖拽。
- 右区:WindowControls 原样保留。
- 响应式:左区名称超长时 overflow:hidden + text-overflow:ellipsis,避免挤压中间 Logo 与右侧按钮。

## Agent Extensions

### Skill

- **test-driven-development**
- Purpose: 按 TDD 流程先编写/更新 Titlebar 与 ToolPanel 的测试用例,再实现代码,确保行为验证闭环
- Expected outcome: 测试先行覆盖工具态显示/欢迎态隐藏/Tooltip 描述等行为,实现后全部通过