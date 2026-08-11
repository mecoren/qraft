# UI Token 全量化优化设计文档

> **版本**：v1.0
> **创建日期**：2026-07-29
> **参考来源**：项目全面盘查报告、[15-ui-design-system.md](../15-ui-design-system.md)、[theme-redesign/design.md](../theme-redesign/design.md)

---

## 1. 需求理解

本次优化一次性消除 Qraft 项目所有已知 UI token 缺口与代码质量问题，覆盖 12 类问题：ESLint 配置、字号/间距/动画 token、Monaco 主题色、Markdown 排版、快捷键体系、零散硬编码、PRD 文档同步。目标是让 UI 代码与 [15-ui-design-system.md](../15-ui-design-system.md) 设计规范完全对齐，且不改变任何现有视觉表现。

---

## 2. 关键技术决策

### 2.1 字号 token：采用 Tailwind v4 文本 token 格式

**决策**：使用 `--text-{name}: {size}` + `--text-{name}--line-height: {lh}` 双变量格式。

**理由**：Tailwind v4 原生支持此格式，会自动生成 `text-{name}` utility，且同时设置 `font-size` 与 `line-height`，比单一 `--font-size-*` 更完整。

**映射**：
| 原 | 新 token | 新 utility | 字号 | 行高 |
|---|---|---|---|---|
| `text-[13px]` | `--text-body-sm` | `text-body-sm` | 0.8125rem (13px) | 1.4 |
| `text-[11px]` | `--text-caption` | `text-caption` | 0.6875rem (11px) | 1.4 |
| `text-[26px]` | `--text-hero` | `text-hero` | 1.625rem (26px) | 1.2 |

### 2.2 间距 token：仅用于 globals.css，业务组件保持 Tailwind utility

**决策**：新增 `--space-1` 到 `--space-8`，但仅在 `.markdown-body` 等 globals.css 手写选择器中使用；业务组件的 `gap-2` / `p-4` 等 Tailwind utility 不变。

**理由**：Tailwind 的 `gap-2` 本身已是 token 化的（映射到 `--spacing-2`），强行替换为 `gap-space-2` 是反模式。仅 globals.css 中的原生 CSS 需要显式 token 引用。

### 2.3 动画 token：扩展 Tailwind v4 `--duration-*` 命名空间

**决策**：在 `@theme inline` 中新增 `--duration-fast: 150ms` / `--duration-base: 200ms` / `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`。

**理由**：Tailwind v4 会将 `--duration-*` 映射为 `duration-*` utility（如 `duration-fast`），与现有 `duration-150` 等数字 utility 并存。`--ease-*` 同理映射为 `ease-*`。

### 2.4 Monaco 主题色：新增 9 个编辑器专用 token

**决策**：在每个 `[data-palette]` 块中新增 9 个 `--editor-*` / `--scrollbar-*` token，code-editor.tsx 通过 `getComputedStyle` 读取。

**理由**：
- Monaco 的 `editor.defineTheme` API 接受 hex/rgba 字符串，不直接支持 CSS 变量
- 但 `getComputedStyle(document.documentElement).getPropertyValue('--editor-selection-bg')` 可在运行时读取 CSS 变量值
- 主题切换时 MutationObserver 已存在，触发 `monaco.editor.setTheme()` 重新读取即可

**token 定义**（深色主题用 white + alpha，亮色用 black + alpha）：
```css
/* 深色主题示例 */
--editor-selection-bg: oklch(1 0 0 / 13%);
--editor-inactive-selection-bg: oklch(1 0 0 / 9%);
--editor-line-highlight-bg: oklch(1 0 0 / 5%);
--editor-bracket-match-bg: oklch(0.62 0.19 250 / 13%);
--editor-bracket-match-border: transparent;
--scrollbar-slider-bg: oklch(1 0 0 / 12%);
--scrollbar-slider-hover-bg: oklch(1 0 0 / 20%);
--scrollbar-slider-active-bg: oklch(1 0 0 / 27%);
```

