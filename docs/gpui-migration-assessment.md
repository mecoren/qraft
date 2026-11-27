# GPUI 改造可行性评估

> 评估日期：2026-11-25 · 评估对象：Qraft 0.3.7（Tauri v2 + React 19）· 结论：**技术上可行，但不建议整仓改造**。

## 1. 结论摘要

| 问题                       | 结论                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qraft 能不能用 GPUI 重写？ | **能。** GPUI Kit 0.11 已提供 75+ 组件、代码编辑器、Dock、虚拟表格、AccessKit 与 headless UI 测试，覆盖本项目大部分控件需求。                           |
| 值不值得现在做？           | **不值。** 这不是「改造」，而是把 70,313 行生产前端 + 29,278 行测试整体重写为 Rust，粗估 20–29 人月，且 PDF/Office 会明显降级、Mermaid/KaTeX 基本无解。 |
| 性能上有没有必要？         | **没有。** 现网冷启动 164ms、主进程 33MB、空闲 CPU 0.5–1.4%，均已优于 PRD 目标；GPUI 唯一确定的收益是去掉 WebView2 那 ~350MB 渲染进程。                 |
| 最划算的一步是什么？       | **先把 Rust 核心抽成独立 crate（已完成：`src-tauri/qraft-core`，Tauri-free），再用 1–2 周做 GPUI 探针。** 这一步无论最终是否迁移都只有收益。            |

一句话：**GPUI 现在是「有能力承接」的状态，但 Qraft 没有「必须承接」的理由。** 除非产品目标从「工具箱」转向「IDE 级原生编辑器」，或明确要求摆脱系统 WebView 依赖。

本机已实测：`gpui-kit 0.11` 在 rustc 1.96 / Windows 11 上**编译通过并成功创建窗口**（见 §9），技术可行性没有疑问，分歧只在投入产出比。

---

## 2. 项目现状量化

数据取自当前工作区（不含 `node_modules`、`dist`）。

| 维度                | 数值                              | 迁移含义                                    |
| ------------------- | --------------------------------- | ------------------------------------------- |
| 生产前端 TS/TSX     | **70,313 行 / 296 文件**          | 全部需要重写为 Rust                         |
| 前端测试            | **29,278 行 / 190 个文件**        | 测试基建与用例基本作废                      |
| 已注册工具          | **47 个**（48 个目录条目）        | 平均每个工具约 1,500 行 UI + 逻辑           |
| 有 Rust 后端的工具  | **10 个**（`backendId`）          | 其余 **37 个工具的业务逻辑全在 TypeScript** |
| `<CodeEditor>` 引用 | **56 处，分布在 34 个文件**       | Monaco 是绝对核心，替换成本集中在此         |
| shadcn/Radix 原语   | **35 个**                         | 需逐一映射到 gpui-component                 |
| IPC 命令            | **62 个**（底层 99 个 `pub fn`）  | 原生后可直接调用，省掉序列化                |
| 语言片段            | **90 个文件**（45 工具 × 2 语言） | 文案可复用，框架需换                        |
| 主题                | **7 套 OKLCH 调色板**             | 需映射到 `Theme/ThemeColor`                 |
| 弹窗工具            | **6 个**                          | GPUI 支持多窗口，但状态同步需自研           |
| 文件关联            | **26 个关联项 / 40 个扩展名**     | 打包/注册表/Info.plist 全部自理             |
| Rust 源码           | **20,497 行**                     | 可复用（前提是抽成独立 crate）              |

### 2.1 已达标，且余量充足的性能指标

来源：`docs/performance-baseline.md`。

| 指标                  | 实测         | PRD 目标   | 结论                             |
| --------------------- | ------------ | ---------- | -------------------------------- |
| 冷启动（热缓存）      | **164ms**    | <500ms     | 3 倍余量                         |
| 主进程空闲内存        | **33.2MB**   | <150MB     | 4.5 倍余量                       |
| 空闲 CPU（单核）      | **0.5–1.4%** | <5%        | 健康                             |
| 小输入工具执行        | **23.6µs**   | <50ms      | 快 3 个数量级                    |
| WebView2 渲染进程合计 | **~350MB**   | 不计入口径 | **这是 GPUI 唯一能实质改善的项** |

