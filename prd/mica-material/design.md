# 云母（Mica）材质效果设计文档

> **版本**：v1.0
> **创建日期**：2026-07-31
> **参考来源**：[Windows 11 任务栏视觉规范](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)、[window-vibrancy crate](https://crates.io/crates/window-vibrancy)、[theme-redesign/design.md](../theme-redesign/design.md)、[ui-dashboard-refresh/design.md](../ui-dashboard-refresh/design.md)
> **范围**：桌面端（Windows / macOS / Linux）全屏 Mica 材质改造

---

## 1. 需求理解

将 Qraft 桌面端从当前不透明 DevToys 风格升级为 Windows 11 任务栏式的现代云母材质：原生合成器渲染的模糊背景穿透整个窗口（含标题栏），UI 面板半透明叠加其上，既保留模糊质感又不影响信息可读性。同时整体风格统一、层次清晰、信息可读性优先；桌面端优化鼠标操作体验（hover 反馈、命中区域、自定义窗口控制按钮）。

**与既有 ADR 的关系**：`ui-dashboard-refresh/design.md` 的 ADR-01「不引入 backdrop-filter」仍然成立——本次方案**不依赖 CSS backdrop-filter** 实现主模糊，改用原生 `window-vibrancy` 由系统合成器渲染，零 JS / 零 CSS 模糊开销。仅在 Linux 无原生支持时回退到 CSS `backdrop-blur`。

---

## 2. 关键技术决策

### 2.1 原生 Mica vs CSS backdrop-filter

**决策**：Windows 用 `window-vibrancy::apply_mica`，macOS 用 `apply_vibrancy`，Linux 用 CSS `backdrop-filter` 回退。

**理由**：
- 原生 Mica 由 DWM（Desktop Window Manager）/ NSVisualEffectView 在合成器层渲染，单次绘制，无每帧开销，性能远优于 CSS backdrop-filter。
- WebView2（Windows）的 backdrop-filter 在低端设备掉帧，是 ui-dashboard-refresh ADR-01 拒绝它的根本原因；原生 Mica 规避此问题。
- Linux（X11 / Wayland）无统一原生 API，CSS 回退是唯一可行方案，且 Linux 用户对性能敏感度低于 Windows。

**代价**：
- 引入 `window-vibrancy` crate（小，纯 FFI，无运行时依赖）。
- Linux 上若 compositor 不支持模糊（如某些 Mutter 配置），CSS `backdrop-filter` 无效，画面会显示为半透明纯色——可接受降级。

### 2.2 自定义标题栏 - 全屏 Mica

**决策**：Windows / Linux 关闭原生装饰（`decorations: false`），自绘标题栏；macOS 保留原生红绿灯，仅自绘拖拽区域。

**理由**：
- `decorations: false` 后，Mica / vibrancy 覆盖整个客户区含顶部 32px，符合「全面采用云母」诉求。
- macOS 红绿灯是平台强约定，关闭会破坏用户预期；保留原生装饰 + `apply_vibrancy` 即可让标题栏也带 vibrancy。
- Windows 自绘三按钮（最小化 / 最大化 / 关闭）+ 应用图标 + 标题，命中区域 ≥ 44×32px（Win11 规范）。

**代价**：
- 需实现窗口控制 IPC 调用（`@tauri-apps/api/window` 的 `minimize / toggleMaximize / close`）。
- 最大化状态下需要还原按钮图标切换。
- 拖拽区域使用 `data-tauri-drag-region` 属性，双击标题栏切换最大化。

### 2.3 三层透明度体系

为兼顾「模糊质感」与「内容可读性」，建立三档透明度（与既有 token 体系融合，不破坏 dashboard 改版成果）：

| 层级 | 用途 | 视觉透明度（深色） | 视觉透明度（亮色） | 实现 |
|------|------|------|------|------|
| L1 窗口底 | Mica / vibrancy 原生模糊 | 100%（穿透） | 100%（穿透） | `transparent: true` + `apply_mica` |
| L2 结构层 | 侧边栏、标题栏、主区底 | 70-75% 半透明 | 80-85% 半透明 | `bg-sidebar/75`、`bg-background/85` |
| L3 内容层 | 卡片、弹窗、对话框 | 92-96% 接近不透明 | 100% 不透明 | `bg-card/95`、`bg-popover` |

**关键规则**：
- **正文承载区（卡片 / 弹窗 / 编辑器 / 输入框）保持 L3 高不透明度**，确保 WCAG AA 对比度（4.5:1）。
- **结构层（侧栏 / 主区底）允许 L2 半透明**，让 Mica 透出但不承载长文本。
- **标题栏仅放图标与按钮**，无文本可读性问题，可用更低透明度。

### 2.4 跨平台窗口配置策略

**决策**：使用 Tauri 2 的平台级配置文件合并机制，避免运行时切换 decorations。

- `tauri.conf.json`（基线）：`decorations: true, transparent: false`（最安全默认）
- `tauri.windows.conf.json`：`decorations: false, transparent: true`
- `tauri.macos.conf.json`：`decorations: true, transparent: true`（保留红绿灯 + 启用 vibrancy）
- `tauri.linux.conf.json`：`decorations: false, transparent: false`（CSS 模拟，无需原生透明）

构建时 Tauri CLI 自动合并 `tauri.<platform>.conf.json` 覆盖基线。

**理由**：`decorations` 是窗口创建时属性，运行时 `set_decorations` 在某些平台行为不一致；配置文件方案确定性强。

### 2.5 鼠标交互优化

**决策**：桌面端针对鼠标交互做四项优化，移动端 / 触控不在本期范围。

1. **窗口控制按钮命中区**：32px 高 × 46px 宽（Win11 规范），hover 时背景 alpha 提升（非缩放，避免抖动）。
2. **侧栏导航项命中区**：完整宽度可点击，hover 背景 alpha 渐变 150ms，激活态左侧渐变指示条 + 内嵌高光（沿用 dashboard 改版）。
3. **工具卡片 hover**：`-translate-y-0.5` + 阴影加深（沿用 dashboard），新增图标盒 scale-105。
4. **关闭按钮 hover 反色警示**：hover 时背景变 `--destructive`，图标变白，符合 Win11 行为约定。

### 2.6 主题令牌扩展

在既有 `globals.css` 每个主题块新增 3 个 token（不破坏现有变量）：

```css
--mica-tint: oklch(0.96 0.005 264 / 60%);     /* Mica 色调（亮色：浅灰；深色：深灰） */
--layer-base: 75%;                              /* L2 结构层透明度（深色更低，mica 更显） */
--layer-content: 95%;                            /* L3 内容层透明度 */
```

`@theme inline` 映射为 `--color-mica-tint`，业务组件用 `bg-mica-tint` 等 utility。

亮色主题 `--layer-base: 85%`（亮色 mica 本身较浅，结构层需更不透明以保证可读性），深色主题 `--layer-base: 72%`（深色 mica 较暗，结构层可更透明以透出质感）。

---

## 3. 文件结构

```
src/
├── components/
│   ├── layout/
│   │   ├── Titlebar.tsx          ← 新增：自定义标题栏（drag region + 窗口控制按钮）
│   │   └── Sidebar.tsx           ← 改造：L2 半透明背景 + 鼠标命中优化
│   ├── ui/
│   │   └── window-controls.tsx   ← 新增：最小化 / 最大化 / 关闭按钮组（平台条件渲染）
│   └── ...
├── lib/
│   ├── platform.ts               ← 新增：平台检测 + 是否原生 Mica / 自定义标题栏
│   └── window.ts                 ← 新增：窗口控制 IPC 封装（minimize / toggleMaximize / close）
├── styles/
│   └── globals.css               ← 改造：root 透明 + 3 个新 token × 6 主题块 + 标题栏样式
├── App.tsx                       ← 改造：顶层 flex-col，Titlebar + 主体（侧栏 + 主区）
└── main.tsx                      ← 不变

src-tauri/
├── Cargo.toml                    ← 新增：window-vibrancy 依赖（条件依赖，仅桌面平台）
├── tauri.windows.conf.json       ← 新增：Windows 平台窗口配置覆盖
├── tauri.macos.conf.json         ← 新增：macOS 平台窗口配置覆盖
├── tauri.linux.conf.json         ← 新增：Linux 平台窗口配置覆盖
├── tauri.conf.json               ← 微调：decorations/transparent 基线值
└── src/
    └── lib.rs                    ← 改造：setup() 中按平台 apply_mica / apply_vibrancy
```

---

## 4. 实现步骤

### 步骤 1：Rust 端 - 引入 window-vibrancy 与平台配置

1. `Cargo.toml` 新增 `window-vibrancy = "0.5"`（在桌面平台条件依赖块下）。
2. 新增 `tauri.windows.conf.json` / `tauri.macos.conf.json` / `tauri.linux.conf.json` 三个平台覆盖配置。
3. `lib.rs` 的 `setup()` 闭包中：
   - 取 `main` 窗口句柄
   - `#[cfg(target_os = "windows")]` → `apply_mica(&window, Some(true))`（true = 扩展到标题栏区）
   - `#[cfg(target_os = "macos")]` → `apply_vibrancy(&window, NSVisualEffectView::Sidebar, NSVisualEffectMaterial::Sidebar, None)`
   - `#[cfg(target_os = "linux")]` → 无原生调用，CSS 兜底
4. 错误处理：`apply_*` 失败仅 `tracing::warn!`，不阻塞启动（透明窗口仍可工作，只是无模糊）。

### 步骤 2：CSS - 透明度体系与主题令牌

1. `globals.css` 的 `@layer base` 中：`html, body { background: transparent }`，让 Mica 透出。
2. 每个 `[data-palette="..."]` 块（6 个：5 预设 + custom）新增 `--mica-tint` / `--layer-base` / `--layer-content` 三个 token，亮色与深色取值不同。
3. `@theme inline` 映射 `--color-mica-tint` / `--color-layer-base` / `--color-layer-content`。
4. 新增 `.titlebar` / `.window-control` 样式块，含 hover / active 状态。

### 步骤 3：前端 - Titlebar 组件与窗口控制

1. `src/lib/platform.ts`：导出 `isMac` / `isWindows` / `isLinux` / `useNativeTitlebar` / `hasNativeMica`。
2. `src/lib/window.ts`：封装 `minimize()` / `toggleMaximize()` / `close()` / `isMaximized()`（订阅 Tauri 窗口事件）。
3. `src/components/ui/window-controls.tsx`：Windows/Linux 三按钮，macOS 渲染 null（用原生红绿灯）。
4. `src/components/layout/Titlebar.tsx`：drag region + 应用图标 + 标题 + `<WindowControls />`，macOS 左侧留 78px 红绿灯空间。

### 步骤 4：App 布局重构

1. `App.tsx` 顶层结构改为 `<div className="flex h-screen flex-col"><Titlebar /><div className="flex flex-1"><Sidebar /><main>...</main></div></div>`。
2. `Sidebar.tsx`：`bg-sidebar` → `bg-sidebar/[var(--layer-base)]`（结构层 L2 半透明）。
3. `main` 区域根容器：`bg-background/[var(--layer-base)]`。
4. 内容卡片保持 `bg-card`，但加 `/[var(--layer-content)]`（L3 接近不透明）。

### 步骤 5：验证

1. `cargo clippy --all-targets -- -D warnings`（Rust 端）
2. `pnpm exec tsc --noEmit`（类型检查）
3. `pnpm test`（既有测试不应失败；新增 Titlebar / window-controls 测试）
4. `pnpm build`（Tauri 三平台配置文件正确合并）
5. **手动验收**（Windows 实机）：
   - 桌面壁纸更换时，应用背景模糊色调跟随变化
   - 标题栏三按钮 hover 反馈、最大化图标切换、双击标题栏切换最大化
   - 侧栏 / 主区可见 Mica 透出，但卡片文本清晰可读
   - 切换 5 套预设主题，每套的透明度层次合理

---

## 5. 边界条件与潜在风险

### 5.1 Linux 透明窗口在无 compositor 时不可见

**风险**：Linux 上若 compositor（如某些 server 环境的 Mutter）禁用模糊，`tauri.linux.conf.json` 用 `transparent: false`，CSS `backdrop-filter` 在无 GPU 合成时无效，画面显示为纯色面板——Mica 感消失但应用仍可用。

**缓解**：接受降级。Linux 配置采用 `decorations: false + transparent: false`，背景用 `--layer-base` 半透明色（无 backdrop-blur 也可看），仍比纯不透明更有层次。

### 5.2 亮色主题 Mica 可读性

**风险**：亮色 Mica 本身是浅色，若结构层透明度过高，长列表（如历史记录）文本对比度不足。

**缓解**：
- 亮色主题 `--layer-base: 85%`（比深色 72% 更不透明）。
- 历史面板、设置面板等长内容区使用 L3 `--layer-content: 100%`（完全不透明）。
- 验收阶段在亮色主题下检查每张卡片 WCAG AA 对比度。

### 5.3 自定义标题栏的双击最大化与拖拽冲突

**风险**：`data-tauri-drag-region` 在按钮上会拦截点击；标题栏子元素需阻止冒泡。

**缓解**：
- 窗口控制按钮显式 `data-tauri-drag-region={false}` 或使用 `onMouseDown` stopPropagation。
- 标题文本容器保留 drag region，按钮容器不保留。
- 双击最大化由 Tauri 内置支持，无需自行实现。

### 5.4 macOS 红绿灯与自绘拖拽区域重叠

**风险**：macOS 保留 `decorations: true`，红绿灯位于标题栏左侧 78px。自绘标题栏内容若从左 0 开始，会被红绿灯遮挡。

**缓解**：
- `Titlebar.tsx` 在 macOS 平台下 `padding-left: 78px`（CSS 通过 `.platform-mac .titlebar { padding-left: 78px }`）。
- 应用图标与标题在中部居中，避开两侧。

### 5.5 Tauri 2 window-vibrancy 版本兼容

**风险**：`window-vibrancy 0.5` 与 Tauri 2 的 webview window 句柄转换需正确实现 `HasWindowHandle`。

**缓解**：`tauri::WebviewWindow` 已实现 `raw_window_handle::HasWindowHandle`，可直接传引用。验证步骤 1 完成后先 `cargo check` 确认 API 兼容。

### 5.6 既有测试快照失效

**风险**：`App.test.tsx` 可能断言顶层 DOM 结构（如 `flex h-screen w-screen`），新增 Titlebar 会破坏断言。

**缓解**：步骤 4 后跑测试，逐项更新断言。新增 Titlebar / WindowControls 单元测试覆盖三平台条件渲染。

---

## 6. 设计决策记录（ADR）

### ADR-01：选用原生 window-vibrancy 而非 CSS backdrop-filter

- **决策**：Windows / macOS 用原生 API，Linux 用 CSS 回退。
- **理由**：原生 Mica / vibrancy 由系统合成器渲染，零 JS 开销；CSS backdrop-filter 在 WebView2 低端设备掉帧（ui-dashboard-refresh ADR-01 已论证）。本次方案与之不冲突。
- **代价**：跨平台行为不完全一致，Linux 视觉降级。

### ADR-02：采用平台级配置文件而非运行时切换 decorations

- **决策**：通过 `tauri.<platform>.conf.json` 在构建时确定 `decorations` / `transparent`。
- **理由**：`set_decorations` 在 macOS 行为不一致，运行时切换有视觉闪烁；配置文件方案确定性强，Tauri CLI 原生支持。
- **代价**：多 3 个配置文件，维护成本略增。

### ADR-03：三层透明度体系而非全屏半透明

- **决策**：L1 原生模糊 + L2 结构层半透明 + L3 内容层接近不透明。
- **理由**：用户明确「不能影响可视度」，长文本承载区必须高对比度；结构层仅作视觉过渡，可低不透明度透出 Mica。
- **代价**：视觉层次略复杂，但符合 Win11 任务栏本身的设计逻辑（任务栏半透明，但应用窗口内容不透明）。

### ADR-04：macOS 保留原生红绿灯

- **决策**：macOS 不关闭 decorations，仅自绘拖拽区域，红绿灯由系统提供。
- **理由**：macOS 用户对红绿灯位置与行为有强预期，自绘会破坏 muscle memory；vibrancy 仍可通过 `apply_vibrancy` 应用于整窗。
- **代价**：macOS 标题栏左侧 78px 不可放置应用内容，但这是平台约定。

---

## 7. 相关文档

- [需求文档](./requirements.md)
- [theme-redesign/design.md](../theme-redesign/design.md) — 主题三层架构（本方案在其上扩展透明度 token）
- [ui-dashboard-refresh/design.md](../ui-dashboard-refresh/design.md) — Dashboard 改版（ADR-01 不引入 backdrop-filter，本方案兼容）
- [15-ui-design-system.md](../15-ui-design-system.md) — UI 设计体系
- [window-vibrancy 文档](https://docs.rs/window-vibrancy)
- [Mica 官方规范](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