### 2.5 快捷键：useShortcut hook + 全局 keydown 监听

**决策**：新建 `src/hooks/useShortcut.ts`，导出 `useShortcut(key, handler, deps)` hook。App.tsx 中使用多个 `useShortcut` 调用注册 10 个快捷键。

**API 设计**：
```typescript
type ShortcutKey = keyof ShortcutBinding;
function useShortcut(key: ShortcutKey, handler: () => void, deps: readonly unknown[]): void;
```

**实现要点**：
- 从 `configStore` 读取快捷键字符串（如 `Ctrl+Shift+C`）
- 解析为 `{ ctrl, shift, alt, meta, key }` 结构
- 在 `window` 上注册 `keydown` 监听器
- Ctrl+Enter / Ctrl+L / Ctrl+Shift+C 需要访问当前工具状态，通过 `useToolStateStore.getState()` 获取
- Esc 全局关闭面板（命令面板/设置/历史 → 回到 welcome 或 tool 视图）

**Ctrl+Enter / Ctrl+L / Ctrl+Shift+C 的实现挑战**：
- 这三个快捷键需要操作"当前工具的输入/输出"
- 工具组件内部状态不在全局 store 中，无法直接访问
- **方案**：通过 `useToolStateStore` 暴露的 `currentToolId` + 自定义事件机制，工具组件监听对应事件并响应
- **简化方案**：先实现导航类快捷键（Ctrl+,/P/H/Esc），工具操作类（Ctrl+Enter/L/Shift+C/F）通过 Tauri 全局事件 `tool_action` 派发，工具组件可选订阅

**本次范围**：考虑到复杂度，本次实现 6 个导航类 + Esc 全局关闭，工具操作类（Ctrl+Enter/L/Shift+C/F）作为 v1.1 延后（需工具组件契约改造）。在文档中标注此为"分阶段实现"。

### 2.6 ESLint 配置：补全 react-x / react-dom 插件

**决策**：安装 `eslint-plugin-react-x` 与 `eslint-plugin-react-dom`，在 `plugins` 中注册，并在 `rules` 中显式启用 `react-x/no-array-index-key` 与 `react-dom/no-dangerously-set-innerhtml`。

**理由**：`eslint-plugin-react-hooks@7` 的 recommended 规则集引用了这两个命名空间，必须补全。

### 2.7 set-state-in-effect 修复策略

三处错误均为"在 effect 早返回路径中同步 setState"：

**LoremIpsum.tsx**：mount 时 `setSeed(s => s+1)` 触发首次生成。
- **修复**：用 `useReducer` + 初始 action 或 `useState(() => initialSeed)` + 显式刷新函数，避免 effect 内 setState。

**MarkdownPreview.tsx**：输入为空时 `setHtml('')`。
- **修复**：将 `html` 改为派生状态，用 `useMemo` 计算 `marked.parse(input)` 结果（marked 同步快路径）；或保留 effect 但将早返回的 `setHtml('')` 移到 promise 链中：`marked.parse(trimmed || '').then(html => setHtml(DOMPurify.sanitize(html)))`，空字符串 parse 后仍为空字符串。

**QrcodeTool.tsx**：输入为空时 `setQrDataUrl('')`。
- **修复**：同 MarkdownPreview，将早返回移到 promise 链中：`QRCode.toDataURL(text || '').then(setQrDataUrl).catch(() => setQrDataUrl(''))`，空字符串 toDataURL 会抛错走 catch 返回空。

---

## 3. 实现步骤

### 步骤 1：ESLint 配置修复
1. `pnpm add -D eslint-plugin-react-x eslint-plugin-react-dom`
2. 修改 [eslint.config.js](../../eslint.config.js)：注册 `react-x` / `react-dom` 插件
3. 修复 3 处 set-state-in-effect