### 2.2 代码分布决定改造重心

| 区域                                        | 行数                                                                            | 说明                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/tools/code-editor-workspace/`          | **9,237**                                                                       | 标签页、侧栏、大文件查看、跨文件搜索替换——Monaco 深度绑定 |
| `src/tools/pdf/`                            | 2,412                                                                           | pdfjs-dist 渲染 + 自研标注编辑                            |
| `src/tools/markdown-editor/`                | 2,357                                                                           | tiptap WYSIWYG + Mermaid + KaTeX                          |
| `src/tools/office/`                         | 1,232                                                                           | docx-preview / SheetJS / JSZip                            |
| `src/lib/`（含 catalog、search、changelog） | ~8,000                                                                          | 目录、搜索索引、命令面板                                  |
| 单个大工具                                  | JsonFormatter 2,258 / TextProcessor 1,299 / RegexTester 1,229 / Base64Codec 898 | 逻辑复杂、边界多                                          |

45 个工具入口文件中：**19 个 <250 行**（简单）、**21 个 250–600 行**（中等）、**5 个 >600 行**（复杂）。工具本身不是难点，难点是编辑器、PDF、Office、Markdown 四块。

---

## 3. GPUI 生态现状（2026-11）

### 3.1 版本与项目

| 项目                                                        | 现状                                                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`gpui`](https://crates.io/crates/gpui)                     | crates.io 正式版 **0.2.2**（2025-10-22），累计 56 万下载；上游仍在 Zed 主仓内高频演进                                                                                                                           |
| `gpui-pre`                                                  | Zed 快照分发包，**0.3.14**（2026-11-22），事实上是生态的当前核心                                                                                                                                                |
| [`gpui-component`](https://crates.io/crates/gpui-component) | **0.11.0**（2026-11-23），约 9.6 万行 Rust，精确锁定 `gpui-pre =0.3.14`                                                                                                                                         |
| [GPUI Kit](https://gpui-kit.com/)                           | 统一入口 `gpui-kit`，75+ 组件、21.3k stars、Apache-2.0；分层 `gpui-base` / `gpui-component` / `gpui-shell`                                                                                                      |
| 生产验证                                                    | Longbridge Pro（商业桌面应用）、Zed；Discord 于 2026-11-04 宣布用 Rust + GPUI 重写桌面端（[heise](https://www.heise.de/en/news/Discord-is-rebuilding-in-Rust-leaving-React-and-Electron-behind-11516113.html)） |

### 3.2 能力盘点（对本项目有意义的部分）

- **组件**：按钮、输入、下拉、Tabs、Dialog、Sheet、Tooltip、Menu、Table/DataTable、Tree、VirtualList、Dock、Resizable、Command Palette、Chart、Diff（只读）、Markdown/HTML 渲染。
- **代码编辑器**：Rope 存储、Tree-sitter 高亮、LSP 诊断/补全/悬浮，官方称 20 万行仍稳定。
- **无障碍**：gpui-kit 在交互层集成 AccessKit（裸 `gpui` 长期没有，Zed 的 a11y 讨论自 2023 年悬置）。
- **测试**：headless window 渲染真实组件，驱动鼠标/键盘并断言状态、焦点、布局、a11y。
- **i18n**：依赖 `rust-i18n`，提供 `set_locale`。

### 3.3 已知短板与硬约束

| 短板               | 具体表现                                                                                                                                     | 对本项目影响                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 版本锁定           | `gpui-component` 精确依赖 `gpui-pre =0.3.14`，上游每月破坏性变更                                                                             | 升级即迁移；无法「小步跟进」           |
| 生态分叉           | 上游 `gpui` / `gpui-pre` 快照 / `gpui-fast` / `gpui-ce` 四条线并存                                                                           | 选错线等于二次迁移                     |
| 桌面集成缺失       | 无内置更新器、单实例、文件关联、窗口状态、安装包生成                                                                                         | 全部自研或找零散 crate，CI 需重做      |
| WebView 嵌入实验性 | [`gpui-webview`](https://github.com/longbridge/gpui-kit/tree/main/crates/webview) 基于 wry：Windows 上 GPUI 浮层无法覆盖网页，Wayland 不支持 | 想「GPUI 壳 + 现有 React」走不通       |
| 平台门槛           | Windows 需 VS2022 C++ 工作负载 + **CMake**；Linux 需 **Vulkan 驱动** + Wayland/X11                                                           | 企业机、远程桌面、虚拟机可能起不来窗口 |
| 无 DOM             | 依赖 DOM/SVG 布局的库（Mermaid）无法移植                                                                                                     | Markdown 预览功能直接缺失              |

---

## 4. 能力映射：哪些能换，哪些会丢

| 现有能力         | 技术底座                                                                       | GPUI 对应物                             | 判定                                                        |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------- |
| 组件与主题       | Radix 35 原语 + Tailwind v4 + 7 套 OKLCH                                       | gpui-component 75+，`Theme/ThemeColor`  | 🟡 可替代，需重写样式与主题映射                             |
| 代码编辑器       | Monaco 0.56（56 处 / 34 文件）                                                 | gpui-kit Editor（Rope/tree-sitter/LSP） | 🟡 主体可替代；查找替换、多光标、model 池化、右键菜单需自建 |
| 编辑器工作区     | 9,237 行（标签/侧栏/大文件/跨文件搜索）                                        | Dock + Editor + 自研                    | 🟡 需整体重写                                               |
| PDF 阅读与标注   | pdfjs-dist 4.10 + 自研标注                                                     | **无**；需 pdfium/mupdf FFI             | 🔴 最大缺口，工作量大且保真度难对齐                         |
| Office 预览编辑  | docx-preview / SheetJS / JSZip                                                 | calamine / docx-rs（只读为主）          | 🔴 能力明显降级                                             |
| Markdown WYSIWYG | TipTap 3 + 表格/任务/图片                                                      | 仅 Markdown **只读渲染**                | 🔴 富文本编辑器需自研                                       |
| Mermaid / KaTeX  | mermaid 11 / katex 0.18                                                        | **无**（依赖 DOM/SVG 布局与 CSS）       | ⛔ 基本无解，除非嵌 WebView                                 |
| HTML 预览        | iframe + DOMPurify                                                             | gpui-webview（实验性）                  | 🔴 需嵌 WebView 或砍掉                                      |
| 图像/二维码      | canvas + qrcode/jsqr                                                           | `image` / `qrcode` / `rqrr`             | 🟢 更优，Rust 侧反而更强                                    |
| 虚拟滚动/表格    | @tanstack/react-virtual                                                        | VirtualList / Table                     | 🟢 覆盖                                                     |
| 命令面板/搜索    | cmdk + 1,413 行索引                                                            | Command + 自研索引                      | 🟡 需重写                                                   |
| 状态管理         | Zustand 7 个 store + localStorage                                              | Entity/Context + 自研持久化             | 🟡 需重写                                                   |
| i18n             | i18next + 90 片段                                                              | rust-i18n + 片段                        | 🟡 文案可复用，框架换                                       |
| 桌面集成         | updater/single-instance/window-state/vibrancy/dialog/clipboard/shell/drag-drop | 自选 crate + 打包脚本                   | 🔴 全部自理                                                 |
| 测试             | Vitest 190 文件                                                                | gpui test + headless window             | 🔴 需重写                                                   |

图例：🟢 直接受益 · 🟡 可替代但有工作量 · 🔴 明显降级/需自研 · ⛔ 无可行替代。

---

## 5. 三条改造路线与成本

### 路线 A：不改造（推荐基线）

继续 Tauri + React，把精力放回工具密度与体验。**成本 0，风险 0。**

- 若目标是总内存：可评估「WebView2 渲染进程回收」「工具面板 keepalive 上限」「Monaco 实例复用」等局部优化，收益远大于重写。
- 若目标是 Linux WebKitGTK 兼容：先量化失败率，再决定是否值得为少数用户重写全栈。

### 路线 B：抽核心 + GPUI 试点（推荐的第一步）

**B1（已完成，2026-11-25）**：把 `src-tauri/src/core` + `tools` 抽成独立 crate `qraft-core`，不依赖 Tauri。
现状：`src-tauri/qraft-core`（`publish = false`）单独 `cargo check` 即可构建；`qraft_lib` 仅做再导出，`crate::core::*` / `qraft_lib::core::*` 路径不变；261 个引擎单测随 crate 迁移，`cargo test` 通过 workspace `default-members` 同时覆盖两个包。收益：任何前端（Tauri / GPUI / CLI）都能直接复用该引擎。

**B2（1–2 周，验证性）**：新建 `qraft-native/` 二进制，用 `gpui-kit` 复刻 3 个工具（Base64、UUID、Hash）+ 一个 10 万行文本编辑器场景，直接调用 `qraft-core`。产出可量化的 go/no-go 数据。

**B3（不推荐）**：GPUI 壳 + `gpui-webview` 托管现有 React。结论：仍带 WebView、Windows 浮层受限、双栈维护，收益为零。

### 路线 C：全量原生重写

| 区域                                                   | 现有规模 | 重写估算（1 名熟练 Rust 工程师） |
| ------------------------------------------------------ | -------- | -------------------------------- |
| 壳与设计系统（布局/侧栏/设置/命令面板/历史/主题/i18n） | ~8k 行   | 8–12 周                          |
| 简单工具 19 个                                         | ~3k 行   | 6–8 周                           |
| 中等工具 21 个                                         | ~8k 行   | 12–16 周                         |
| 复杂工具 5 个                                          | ~5k 行   | 8–12 周                          |
| 代码编辑器工作区                                       | 9.2k 行  | 10–14 周                         |
| PDF 编辑器                                             | 2.4k 行  | 10–14 周                         |
| Office 编辑器                                          | 1.2k 行  | 8–12 周                          |
| Markdown 编辑器                                        | 2.4k 行  | 10–14 周                         |
| 桌面集成（更新/单实例/关联/拖放/打包/签名）            | —        | 8–12 周                          |
| 测试迁移                                               | 29.3k 行 | 8–12 周                          |
| **合计**                                               | —        | **88–126 周 ≈ 20–29 人月**       |

换算：单人 20–29 个月；3 人全职 8–12 个月，且第一年大概率只能做到 70% 功能对齐。**不含**迁移期间维持 Tauri 版本正常发版的并行成本（通常再加 40–60%）。

---

## 6. 按动机给的决策建议

| 你的真实动机                                    | GPUI 能否解决   | 建议                                                            |
| ----------------------------------------------- | --------------- | --------------------------------------------------------------- |
| 降低总内存（~380MB → 待实测，预期 100–150MB）   | ✅ 唯一有效手段 | 只有这一条足够硬。先做 B2 量化，再决定是否 C                    |
| 更快启动                                        | ⚠️ 边际收益极小 | 不做，164ms 已达标                                              |
| 摆脱系统 WebView 依赖（合规/精简 Linux/供应链） | ✅              | 这是最实质的理由；同时接受 Vulkan 新门槛与 PDF/Office 降级      |
| Linux WebKitGTK 卡顿/装不上                     | ✅ 部分         | 先统计受影响用户比例；GPUI 换成 Vulkan 要求，未必更省心         |
| 减小安装包                                      | ❓ 未知         | 必须实测（gpui-kit 含资源与字体）；debug 版 54.9MB 不能作为依据 |
| 跨平台渲染一致性                                | ✅              | 明确收益，但代价是 C 路线                                       |
| 想要 Zed 级编辑器体验                           | ✅ 长期优势     | 若产品要转向「编辑器/IDE」，GPUI 是对的方向                     |
| 学习/技术探索                                   | ✅              | 做 B1+B2，不要动主干                                            |

**明确的反对场景**：小团队/单人维护、需要保持 47 个工具的功能密度、必须保留 PDF 标注与 Office 预览、无法接受一年没有新功能。

---

## 7. 如果要做：两周一阶段的验证计划

**目标**：用最小成本回答「GPUI 能否承载 Qraft 的核心交互」，而不是证明「能写一个 Hello World」。

| 阶段    | 内容                                                                         | 产出                                  |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| D1–D3   | 抽 `qraft-core`（去掉 Tauri 依赖），保持 10 个 Rust 工具的注册与执行语义不变 | `cargo test` 全绿，Tauri 主程序照常跑 |
| D4–D6   | `qraft-native` 启动：gpui-kit + 侧栏 + 命令面板 + 3 个简单工具（复用 core）  | 可运行二进制                          |
| D7–D9   | 复刻编辑器最小闭环：打开文件、多标签、查找替换、10 万行滚动                  | 性能与手感数据                        |
| D10–D12 | 最大风险验证：pdfium 渲染一页 PDF + 一次文本标注                             | 判断 PDF 是否可行                     |
| D13–D14 | 出 go/no-go 报告                                                             | 指标 + 结论                           |

**量化门槛（任一不达标即 no-go）**：

- 空闲 RSS > 120MB（相对 Tauri 无优势）
- 冷启动 > 300ms
- 中文 IME 出现候选窗错位、丢字、组合态异常
- 10 万行文件滚动/输入出现可感知卡顿
- PDF 两周内达不到 pdfjs 现有能力的 80%
- gpui-kit 升级导致 API 大面积破坏且无迁移指引

---

## 8. 风险登记

| 风险                         | 概率 | 影响 | 缓解                                                     |
| ---------------------------- | ---- | ---- | -------------------------------------------------------- |
| 上游破坏性变更               | 高   | 高   | 锁定 `gpui-pre 0.3.14` + `gpui-kit 0.11`，按季度评估升级 |
| 生态分叉选错线               | 中   | 高   | 只用 `gpui-kit` 单入口，不直接依赖 `gpui`                |
| 平台/驱动门槛                | 中   | 高   | B2 阶段在 Windows 10/11、RDP、Ubuntu Wayland 三环境实测  |
| PDF/Office/Markdown 能力缺失 | 高   | 高   | 产品层面先决定「可降级/可砍」                            |
| 打包、签名、增量更新         | 高   | 中   | 预留 2–3 个月专门做发布基建                              |
| 无障碍                       | 中   | 中   | 必须用 gpui-kit 的 AccessKit 层，NVDA/VoiceOver 实测     |
| 框架维护者集中               | 中   | 中   | 关注 Longbridge 投入；必要时 fork                        |
| 工具语义漂移                 | 高   | 中   | 逐工具对照现有 Vitest 用例做行为快照                     |

---

## 9. 附：本机编译探针

在临时目录（不污染仓库）用 `gpui-kit 0.11.0` 编译最小窗口程序，验证工具链可用性。

| 项       | 结果                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 工具链   | rustc 1.96.0 / cargo 1.96.0 / MSVC（VS2022 C++ 工作负载已具备）          |
| 依赖图   | **812 个 crate**（含 `gpui-pre`、`resvg`、`wgpu`、`accesskit`、`taffy`） |
| 首次编译 | **8 分 04 秒**（dev profile、冷缓存、本机）                              |
| 编译结果 | ✅ **成功**，exit 0                                                      |
| 产物体积 | debug exe **54.9MB**（含调试符号）；`target/` 目录 **3.98GB**            |
| 运行验证 | 启动后进程存活 6 秒，**窗口成功创建**（Windows 11；未做画面内容校验）    |

结论：工具链与平台门槛在本机不构成障碍；但首次编译成本、依赖体积明显高于 Tauri 增量构建，CI 必须做 target 缓存。debug 体积不代表安装包体积，release + strip 后的真实体积仍需单独测量。

**探针代码**（最小可复现）：`gpui-kit 0.11` + `Label` + `Button` + `open_window`，`cargo build` 即通过。

---

## 10. 参考

- GPUI Kit 官网与文档：<https://gpui-kit.com/>
- GPUI Kit 仓库：<https://github.com/longbridge/gpui-kit>
- `gpui-component` 0.11 API：<https://docs.rs/gpui-component/0.11.0/gpui_component/>
- GPUI（Zed）：<https://gpui.rs/> · <https://github.com/zed-industries/zed>
- Discord 迁移报道：<https://www.heise.de/en/news/Discord-is-rebuilding-in-Rust-leaving-React-and-Electron-behind-11516113.html>
- 本项目性能基线：[performance-baseline.md](./performance-baseline.md)
- 本项目技术选型：[prd/03-tech-stack.md](../prd/03-tech-stack.md)
