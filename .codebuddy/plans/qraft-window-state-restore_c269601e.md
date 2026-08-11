---
name: qraft-window-state-restore
overview: 为 Qraft 引入 tauri-plugin-window-state 插件,实现窗口位置/大小/所在屏幕在关闭时自动保存、重启时精确恢复(参考 wait-home/desktop 的实现方式)。
todos:
  - id: add-window-state-deps
    content: 在 src-tauri/Cargo.toml 插件依赖区块添加 tauri-plugin-window-state = "2"
    status: completed
  - id: register-window-state-plugin
    content: 在 src-tauri/src/lib.rs 的 Builder 链中、setup 之前注册 window-state 插件,参考 wait-home 实现
    status: completed
    dependencies:
      - add-window-state-deps
  - id: verify-window-state
    content: cargo check 编译验证,并用 pnpm tauri dev 手动测试关闭后重启恢复窗口位置与大小
    status: completed
    dependencies:
      - register-window-state-plugin
  - id: review-window-state
    content: 使用 [skill:requesting-code-review] 审查窗口状态记忆改动,确认与参考实现一致且无回归
    status: completed
    dependencies:
      - verify-window-state
---

## 用户需求

参考 C:\Develop\project\00_AI\wait-home\desktop 的窗口打开代码,为 Qraft 桌面应用实现窗口状态记忆:关闭时记住窗口所在的屏幕、位置(x, y)和大小(宽高),重新启动后恢复为完全相同的状态。

## 产品概述

Qraft 当前每次启动都在默认位置(居中)以固定大小(1200x800)打开窗口,用户体验不佳。本次通过 Tauri 官方窗口状态插件,让窗口"记住"上次关闭时的位置、大小与所在屏幕。

## 核心特性

- 关闭窗口时自动保存其所在屏幕、位置(x, y)与大小(宽高)
- 重新启动时自动恢复到上次关闭时的状态,包括多显示器场景下恢复到原屏幕原位置
- 实时跟踪窗口移动与缩放,确保关闭时保存的是最新状态而非陈旧数据

## 技术栈

- Tauri 2 + Rust(沿用现有技术栈,不引入新架构)
- `tauri-plugin-window-state` 官方插件(参考项目 wait-home/desktop 同款方案)

## 实现方案

直接复用参考项目 wait-home/desktop 的核心做法:注册官方 `tauri-plugin-window-state` 插件,插件在窗口生命周期内自动完成状态记忆,无需手写监听逻辑。

具体改动两点:

1. **`src-tauri/Cargo.toml`**:在现有插件依赖区块添加 `tauri-plugin-window-state = "2"`,版本风格与现有 `tauri-plugin-dialog`、`tauri-plugin-shell` 等一致。

2. **`src-tauri/src/lib.rs`**:在 `tauri::Builder::default()` 链的插件注册区(现有 4 个插件之后、`.setup(...)` 之前)添加:

```rust
.plugin(tauri_plugin_window_state::Builder::default().build())
```

**关键决策与依据**:

- **采用官方插件而非手写保存逻辑**:插件已成熟处理多显示器物理坐标、最大化/全屏状态、边界恢复等边界情况;手写需自行监听 Moved/Resized/CloseRequested 事件并序列化到 JSON,代码量大且易出错。
- **必须在 Builder 阶段注册而非 setup 回调**:参考项目注释明确说明——Tauri 2 会先创建 config 声明的窗口,再执行 setup 回调,setup 中动态注册会错过插件的 `on_window_ready`,导致既不恢复状态、也不监听 Moved/Resized 事件,关闭时保存的是陈旧位置/大小。
- **不复制参考项目的 `with_filename` 自定义路径逻辑**:该逻辑仅为 wait-home 的"自定义数据目录"功能服务;qraft 无此需求,使用插件默认行为即可,状态文件默认落在 `app_config_dir/.window-state.json`(`%APPDATA%\dev.qraft.app\`),与 config.json 同目录,符合项目惯例。
- **无需新增 capability**:window-state 插件的保存/恢复是纯后端自动行为,前端不调用任何 API,capabilities 目录无需改动。

## 实现注意事项

- 插件保存的是物理坐标,多显示器下可精确恢复到原屏幕原位置;若显示器布局变化,插件内部会做合理性校验,避免窗口落在屏幕外。
- `tauri.conf.json` 中 `center: true` 仅作为无历史状态时的首次启动兜底,恢复逻辑在窗口创建后执行,会覆盖居中位置,行为符合预期。
- 保持 Builder 链代码风格与现有 `.plugin(...)` 单行写法一致;clippy 为 `all = deny` 级别,注意不加不必要的 let 绑定。
- 改动面极小(2 个文件),不涉及前端、不涉及状态管理,无回归风险。

## 目录结构

```
src-tauri/
├── Cargo.toml          # [MODIFY] 插件依赖区块添加 tauri-plugin-window-state = "2"
└── src/
    └── lib.rs          # [MODIFY] Builder 链中、setup 之前注册 window-state 插件
```

## 验证方式

1. `cd src-tauri && cargo check` 确认编译通过。
2. `pnpm tauri dev` 手动验证:将窗口拖到副屏或任意位置并调整大小,关闭后重新启动,确认窗口恢复到完全相同的位置、大小与屏幕。
3. 检查 `%APPDATA%\dev.qraft.app\.window-state.json` 是否生成且包含位置/大小字段。

## Agent 扩展

### Skill

- **requesting-code-review**
- Purpose: 在实现完成后对 window-state 改动进行代码审查,确认符合参考项目模式、无遗漏边界情况
- Expected outcome: 输出审查结论,确保 Cargo.toml 依赖与 lib.rs 插件注册实现正确、无回归