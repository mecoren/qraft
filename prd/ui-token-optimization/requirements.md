# UI Token 全量化优化需求文档

> **版本**：v1.0
> **创建日期**：2026-07-29
> **来源**：项目全面盘查报告（2026-07-29）

---

## 1. 需求理解

Qraft 项目的 design token 体系在颜色/圆角/阴影层面已较完善，但**字号、间距、动画速率三类 token 缺失**，导致 `text-[13px]` 等"伪标准"在 28+ 业务文件中蔓延；同时存在 ESLint 配置损坏、Monaco 主题色硬编码、PRD 快捷键未实现、PRD 文档过期等问题。本次优化旨在**一次性消除所有已知 UI token 缺口与代码质量问题**，使 UI 代码与 [15-ui-design-system.md](../15-ui-design-system.md) 的设计规范完全对齐。

---

## 2. 功能需求

### 2.1 ESLint 配置修复（P0 阻断）

- **FR-1.1**：`pnpm run lint` 必须以 exit code 0 退出，0 错误。
- **FR-1.2**：解决 `react-x/no-array-index-key` 与 `react-dom/no-dangerously-set-innerhtml` 规则未找到的问题。
- **FR-1.3**：解决 3 处 `react-hooks/set-state-in-effect` 错误（[LoremIpsum.tsx:88](../../src/tools/LoremIpsum.tsx)、[MarkdownPreview.tsx:22](../../src/tools/MarkdownPreview.tsx)、[QrcodeTool.tsx:52](../../src/tools/QrcodeTool.tsx)）。
- **FR-1.4**：保留 `react-refresh/only-export-components` 警告（非阻断，符合 shadcn 风格）。

### 2.2 字号 Token 体系（P0）

- **FR-2.1**：在 `globals.css` 的 `@theme inline` 块中新增字号 token：
  - `--text-body-sm: 0.8125rem` + `--text-body-sm--line-height: 1.4`（对应 13px）
  - `--text-caption: 0.6875rem` + `--text-caption--line-height: 1.4`（对应 11px）
  - `--text-hero: 1.625rem` + `--text-hero--line-height: 1.2`（对应 26px）
- **FR-2.2**：全局替换 `text-[13px]` → `text-body-sm`、`text-[11px]` → `text-caption`、`text-[26px]` → `text-hero`。
- **FR-2.3**：替换后视觉表现与原 `text-[13px]` 完全一致（同样字号、同样行高）。

### 2.3 间距 Token 体系（P2）

- **FR-3.1**：在 `@theme inline` 块中新增 `--space-1` 到 `--space-8`（0.25/0.5/0.75/1/1.5/2/3/4 rem），对齐 [15-ui-design-system.md:189-194](../15-ui-design-system.md) 的定义。
- **FR-3.2**：将 `.markdown-body` 内的 px/rem 直接量改用 `var(--space-*)` 引用。
- **FR-3.3**：业务组件中的 Tailwind 间距 utility（`gap-2` 等）保持不变，仅替换 globals.css 内的硬编码。

### 2.4 动画速率 Token（P2）

- **FR-4.1**：在 `@theme inline` 块中新增：
  - `--duration-fast: 150ms`
  - `--duration-base: 200ms`
  - `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`
- **FR-4.2**：替换 `accordion-down 0.2s ease-out` → `accordion-down var(--duration-base) var(--ease-standard)`。
- **FR-4.3**：业务组件 `duration-150` / `duration-200` 改为 `duration-fast` / `duration-base`（需配合 Tailwind v4 `--duration-*` 映射）。

### 2.5 Monaco 主题色 Token 化（P1）

- **FR-5.1**：在 `globals.css` 的每个 `[data-palette]` 块中新增编辑器相关 token：
  - `--editor-selection-bg`
  - `--editor-inactive-selection-bg`
  - `--editor-line-highlight-bg`
  - `--editor-bracket-match-bg` / `--editor-bracket-match-border`
  - `--scrollbar-slider-bg` / `--scrollbar-slider-hover-bg` / `--scrollbar-slider-active-bg`
- **FR-5.2**：[code-editor.tsx](../../src/components/ui/code-editor.tsx) 的 Monaco 主题定义改为读取上述 CSS 变量。
- **FR-5.3**：移除 `resolveColor('--var', fallback)` 中与 token 不同步的 hex fallback，改为读取新 token 变量。
- **FR-5.4**：主题切换时 Monaco 编辑器颜色与 UI 完全同步。

### 2.6 Markdown 排版 Token 化（P1）