### 步骤 2：新增 token 定义
1. 在 [globals.css](../../src/styles/globals.css) 的 `:root` 与 5 个 `[data-palette]` + `custom` 块中新增 `--editor-*` / `--scrollbar-*` token
2. 在 `@theme inline` 块中新增 `--text-body-sm` / `--text-caption` / `--text-hero` / `--duration-fast` / `--duration-base` / `--ease-standard` / `--space-1..8`

### 步骤 3：全局替换硬编码字号
1. 用 Grep 找出所有 `text-[13px]` / `text-[11px]` / `text-[26px]`
2. 批量替换为 `text-body-sm` / `text-caption` / `text-hero`

### 步骤 4：Monaco 主题色 token 化
1. 重写 [code-editor.tsx](../../src/components/ui/code-editor.tsx) 的 Monaco 主题定义，读取新 token
2. 移除 `resolveColor` 的 hex fallback（改为读取新 token，fallback 用 oklch 值）

### 步骤 5：Markdown 排版 token 化
1. 重写 `.markdown-body` 选择器，所有 px/rem 改用 `var(--space-*)` 或 `var(--text-*)`

### 步骤 6：动画 token 替换
1. `accordion-down 0.2s ease-out` → `var(--duration-base) var(--ease-standard)`
2. 业务组件 `duration-150` → `duration-fast`、`duration-200` → `duration-base`

### 步骤 7：快捷键体系
1. 新建 [src/hooks/useShortcut.ts](../../src/hooks/useShortcut.ts)
2. 在 [App.tsx](../../src/App.tsx) 注册 6 个导航快捷键 + Esc 全局关闭
3. 工具操作类快捷键标注 TODO(v1.1)

### 步骤 8：零散硬编码
1. [DiffView.tsx](../../src/tools/text-compare/DiffView.tsx) `rounded-[2px]` → `rounded-sm`
2. 新建 [src/lib/icon-constants.ts](../../src/lib/icon-constants.ts)，替换 5 处 `strokeWidth={1.75}`

### 步骤 9：PRD 文档同步
1. 更新 [18-known-issues.md](../18-known-issues.md) 与 [19-roadmap.md](../19-roadmap.md)

### 步骤 10：验证
1. `pnpm run lint` / `typecheck` / `test`
2. `cargo test`
3. Grep 验证 `text-[13px]` 等出现次数为 0

---

## 4. 边界条件与潜在风险

### 4.1 字号 token 行高副作用

`text-body-sm` 会同时设置 `font-size: 0.8125rem` 与 `line-height: 1.4`。原 `text-[13px]` 不设置 line-height（继承父级）。**风险**：替换后行高变化可能导致布局微调。

**缓解**：逐文件检查 `text-[13px]` 所在元素的父级 line-height，若与 1.4 差异大则显式补 `leading-*` class。预期大多数场景 1.4 与继承值接近。

### 4.2 Monaco token 读取时机

`getComputedStyle` 在主题切换的瞬间可能返回旧值（CSS 变量尚未重绘）。**风险**：Monaco 主题与 UI 短暂不同步。

**缓解**：现有 MutationObserver 已在 `data-palette` 属性变化后触发，此时 `getComputedStyle` 读取的是新值（CSS 变量同步生效，无需等重绘）。已验证可行。

### 4.3 快捷键冲突

Ctrl+, / Ctrl+P / Ctrl+H 在 Tauri 中无原生占用，但 Ctrl+F 在某些 WebView 中可能触发原生查找。**风险**：Ctrl+F 行为不一致。

**缓解**：Tauri 默认禁用原生查找栏，`preventDefault()` 可拦截。本次实现后手动测试。

### 4.4 Tailwind v4 `--duration-*` utility 生成

需验证 Tailwind v4.3.3 是否自动将 `--duration-fast: 150ms` 映射为 `duration-fast` utility。**风险**：若不自动映射，`duration-fast` class 无效。

