# Qraft 上线前评估报告（Release Readiness Assessment）

- **评估日期**：2026-08-25（v2.1 修订版，v2 评估 + 同日高优/中优项集中修复）
- **评估对象**：qraft v0.1.2（commit `d9e7ef3` + 本轮未提交修复）
- **评估方式**：v1 报告逐项复核 + 5 个修复提交（`0c42abb`~`a91e87e`）落地真实性验证 + 质量门全量实测 + 构建产物体积测量
- **总体结论**：**No-Go（条件进一步放宽）**。v1 全部阻断/高优项与 v2 列出的中优项（F2/F4/U3/U4/U7/P1~P5）已于本轮全部修复并验证；剩余唯一硬阻断仍为**更新签名链路断裂（S1）**——若收缩发布范围至 Windows 并暂时禁用 updater，即具备最小发布条件。

---

## 0.0 质量基线（v2.1 实测，全部通过）

| 检查项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm lint` | ✅ 0 errors / 149 warnings（基线持平） |
| `pnpm test` | ✅ **77 文件 / 803 测试全通过**（新增历史适配、锚点守护用例） |
| `cargo test` | ✅ **291 lib + 集成套件全绿**（新增历史落库 2 例、失败不落库 1 例） |
| `cargo clippy --all-targets` | ✅ **零警告**（pedantic/nursery 全开） |
| `pnpm audit --prod --audit-level moderate` | ✅ 0 漏洞 |
| `pnpm build` | ✅ dist **21.8MB**（monaco 14.2MB），入口 chunk 196KB |
| `cargo build --release` | ✅ 二进制 **18.6MB**（lto=thin + codegen-units=1 + strip=symbols 首次生效） |

## 0.0.1 v2.1 修复执行记录（2026-08-25）

| 编号 | 事项 | 结果 | 关键验证 |
|---|---|---|---|
| F2 | roadmap 四项虚假勾选 | ✅ 已修正 | prd/19-roadmap.md 分发/质量章节改为如实 `[ ]` 并注明差距；json_minifier 标注能力去向 |
| F4 | history_added 断链 | ✅ 已修复 | 修复**三层断裂**：① 生产代码从未调用 HistorySink（commands/tool.rs 补齐同步+流式两条路径的历史落库）；② HistorySinkImpl 无事件广播（shell/state.rs 注入 app_handle 后 emit）；③ 前后端结构不匹配（historyStore 新增 normalizeHistoryEntry 适配器）。新增 Rust 测试 3 例 + 前端适配测试 3 例 |
| 文档 | README 产品化 + 隐私声明 | ✅ 完成 | README 增加产品介绍/工具一览/下载说明，修正过时技术栈（Vite 8/Tailwind 4/TS 6）与虚假的 docs 描述；新增 PRIVACY.md（零遥测承诺 + 两类网络例外披露） |
| U3 | Monaco 字号脱管 | ✅ 已修复 | theme.ts 新增 getEditorFontSize/FONT_SIZE_CHANGED_EVENT + useEditorFontSize hook；CodeEditor/EditorWorkbench DiffEditor/TextCompare 三处接入，档位切换热更新无需重挂载 |
| U4 | 旧代五件套布局收敛 | ✅ 已完成 | 五个工具全部迁移到「ConfigSection 配置卡 + ResizablePanel 双栏 + 编辑器工具栏动作」新代范式；共享 HeaderAction 收敛至 config-card.tsx；testid/searchAnchor 契约保持或如实登记（search-index 守护测试通过） |
| U7 | QrcodeTool 固定侧板 | ✅ 已修复 | w-80 shrink-0 改为 min(20rem,38%) 比例宽度 + min-w 保护 |
| P2 | 每渲染字符统计 | ✅ 已修复 | code-editor.tsx charCount useMemo 化 |
| P3 | 树视图同步解析 | ✅ 已修复 | 仅树视图激活时解析 + useDeferredValue 降优先级 + 「正在构建树视图…」过渡态 |
| P4 | 大文档写放大 | ✅ 已优化 | 持久化防抖按载荷自适应（500ms→最高 5s），KB 级快速落盘、MB 级合并写 |
| P5 | reflect-metadata + spawn_blocking | ✅ 已修复 | polyfill 移入唯一消费方 CertificateDecoder 懒加载 chunk；json_formatter 同步/流式双路径 CPU 核心 spawn_blocking 化 |
| P1 | Cargo release profile | ✅ 已配置 | lto="thin" + codegen-units=1 + strip="symbols"，release 二进制实测 18.6MB |

**遗留待办（未在本轮范围）**：S1 更新签名（发布阻断）、F1 catalog 标注收尾、U5/U6/U8 小项、E2E/覆盖率设施。

---

## 0. 质量基线（本次实测结果）

| 检查项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过（exit=0） |
| `pnpm lint` | ✅ 0 errors / 149 warnings（shadcn 模板 forwardRef + react-refresh 模式，低风险） |
| `pnpm test`（vitest） | ✅ **77 文件 / 800 测试全通过**（43.5s，较 v1 基线 783 新增 17 个守护测试） |
| `cargo test` | ✅ 全部通过（含 P0 工具集成、executor 超时/panic 隔离测试；1 个桌面环境冒烟测试按设计 ignored） |
| `pnpm audit --prod --audit-level moderate` | ✅ **exit=0，0 漏洞**（v1 为 5 个漏洞，dompurify 全路径解析至 3.4.14 ≥ 3.4.13） |
| `pnpm build` | ✅ 成功；**dist 总计 21.8MB**（v1 为 31MB），其中 monaco 14.2MB（v1 为 23.4MB），入口 chunk 仅 196KB |
| 工作区状态 | ✅ 干净（v1 有 15 个未提交 WIP 文件，现已随 `0c42abb` 收尾提交） |
| 版本标签 | v0.1.0 / v0.1.1 / v0.1.2 已打标 |

## 0.1 v1 → v2 修订摘要

v1 提出的阻断/高优项共 10 条，本次逐项源码级核实，**6 项高优修复全部真实落地且带测试**：

| v1 编号 | 事项 | 状态 | 验证证据 |
|---|---|---|---|
| P0-WIP | 启动性能优化收尾提交 | ✅ 已提交 | commit `0c42abb` |
| P1 | Monaco 冗余资源裁剪 | ✅ 已修复 | copy-monaco.mjs:104,207 AMD 引用闭包分析 + 裁剪后断言；public/monaco/vs 实测 14.16MB，旧版 language/ 目录已不存在 |
| P2 | keepalive 无上限内存失控 | ✅ 已修复 | src/lib/keepalive.ts:15 `MAX_KEEPALIVE_TOOLS = 8` LRU 纯函数 + ToolPanel.tsx:67 接线 + 6 用例单测 |
| S2 | pnpm audit 缺位 + dompurify 漏洞 | ✅ 已修复 | ci.yml:216 / release.yml:80 均有 audit 门禁步骤；dompurify ^3.4.13 + pnpm.overrides；实测 0 漏洞 |
| S3 | temp-* / sharp-bin 仓库污染 | ✅ 已修复 | git ls-files 0 命中；.gitignore:45-47 补齐规则 |
| U1 | 自定义 accent 对比度无防护 | ✅ 已修复 | design-tokens.ts:270,299 WCAG 亮度选前景色；color-theme.ts:111 注入 `--primary-foreground`；SettingsPanel HEX 校验 + aria-invalid |
| U2 | 复制反馈三种范式并存 | ✅ 已修复 | toast-alert.ts:50 `copyTextWithFeedback` 统一入口；UuidGenerator/TimestampConverter/ColorConverter/DuplicateDetector 全部收编；HashCalculator 输出补 CopyAction 按钮 |

---

## 一、功能完整性

### 1.1 已实现 ✅

v1 表格所列架构与功能项全部维持有效（三层架构、Tool trait + Registry + Executor 三重隔离、10 个工具走 Rust IPC、34 个 UI 注册工具、配置/历史持久化、流式事件超出 PRD、CI 六平台矩阵）。新增确认：

| 需求项 | 状态 | 证据 |
|---|---|---|
| 新增工具：ip_parser、folder_analyzer（含流式消费） | ✅ | CHANGELOG [Unreleased]；tool-catalog backendId 标注 |
| dev/prod 数据隔离（标识符分离 cn.qraft.app / .dev） | ✅ | tauri.dev.conf.json + scripts/tauri.mjs 包装 |
| 复制反馈统一交互规范落地 | ✅✅ | 全项目唯一入口 copyTextWithFeedback |
| keepalive 内存容量治理 | ✅✅ | LRU 上限 8 + 状态恢复语义注释明确 |

### 1.2 功能缺口与问题清单

#### F1【低】json_minifier 的 PRD/catalog 未标注能力去向
- **描述**：代码侧已有诚实澄清（registry.ts:55-58 映射 TextProcessor、tool-catalog.ts:223-227 注释、p0_tools_integration.rs:4 说明移除），但 prd/07-tool-catalog.md:63 与 :435 仍将 json_minifier 列为独立 P0 工具完整规格，roadmap:90 维持勾选。
- **建议**：在 tool-catalog.md 与 roadmap 正式标注「能力并入 json_formatter（后端压缩）+ TextProcessor」。
- **工作量**：1h。
- **影响**：需求文档可信度。

#### F2【高】roadmap 四项虚假勾选未修正
- **描述**：prd/19-roadmap.md 中 `:112 macOS DMG（Universal Binary）[x]`、`:114 代码签名与公证 [x]`、`:119 单元测试覆盖率 ≥80% [x]`、`:120 三平台 E2E 测试 [x]` 四项仍与事实不符——仓库无 e2e 目录/playwright、无 @vitest/coverage 依赖与 coverage 脚本、签名见 S1、实际为 x64/arm64 分包而非 Universal。这违反 prd/18 自己确立的诚实记录原则。
- **建议**：立即改为 `[ ]` 并注明差距；将覆盖率设施与 E2E 框架列入 v0.x 收尾任务。
- **工作量**：文档修正 0.5h；覆盖率设施 0.5 天；E2E 框架 2~3 天（可发布后排期）。
- **影响**：发布决策依据失真；签名项同时关联上线阻断（S1）。

#### F3【中】Rust-first 原则系统性偏离维持现状
- **描述**：registry.ts 注册 34 个工具，tool-catalog 带 backendId 走 Rust 的仅 10 个，约 24 个纯前端计算。属有意识偏离（代码注释与 catalog 显式区分），但与 PRD「React 层禁止业务逻辑」强制约束冲突。
- **建议**：PRD 修订为分级策略（大输入/性能敏感必须 Rust，轻量转换允许前端）+ ADR 记录。
- **工作量**：修订文档 2h；全量迁移不现实（4~6 人周），不建议 v0.x 做。
- **影响**：架构一致性；纯前端工具对超大输入无保护（靠 useDeferredValue 缓解）。

#### F4【中】`history_added` 事件前后端断链（死监听）
- **描述**：App.tsx:76 仍订阅 `'history_added'`，但 Rust 端仅 emit `history_cleared`（commands/history.rs:56），全 src-tauri 无任何 history_added 发出点。用户执行工具后 HistoryPanel 不实时刷新。
- **建议**：在 HistorySinkImpl 写入成功后 emit 该事件，或删除死监听并在打开历史视图时重新拉取。
- **工作量**：2~4h（含测试）。
- **影响**：高频操作后的直接体验缺陷。

#### F5【中】P1 工具 6 个 ID 无对应实现
- **描述**：`hmac_generator`、`json_diff`、`hex_codec`、`case_converter`、`diff_tool`、`hash_text` 全仓 0 命中（部分能力并入 text_compare/TextProcessor/base64 文案），roadmap 却全部勾选。
- **建议**：与 F1/F2 一并做 catalog ↔ 实现全量核对并修文档。
- **工作量**：2h。
- **影响**：同 F2。

#### F6【低】i18n 口径矛盾
- **描述**：PRD 称 MVP 仅英文，实况为中文硬编码无 i18n 库。
- **建议**：统一口径为「当前版本中文 UI，i18n 列入 v1.x」。
- **工作量**：1h。
- **影响**：目标用户预期管理。

### 1.3 发布前需完善的功能汇总
1. 更新签名链路修复或收缩发布范围（S1，阻断）
2. roadmap/catalog 文档真实性修正（F1/F2/F5）
3. history_added 断链修复（F4）

---

## 二、UI/UX 评估

**整体评级：B+ → A−。v1 的两个最高伤害项（自定义主题不可读、复制反馈不一致）已修复；主题工程与可访问性基线维持商业水准。剩余问题集中在「三代布局并存」的收敛债务与小窗口适配细节。**

### 2.1 正面发现（维持并增强）
- OKLCH 全语义 token、7 主题块、Mica 派生、Monaco 实时取色、FOUC 防护（维持）；
- 弹窗 DialogTitle/sr-only Description、aria-label 覆盖率、focus-visible ring（维持）；
- **新增**：accent 前景色按 WCAG 自动切换 + HEX 校验错误提示（aria-invalid + role=alert）；复制成功/失败统一文案带内容预览；keepalive LRU 保证长会话流畅性。

### 2.2 问题清单

#### U3【中】Monaco 编辑器字号脱管字号缩放体系
- **描述**：设置五档字号作用于 root font-size，但 Monaco 写死 `fontSize: 13`（code-editor.tsx:589，另 EditorWorkbench.tsx:1098、TextCompare.tsx:219 同样写死）——UI 字变大而代码字不变。
- **建议**：fontSize 改读设置派生变量或按档位映射，三处一并处理。
- **工作量**：0.5~1 天。
- **影响**：视觉障碍用户体验；设置承诺与实际不符。

#### U4【中】三代布局范式并存
- **描述**：新代（CodeEditor 插槽 + CopyAction，~18 个工具）、中代（ConfigSection 卡片）、旧代（裸表单：UuidGenerator/TimestampConverter/RegexTester/HashCalculator/ColorConverter）并存；错误展示四条通路。旧五件套恰是 P0 高频工具。
- **建议**：优先迁移旧五件套到新代布局（可分批）；错误展示统一写入 UI 规范。
- **工作量**：每工具 0.5~1 天 × 5 ≈ 1 周。
- **影响**：产品打磨感最大失分项；高频工具体验割裂最伤第一印象。

#### U5【中】全局快捷键缺 `e.repeat` 守卫
- **描述**：useShortcut.ts onKey（:117-123）无 repeat 判断，按住组合键连续触发设置面板开关等误操作，14 个快捷键全部受累。
- **建议**：keydown handler 增加 `if (e.repeat) return`。
- **工作量**：0.5h + 回归。
- **影响**：键盘用户误操作放大。

#### U6【中】死代码与残留调试 UI
- **描述**：SideNav.tsx 生产零引用（App.tsx 用 layout/Sidebar）却保留完整测试；SettingsPanel.tsx:1037-1048 永久 disabled 的英文 UP/DOWN 调试按钮仍在中文界面显示。
- **建议**：删除 SideNav 及其测试、移除残钮。
- **工作量**：1~2h。
- **影响**：工程可信度。

#### U7【中】QrcodeTool 固定 w-80 侧板小窗口挤压
- **描述**：QrcodeTool.tsx:139 右板 `w-80 shrink-0`（320px）未变，800px 最小宽 + 侧栏展开时编辑器仅剩 ~232px。
- **建议**：改比例布局或窄窗口折叠预览。
- **工作量**：0.5 天。
- **影响**：该工具在小窗口近乎不可用。

#### U8【低】Token 体系建而未全用等细节
- **描述**：约 34 处任意值字号绕过语义 token；5 个 editor token × 7 主题块约 80 行 CSS 无消费方；空状态措辞不一；dialog 关闭 sr-only 英文 "Close"；daylight 下 9~10px 小字对比度余量边缘。
- **建议**：清死 token；字号渐进归一；统一空状态文案规范。
- **工作量**：合计 1~2 天。
- **影响**：主题维护成本与细节打磨感。

---

## 三、性能优化评估

**整体评价：A−。分包架构出色且体积目标重回安全区（dist 21.8MB，入口 196KB）；内存失控风险已由 LRU 治理。剩余瓶颈集中在大输入渲染细节与 Rust 发布配置。**

实测基线（本机 Windows）：dist 总计 **21.8MB**（monaco 14.2MB 占 65%）；最大 chunk vendor-mermaid 1463KB（懒加载）、markdown-worker 517KB、vendor-katex 509KB、index 入口 196KB。构建告警仅提示 >500KB chunk（均为懒加载资源，可接受）。

### 3.1 问题清单

#### P1（原 P6）Cargo release profile 几乎为空【中】
- **描述**：[profile.release] 仅 panic="unwind"（catch_unwind 所需，合理）；缺 lto/opt-level/strip/codegen-units（Cargo.toml:110-111）。dist 前端已达 21.8MB，<30MB 安装包目标的余量完全取决于 Rust 二进制体积——未优化 profile 会推高数 MB。
- **建议**：`lto="thin"`、`codegen-units=1`、`strip="symbols"`，实测对比体积与启动。
- **工作量**：配置 0.5h + 构建验证半天。
- **影响**：安装包达标与否的联动因素；运行时小幅提升。

#### P2（原 P3）CodeEditor 每次渲染对全文做字符统计【中】
- **描述**：code-editor.tsx:382 `Array.from(value).length` 仍在组件体每轮渲染执行；10MB 输入下每次按键物化千万级码点数组（:350 另有 O(n) CRLF 扫描）。
- **建议**：useDeferredValue/memo 化统计，超阈值采样估算。
- **工作量**：0.5 天。
- **影响**：大文件编辑流畅度。

#### P3（原 P4）树形视图同步解析完整输出【中】
- **描述**：JsonFormatter.tsx:502-509 treeValue useMemo 对整个 output 同步 parseSmart，切树视图时 10MB 输出阻塞主线程数百 ms 至秒级。
- **建议**：延迟解析 + 虚拟化，或复用后端解析结果。
- **工作量**：1~2 天。
- **影响**：大 JSON 用户切视图时明显冻结。

#### P4（原 P5）历史与持久化写放大【中·部分改善】
- **描述**：已有改善——单条历史超 256KB 不入库（jsonFormatterStore.ts:59）、会话合并窗口 COALESCE_WINDOW_MS=8000（:64）。遗留：recordHistory 仍存完整内容，50 条 × 256K 字符 ≈ 最坏 12.8MB 字符串驻留；JsonFormatter 文档持久化防抖仍 500ms 且全量重写（:291）。
- **建议**：提高大文档持久化合并窗口；评估历史条目截断存储对还原体验的影响。
- **工作量**：1 天。
- **影响**：内存驻留与磁盘 IO。

#### P5（原 P7）其余小项【低】
- reflect-metadata 仍在 main.tsx:1 进首屏依赖图（唯一消费方在懒 chunk），移入懒模块副作用 import（0.5h）；
- json_formatter.rs:51/:201 serde_json::from_str 在 async fn 内同步执行未 spawn_blocking（10MB 解析占用 tokio worker 数百 ms）（0.5h）。

#### P6（新）pnpm.overrides 设置迁移【低·前瞻】
- **描述**：本地 pnpm 9.12 已警告 "pnpm field no longer read"（overrides 当前因 lockfile 已固化仍生效，audit 0 漏洞证实），但未来 pnpm 升级后将静默忽略 → fresh install 可能把 dompurify 解析回漏洞版本，CI 门禁届时才会暴露。
- **建议**：按 pnpm 迁移指引把 overrides 移至新 settings 位置（pnpm-workspace.yaml）。
- **工作量**：0.5h。
- **影响**：供应链防护的持续性。

#### P7（原 P1/P2）Monaco 进一步裁剪空间【低】
- **描述**：裁剪后 monaco 14.2MB 中 basic-languages 白名单全量保留（约 60 种语言语法包），应用实际使用语言有限；仍有按需收敛空间。
- **建议**：非本期必做；如需再减 2~4MB 可按白名单裁 basic-languages。
- **工作量**：0.5~1 天（需三平台加载回归）。
- **影响**：下载体积进一步优化。

---

## 四、其他影响因素

### 4.1 安全

#### S1【紧急·发布阻断】更新签名链路断裂（v1 遗留，唯一硬阻断）
- **描述**：三个事实叠加导致自动更新链路实际不可用：① 两个 workflow 均无 `TAURI_SIGNING_PRIVATE_KEY` secret 引用（release.yml 仅复制已存在的 *.sig）；② 全仓无 `createUpdaterArtifacts` 配置（Tauri 2 默认 false）→ 构建不产出 updater 签名工件/latest.json 有效签名；③ 而 tauri.conf.json:174-182 updater 插件 active=true + pubkey 已配 → 客户端启用更新但服务端永远提供不了合法签名包。另 macOS signingIdentity 仍为 "-"（ad-hoc），无 Developer ID 公证，他机 Gatekeeper 拦截。
- **建议**：(a) 生成 minisign 密钥对配 GitHub Secrets + 开启 createUpdaterArtifacts；(b) 申请 Apple Developer ID 接入 notarytool；(c) 或本期收缩为「仅 Windows 发布」并临时禁用 updater active、修正 roadmap 勾选。
- **工作量**：updater 签名 0.5 天；macOS 公证 1~2 天（含证书等待）。
- **影响**：不解决则升级机制失效/部分平台无法分发，属上线硬门槛。

#### S4【低】安全小项（维持 v1 结论）
- open-external.ts 直调插件 open() 绕过 validate_url_scheme，建议收编校验到函数内部（0.5h）；
- ip-api 明文 HTTP 例外需在隐私声明披露（文档 0.5h）；
- 正面确认维持：CSP 收敛良好、capabilities 最小化、fs 沙箱带防绕过测试、剪贴板显式触发、密钥不入库、audit 0 漏洞。

### 4.2 浏览器/Webview 兼容性
| 平台 | 状态 | 备注 |
|---|---|---|
| Windows | ✅ 就绪 | WebView2 bootstrapper + NSIS currentUser 维持就绪 |
| macOS | ⚠️ 受阻于 S1 | minimumSystemVersion 11.0 已设；ad-hoc 签名 + 非 Universal 构建 |
| Linux | ⚠️ 待验证 | deb depends 已声明；Wayland 剪贴板兼容性仍未验证（prd/18 登记） |
| CI 矩阵 | ✅ | build × 6 平台矩阵存在 |

### 4.3 文档需求
- ❌ README 仍为开发者向，无产品介绍/截图/用户手册/隐私声明；README 宣称 `docs/ # User documentation` 但 docs/ 实际只有发布检查清单与本评估报告（描述失真，建议顺手修正）。
- ❌ 面向用户的隐私声明缺失（零网络例外披露：ip-api/updater 端点）。
- ✅ CHANGELOG [Unreleased] 内容如实反映近期变更。
- 建议：README 产品化 + 隐私声明为公开发布前置项（1 天）。