- **FR-6.1**：`.markdown-body` 内的所有 `font-size` / `margin` / `padding` / `line-height` / `font-weight` 改用 token 或 Tailwind `@apply`。
- **FR-6.2**：保留 GitHub 风格排版视觉表现。

### 2.7 快捷键体系（P1）

- **FR-7.1**：新建 `src/hooks/useShortcut.ts`，实现 PRD [15-ui-design-system.md:440-462](../15-ui-design-system.md) 规定的 `useShortcut(key, handler, deps)` API。
- **FR-7.2**：在 [App.tsx](../../src/App.tsx) 中实现 8 个缺失快捷键：
  - Ctrl+, 打开设置
  - Ctrl+P 切换工具（打开命令面板）
  - Ctrl+H 打开历史
  - Ctrl+L 清空输入（当前工具）
  - Ctrl+Shift+C 复制输出
  - Ctrl+Enter 执行工具
  - Ctrl+F 工具内搜索（聚焦输入区，无搜索则 no-op）
  - Esc 关闭面板（已部分实现，扩展到全局）
- **FR-7.3**：快捷键读取 `configStore.shortcuts`，支持用户自定义。
- **FR-7.4**：当焦点在输入框/编辑器内时，Ctrl+L / Ctrl+Enter / Ctrl+F 仍生效（全局快捷键），但 Ctrl+F 在原生搜索场景让位浏览器（实际上 Tauri 无浏览器搜索，可保留）。

### 2.8 零散硬编码清理（P2）

- **FR-8.1**：[DiffView.tsx:24](../../src/tools/text-compare/DiffView.tsx) `rounded-[2px]` → `rounded-sm`。
- **FR-8.2**：[WelcomePage.tsx:83](../../src/pages/WelcomePage.tsx) `text-[26px]` → `text-hero`（见 FR-2.1）。
- **FR-8.3**：新建 `src/lib/icon-constants.ts`，导出 `ICON_STROKE_WIDTH = 1.75`，替换 5 处重复。

### 2.9 PRD 文档同步（P3）

- **FR-9.1**：[18-known-issues.md](../18-known-issues.md) 更新已解决项（亮色主题、Diff、SQL/Markdown/QR/证书等工具）。
- **FR-9.2**：[19-roadmap.md](../19-roadmap.md) 更新 v1.0/v2.0 工具勾选状态。
- **FR-9.3**：在 [18-known-issues.md](../18-known-issues.md) 新增"UI Token 全量化"已解决项记录。

---

## 3. 非功能需求

### 3.1 兼容性

- **NFR-1.1**：不改变任何现有视觉表现（像素级一致）。
- **NFR-1.2**：不破坏现有 141 个前端测试与 197 个 Rust 测试。
- **NFR-1.3**：Tailwind v4 的 `@theme inline` 语法保持不变。

### 3.2 性能

- **NFR-2.1**：token 替换不引入额外运行时开销（CSS 变量本身已是最高性能方案）。
- **NFR-2.2**：Monaco 主题切换性能不退化（仍通过 MutationObserver 触发）。

### 3.3 可维护性

- **NFR-3.1**：所有 token 命名遵循 [design-tokens.ts](../../src/lib/design-tokens.ts) 已有约定（kebab-case）。
- **NFR-3.2**：新增 token 必须在 5 套主题块中都有定义（obsidian/deep-sea/twilight/emerald-night/daylight）+ custom 块。

---

## 4. 验收标准

| 验收项 | 标准 |
|--------|------|
| `pnpm run lint` | exit 0，0 errors（warnings 允许） |
| `pnpm run typecheck` | exit 0 |
| `pnpm run test` | 141+ 测试全绿 |
| `cd src-tauri && cargo test` | 197+ 测试全绿 |
| `text-[13px]` 出现次数 | 0（业务文件中） |
| `text-[11px]` 出现次数 | 0（业务文件中） |
| `text-[26px]` 出现次数 | 0 |
| Monaco hex 颜色硬编码 | 0（除完全透明的 `#00000000`） |
| 快捷键实现数 | 10/10（含已有 2 个） |
| PRD 文档勾选状态 | 与实际实现一致 |

---

## 5. 范围外

- 不重构 shadcn/ui 组件内部的任意值（`p-[1px]` 等为 shadcn 默认风格）。
- 不引入 `@tailwindcss/typography` 插件（保持手写 `.markdown-body` 控制力）。
- 不实现 i18n（PRD 规划 v1.0，本次不涉及）。
- 不实现 Smart Detection（PRD 规划 v1.0，本次不涉及）。
