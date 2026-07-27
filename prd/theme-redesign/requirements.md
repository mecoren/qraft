# 主题重构需求文档

> **版本**：v1.0
> **创建日期**：2026-07-26
> **关联项目**：参考 `C:\Develop\project\00_AI\wait-home\desktop`

---

## 1. 需求理解

当前 qraft 的暗黑模式视觉效果较差（HSL 色值、单一深蓝调、对比度不足），且大量 UI 文案为英文，编辑框使用原生 `<textarea>` 缺乏语法高亮。需参考 wait-home 桌面项目的 UI 设计体系，全面重构主题系统、引入 Monaco 编辑器、并完成全量中文化。

## 2. 功能需求

### 2.1 主题系统重构（核心）

> **UI 命名约定**：用户可见的"色板"统一称为"主题"（如"黑曜石主题"、"自定义主题"）。代码内部变量名保留 `palette`/`PaletteId` 以区分"主题模式"（light/dark/system）。

| 需求 ID | 描述 | 验收标准 |
|---------|------|---------|
| TR-01 | 升级 Tailwind v3 → v4，启用 `@custom-variant dark` | 所有现有 utility class 正常工作；构建无报错 |
| TR-02 | 颜色空间从 HSL 迁移到 OKLCH（感知均匀） | CSS 变量值使用 `oklch(L C H)` 格式 |
| TR-03 | 提供 5 套预设主题：黑曜石/深海/暮光/翡翠夜/日光 | 设置页可切换，切换后立即生效 |
| TR-04 | 支持自定义 accent 色（color-mix 派生主题） | 自定义模式下可拾取任意 HEX 色，实时预览 |
| TR-05 | 支持三种主题模式：浅色/深色/跟随系统 | 系统模式监听 `prefers-color-scheme` 实时切换 |
| TR-06 | 启动时无 FOUC（主题闪烁） | `main.tsx` 在 React 渲染前应用持久化主题 |
| TR-07 | 侧边栏独立配色（`--sidebar-*` 变量） | 侧边栏与主内容区颜色有层次区分 |
| TR-08 | 主题切换器组件 `ThemeModeToggle` | 点击循环 system → light → dark，显示对应图标与中文标签 |
| TR-09 | **默认主题为浅色（日光/daylight）** | 首次启动（localStorage 无记录）时默认浅色主题 |
| TR-10 | **主题选择必须缓存到 localStorage** | 主题模式、主题 ID、自定义 accent、字体设置全部持久化；重启应用自动恢复 |

### 2.2 Monaco 编辑器集成

| 需求 ID | 描述 | 验收标准 |
|---------|------|---------|
| ME-01 | 引入 `@monaco-editor/react` 依赖 | 包体积增量 < 5MB（gzip） |
| ME-02 | 封装 `CodeEditor` 组件（替代 `Textarea`） | 支持 value/onChange/language/readOnly/placeholder |
| ME-03 | Monaco 主题跟随应用色板自动切换 | 切换 daylight/obsidian 时 Monaco 主题同步切换 |
| ME-04 | 替换以下工具的所有输入/输出 Textarea | JsonFormatter / JsonMinifier / Base64Codec / UrlCodec / JwtParser / HashCalculator / RegexTester |
| ME-05 | JSON 输入框启用 `json` 语言、其他默认 `plaintext` | JSON 工具有语法高亮与括号匹配 |
| ME-06 | JWT 解析结果 Header/Payload/Signature 分别用 Monaco 只读展示 | JSON 部分用 `json` 语言，Signature 用 `plaintext` |

### 2.3 字体设置（移植自 wait-home）

| 需求 ID | 描述 | 验收标准 |
|---------|------|---------|
| FS-01 | 字体族下拉选择，调用 Rust `list_system_fonts` | 优先推荐 MiSans，列表项用字体自身渲染预览 |
| FS-02 | 5 级字号：小/标准/大/特大/超大 | 通过 root font-size 缩放 rem |
| FS-03 | 5 级字重：细/常规/中等/半粗/粗体 | 通过 root font-weight 注入 |
| FS-04 | 字体预览区实时展示当前字体族 + 字重 | 中英文双语预览文本 |
| FS-05 | 字体设置持久化到 localStorage | 重启应用恢复设置 |

