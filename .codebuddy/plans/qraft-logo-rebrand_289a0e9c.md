---
name: qraft-logo-rebrand
overview: 将桌面 SVG 作为 Qraft 的官方 logo 单一来源，替换 assets/app-icon.svg、更新应用内 Logo 组件（暗色主题反色）、重新生成全套 Tauri 打包图标，并全面更新所有引用位置与测试。
---

探索完成。我已确认：桌面 SVG 的完整内容（614.4×614.4、#F5F5F5 底 + #1A1A1A 图形、窗口+`</>` 设计）、现有 logo 体系（app-icon.svg 单一来源 → generate-app-icon.js → tauri icon 全套）、Logo.tsx 组件及三处引用（SideNav/Titlebar/WelcomePage）、主题机制（data-palette + color-scheme: dark 合并块）、Logo.test.tsx 断言。现在生成完整计划。

<plan_result>
<req>

## 需求概述

- 将桌面 SVG（Page 1.svg）**原样**作为 Qraft 项目 Logo 全面应用：所有图形形状、描边宽度、圆角、布局细节完全不变，仅将两处颜色替换为可主题化的 CSS 变量
- 视觉效果：浅灰 `#F5F5F5` 圆角方形底色 + 近黑 `#1A1A1A` 的「圆角窗口外框 + 顶部标题栏（左侧标签 + 右侧三个窗口控制圆点）+ 内容区 `</>` 代码符号」
- 应用范围（全面应用）：
- 应用内所有 Logo 展示点：侧边栏品牌区、标题栏中段、欢迎页 Hero
- 打包系统图标：Windows ICO / macOS ICNS / 各尺寸 PNG / iOS / Android 全套
- 暗色主题反色：应用内 Logo 在全部 5 套暗色调色板（obsidian / deep-sea / twilight / emerald-night / custom）下自动反色为「底 `#1A1A1A` + 图形 `#F5F5F5`」；系统级图标（任务栏/桌面）无主题感知能力，保持亮色原版

## 核心功能

- 图标源资产替换：`assets/app-icon.svg` 替换为桌面 SVG 原样内容
- 内嵌 Logo 组件重写：完整细节版 SVG，颜色映射到 `--logo-bg` / `--logo-fg` 主题变量
- 全部引用点适配：侧栏、标题栏、欢迎页
- 单元测试更新：viewBox、颜色变量、元素数量断言
- 全套平台图标重新生成：脚本渲染 PNG + `tauri icon` 全套
</req>

<tech>

## 技术栈

- React + TypeScript（内嵌 SVG Logo 组件）
- Tailwind CSS v4 + CSS 变量（`data-palette` 主题 token 体系）
- Node.js sharp 脚本 + Tauri 2 `tauri icon`（图标生成链路）

## 实现方案

### 总体策略

沿用项目既有「单一来源」图标体系：`assets/app-icon.svg`（亮色原版）→ `scripts/generate-app-icon.js` 渲染 `assets/source-icon.png` → `pnpm tauri icon` 生成全套平台图标；应用内 Logo 由 `src/components/Logo.tsx` 内嵌 SVG 提供，颜色经 CSS 变量随 `data-palette` 自动反色。

### 关键决策

1. **资产替换**：`assets/app-icon.svg` 直接写入桌面 SVG 原样内容，补充 `viewBox="0 0 614.4 614.4"`（原文件仅有 width/height，SVG 栅格化与 React 缩放均需 viewBox 保证等比）。所有 shape / transform / d 逐字保留。
2. **组件重写**：`Logo.tsx` 改为完整版 SVG，`viewBox="0 0 614.4 614.4"`，所有元素原样复制，仅 `#F5F5F5 → var(--logo-bg)`、`#1A1A1A → var(--logo-fg)`，移除 `fill="none" stroke="currentColor"` 线稿模式。`className` / `aria-hidden` 契约保留。
3. **主题变量**：`globals.css` 在 `:root`（亮色 fallback）定义 `--logo-bg: #F5F5F5; --logo-fg: #1A1A1A;`；在现有 `[data-palette="obsidian"], ..., [data-palette="custom"] { color-scheme: dark; }` 合并选择器块中追加反色 `--logo-bg: #1A1A1A; --logo-fg: #F5F5F5;`，一处覆盖全部暗色调色板，与既有主题架构一致。
4. **引用点适配**：Logo 自带底色瓦片后，SideNav 移除 `bg-primary` 包裹容器直接展示；Titlebar / WelcomePage 移除不再生效的 `text-muted-foreground` / `text-hero-foreground` 文本色类。
5. **图标重生成**：执行 `node scripts/generate-app-icon.js` → `pnpm tauri icon assets/source-icon.png`，重新生成 `src-tauri/icons/` 全套（含 Windows Store Square*、iOS、Android）。`generate-app-icon.js` 逻辑无需改动，仅同步更新文件头注释。
6. **系统限制说明**：打包图标使用亮色原版（`#F5F5F5` 底），OS 层无主题感知；暗色反色仅作用于应用内 React Logo。

