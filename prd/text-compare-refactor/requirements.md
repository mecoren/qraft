# 文本比较工具重构 —— 需求文档

## 需求理解

把文本比较工具从「Monaco DiffEditor 单体 + 顶部配置卡」布局，全面重构为 JSON 格式化器同款布局：外层圆角卡片 + 多文档 Tab 栏 + `ResizablePanelGroup`（2px 间隔 + 4px 圆角高亮分隔条）+ 左右两个独立 `CodeEditor`。同时把工具升级为多 Tab 工作区（每组 Tab 是一对原始/修改后文本）。

## 功能需求

### FR1 布局样式对齐 JSON 格式化器

- 外层卡片：`rounded-lg border border-border bg-background shadow-sm`，`overflow-hidden`。
- 多文档 Tab 栏：h-9、VSCode 风格全高 Tab（激活态顶部 2px 主色条）、右键菜单、中键关闭、关闭确认小 Popover —— 与 JsonFormatter 的 doc-tabs 完全同款交互。
- 主区域：`ResizablePanelGroup`（横向，`gap-0.5`）+ `ResizableHandle`（4px 圆角主色高亮线，悬浮/拖拽显示）。
- 左右两个 `CodeEditor`：各自带标题工具栏（原始文本 / 修改后文本）+ 粘贴 / 打开文件 / 清除按钮 + 底部状态栏；输入侧只保留右侧边框、输出侧只保留左侧边框（对齐 JsonFormatter 的 border-r / border-l 处理）。

### FR2 多 Tab 对比工作区

- 每个 Tab 承载一组对比（原始文本 + 修改后文本双内容）。
- 支持：新建空白 Tab、关闭（含确认 Popover）、切换、手动重命名、固定（pinned 恒排最前）、自动命名（compare-N，内容由首行派生标题）。
- Tab 列表与激活态经 Rust `config_get` / `config_set` IPC 持久化（key：`tool_prefs.text_compare_docs_v1`），重启还原 —— 模式与 jsonFormatterStore 一致（hydrate / ready / userTouched 语义）。

### FR3 差异高亮（替代 DiffEditor）

- 放弃 DiffEditor 组件，差异用 `diff`（jsdiff）自行计算，以 Monaco 装饰渲染：
  - 行级：删除行红底、新增行绿底、成对增删行（修改行）双侧行背景。
  - 词级：修改行内部用 `diffWordsWithSpace` 计算行内差异区间，双侧行内高亮。
- 差异统计（+新增 / −删除 / ~修改）语义与旧版 `summarizeLineChanges` 一致，展示在工具栏 actions 区。
- 主题适配：装饰颜色复用现有 `--diff-add-line` / `--diff-remove-line` CSS 变量。

### FR4 滚动同步

- 左右编辑器竖向滚动镜像同步（onDidScrollChange → setScrollTop，带重入防护）。
- 提供同步开关按钮（默认开启），放在工具栏 actions 区。

### FR5 行内对比

- 主视图提供行内/并排布局开关（工具栏按钮，默认并排）：
  - 并排：双 `CodeEditor` + `ResizablePanelGroup`（同 FR1）。
  - 行内：切换为单体 `DiffEditor`（`renderSideBySide: false`），修改侧可编辑（onChange 写回当前文档 modified），原始侧只读。
- 不提供全屏弹窗（已按用户要求移除）。

## 非功能需求

- 输入性能：按键即重算差异；用 `useDeferredValue` + 规模阈值降级（超限停用词级 diff，仅行级）保证大文档不卡。
- 搜索锚点 `text_compare:original` / `text_compare:modified` / `text_compare:diff` 保留，搜索跳转行为不回归。
- i18n：新增键补齐中英文；现有 `tools.text_compare.*` 键尽量复用。
- 无回归：现有全局测试套件通过；差异计算纯函数配单元测试。

## 不做什么

- 不引入本地历史快照（旧版 TextCompare 无历史功能，本次不新增）。
- 不做未变更区域折叠（旧版 hideUnchangedRegions 本就关闭）。
- 不引入「发送到…」跨工具注入（旧版无）。

## 验收标准

1. 布局与 JSON 格式化器并排观察，卡片 / Tab / 间隔 / 分隔条样式一致。
2. 新建两个 Tab 各自输入内容，Tab 标题自动派生；关闭/重命名/固定行为与 JsonFormatter 一致。
3. 修改一侧文本，另一侧行级红绿高亮、修改行行内词级高亮即时刷新；统计数字正确。
4. 重启应用后 Tab 列表与内容还原。
5. 拖动分隔条比例可调且高亮线样式正确；左右滚动同步（可关）。
6. 主视图可在并排/行内布局间切换；行内模式修改侧可编辑且差异高亮实时刷新。

### FR6 与 VSCode 原生 Diff 观感对齐

- 差异行渲染四件套（对齐 Monaco DiffEditor 视觉）：
  1. 行级背景（新增绿 / 删除红，删除侧与新增侧同段配对）；
  2. 行内词级高亮（修改行内变更片段深一档强调色）；
  3. 行号槽（gutter）左缘色条 + 行号加粗；
  4. 编辑器右缘概览标尺红/绿刻度（`overviewRulerLanes: 3`，随调色板取色）。
- 已知与原生 DiffEditor 的差异（接受，不做像素级复刻）：
  - 无两侧编辑器间的对角连接线 / 中部差异折叠箭头（原生独有部件）；
  - 滚动同步为等值镜像，非原生「按差异对齐的比例滚动」；
  - 不折叠未变更区域（显式关闭，保持全量并排观感）。
