# 差异对比视图组件化 —— 需求文档

## 需求理解

把文本比较工具（TextCompare）的对比差异视图（双编辑器 + jsdiff 差异高亮 + 统计 + 行内切换等）提升为共享组件，并让文本编辑器工作台（code-editor-workspace）的文件对比视图（FileCompareView，现为原生 Monaco DiffEditor）改用该组件，使两处对比观感完全一致。

## 功能需求

### FR1 共享组件抽取

- 从 TextCompare 抽出「对比差异视图」为共享组件（暂名 `TextDiffView`），包含：
  - 并排布局：双 CodeEditor + ResizablePanelGroup 可拖分隔条；
  - 差异渲染四件套：行级红/绿背景、行内词级高亮、gutter 色条 + 行号加粗、右缘概览标尺刻度；
  - 差异统计徽标（+n/−n/~n）、行内/并排布局开关、滚动同步开关（统计与开关位于「修改侧标题旁」）；
  - 行内模式：单体 DiffEditor（renderSideBySide: false，修改侧可编辑）。
- 差异计算沿用 text-compare-utils（含大文档降级与词级停用阈值），抽至共享位置供组件引用。

### FR2 TextCompare 迁移

- TextCompare 改为「Tab 栏 + TextDiffView」组合，多 Tab、持久化、重命名、Pin 等逻辑不变。
- 现有交互（两侧粘贴/打开/清除按钮、关闭确认 Popover 等）不回归。

### FR3 文本编辑器文件对比迁移

- FileCompareView 改用 TextDiffView，替换原生 DiffEditor：
  - 两侧可编辑，内容实时写回对应文件 Tab（行为不变）；
  - 保留「左 文件名 ↔ 右 文件名」头部；
  - 语言按各文件扩展名推断（替换现在写死的 plaintext，属顺带修复）；
  - 保留中文右键菜单（经 CodeEditor 内建的 MonacoContextMenu 集成）；
  - 统计徽标 / 行内开关 / 滚动同步与文本比较工具一致。

## 非功能需求

- 视觉：两处对比视图渲染结果一致（同套装饰类与调色板变量，深浅色自适应）。
- 性能：useDeferredValue 缓冲、词级 100k 上限、jsdiff maxEditLength 降级策略不回退。
- 兼容：CodeEditor 的 overviewRulerLanes prop 默认仍为 0，不影响其他工具。
- 测试：TextCompare 现有用例尽量保持通过（组件行为不变）；FileCompare 相关用例按新 DOM 适配；共享组件核心逻辑有单测。

## 边界与风险

- 文件对比两侧扩展名可能不同：语言需分别推断、分别传入。
- 大文件场景（文本编辑器常见）：依赖 computeLineDiff 既有降级策略，行级装饰在降级时仍可用。
- 原生 DiffEditor 独有能力（对角连线、差异折叠）在 FileCompare 中随之消失，换得与文本比较一致的观感——即本次需求目的。
