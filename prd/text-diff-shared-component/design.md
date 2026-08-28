# 差异对比视图组件化 —— 设计文档

## 关键技术决策

| 决策点 | 方案 | 理由 |
|---|---|---|
| 组件位置 | `src/components/text-diff/TextDiffView.tsx` + `src/components/text-diff/diff-utils.ts`（由 `src/tools/text-compare-utils.ts` 迁移） | 被 TextCompare 与 code-editor-workspace 两个工具消费，放 components 层；utils 属纯函数随迁并保持测试 |
| 定制面 | props：`original/modified` + 双 onChange、`originalLanguage/modifiedLanguage`、`originalTitle/modifiedTitle`（ReactNode）、`leftExtraActions/rightExtraActions`、`folding`、`defaultInline`、`testIdPrefix` | 标题与统计/开关的排布（标题旁）由组件内置保证一致；文件级功能（粘贴/打开/清除）经既有 CodeEditor props 由调用方决定是否显示 |
| 状态归属 | 组件内部持有布局开关/同步滚动开关与 editor 实例；内容受控于调用方 | TextCompare 的 Tab 切换、FileCompare 的 Tab 写回都在调用方；组件无持久化职责 |
| 差异计算 | useDeferredValue + computeLineDiff + buildDiffDecorations（随迁） | 已验证的缓冲与降级策略，原样复用 |
| 标尺色值 | getComputedStyle 解析 `--diff-*-emph`，随 themeName 重算（含 eslint 豁免注释） | canvas 不认 CSS var()，方案已在 TextCompare 验证 |
| 右键菜单 | CodeEditor 内建 MonacoContextMenu（contextMenuSections 传空 = 标准菜单） | FileCompare 现自挂 MonacoContextMenu 的逻辑删除，由 CodeEditor 统一承担 |

## 组件结构

```
src/components/text-diff/
├─ TextDiffView.tsx      # 对比差异视图（并排双 CodeEditor / 行内 DiffEditor）
└─ diff-utils.ts         # computeLineDiff / buildDiffDecorations / 类型（自 text-compare-utils 迁移）
   └─ diff-utils.test.ts # 随迁的 12+3 个用例

消费方:
├─ src/tools/TextCompare.tsx          # Tab 栏 + 持久化 + TextDiffView(带文件级按钮)
└─ src/tools/code-editor-workspace/
   └─ EditorWorkbench.tsx             # FileCompareView 变薄:文件名头 + TextDiffView(按扩展名传语言)
```

TextDiffView 内部（自 TextCompare 迁移，行为不变）：
双 CodeEditor（ResiazablePanelGroup, gap-0.5）→ 装饰注入 effect ×2 → 滚动同步 effect（syncingRef 防回环）→ 行内 DiffEditor（修改侧可编辑）→ header 内联 statsBadge / inlineToggle / syncScrollButton。

## 实现步骤

1. 新建 `src/components/text-diff/diff-utils.ts`：迁移 text-compare-utils 全量实现与测试，原文件改为 re-export（或直接更新 TextCompare 引用路径），先跑测试确认绿。
2. 新建 `TextDiffView.tsx`：迁移 TextCompare 主区域（编辑器布局、装饰、同步、统计、行内切换），props 化标题/语言/actions/折叠；TextCompare 主区域替换为该组件，i18n 键不动。
3. 改造 FileCompareView：删除原生 DiffEditor 与自挂右键菜单，换 TextDiffView（语言经 languageMap 按扩展名推断，两侧分别传入）；内容写回 onChangeLeft/Right 不变。
4. 测试适配：TextCompare 用例的查询范围不变（testid 经 testIdPrefix 保持）；FileCompare 相关用例按新结构断言（统计存在、语言传参、双侧可编辑）。
5. 全量验证：typecheck + eslint + vitest 全量；更新两份 PRD 状态。

## 边界与风险

- **语言推断**：languageMap 未覆盖的扩展名回退 plaintext；两侧语言不同时各传各的（DiffEditor 原生支持两侧异构语言，CodeEditor 侧天然支持）。
- **大文件性能**：jsdiff 在超大文件（数 MB）上单次计算可能达百 ms 级，已有 maxEditLength 降级兜底（整文件替换展示）；文本编辑器场景若仍嫌慢，后续可加「行数 > N 时跳过词级并提示」的开关，不在本次范围。
- **行为差异接受项**：FileCompare 失去原生对角连线与差异折叠（hideUnchangedRegions 本就关闭）；获得 gutter 色条、标尺刻度、统计徽标与行内模式。
- **测试 mock**：test/setup.ts 的 CodeEditor/DiffEditor mock 已覆盖 TextCompare 需求，FileCompare 新用例若需语言断言须扩展 mock 记录 language prop。
