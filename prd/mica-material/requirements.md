# 云母（Mica）材质效果需求文档

> **版本**：v1.0
> **创建日期**：2026-07-31
> **关联设计**：[design.md](./design.md)
> **范围**：Qraft 桌面端（Windows / macOS / Linux）全屏 Mica 材质与现代化质感改造

---

## 1. 需求背景

Qraft 当前 UI 为不透明 DevToys 风格，与 Windows 11 / macOS 现代桌面应用的视觉质感存在差距。用户要求全面采用云母（Mica）材质效果，参考 Windows 11 任务栏的半透明、模糊背景质感，同时保证信息可读性与桌面端鼠标操作体验。

---

## 2. 功能需求

### FR-1 原生 Mica / Vibrancy 应用

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-1.1 | Windows 平台应用原生 Mica 材质 | P0 | 启动后窗口背景呈 Mica 模糊；更换桌面壁纸时模糊色调跟随变化 |
| FR-1.2 | macOS 平台应用原生 vibrancy（Sidebar 材质） | P0 | 窗口背景呈侧边栏式 vibrancy；浅色 / 深色模式自动跟随系统 |
| FR-1.3 | Linux 平台 CSS `backdrop-filter` 回退 | P1 | 在支持合成的桌面环境下有近似模糊感；不支持的 compositor 降级为半透明纯色，应用仍可用 |
| FR-1.4 | 原生 API 调用失败不阻塞启动 | P0 | `apply_mica` / `apply_vibrancy` 失败时仅 `tracing::warn!`，应用正常打开 |

### FR-2 自定义标题栏

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-2.1 | Windows / Linux 关闭原生装饰，自绘标题栏 | P0 | 顶部 32px 高自定义标题栏，含应用图标 + 标题 + 三按钮 |
| FR-2.2 | macOS 保留原生红绿灯，自绘拖拽区域 | P0 | 红绿灯位置与行为符合系统约定；标题栏左侧留 78px 红绿灯空间 |
| FR-2.3 | 标题栏支持拖拽移动窗口 | P0 | 在标题栏空白区域按下拖动可移动窗口 |
| FR-2.4 | 标题栏支持双击切换最大化 | P0 | 双击标题栏在最大化 / 还原之间切换 |
| FR-2.5 | 三按钮（最小化 / 最大化 / 关闭）命中区与图标 | P0 | 命中区 ≥ 46×32px；hover 背景变化；关闭按钮 hover 反色警示（红底白图标） |
| FR-2.6 | 最大化状态图标切换 | P1 | 最大化时按钮图标切换为「还原」图标 |

### FR-3 三层透明度体系

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-3.1 | L1 窗口底层：Mica / vibrancy 全屏穿透 | P0 | html / body 背景透明；Mica 覆盖整个客户区含标题栏 |
| FR-3.2 | L2 结构层：侧栏 + 标题栏 + 主区底 半透明 | P0 | 深色主题透明度 72%；亮色 85%；Mica 可见透出 |
| FR-3.3 | L3 内容层：卡片 + 弹窗 + 编辑器接近不透明 | P0 | 深色 95%；亮色 100%；正文区 WCAG AA 对比度 ≥ 4.5:1 |
| FR-3.4 | 6 套预设主题均配置透明度 token | P0 | obsidian / deep-sea / twilight / emerald-night / daylight / custom 各自取值合理 |

### FR-4 主题令牌扩展

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-4.1 | 新增 `--mica-tint` token | P0 | 6 个主题块均定义；亮色浅灰、深色深灰 |
| FR-4.2 | 新增 `--layer-base` / `--layer-content` token | P0 | 6 个主题块均定义；亮色与深色取值不同 |
| FR-4.3 | `@theme inline` 映射新 token 到 Tailwind utility | P0 | `bg-mica-tint` / `bg-sidebar/[var(--layer-base)]` 等 class 可用 |

### FR-5 鼠标交互优化（桌面端）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-5.1 | 窗口控制按钮 hover 反馈 | P0 | hover 时背景 alpha 提升（非缩放，无抖动）；过渡 150ms |
| FR-5.2 | 侧栏导航项完整宽度命中 | P0 | 点击命中区域为整行宽度，非仅文本区 |
| FR-5.3 | 工具卡片 hover 位移与阴影 | P1 | hover 时 `-translate-y-0.5` + 阴影加深 + 图标盒 scale-105（沿用 dashboard） |
| FR-5.4 | 关闭按钮 hover 反色警示 | P0 | hover 时背景 `--destructive`，图标变白 |

### FR-6 App 布局重构

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-6.1 | 顶层结构改为 Titlebar + 主体 | P0 | `flex-col` 包裹 Titlebar；下方 `flex` 包裹 Sidebar + main |
| FR-6.2 | Sidebar 改用 L2 半透明背景 | P0 | 侧栏背景半透明，Mica 透出 |
| FR-6.3 | main 根容器改用 L2 半透明背景 | P0 | 主区域底层半透明，工具卡片在其上叠加 L3 |
| FR-6.4 | 内容卡片使用 L3 高不透明度 | P0 | 卡片 / 弹窗 / 输入框 / 编辑器背景接近不透明 |

---

## 3. 非功能需求

### NFR-1 性能

| 编号 | 需求 | 验收标准 |
|------|------|----------|
| NFR-1.1 | 不引入 CSS backdrop-filter 作为主模糊方案 | 仅 Linux 允许 backdrop-filter 回退；Windows / macOS 必须原生 |
| NFR-1.2 | 标题栏渲染零额外开销 | 不使用动画 / 不使用 backdrop-filter；纯静态背景 + hover 过渡 |
| NFR-1.3 | 主题切换无闪烁 | 沿用 color-theme.ts 三层架构，新 token 通过 CSS 变量切换，无 React 重渲染 |

