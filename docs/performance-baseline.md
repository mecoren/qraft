# 性能基线

> 口径:criterion 默认 bench profile(release + 优化)。每次优化/回归在此追加记录,保持时间倒序或按场景分组。
> 目标对照(prd/01-project-overview.md):冷启动 <500ms · 小输入执行 <50ms · 10MB JSON 解析 <500ms · 空闲内存 <150MB · 安装包 <30MB。

## Rust 工具执行(criterion,`cargo bench --bench json_formatter`)

| 日期       | 场景                              | mean              | 说明                                                                                             | 机器                                  |
| ---------- | --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 2026-08-25 | `json_format_small`(24B 输入)     | **25.4µs**(±0.25) | 含 IPC 层之下的 Tool::execute 全链路 + spawn_blocking 开销;距「小输入 <50ms」目标有 ~2000 倍余量 | AMD Ryzen 7 7840H / 28GB / Windows 11 |
| 2026-08-25 | `json_format_1mb`(~1MB 嵌套 JSON) | **39.3ms**(±0.63) | 线性外推 10MB ≈ 400ms,与 PRD「10MB JSON <500ms」目标吻合                                         | 同上                                  |

## 应用级(冷启动 / 内存)

> 测量前置条件:必须先退出所有已运行的 Qraft 实例 —— single-instance 插件会让第二个进程静默退出,产生无效数据(scripts/perf-baseline.ps1 已内置预检)。

| 日期 | 平台    | 冷启动(到主窗口)                    | 主进程峰值 WorkingSet | WebView2 子进程合计 | 脚本                      |
| ---- | ------- | ----------------------------------- | --------------------- | ------------------- | ------------------------- |
| 待测 | Windows | 待测                                | 待测                  | 待测                | scripts/perf-baseline.ps1 |
| 待测 | macOS   | 手动秒表口径见 release-checklist.md | —                     | —                   | —                         |
| 待测 | Linux   | 同上                                | —                     | —                   | —                         |

## 回归规则

- PR 不允许冷启动增加 >20ms(prd/17-dev-workflow.md:580)。
- criterion 结果出现 >10% 退化时告警(prd/11-testing-strategy.md:368)。