### 2.4 全量中文化

| 需求 ID | 描述 | 验收标准 |
|---------|------|---------|
| CN-01 | SettingsPanel 所有 Label 与按钮文案中文化 | "Theme Mode"→"主题模式"、"Font Size"→"字号" 等 |
| CN-02 | SHORTCUT_KEYS 标签中文化 | "Open Command Palette"→"打开命令面板" 等 10 项 |
| CN-03 | 工具内英文文案中文化 | "Input"/"Output"/"Format"/"Execute" 等 |
| CN-04 | SideNav 分类标签中文化 | Formatter→格式化 / Encoder→编解码 等 |
| CN-05 | HistoryPanel 文案中文化 | "Clear History"→"清空历史"、"No history"→"暂无历史" |
| CN-06 | 空状态与提示文案中文化 | "Tool not found"→"未找到工具" 等 |

## 3. 非功能需求

| 维度 | 要求 |
|------|------|
| **性能** | Monaco 按 language 懒加载；色板切换无 React 重渲染（CSS 变量切换） |
| **兼容性** | Tauri WebView2（Chromium 111+）支持 OKLCH 与 color-mix |
| **可访问性** | 主题切换器有 `title` 与 `aria-label`；色板卡片有键盘焦点 |
| **持久化** | 主题模式、色板 ID、自定义 accent、字体设置均存 localStorage |
| **零闪烁** | 启动时在 React 渲染前应用主题，避免 FOUC |

## 4. 范围与边界

### 4.1 包含

- 主题色板架构（5 预设 + 1 自定义 + system）
- Tailwind v4 升级
- Monaco 编辑器集成
- 字体设置面板
- 全量中文化
- 设置页主题面板重构（色板网格 + 字体设置）

### 4.2 不包含

- 不引入 wait-home 的业务模块（家庭成员、云同步等）
- 不引入 wait-home 的 TanStack Query（保持现有 Zustand 架构）
- 不修改 Rust 端逻辑（仅新增 `list_system_fonts` IPC 命令）
- 不替换 `Textarea` 组件本身（保留供未来其他用途）

## 5. 验收清单

- [ ] 应用首次启动（localStorage 无记录）默认显示日光（daylight）浅色主题，无 FOUC
- [ ] 用户切换主题后，重启应用自动恢复上次选择的主题（缓存生效）
- [ ] 设置页可切换 6 种主题（5 预设 + 自定义 + 跟随系统），切换立即生效
- [ ] 设置页"颜色主题"卡片标题改为"主题"，所有"色板"文案统一为"主题"
- [ ] ThemeModeToggle 在侧边栏底部可点击循环切换模式（system/light/dark）
- [ ] 所有工具的输入/输出框使用 Monaco 编辑器，JSON 输入有语法高亮
- [ ] Monaco 主题跟随应用主题切换（深色主题用 vs-dark，亮色用 vs）
- [ ] 字体族下拉显示系统字体列表，选择后立即生效并持久化
- [ ] 字号/字重级别按钮可点击切换，预览区实时更新，设置持久化
- [ ] 所有 UI 文案为中文（含设置标签、按钮、快捷键名称、空状态提示）
- [ ] `pnpm test` 全部通过（已有测试可能需同步更新断言）
- [ ] `pnpm build` 构建成功

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Tailwind v4 升级破坏现有样式 | 升级前快照所有页面，升级后逐一对比；保留 v3 配置文件备份 |
| Monaco 包体积过大 | 使用 `@monaco-editor/react` 默认 CDN 加载，或 vite-plugin-monaco-editor 按需打包 |
| 已有测试断言英文文案失败 | 同步更新测试断言为中文 |
| OKLCH 在旧 WebView2 不支持 | Tauri 2 强制 Chromium 111+，无需兼容更旧版本 |
