# Qraft 上线前评估报告（Release Readiness Assessment）

- **评估日期**：2026-08-25
- **评估对象**：qraft v0.1.2（commit `3aab316` + 15 个未提交的进行中文件）
- **评估方式**：需求文档（prd/）逐项核对 + 源码审查 + 质量门验证（typecheck / lint / 前端 783 测试 / Rust 300 测试全绿）+ 构建产物分析
- **总体结论**：**尚不具备立即生产发布条件**。工程质量基线优秀（全部测试通过、CI 完整、架构清晰），但存在 2 个发布阻断项（更新签名缺失、WIP 未收尾）、3 个高优先级风险（安装包超体积目标、长会话内存失控、前端依赖审计缺位）。预计 1~2 周集中修复后可达发布标准。

---

## 0. 质量基线（验证结果）

| 检查项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm lint` | ✅ 0 errors，149 warnings（多为 shadcn 模板 forwardRef 模式，低风险） |
| `pnpm test`（vitest） | ✅ **75 文件 / 783 测试全通过**（36.8s） |
| `cargo test` | ✅ **300 测试通过，0 失败**（含 P0 工具集成测试、executor 超时/panic 隔离测试） |
| `pnpm audit --prod` | ⚠️ **5 个漏洞**（3 moderate / 2 low，均为 dompurify 经 mermaid 与 monaco-editor 间接引入） |
| 工作区状态 | ⚠️ 15 个已修改文件 + 2 个未跟踪文件未提交（属"启动性能与 UI 打磨"计划的实施中产物） |

---

## 一、功能完整性

### 1.1 已实现 ✅

| 需求项 | 状态 | 证据 |
|---|---|---|
| 三层架构（Rust Core / Tauri Shell / React UI） | ✅ | `src-tauri/src/{core,shell,commands,store}` 分层完整；UI↔Core 仅经 IPC |
| Tool trait + Registry + Executor（5s 默认超时 + panic catch_unwind 隔离） | ✅ | `core/executor.rs:14-27,100-135`，测试覆盖成功/超时/取消/panic 四路径 |
| 9 个 P0 工具 Rust 实现（base64/url/jwt/uuid/hash/timestamp/color/regex/json_formatter） | ✅ | `src-tauri/src/tools/*`，共约 **90 个 tokio 单元测试** |
| P0 UI 全部经 `invoke('tool_execute')` 走 Rust 后端 | ✅ | JsonFormatter.tsx:359、Base64Codec.tsx:418 等，且有 mock 断言测试 |
| 输入限制（ERR_INPUT_TOO_LARGE 白名单式 per-tool 上限：json 10MB / regex 1MB 等） | ✅ | json_formatter.rs:12,38-43、regex_tester.rs:13 |
| 基础 UI 六件套（侧边导航/Ctrl+K 命令面板/工具面板 Split View/历史/设置/主题） | ✅ | App.tsx L4-L10；快捷键默认值 config.ts:71 |
| 配置与历史持久化走 Rust 端（JSONL + max_history 自动裁剪） | ✅ | store/history.rs:26 起、lib.rs:142-144 |
| 流式支持**超出 PRD**（tool_progress/chunk/completed/failed 事件 + 取消令牌，folder_analyzer 已消费） | ✅✅ | commands/tool.rs:171-212 |
| Updater 代码链路（检查/下载进度/安装事件齐全） | ⚠️ 代码就绪但见 S2 签名问题 | shell/updater.rs、commands/app.rs:203-310 |
| CI/CD（lint/test/build×6 平台矩阵/cargo audit/SBOM cyclonedx/release 流水线） | ✅ | .github/workflows/{ci,release}.yml |

### 1.2 功能缺口与问题清单

#### F1【高】P0 工具 `json_minifier` 名存实亡
- **描述**：PRD 规定 `json_minifier` 为 P0 工具且应实现于 Rust 层；实际 Rust 层无此模块，UI 槽位被改造为纯前端 `TextProcessor`（registry.ts:55-58 复用历史 toolId 以兼容收藏夹数据）。JSON 压缩能力实际并入后端 json_formatter。
- **建议**：二选一——(a) 在 tool-catalog.md / roadmap 中正式将 `json_minifier` 标记为"能力并入 json_formatter + TextProcessor"，消除 PRD 与实现的偏差；(b) 若坚持 PRD 清单，补一个薄 Rust 包装。
- **工作量**：方案 (a) 约 0.5h；方案 (b) 约 1 天。
- **影响**：文档可信度与后续工具开发对齐基准。

#### F2【高】roadmap 存在虚假勾选（分发与质量章节）
- **描述**：`19-roadmap.md` MVP 章节勾选了 4 项实际不存在的能力：
  - "代码签名与公证 [x]" → 实况：macOS `signingIdentity: "-"`（ad-hoc），release.yml 无任何签名 secret（唯一 secret 为 GITHUB_TOKEN）；
  - "macOS DMG（Universal Binary）[x]" → 实为 x64/arm64 分别构建，无 universal-apple-darwin 目标（ci.yml:107-115）;
  - "三平台 E2E 测试 [x]" → 全仓无 e2e 目录/playwright 依赖/E2E job；
  - "单元测试覆盖率 ≥80% [x]" → 无 @vitest/coverage-* 依赖、无 coverage 脚本、无 llvm-cov 配置。
- **建议**：立即修正 roadmap 勾选状态（诚实记录原则是本项目 prd/18 的明文要求）；将 E2E 与覆盖率设施列入 v0.x 收尾任务。
- **工作量**：改文档 0.5h；补覆盖率设施 0.5 天；E2E 框架搭建 2~3 天。
- **影响**：发布决策依据失真；签名问题同时构成上线阻断（见 S2）。

#### F3【中】Rust-first 原则系统性偏离：34 个注册工具仅 10 个走 Rust
- **描述**：registry.ts 注册 34 个工具，其中 24 个标注"纯前端工具"，计算在 JS 完成（如 SqlFormatter.tsx:45 直接调 sql-formatter、CronParser.tsx:47 调 cronstrue、CertificateDecoder.tsx 用 @peculiar/x509+WebCrypto）。代码内有诚实注释，tool-catalog.ts:98-99 用 `backendId` 显式区分，属于**有意识的偏离**而非疏漏，但与 PRD「React 层禁止业务逻辑」的强制约束冲突。
- **建议**：在 PRD 中正式修订 Rust-first 为分级策略（性能敏感/大输入工具必须 Rust，轻量转换允许前端），并记录 ADR；否则制定渐进迁移计划。
- **工作量**：修订文档 2h；迁移全部 24 个工具约 4~6 人周（不现实，不建议 v0.x 做）。
- **影响**：架构一致性、大输入性能上限（纯前端工具对 10MB 输入无保护，仅靠 useDeferredValue 缓解）。

#### F4【中】`history_added` 事件前后端断链（隐性缺陷）
- **描述**：App.tsx:76 订阅 `'history_added'` 事件，但 Rust 端从不发出该事件（全仓 0 命中）。历史新增只能靠启动时加载，HistoryPanel 无法实时刷新，监听器为死代码。
- **建议**：在 HistorySinkImpl 写入成功后 emit 该事件（shell/state.rs:100-106），或删除死监听并在打开 history 视图时重新拉取。
- **工作量**：2~4h（含测试）。
- **影响**：用户执行工具后需重启或重进视图才能看到新历史记录。

#### F5【中】P1 工具 6 个 ID 无对应实现
- **描述**：roadmap v1.0 的 12 个 P1 工具全部勾选 [x]，但 `hmac_generator`、`json_diff`、`hex_codec`、`case_converter`、`diff_tool`、`hash_text` 全仓 0 命中（部分能力被并入 text_compare/TextProcessor/base64 描述文案）。
- **建议**：与 F1/F2 一并做一次"catalog ↔ 实现"全量核对，未实现的取消勾选或在 catalog 标注去向。
- **工作量**：核对+修文档 2h。
- **影响**：同 F2。

#### F6【低】i18n 现状与两份文档互相矛盾
- **描述**：PRD 称 MVP"仅英文"，roadmap 变更记录称 UI 全量中文硬编码（实况确为中文硬编码，无 i18n 库）。
- **建议**：统一口径为"当前版本中文 UI，i18n 列入 v1.x"。
- **工作量**：1h。
- **影响**：目标用户预期管理。

#### F7【低】ExtensionsPage 占位、命令面板模糊搜索为简单 includes
- **描述**：扩展页存在但动态插件机制未实现（v2.0 计划项，一致）；搜索过滤 tool-catalog.ts:512-521 无模糊匹配。
- **建议**：v1.x 引入 fuse.js 或类似库；占位页保留。
- **工作量**：搜索增强 0.5~1 天。
- **影响**：拼写容错体验。

### 1.3 发布前需完善的功能汇总
1. 更新签名私钥配置与 macOS Developer ID 分发（阻断项，见 S2）
2. WIP 的启动性能优化收尾提交（见 P0-WIP）
3. `history_added` 断链修复（F4）
4. 文档真实性修正（F1/F2/F5）

---

## 二、UI/UX 评估

**整体评级：B+（约 7.5/10）。设计系统成熟度显著高于工具层一致性——主题工程达到商业产品水准，工具层存在"三代布局并存"的收敛债务。**

### 2.1 正面发现（超出同类平均线）
- **主题工程**：OKLCH 全语义 token、7 个主题块（obsidian/deep-sea/twilight/emerald-night/daylight/custom/system 跟随）、Mica 材质分层透明度惰性派生（globals.css:92-97）、Monaco 主题从 CSS 变量实时解析生成、启动前应用主题防 FOUC（main.tsx 渲染前调用）；有专门 CSS 结构测试守护（globals.test.ts:20-28）。
- **可访问性基线扎实**：四个弹窗均有 DialogTitle + sr-only Description；图标按钮 aria-label 覆盖率高（窗口控制钮/RailButton/CopyAction 等均达标）；Tab 导航 + focus-visible ring 全覆盖；自绘 tab 组件补齐 role=tablist/aria-selected/键盘操作。
- **窗口适配细节好**：弹窗视口内钳制 + resize 回弹（useDialogWindow.tsx:69-78）；800px 最小宽度下主区无溢出级问题（split view 均 minSize=20 + min-w-0 保护）。
- **加载反馈健康**：lazy+Suspense fallback（role=status）、执行态按钮 disabled+文案切换、HashCalculator 有 Progress 条、Markdown 渲染 Worker 化不阻塞主线程。

### 2.2 问题清单

#### U1【高】自定义强调色无对比度防护
- **描述**：用户可选任意 HEX 作为 accent，但 `primaryForeground` 恒为白色（design-tokens.ts:299）；选浅色（如黄色）时所有 primary 按钮/链接/激活态白字浅底不可读。HEX 输入框亦无格式校验与非法提示（SettingsPanel.tsx:304-309,358-371）。
- **建议**：按 WCAG 相对亮度计算自动切换前景色（黑/白），输入框加 zod 校验 + 即时预览。
- **工作量**：0.5~1 天。
- **影响**：自定义主题是 PRD 明确功能，浅色 accent 下核心交互元素不可读。

#### U2【高】复制反馈三种行为并存 + HashCalculator 无复制按钮
- **描述**：① 新代 CopyAction→带 description 的 toast；② 旧工具（UuidGenerator.tsx:55-59、TimestampConverter、ColorConverter）用裸 clipboard.writeText **静默无任何反馈**；③ DuplicateDetector 直接 toast.success。同一"复制"操作有时弹窗有时无声。哈希值这一最典型复制场景（HashCalculator.tsx:109-117 只读编辑器未传 actions）竟无复制按钮。
- **建议**：统一收敛到 CopyAction 组件；给 HashCalculator 补 actions。
- **工作量**：1~2 天。
- **影响**：用户无法确认操作是否成功的直接可用性问题。

#### U3【中】Monaco 编辑器字号脱管字号缩放体系
- **描述**：设置提供小/标准/大/特大/超大五档字号（作用于 root font-size），但 Monaco 写死 `fontSize:13, lineHeight:20` px（code-editor.tsx:589-590）——UI 字变大而代码字不变，无障碍功能半成品观感。
- **建议**：fontSize 改读设置派生的变量或按档位映射。
- **工作量**：0.5 天。
- **影响**：视觉障碍用户体验；设置面板承诺与实际不符。

#### U4【中】三代布局范式并存
- **描述**：新代（CodeEditor 插槽 + ResizablePanelGroup + CopyAction，~18 个工具）、中代（ConfigSection 卡片：ImageConverter/PngCompressor/QrcodeTool）、旧代（裸表单：UuidGenerator/TimestampConverter/RegexTester/HashCalculator/ColorConverter）并存，错误展示也有内联 alert 盒/写进输出编辑器/ToolPanel footer/全局 toast 四条通路。
- **建议**：优先把旧五件套迁到新代布局（它们恰是 P0 高频工具）；错误展示统一为"工具内内联为主 + toast 为辅"双轨并写入 UI 规范。
- **工作量**：每工具 0.5~1 天 × 5 个 ≈ 1 周（可分批）。
- **影响**：产品打磨感的最大失分项；高频工具体验割裂最伤第一印象。

#### U5【中】全局快捷键缺 `e.repeat` 守卫
- **描述**：按住 Ctrl+, 等组合键会连续触发（useShortcut.ts:117-123），设置面板反复开关；全部 14 个全局快捷键同理。
- **建议**：keydown handler 增加 `if (e.repeat) return`。
- **工作量**：0.5h + 回归。
- **影响**：键盘用户误操作放大。

#### U6【中】死代码与残留调试 UI
- **描述**：SideNav.tsx 生产零引用却带完整测试（覆盖的是不再使用的组件，制造维护混淆）；SettingsPanel.tsx:1024-1037 残留永久 disabled 的英文 UP/DOWN 调试按钮出现在中文界面。
- **建议**：删除 SideNav 及其测试、移除残钮。
- **工作量**：1~2h。
- **影响**：工程可信度。

#### U7【中】QrcodeTool 固定 w-80 侧板在最小窗口挤压严重
- **描述**：生成页右板 `w-80 shrink-0`（320px，QrcodeTool.tsx:139），800px 最小宽 + 侧栏展开时左侧编辑器仅剩 ~232px，近乎不可用。
- **建议**：改比例布局或窄窗口折叠。
- **工作量**：0.5 天。
- **影响**：单工具在小窗口不可用。

#### U8【低】Token 体系"建而未全用"
- **描述**：约 34 处任意值字号（text-[9px]~text-[12px]）绕过语义 token；hero 渐变与 editor-selection 等 5 个 editor token × 7 主题块共约 80 行 CSS 无消费方（Monaco 主题走自身硬编码）；空状态措辞/标点风格不一；dialog 关闭钮 sr-only 为英文 "Close"；daylight 下 9~10px 小字 + muted-foreground 对比度余量不足（≈4.8:1 边缘过 AA）。
- **建议**：清死 token；字号任意值渐进归一；统一空状态文案规范。
- **工作量**：各 0.5 天内，合计 1~2 天。
- **影响**：长期主题维护成本与细节打磨感。

---

## 三、性能优化评估

**整体评价：前端分包架构出色（入口仅 194KB + react-dom 175KB，mermaid/katex/highlight.js/sql-formatter 全部独立懒 chunk，material-icon-theme 确认只取单 SVG 未整包引入）；Rust 端 executor 三重隔离完备。主要风险集中在①安装包体积、②长会话内存、③大输入渲染细节。**

实测基线：dist 总计 **31MB（其中 monaco 占 23.4MB）**，尚未叠加 Rust 二进制 → **<30MB 安装包目标大概率失守**。

### 3.1 进行中的优化（WIP，未提交）
当前 15 个未提交文件正是 `docs/superpowers/plans/2026-08-24-startup-perf-and-ui-polish.md` 的实施产物：rolldown advancedChunks 修复入口静态拖入 mermaid(686KB)/asn1-cms(113KB)、Monaco loader 移出首屏、index.html 阻塞 CSS 改非阻塞预取、8 个工具补 useDeferredValue。**计划明确要求不提交代码，需在完成后统一收尾提交并跑三绿基线（typecheck/lint/test）。**

### 3.2 问题清单

#### P1【高】Monaco 资源整包冗余进安装包（体积目标威胁）
- **描述**：copy-monaco.mjs 将 monaco-editor/min/vs 整树（23.3MB）拷入 public/monaco/vs 并进入 dist。0.56 版本新旧 worker 双份并存：ts.worker 两个副本共 ~13.5MB 内容重复，css/html/json worker 同样双份，另有孤立 toggleHighContrast chunk 1.2MB。脚本注释声称"跳过 dev/esm 和 source map"但 copyDir 无任何过滤逻辑（copy-monaco.mjs:12 vs 49-61）。
- **建议**：拷贝后按语言白名单裁剪 basic-languages、剔除重复遗留 worker 与 toggleHighContrast；或改为按需打包 Monaco ESM（更彻底）。目标 dist monaco ≤ 8MB。
- **工作量**：裁剪方案 1~2 天（含三平台加载回归）；ESM 化 3~5 天。
- **影响**：安装包 <30MB 承诺达成与否的决定性因素；下载转化率。

#### P2【高】keepalive 无上限 × ~47 处 Monaco 挂载点永不销毁（内存目标威胁）
- **描述**：ToolPanel.tsx:56-67 visited 数组只增不减、无 LRU 上限，非当前工具仅 display:none 常驻；每个 CodeEditor 一个 Monaco 实例且 automaticLayout:true 使隐藏实例仍挂 ResizeObserver，卸载才 dispose 而 keepalive 使其永不卸载。JsonFormatter 2 个实例、JwtParser 4 个、ListComparer 3 个、EditorWorkbench 主编辑器+DiffEditor 双实例——访问 10 个编辑器类工具即累积 20~40 个活体 Monaco 实例，**空闲内存 <150MB 目标必然击穿**。
- **建议**：(a) visited 加 LRU 上限（如最近 5~8 个），淘汰时真卸载（store 已保文本状态，恢复成本低）；(b) 或对含 Monaco 的工具隐藏超阈值后降级卸载编辑器；(c) hidden 时暂停 automaticLayout。
- **工作量**：LRU 方案 1~2 天（注意与"keepalive 是既定设计"的计划约束协调，需先与负责人确认取舍）。
- **影响**：常驻工具类应用的核心口碑指标；长时间使用必然卡顿。

#### P3【中】CodeEditor 每次渲染对全文做字符统计
- **描述**：code-editor.tsx:382 `Array.from(value).length` 在函数体每轮渲染执行；10MB 输入下每次按键都物化千万级码点数组，是输入卡顿的直接来源（同文件 :350 还有每次渲染 O(n) CRLF 扫描）。
- **建议**：useDeferredValue/memo 化统计，超阈值采样估算。
- **工作量**：0.5 天。
- **影响**：大文件编辑流畅度。

#### P4【中】树形视图同步解析完整输出
- **描述**：JsonFormatter.tsx:502-509 treeValue useMemo 对整个 output 同步 parseSmart，切树视图时 10MB 输出阻塞主线程数百 ms 至秒级。
- **建议**：延迟解析 + 虚拟化，或复用后端解析结果。
- **工作量**：1~2 天。
- **影响**：大 JSON 用户切视图时的明显冻结。

#### P5【中】历史与持久化的写放大
- **描述**：历史上限 50 条 × 单条 256K 字符 ≈ 最坏 12.8MB 常驻字符串（jsonFormatterStore.ts:57-59）；recordHistory 存完整内容；文档持久化防抖仅 500ms 且全量重写（JsonFormatter.tsx:289-293）——大文档上每次停顿即向磁盘重写数 MB。
- **建议**：超大文档跳过自动历史/截断存储条目、提高持久化合并窗口。
- **工作量**：1 天。
- **影响**：内存驻留与磁盘 IO、SSD 写入寿命。

#### P6【中】Cargo release profile 几乎为空
- **描述**：[profile.release] 仅 panic="unwind"（catch_unwind 所需，合理）；缺 lto/opt-level/strip/codegen-units（Cargo.toml:110-111），二进制体积与运行性能均有让渡。
- **建议**：`lto="thin"`、`codegen-units=1`、`strip="symbols"`，实测对比体积与启动。
- **工作量**：配置 0.5h + 构建验证半天（注意编译时间上升）。
- **影响**：与 P1 叠加决定包体积达标；运行时性能小幅提升。

#### P7【低】其余小项
- reflect-metadata 在 main.tsx:1 进首屏依赖图，唯一运行时消费方（@peculiar/x509 DI）在懒 chunk → 移入懒模块副作用 import（0.5h）。
- json_formatter.rs:50-51 的 serde_json::from_str 在 async fn 内同步执行未 spawn_blocking（10MB 解析占用 tokio worker 数百 ms）（0.5h）。
- vite minify:'esbuild' 较保守（Vite 8 下可接受，暂不动）。

---

## 四、其他影响因素

### 4.1 安全

#### S1【紧急·发布阻断】更新签名私钥未配置 + macOS 分发签名缺失
- **描述**：updater 公钥已配但 release.yml 无 `TAURI_SIGNING_PRIVATE_KEY`，生产更新包无签名 → **自动更新链路实际不可用**（客户端将拒绝无签名更新）；macOS `signingIdentity:"-"` 为 ad-hoc 签名，无 Developer ID 证书与公证 → macOS 包在他人机器上被 Gatekeeper 拦截。roadmap 却勾选"代码签名与公证 [x]"。
- **建议**：生成 minisign 密钥对配置到 GitHub Secrets；申请 Apple Developer ID 并接入 notarytool 公证流程；或本期明确"仅 Windows 发布"并同步修正文档。
- **工作量**：Tauri updater 签名 0.5 天；Apple 公证 1~2 天（含证书申请等待）。
- **影响**：不解决则升级机制失效/部分平台无法分发，属上线硬门槛。

#### S2【高】CI 缺失 pnpm audit（安全底线承诺未兑现）+ 现存 dompurify 漏洞
- **描述**：CHANGELOG.md:85、release-checklist.md:70、prd/13-security.md:407 均宣称"cargo audit + pnpm audit 强制审计"，但 ci.yml:169-214 与 release.yml 只有 cargo audit。实测 `pnpm audit --prod` 报 **5 个漏洞（3 moderate / 2 low）**：dompurify ≤3.4.12 有 XSS 类 advisory（GHSA-cmwh-pvxp-8882、GHSA-55q2-fjhq-7xh7 等），直依赖需 ≥3.4.13，另一路经 monaco-editor 锁死的 dompurify@3.4.8。
- **建议**：CI 补 `pnpm audit --prod --audit-level moderate` 步骤；升级 dompurify 直依赖至 ≥3.4.13；monaco 侧漏洞评估实际暴露面（XSS 需 untrusted HTML 注入路径，当前 CSP 'self' + script-src 无 unsafe-eval 大幅缓解）后在 CI 登记豁免或等上游。
- **工作量**：CI 步骤 0.5h；dompurify 升级 + 回归 0.5 天。
- **影响**：安全底线合规性；markdown 预览/证书工具涉及富文本渲染，XSS 修复宜尽早。

#### S3【中】仓库污染：临时文件与 26.4MB 二进制已提交
- **描述**：git ls-files 显示 temp-alpha-check.cjs、temp-fold-debug.mjs、temp-logo-check.cjs、temp-build-check/、vitest-result.json 及 **temp-sharp-bin/（整个 sharp win32-x64 包，26.4MB，含 libvips DLL 与 .node 原生二进制）**已被跟踪；.gitignore 无 temp-* 规则，问题会复发。仓库 pack 已达 19.2MB。
- **建议**：`git rm -r --cached` 清除 + 补 ignore 规则（temp-*、vitest-result.json）；sharp 本应是 devDependency 由 pnpm 管理，不该手工拷贝入库。
- **工作量**：1~2h。
- **影响**：克隆体积、供应链卫生（二进制来源不可审计）。

#### S4【低】安全小项
- 外链第二通道：src/lib/open-external.ts:8-21 直调插件 open()，绕过应用层 validate_url_scheme（当前调用方已自白名单化，建议收编校验到函数内部）（0.5h）。
- ip_lookup 走明文 HTTP ip-api.com（net/ip_lookup.rs:27，免费档无 HTTPS；已有 IP 白名单防 SSRF、用户手动触发）→ 属登记过的例外，建议在隐私声明中如实披露"两类网络例外"（文档 0.5h）。
- 正面确认：生产 CSP 收敛良好（default-src 'self'、script-src 无 unsafe-eval、connect-src 仅 ipc）；capabilities 九个均限 windows:["main"]；fs 未授插件文件域、读写经 AuthorizedPaths 沙箱（含前缀边界防绕过测试 commands/fs.rs:30-92）；剪贴板无后台监听、符合显式触发；.env 无敏感值且正确忽略；updater 私钥未入库。

### 4.2 浏览器/Webview 兼容性
| 平台 | 状态 | 备注 |
|---|---|---|
| Windows | ✅ 就绪 | WebView2 downloadBootstrapper 已配（tauri.conf.json:150-152）；NSIS currentUser 安装模式 |
| macOS | ⚠️ 受阻 | minimumSystemVersion 11.0 已设；但 ad-hoc 签名使分发受阻（S1）；非 Universal 构建（x64/arm64 分包可接受但与文档不符） |
| Linux | ⚠️ 待验证 | deb depends 已声明 libwebkit2gtk-4.1/libssl3；**Wayland 剪贴板兼容性未验证**（prd/18 自我登记）；WebKitGTK 性能差异已知 |
| CI 矩阵 | ✅ | build job × 6 平台矩阵存在 |

### 4.3 文档需求
- ✅ 已有：CHANGELOG.md、docs/release-checklist.md、prd/ 全套 19 篇架构文档、贡献模板。
- ❌ 缺失：面向用户的 README 产品介绍与截图、隐私声明（零网络的例外披露：ip-api/updater 端点）、用户手册/工具使用说明、CLA（roadmap 自己标注待补充）。
- 建议：README + 隐私说明为公开发布前置项（1 天）。

### 4.4 性能指标实测缺口
prd/18:299-307 自我承认"性能基线数据待补充"：冷启动时间、空闲内存、包体积均无三平台实测记录。**建议发布前建立基线**：Windows 实机测冷启动（目标 <500ms）、空闲内存（<150MB）、安装包体积（<30MB）、10MB JSON 解析（<500ms），并记入 docs。

---

## 五、结论与发布路线

### Go/No-Go 评定：**No-Go（有条件）** —— 阻断项清零后即可发布

**发布阻断（紧急，必须完成）：**
| # | 事项 | 工作量 |
|---|---|---|
| 1 | S1 更新签名私钥 + macOS 签名公证（或收缩发布范围至 Windows） | 0.5~2 天 |
| 2 | WIP 启动性能优化收尾：验证三绿 → 提交 15 个文件 | 0.5 天 |

**强烈建议发布前完成（高）：**
| # | 事项 | 工作量 |
|---|---|---|
| 3 | P1 Monaco 资源裁剪（否则包体积目标失守） | 1~2 天 |
| 4 | P2 keepalive LRU 上限（否则内存目标失守） | 1~2 天 |
| 5 | S2 pnpm audit 接入 CI + dompurify 升级 | 0.5 天 |
| 6 | U1 accent 对比度防护 | 0.5~1 天 |
| 7 | U2 复制反馈统一 + HashCalculator 补复制 | 1~2 天 |
| 8 | F1/F2/F5 文档真实性修正（roadmap/catalog 对齐实况） | 0.5 天 |
| 9 | S3 仓库清理 temp-*/sharp-bin | 0.5h |
| 10 | README + 隐私声明 + 三平台性能基线实测 | 1~2 天 |

**可发布后排期（中/低）：** U3/U4/U5/U6/U7（UI 收敛分批）、P3~P7（性能细项）、F3（Rust-first 策略修订）、F4（history_added 断链，建议提前，仅 2~4h）、F6/F7/U8/S4。

**合计估算：阻断项 + 高优项约 7~11 人天，1~2 周（单人）可达发布标准。**

### 项目亮点（值得保持）
1. 测试文化优秀：前端 783 + Rust 300 测试全绿，组件级 invoke 断言、executor 四路径覆盖、CSS 结构守护测试；
2. 分包与懒加载架构先进：194KB 入口、advancedChunks 精细控制（含 preload-helper/tslib 寄存问题的踩坑记录）；
3. 安全设计认真：CSP/capabilities 最小化、fs 沙箱带防绕过测试、剪贴板显式触发、密钥不入库；
4. 主题系统商业水准：OKLCH 语义 token + Mica 派生 + Monaco 实时取色；
5. 文档工程化程度高：19 篇 PRD 含已知问题的诚实记录框架（虽然本次发现 roadmap 勾选失真，但"每月 review"机制存在）。