### 性能与可靠性

- 纯静态资产变更，无运行时性能影响；CSS 变量切换零重渲染（沿用现有主题机制）
- 图标重生成是确定性脚本流程，无网络依赖（sharp 本地渲染）

## 架构设计

- 单一来源原则：`assets/app-icon.svg`（亮色原版）→ 系统打包图标；`Logo.tsx`（主题自适应版）→ 应用内展示
- 主题数据流：`data-palette` 属性 → globals.css 变量（`--logo-bg` / `--logo-fg`）→ SVG fill/stroke 自动跟随，无需 React 参与
- 引用结构：Logo 组件 → SideNav / Titlebar / WelcomePage（均为直接渲染，无容器依赖）

## 目录结构

```
project-root/
├── assets/
│   └── app-icon.svg                    # [MODIFY] 替换为桌面 SVG 原样内容(补 viewBox="0 0 614.4 614.4"),亮色原版图标源
├── src/
│   ├── components/
│   │   ├── Logo.tsx                    # [MODIFY] 重写为完整版 SVG,颜色映射 var(--logo-bg)/var(--logo-fg)
│   │   ├── Logo.test.tsx               # [MODIFY] 更新断言(viewBox/颜色变量/元素数量)
│   │   ├── SideNav.tsx                 # [MODIFY] 移除 bg-primary 包裹容器,直接展示 Logo
│   │   ├── layout/Titlebar.tsx         # [MODIFY] Logo 移除 text-muted-foreground
│   │   └── pages/WelcomePage.tsx       # [MODIFY] Logo 移除 text-hero-foreground
│   └── styles/globals.css              # [MODIFY] :root 定义亮色 logo 变量 + 暗色合并块追加反色
├── scripts/generate-app-icon.js        # [MODIFY] 仅更新文件头设计说明注释,逻辑不变
├── src-tauri/icons/                    # [REGENERATE] 全套平台图标重生成(含 android/、ios/、StoreLogo 等)
└── CHANGELOG.md                        # [MODIFY] 追加 Unreleased 变更条目
```

## 实施注意事项

- 严格保持 SVG 所有 shape/transform/d 原样，用户明确要求「细节什么都不要变」，仅允许颜色替换为 CSS 变量与补充 viewBox
- `Logo.tsx` 不再使用 `currentColor`，测试中相关断言需同步修改
- 重生成图标后 `src-tauri/icons/` 会产生大量 PNG 变更（含 android/ios 子目录），属预期行为
- 暗色反色覆盖全部 5 个暗色调色板，勿遗漏 `custom`
</tech>

<extensions>

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在修改前全面核查项目内所有 Logo / 图标引用点（组件、资产、配置文件、文档），确保「全面应用」无遗漏
- Expected outcome: 输出完整的 Logo 引用清单，确认仅 SideNav / Titlebar / WelcomePage 三处组件引用，无其他遗漏点

### Skill

- **test-driven-development**
- Purpose: 按 TDD 流程先更新 `Logo.test.tsx` 断言（viewBox="0 0 614.4 614.4"、颜色变量、2 rect / 5 path / 3 circle、aria-hidden、className 透传），再以测试驱动组件实现验证
- Expected outcome: 测试先红后绿，运行 `pnpm test` 全部通过，Logo 契约变更被完整覆盖

- **requesting-code-review**
- Purpose: 全部改动完成后对变更做最终审查，核对 SVG 细节未变、暗色反色生效、引用点与图标全套一致
- Expected outcome: 审查确认无遗漏、无回归，产出可合入的变更
</extensions>

<todolist>
<item id="verify-and-replace-icon-source" deps="">Use [subagent:code-explorer] to verify all logo/icon references, then replace assets/app-icon.svg with desktop SVG verbatim (add viewBox, keep all shapes/transforms)</item>
<item id="rewrite-logo-component" deps="">Rewrite Logo.tsx as full-detail SVG mapped to var(--logo-bg)/var(--logo-fg) and add logo tokens to globals.css with dark-palette inversion</item>
<item id="adapt-logo-usage" deps="rewrite-logo-component">Update SideNav.tsx (remove bg-primary container), Titlebar.tsx and WelcomePage.tsx (remove text color classes)</item>
<item id="update-logo-tests" deps="rewrite-logo-component">Use [skill:test-driven-development] to update Logo.test.tsx assertions (viewBox, color vars, element counts) and run vitest</item>
<item id="regenerate-icon-set" deps="verify-and-replace-icon-source">Run node scripts/generate-app-icon.js then pnpm tauri icon to regenerate full platform icon set incl. android/ios</item>
<item id="finalize-changelog-review" deps="adapt-logo-usage,update-logo-tests,regenerate-icon-set">Append CHANGELOG.md entry and use [skill:requesting-code-review] to review the complete logo change</item>
</todolist>
</plan_result>