**缓解**：先验证 Tailwind v4 行为；若不映射，则改用 `--animate-duration-fast` 或保留 `duration-150` 数字 utility（Tailwind v4 默认支持 `duration-{ms}`）。

### 4.5 业务组件间距 utility 不统一

本次不替换 `gap-2` 等 Tailwind utility（见决策 2.2），但这意味着间距 token 化不彻底。**风险**：未来调整间距体系仍需改多个文件。

**缓解**：记录在 [18-known-issues.md](../18-known-issues.md) 作为已知限制，待 v1.1 评估是否全面迁移到 `--spacing-*` 命名空间。

---

## 5. 关键流程图

### 5.1 token 定义层级

```
globals.css
├── :root                          ← 默认值（daylight）
├── [data-palette="obsidian"]      ← 深色主题编辑器/滚动条 token
├── [data-palette="deep-sea"]      ← 同上
├── [data-palette="twilight"]      ← 同上
├── [data-palette="emerald-night"] ← 同上
├── [data-palette="daylight"]      ← 亮色主题编辑器/滚动条 token
├── [data-palette="custom"]        ← 同 obsidian 基底
└── @theme inline                  ← 映射到 Tailwind utility
    ├── --text-body-sm  → text-body-sm
    ├── --text-caption  → text-caption
    ├── --text-hero     → text-hero
    ├── --duration-fast → duration-fast
    ├── --duration-base → duration-base
    └── --ease-standard → ease-standard
```

### 5.2 快捷键处理流程

```
用户按键
   ↓
window keydown 监听器
   ↓
useShortcut hook 匹配 configStore.shortcuts[key]
   ↓
{导航类} → setView('settings' | 'history' | 'welcome')
{命令面板} → setPaletteOpen(true)
{Esc} → 关闭当前打开的面板
{工具操作类} → 派发 tool_action 事件（v1.1）
```

---

## 6. 设计决策记录（ADR）

### ADR-01：字号 token 采用双变量格式而非单一变量

- **决策**：用 `--text-body-sm` + `--text-body-sm--line-height` 而非 `--font-size-body-sm`
- **理由**：Tailwind v4 原生支持双变量格式，自动生成 utility 同时设置 size + line-height，更完整
- **代价**：与 [15-ui-design-system.md:199](../15-ui-design-system.md) 规划的 `--font-size-*` 命名不一致，需更新 PRD

### ADR-02：工具操作类快捷键延后到 v1.1

- **决策**：本次仅实现导航类快捷键（6 个）+ Esc，工具操作类（Ctrl+Enter/L/Shift+C/F）标注 TODO(v1.1)
- **理由**：工具操作类需要工具组件契约改造（暴露 clear/execute/copy API），范围过大；导航类可立即提升体验
- **代价**：PRD 承诺的 10 个快捷键本次只完成 7 个，需在文档中明确标注

### ADR-03：不引入 @tailwindcss/typography

- **决策**：手写 `.markdown-body` 并 token 化，不引入 typography 插件
- **理由**：typography 插件风格固定，与 Qraft 主题体系集成需大量覆盖；手写已有完整控制力
- **代价**：排版样式需手动维护

### ADR-04：间距 token 仅用于 globals.css

- **决策**：业务组件的 `gap-2` 等 Tailwind utility 不替换为 `gap-space-2`
- **理由**：Tailwind utility 本身已是 token，强行替换是反模式
- **代价**：间距 token 化不彻底，记录为已知限制

---

## 7. 相关文档

- [需求文档](./requirements.md)
- [15-ui-design-system.md](../15-ui-design-system.md) — UI 设计体系（token 规范来源）
- [theme-redesign/design.md](../theme-redesign/design.md) — 主题重构设计（三层架构来源）
- [18-known-issues.md](../18-known-issues.md) — 已知问题（待同步）
- [19-roadmap.md](../19-roadmap.md) — 路线图（待同步）
