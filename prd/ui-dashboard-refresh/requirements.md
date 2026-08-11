# UI Dashboard 改版需求文档

> **版本**：v1.0
> **创建日期**：2026-07-29

---

## 1. 背景

当前 Qraft UI 采用 DevToys 风格（左侧栏 + 欢迎页网格 + 工具页），视觉表现稳定但缺乏「数据看板」的现代感。用户希望参考 [token-monitor](https://github.com/Javis603/token-monitor) 的 UI 效果，让首页更具仪表盘观感。

---

## 2. 目标

- 让欢迎页一打开即有「仪表盘」观感（KPI 行 + 卡片化分区）
- 提升侧栏、卡片、工具页头的视觉精致度
- 不破坏现有功能与主题体系
- 改动可控，可在一次迭代内完成并验证

---

## 3. 功能需求

### 3.1 WelcomePage 仪表盘化

| 需求 ID | 描述 | 验收标准 |
|---|---|---|
| WP-1 | hero 下方新增 KPI 行 | 显示 4 个数字卡：工具总数 / 收藏数 / 最近使用数 / 分类数 |
| WP-2 | 分区标题改为标签风 | `text-caption uppercase tracking-wider` + 分类图标 |
| WP-3 | 「所有工具」按分类分组 | 每组带分类图标 + 中文名，组内网格不变 |
| WP-4 | 底部反馈栏改为浮动卡片 | 不再贴底，与内容区一起滚动，圆角 + 边框 |

### 3.2 ToolCard 视觉重设计

| 需求 ID | 描述 | 验收标准 |
|---|---|---|
| TC-1 | 图标盒改为 primary 渐变 | `bg-primary/10` + `ring-1 ring-primary/20` |
| TC-2 | hover 位移加大 | `-translate-y-0.5` + 图标盒 `scale-105` |
| TC-3 | 卡片背景半透明 | `bg-card/80`（深色）/ `bg-card`（亮色） |

### 3.3 Sidebar 视觉精致化

| 需求 ID | 描述 | 验收标准 |
|---|---|---|
| SB-1 | 活动项指示条改渐变 | `from-sidebar-primary to-transparent`，3px 宽 |
| SB-2 | 活动项背景加高光 | 内嵌 `shadow-[inset_0_0_0_1px_...]` |
| SB-3 | 搜索框聚焦加 ring | `focus-visible:ring-2 ring-sidebar-ring` |
| SB-4 | 折叠态宽度 48 → 52px | 视觉呼吸感更好 |

### 3.4 ToolPanel 页头优化

| 需求 ID | 描述 | 验收标准 |
|---|---|---|
| TP-1 | 页头加工具图标盒 | 与卡片图标盒同款渐变 |
| TP-2 | 标题字号增大 | `text-xl` → `text-2xl` |
| TP-3 | 收藏按钮精致化 | 加图标盒背景 + hover 微动 |

### 3.5 globals.css token 扩展

| 需求 ID | 描述 | 验收标准 |
|---|---|---|
| TK-1 | 新增 `--card-glow` | 深色 `oklch(1 0 0 / 6%)`，亮色 `oklch(0 0 0 / 4%)` |
| TK-2 | 新增 `--kpi-accent` | 沿用 `var(--primary)` |
| TK-3 | `@theme inline` 映射 | `--color-card-glow` / `--color-kpi-accent` |

---

## 4. 非功能需求

- **性能**：不引入 `backdrop-filter`；所有动效用 CSS transform/opacity
- **兼容**：保留所有 `data-testid`，不破坏现有测试断言
- **主题**：5 套预设主题 + custom 全部生效
- **可访问性**：活动项 `aria-current` 保留；图标盒 `aria-hidden` 保留

---

## 5. 验证清单

- [ ] `pnpm exec tsc --noEmit` 0 错误
- [ ] `pnpm test` 全绿（更新受影响快照）
- [ ] `pnpm build` 成功
- [ ] 5 套主题切换后视觉正确
- [ ] 折叠/展开侧栏后视觉正确
- [ ] 窄屏（600px）KPI 行 2 列布局不破

---

## 6. 不在本次范围

- 工具内部组件布局（保持现状）
- SettingsPanel / HistoryPanel / CommandPalette 改版
- 新增主题或调色板逻辑变更
- 国际化、新增工具