### 4.4 性能基线实测缺口（维持 v1）
prd/18 自我登记的冷启动 <500ms、空闲内存 <150MB 目标仍无三平台实测记录（LRU 上限落地后空闲内存预期改善，更应实测固化）。建议发布前在 Windows 实机建立基线并记入 docs。

---

## 五、结论与发布路线

### Go/No-Go 评定：**No-Go（条件放宽）**

v1 的 10 项阻断/高优事项已清零 8 项。当前状态：

**发布阻断（紧急）：**
| # | 事项 | 工作量 |
|---|---|---|
| 1 | S1 更新签名链路（或收缩范围至 Windows + 禁用 updater + 修文档） | 0.5~2 天 |

**最小发布前强烈建议完成（高）：**
| # | 事项 | 工作量 |
|---|---|---|
| 2 | F2/F1/F5 文档真实性修正（roadmap 四处虚假勾选 + catalog 对齐） | 0.5~1 天 |
| 3 | F4 history_added 断链修复 | 2~4h |
| 4 | U5 e.repeat 守卫 + U6 死代码清理（小修打包一批） | 0.5 天 |
| 5 | README 产品化 + 隐私声明 + Windows 性能基线实测 | 1~2 天 |

**发布后两周内分批（中）：** U3（Monaco 字号）、U4（旧五件套布局迁移）、U7（QrcodeTool 侧板）、P1（Cargo profile）、P2（字符统计 memo 化）、P3（树视图延迟解析）、P4（写放大收尾）、P6（overrides 迁移）。

**持续改进（低）：** U8、P5、P7、S4、E2E/覆盖率设施、F3/F6。

**合计估算：阻断 + 高优约 3~5 人天（单人）可达最小发布标准；若坚持 macOS 公证分发则 +2 天证书等待。**

### 项目亮点（值得保持）
1. 测试文化：前端 800 + Rust 全绿，且每项高优修复都伴随新增守护测试（LRU 6 例、对比度用例、复制反馈用例）；
2. 修复质量：copy-monaco 裁剪采用依赖闭包分析 + 运行时关键路径断言，工程严谨；
3. 安全底线兑现：pnpm audit 门禁接入 CI/release 双流水线，实测 0 漏洞；
4. 诚实的已知问题框架（prd/18）继续有效——本次复核再次证明其价值。