### NFR-2 可读性与无障碍

| 编号 | 需求 | 验收标准 |
|------|------|----------|
| NFR-2.1 | 正文区 WCAG AA 对比度 | 卡片 / 弹窗 / 编辑器内文本与背景对比度 ≥ 4.5:1 |
| NFR-2.2 | 标题栏按钮键盘可达 | Tab 可聚焦，Enter / Space 触发，聚焦环可见 |
| NFR-2.3 | 高对比度模式兼容 | 系统高对比度启用时，Mica 自动失效（系统行为），UI 仍可用 |

### NFR-3 跨平台一致性

| 编号 | 需求 | 验收标准 |
|------|------|----------|
| NFR-3.1 | 三平台视觉风格统一 | 同一主题在三平台下，结构层透明度比例、标题栏布局逻辑一致 |
| NFR-3.2 | 平台约定保留 | macOS 红绿灯、Windows 三按钮位置符合各自平台规范 |

### NFR-4 可维护性

| 编号 | 需求 | 验收标准 |
|------|------|----------|
| NFR-4.1 | 平台检测集中化 | `src/lib/platform.ts` 单点导出 `isMac` / `isWindows` / `isLinux` |
| NFR-4.2 | 窗口控制 IPC 封装 | `src/lib/window.ts` 封装 minimize / toggleMaximize / close |
| NFR-4.3 | 透明度 token 集中管理 | `globals.css` 每个主题块统一定义，不散落到组件 inline style |

---

## 4. 约束与边界

### 4.1 范围内

- Windows 10 1903+（Mica 系统支持起点）
- Windows 11（Mica 完整支持）
- macOS 11+（NSVisualEffectView Sidebar 材质）
- 主流 Linux 桌面（GNOME / KDE，含 compositor）

### 4.2 范围外

- 移动端 / 触控适配（本期不做）
- Windows 7 / 8 / 早期 Windows 10（不支持 Mica，降级为纯色背景即可）
- 自定义 Mica 色调（沿用系统壁纸派生，不暴露用户配置）

### 4.3 不破坏既有约束

- **零网络原则**：`window-vibrancy` 为纯本地 FFI crate，不引入网络依赖。
- **依赖锁定**：仅新增 `window-vibrancy = "0.5"`，不修改其他依赖版本。
- **既有主题架构**：6 套预设主题与自定义派生逻辑不变，仅追加 3 个 token。
- **既有测试**：除 App.test.tsx / SideNav.test.tsx 等涉及顶层 DOM 的快照需更新外，其余测试不被动。

---

## 5. 验收清单

### 5.1 自动化验收

- [ ] `cargo clippy --all-targets -- -D warnings` 通过
- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `pnpm test` 通过（含新增 Titlebar / WindowControls 测试）
- [ ] `pnpm build` 通过（三平台配置文件正确合并）

### 5.2 手动验收（Windows 实机）

- [ ] 启动后窗口背景呈 Mica 模糊
- [ ] 更换桌面壁纸，Mica 色调跟随变化
- [ ] 标题栏三按钮 hover 反馈正确
- [ ] 关闭按钮 hover 反色警示
- [ ] 双击标题栏切换最大化
- [ ] 最大化状态下还原图标切换
- [ ] 侧栏 / 主区可见 Mica 透出
- [ ] 卡片文本清晰可读（亮 / 暗主题分别验证）
- [ ] 5 套预设主题切换无闪烁，透明度层次合理
- [ ] 历史面板长列表滚动流畅

### 5.3 手动验收（macOS 实机）

- [ ] 红绿灯位置与行为符合系统约定
- [ ] vibrancy 浅色 / 深色跟随系统
- [ ] 标题栏左侧 78px 红绿灯空间正确

### 5.4 手动验收（Linux 实机）

- [ ] 在 GNOME + Mutter 下有近似模糊感
- [ ] 在无 compositor 环境下降级为半透明纯色，应用仍可用

---

## 6. 风险与缓解

详见 [design.md 第 5 节](./design.md#5-边界条件与潜在风险)。

---

## 7. 依赖与影响

### 7.1 新增依赖

| 包 | 类型 | 平台 | 用途 |
|----|------|------|------|
| `window-vibrancy = "0.5"` | Rust crate | 全平台（桌面目标） | apply_mica / apply_vibrancy |

### 7.2 修改文件清单

- `src-tauri/Cargo.toml`：新增 window-vibrancy 依赖
- `src-tauri/tauri.conf.json`：基线 decorations / transparent 调整
- `src-tauri/tauri.windows.conf.json`、`tauri.macos.conf.json`、`tauri.linux.conf.json`：新增平台覆盖
- `src-tauri/src/lib.rs`：setup() 中按平台 apply_mica / apply_vibrancy
- `src/styles/globals.css`：root 透明 + 3 token × 6 主题块 + 标题栏样式
- `src/App.tsx`：顶层布局加 Titlebar
- `src/components/layout/Sidebar.tsx`：背景改 L2 半透明
- `src/components/layout/Titlebar.tsx`：新增
- `src/components/ui/window-controls.tsx`：新增
- `src/lib/platform.ts`：新增
- `src/lib/window.ts`：新增
- `src/App.test.tsx` / `src/components/SideNav.test.tsx` 等：更新断言

### 7.3 不影响

- 主题三层架构（design-tokens / color-theme / theme）逻辑不变
- 工具实现（src/tools/*）不动
- IPC 命令集不变（窗口控制走 Tauri 内置 `@tauri-apps/api/window`，不需新 IPC）
- Store 层不动
- 依赖锁定清单（除新增 window-vibrancy）不动
