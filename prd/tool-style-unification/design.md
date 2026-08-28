# 工具样式统一 —— 设计文档

## 需求理解

将 src/tools 下 29 个偏离基准的工具（JsonFormatter / EditorWorkbench / TextCompare 三者为基准）按 A/B/C 三级分级改造，统一外层 shell 卡片、边框 token 与确认交互，视觉层级从「平铺小卡片」迁移为「单卡片 + 内部分区」。

## 关键技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 改造策略 | 分级（A：仅 shell；B：shell + 工具栏；C：完整 Tab） | 26 个工具一次性全量改 Tab 风险不可控；表单类工具加 Tab 属于过度设计，只统一 shell 即可消除主要视觉割裂 |
| shell 复用方式 | 不抽公共组件，直接复制基准类名组合 | JsonFormatter/EditorWorkbench 也是类名直写；过早抽象会引入 props 泛化，且各工具内部结构差异大，抽象收益低 |
| 外层卡片背景 | `bg-background` + 内嵌面板 `bg-card`（层级反转） | 基准模式：卡片整体是 background，内部输入/结果区才是 card 层；现状相反，需逐工具调换 |
| 阴影 | shell 用 `shadow-sm`，内部面板去阴影 | `shadow-card` 是页面级组件用的强阴影，嵌在 shell 内部会产生双影 |
| 嵌入模式兼容 | 参照 EditorWorkbench L915 注释：外层已有卡片时 shell 退化为 `rounded-none border-0` 或直接由外层承担 | 避免双层圆角/双边框（TextProcessor L604、Base64Codec L654 已验证该模式） |
| 改造批次 | 按文件独立性分批提交，每批 typecheck + 相关测试 | 29 个文件互相独立（共享 utils 但 UI 不耦合），可并行分批，出问题易回滚定位 |
| 确认交互 | 全仓库仅 CodeEditor UnsavedDialog 用 AlertDialog（有保存/放弃/取消三选，语义合理），保持不动 | 不属于「轻量防误触」场景，无需迁移到 Popover |

## 工具分级清单

### A级（仅 shell 统一，18 个）

表单/计算类，无编辑器面板：UuidGenerator、UlidGenerator、BasicAuthGenerator、PasswordGenerator、LoremIpsum、TimestampConverter、NumberBaseConverter、Ipv4SubnetCalculator、IpParser、HashCalculator、ColorConverter、ColorBlindnessSimulator、CronParser、JwtParser、CertificateDecoder、QrcodeTool、TextStatistics、FolderAnalyzer。

改法：根 `flex h-full flex-col gap-3` → shell 卡片；内部 `rounded-lg bg-card shadow-card` 区块降级为 `rounded-md border border-border` 或收进卡片分区；`border-input` 主边框换 `border-border`。

### B级（shell + 工具栏，8 个）

有编辑器/双栏：TextProcessor、Base64Codec、MarkdownPreview、GzipCodec、HtmlCodec、SqlFormatter、XmlFormatter、JsonCsvConverter（及同族的 JsonYamlConverter、JsonTreeView、JsonArrayTable、JsonPathTester、ListComparer、DuplicateDetector、XmlXsdTester、ImageConverter、PngCompressor 中无 Tab 需求者，共 11 个，并入 B 级后 B 级合计视批次拆分）。

改法：配置区（ConfigSection/ConfigRow）从卡片外平铺收进 shell 顶部工具栏行 `border-b border-border px-3 py-2`；编辑器面板用 `rounded-none border-0 border-l/r` 嵌入（参照 TextProcessor L604 已有模式）；ResizablePanelGroup 外包 shell。

### C级（完整 Tab，暂缓，候选 3 个）

文档型/多实例：JsonPathTester（多 JSON 实例测试）、DuplicateDetector（多组对比）、GzipCodec/Base64Codec（多文档编解码）。本期不实施，待 A/B 级验收后单独提需求。

## 实现步骤（5 步）

1. **试点**：挑 A 级 2 个（UuidGenerator、HashCalculator）+ B 级 1 个（GzipCodec）做样板，确立两级改造模板与 globals.css 是否需新增工具类。
2. **A 级批量**：18 个工具按模板替换根布局与卡片类名，每批 4-6 个文件提交，跑 typecheck + 对应测试。
3. **B 级批量**：编辑器类工具收工具栏、嵌面板，注意 ResizablePanel 嵌套时 `overflow-hidden` 与 `min-h-0` 防溢出（WebView2 纵向滚动条坑，见项目记忆 2026-08-28）。
4. **回归验证**：全量 `pnpm test` + typecheck + ESLint；深浅色主题下逐工具截图抽检（重点：border 对比度、双影、圆角对齐）。
5. **收尾**：更新本项目记忆（lessons），C 级候选清单留档到 prd。

## 边界条件与风险

| 风险 | 缓解 |
| --- | --- |
| `overflow-hidden` shell 裁掉下拉/Popover | Popover 走 Portal 挂 body，不受影响；但工具内绝对定位浮层需检查 z-index |
| gap-3 → 分区 border 后视觉过密/过疏 | 试点阶段在深浅色下核对，必要时调 px-3 py-2 密度 |
| 测试断言依赖旧类名/DOM 结构 | 每批先跑该工具测试，失败用例逐一核对是断言过时还是真回归 |
| ResizablePanel 嵌 shell 后高度塌陷 | 沿用 `min-h-0 min-w-0 flex-1` 模式（TextProcessor 已验证） |
| FolderAnalyzer 是 `gap-4` 且布局特殊（侧栏+结果面板） | 单独处理，参照 EditorWorkbench 的 sidebar 卡片模式而非表单模板 |
