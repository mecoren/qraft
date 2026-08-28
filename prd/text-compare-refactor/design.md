# 文本比较工具重构 —— 设计文档

## 需求理解

把 TextCompare 从 DiffEditor 单体重构为 JsonFormatter 同款布局（卡片 + 多 Tab + ResizablePanelGroup 双 CodeEditor），差异改由 jsdiff 自算并以 Monaco 装饰渲染，多 Tab 经 config IPC 持久化。

## 关键技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 差异计算 | 新增 `diff`(jsdiff) 依赖，`diffLines` + `diffWordsWithSpace` | Monaco 无公开 diff 计算 API；深路径 ESM import 会与 public/monaco AMD 构建形成双实例，不可行 |
| 编辑器形态 | 两个受控 `CodeEditor`（value/onChange） | 与 JsonFormatter 输入侧同模式（已验证光标/性能可接受）；旧的「非受控 + setValue」策略随之废弃 |
| 多 Tab 状态 | 新建 `textCompareStore.ts`（zustand，不挂 persist 中间件，`config_get`/`config_set` IPC 持久化） | 与 jsonFormatterStore 模式逐点对齐（hydrate/ready/userTouched/防抖），团队已踩平该模式的坑 |
| 装饰渲染 | `editor.createDecorationsCollection()` + globals.css 自定义类 | useShadowDOM 已关；颜色复用 `--diff-add-line`/`--diff-remove-line` 变量，自动适配深浅色与调色板 |
| 滚动同步 | onDidScrollChange 互写 scrollTop + 重入 ref 防护 | DiffEditor 原生能力中唯一低成本可复刻的；横向不同步（wordWrap 下无意义） |
| 行内模式 | 主视图工具栏开关；行内时整体切换为单体 `DiffEditor`（`renderSideBySide: false`，modified 可编辑） | 双独立编辑器无法复刻 renderSideBySide=false，行内模式交给 DiffEditor 原生渲染（词级差异/对齐免费获得）；不提供全屏弹窗（已按需求移除） |
| 概览标尺刻度 | 差异行装饰带 `overviewRuler: { color, position: Full }` + 编辑器 `overviewRulerLanes: 3`（经 CodeEditor 新 prop 开启，默认仍为 0 不影响其他工具） | VSCode 对齐：正文滚出视口仍可从右缘刻度定位差异；canvas 不认 CSS var()，色值经 getComputedStyle 解析、随 themeName 重算 |

## 组件结构

```
TextCompare.tsx (重写)
├─ 外层卡片 rounded-lg border bg-background shadow-sm
├─ doc-tabs (h-9, 样式/交互复制 JsonFormatter: 关闭确认 Popover + ContextMenu)
│    Tab 图标: FileDiff / Pin;自动命名 compare-N,标题由 original 首行派生
├─ 主区域(两种布局,工具栏开关切换,默认并排)
│    ├─ 并排: ResizablePanelGroup (gap-0.5)
│    │    ├─ ResizablePanel(50, min 20)
│    │    │    └─ CodeEditor (embedded 风格: h-full rounded-none border-0 border-r)
│    │    │         title=原始文本, showPaste/OpenFile/Clear, onMount→editorRef
│    │    ├─ ResizableHandle
│    │    └─ ResizablePanel
│    │         └─ CodeEditor (border-l) header={标题+统计+行内开关+同步滚动} overviewRulerLanes=3
│    └─ 行内: 同款工具栏(无同步滚动) + 单体 DiffEditor
│         renderSideBySide: false, modified 可编辑(onChange→setDocContent)
└─ (无全屏弹窗,已按需求移除)
└─ (装饰注入) useEffect[deferredOriginal, deferredModified, editorInstance]
     → computeLineDiff() → 两侧 createDecorationsCollection.set()

textCompareStore.ts (新建, 镜像 jsonFormatterStore)
├─ CompareDoc { id, title, autoTitle?, pinned, original, modified }
├─ hydrate/ready/userTouched (injectDocFromTool 不置位 userTouched)
├─ newDoc/closeDoc/switchDoc/renameDoc/togglePinDoc
├─ setDocContent(id, side: 'original'|'modified', text)
└─ persistDocs → config_set('tool_prefs.text_compare_docs_v1')

text-compare-utils.ts (新建, 纯函数 + 单测)
└─ computeLineDiff(original, modified):
     diffLines → 连续 removed/added 段配对 (min=修改, 余量=纯增/纯删)
     → { removedLines, addedLines, stats{added,removed,modified},
         wordRanges: Array<{ origLine, modLine, ranges: [startCol, endCol][] }> }
```

## 实现步骤（5 步）

1. `pnpm add diff`；新建 `text-compare-utils.ts`（computeLineDiff 纯函数）+ 单测（配对语义、统计口径、词级区间、空/相同输入）。
2. 新建 `textCompareStore.ts`（CompareDoc 双内容模型 + hydrate/persist + 全部 Tab 动作）。
3. 重写 `TextCompare.tsx`：卡片 + doc-tabs（复制 JsonFormatter Tab 交互：关闭确认 Popover、右键菜单、中键关闭）+ 双 CodeEditor + 装饰注入 + 滚动同步 + 统计/同步/全屏 actions。
4. 全屏弹窗改弹窗内行内开关；globals.css 增加差异装饰类（行级 `text-compare-line-added/removed` + 词级 `text-compare-word-added/removed` + gutter 色条 `text-compare-gutter-added/removed`）。
5. i18n 中英文键补齐（compare-N 自动名、新建 Tab、同步滚动开关等）；typecheck + lint + 相关测试全量验证。

## 边界条件与风险

- **大文档性能**：每次按键重算 diff → `useDeferredValue` 缓冲；任一侧 > 256KB 停用词级 diff（仅行级），> 1MB 统计仅显示「内容过大」仍保行级（jsdiff 行级为 O(ND)，实测可接受；不行再补阈值）。
- **受控编辑器光标**：@monaco-editor/react 受控 setValue 有光标回跳风险 —— JsonFormatter 同模式已在生产验证，风险可接受；若出现仅在 TextCompare 复现的问题，回退为 onChange 内直接 setDocContent + 编辑器保持受控（同现状工具）。
- **装饰生命周期**：切 Tab 时 value 变化 → effect 重跑重设装饰；编辑器实例复用（同一 CodeEditor），collection 随实例存活，无泄漏。
- **行内/并排切换**：切换会卸载对侧编辑器，CodeEditor 无 onUnmount 回调 → useEffect[inlineMode] 显式清空 editor 实例 state，防止滚动同步监听挂在已销毁实例上；切回并排时 CodeEditor 重新挂载并经 onMount 回填实例。
- **持久化体积**：双内容使单文档体积翻倍 —— 沿用 jsonFormatterStore 无上限策略，防抖窗口按载荷自适应（复用 persistDelayFor 思路）。
- **搜索锚点**：`text_compare:config` 随配置卡消失，需同步清理其注册处（搜索索引/跳转表），保留 original/modified/diff 三个锚点。
- **词级区间换算**：jsdiff 词区间基于字符串偏移，需换算为 Monaco (line, column)；CRLF 与宽字符按 model 位置 API 逐行 offset→column 换算，不能直接把 offset 当列号。

## 验证方式

- `pnpm test`（新增 text-compare-utils 单测 + 既有套件无回归）
- `pnpm typecheck` + `pnpm lint`
- 手工验收按 requirements.md 验收标准 1–6 执行
