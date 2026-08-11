# UI Dashboard 改版设计文档

> **版本**：v1.0
> **创建日期**：2026-07-29
> **参考来源**：[token-monitor](https://github.com/Javis603/token-monitor) 仪表盘视觉语言、[15-ui-design-system.md](../15-ui-design-system.md)、[theme-redesign/design.md](../theme-redesign/design.md)

---

## 1. 需求理解

将 Qraft 当前的 DevToys 风格 UI 升级为更具「数据看板」感的现代界面，借鉴 token-monitor 这类监控类桌面应用的视觉特征：KPI 数字卡片、玻璃质感、精致渐变、紧凑导航。目标是让首页一打开就有「仪表盘」的观感，同时不破坏现有工具页/设置页/历史页的功能与布局。

---

## 2. 关键技术决策

### 2.1 视觉方向：克制的科技感，不堆砌特效

**决策**：采用「精致极简 + 焦点渐变」而非全屏玻璃拟态。仅在 hero、活动项指示条、KPI 卡片强调色三处使用渐变；其余保持现有 token 体系的克制美学。

**理由**：token-monitor 这类工具型应用的核心是信息密度，过度堆砌 backdrop-blur / 阴影会喧宾夺主。Qraft 作为开发者工具箱同样如此。

### 2.2 KPI 卡片：派生状态，不引入新 store

**决策**：KPI 数字（工具总数 / 收藏数 / 最近使用数 / 分类数）全部从现有 `useUiStore` + `TOOL_CATALOG` + `CATALOG_CATEGORIES` 派生，不新增 store 字段。

**理由**：避免状态冗余；派生值天然同步。

### 2.3 卡片重设计：图标盒渐变 + hover 位移

**决策**：`ToolCard` 图标盒从「白底 + border」改为「primary 渐变 + 半透明」；hover 时整卡 `-translate-y-0.5` + 阴影加深 + 图标盒轻微缩放。

**理由**：现代 dashboard 卡片普遍用图标色块作为视觉锚点，渐变让卡片在网格中更易扫描。

### 2.4 侧栏活动项：渐变指示条 + 软高亮

**决策**：活动项左侧指示条由 4px 实色改为 3px 渐变（primary → 透明）；活动项背景使用 `sidebar-accent` 半透明覆盖 + 内嵌细微高光。

**理由**：当前实色指示条过于生硬，渐变让导航更具呼吸感。

### 2.5 新增 token：玻璃质感与渐变变量

**决策**：在 `:root` 与各 `[data-palette]` 块新增：
- `--card-glow`: 卡片 hover 时的渐变光晕（深色用 primary alpha，亮色用浅灰）
- `--hero-gradient-angle`: hero 渐变角度（统一 120deg）
- `--kpi-accent`: KPI 数字强调色（沿用 primary）

不引入 `backdrop-filter`，避免 Tauri WebView2 在低端设备掉帧。

### 2.6 改造范围：聚焦三处用户首屏触点

| 文件 | 改动 |
|---|---|
| `src/styles/globals.css` | 新增 3 个 token，hero 调色微调 |
| `src/components/tool-card.tsx` | 图标盒渐变 + hover 动效 |
| `src/pages/WelcomePage.tsx` | KPI 行 + 分区标题 + 卡片网格精修 |
| `src/components/layout/Sidebar.tsx` | 活动项渐变指示 + 紧凑化 |
| `src/components/ToolPanel.tsx` | 页头加图标 + 收藏按钮精致化 |

**不动**：工具内部组件、SettingsPanel、HistoryPanel、CommandPalette、主题调色板逻辑、store。

---

## 3. 实现步骤

### 步骤 1：globals.css 新增 token
1. `:root` 与 5 个 `[data-palette]` + `custom` 块新增 `--card-glow` / `--kpi-accent`
2. `@theme inline` 映射 `--color-card-glow` / `--color-kpi-accent`
3. hero 渐变角度统一为 `120deg`（已一致，无需改）

### 步骤 2：tool-card.tsx 重设计
1. 图标盒：`bg-background + border` → `bg-primary/10 + 渐变 ring`
2. hover：`-translate-y-px` → `-translate-y-0.5` + 图标盒 `scale-105`
3. 卡片背景：深色主题加 `bg-card/80` 半透明

### 步骤 3：WelcomePage dashboard 化
1. hero 下方新增 KPI 行：4 个数字卡（工具总数 / 收藏数 / 最近使用 / 分类数）
2. 分区标题加 `text-caption uppercase tracking-wider` 标签风
3. 「所有工具」网格按分类分组，每组带分类图标小标题
4. 底部反馈栏改为浮动卡片

### 步骤 4：Sidebar 视觉精致化
1. 活动项指示条：实色 → 渐变（`from-sidebar-primary to-transparent`）
2. 活动项背景加内嵌高光（`shadow-[inset_0_0_0_1px_...]`）
3. 搜索框聚焦时加 primary ring
4. 折叠态图标栏宽度 48px → 52px，呼吸感更好

### 步骤 5：ToolPanel 页头优化
1. 页头左侧加工具图标盒（与卡片图标盒同款）
2. 收藏按钮加图标盒背景
3. 标题字号 `text-xl` → `text-2xl`，描述字号微调

### 步骤 6：验证
1. `pnpm exec tsc --noEmit`
2. `pnpm test`
3. `pnpm build`

---

## 4. 边界条件与潜在风险

### 4.1 KPI 行在窄屏的换行
KPI 行用 `grid grid-cols-2 lg:grid-cols-4`，在窄屏自动 2 列。**风险**：Tauri 窗口最小宽度若 < 600px，KPI 卡片可能过窄。**缓解**：每张 KPI 卡 `min-w-0`，数字字号自适应。

### 4.2 渐变指示条在折叠态不可见
折叠态侧栏宽度 52px，活动项指示条仍需可见。**缓解**：折叠态指示条改为顶部 2px 渐变下划线而非左侧竖条。

### 4.3 玻璃质感在亮色主题的可见性
亮色主题下 `bg-card/80` 几乎不可见。**缓解**：`--card-glow` 在亮色主题用 `oklch(0 0 0 / 4%)`，深色用 `oklch(1 0 0 / 6%)`，对比度可感知即可。

### 4.4 测试快照可能失效
`tool-card.tsx` / `WelcomePage.tsx` 类名调整可能触发现有快照测试。**缓解**：先跑测试看失败项，逐项更新快照或调整断言。

---

## 5. 设计决策记录（ADR）

### ADR-01：不引入 backdrop-filter
- **决策**：不使用 `backdrop-blur` 等玻璃拟态核心 API
- **理由**：Tauri WebView2 在低端 Windows 设备上 backdrop-filter 性能不佳；token-monitor 本身的玻璃感主要来自半透明 + 渐变，而非真正模糊
- **代价**：视觉上不如真玻璃拟态「湿润」，但更稳

### ADR-02：KPI 数字不实时变化
- **决策**：KPI 卡片显示静态派生值（工具总数等），不做数字滚动动画
- **理由**：Qraft 不是监控类应用，没有「实时变化」的数据；强行动画反而违和
- **代价**：少了开场惊艳感，但符合工具型应用调性

### ADR-03：保留 DevToys 三栏架构
- **决策**：不改为 token-monitor 那种顶部导航 + 全屏 dashboard 的布局，保留「侧栏 + 主区」结构
- **理由**：Qraft 是工具箱（30+ 工具），侧栏导航是核心；token-monitor 是单一面板，布局需求不同
- **代价**：不能完全像 token-monitor，但符合 Qraft 自身定位

---

## 6. 相关文档

- [需求文档](./requirements.md)
- [15-ui-design-system.md](../15-ui-design-system.md) — UI 设计体系
- [theme-redesign/design.md](../theme-redesign/design.md) — 主题三层架构
