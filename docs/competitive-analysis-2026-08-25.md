# Qraft 竞品对比分析报告

> 版本:v1.0(2026-08-25) · 基于 Qraft v0.1.2 代码库实测 + 公开资料调研
>
> 维度:UI/UX 设计、功能能力、系统性能 · 结论含量化指标与优先级排序

---

## 0. 方法与对标对象

| 项目 | 定位 | 技术栈 | 规模 | 选取理由 |
|---|---|---|---|---|
| **Qraft**(本项目) | 本地优先桌面开发者工具箱 | Rust + Tauri 2 + React 19 + Tailwind 4 | 34 工具 / 8 分类,前端 803 测试用例,Rust ~376 测试 | — |
| **DevToys 2.0** | 同品类最成熟桌面工具箱 | C# / WinUI(跨平台) | ~31k★,30 内置工具 + 扩展生态 + CLI | 品类标杆,交互范式(Smart Detection)是全行业参照 |
| **IT-Tools** | 工具数量最多的 Web 方案 | Vue 3 + Naive UI(PWA) | ~40k★,~100+ 工具,9 语言 i18n | 功能广度与 i18n/PWA 标杆 |
| **CyberChef**(GCHQ) | 链式数据处理范式标杆 | Web(JS) | ~31k★,300+ 操作(operations) | "配方(recipe)"工作流、Auto Bake、Magic 自动检测 |

辅助参照:He3(Electron,已收缩)、DevUtils(macOS 付费)。性能基线引用第三方 Tauri vs Electron 基准(Nickel benchmark suite 2026-02、johal.in 2026-04、ironcall 实测 2026-06)。

**信息来源**:Qraft 数据来自代码库实查(src/、src-tauri/、docs/release-readiness-assessment.md v2.1);竞品数据来自官网、GitHub README/CHANGELOG 及公开评测。

---

## 1. 总览记分卡

| 维度 | 子项 | Qraft | DevToys | IT-Tools | CyberChef |
|---|---|---|---|---|---|
| **UI/UX** | 视觉美感 | **A−** | A− | B | C+ |
| | 界面布局 | B+ | A− | B+ | B− |
| | 交互模式 | B+ | **A** | B+ | B+ |
| | 可访问性 | B | **A**(WinUI 原生) | C+ | C |
| | 响应式设计 | C+(仅桌面) | B+ | **A**(Web) | B |
| **功能** | 完整性 | B−(34) | B+(30+扩展) | **A−**(~100) | **A+**(300+) |
| | 核心有效性 | A− | A− | B+ | A− |
| | 流程效率 | B | **A** | B+ | A− |
| | 增值功能 | B+ | **A** | B | A− |
| **性能** | 加载速度 | A−(待实测) | A | B(Web 往返) | C(重包) |
| | 资源利用率 | A−(待实测) | B | B | C |
| | 稳定性 | B+(updater 断链) | A− | B+ | B+ |
| | 可扩展性 | C(扩展未落地) | **A**(SDK) | B(插件式架构) | B |

**一句话结论**:Qraft 在视觉工程、安全架构、执行隔离、测试文化上已达一线水准;三大结构性差距是——①交互层缺少 Smart Detection 式「剪贴板感知 + 工具链」;②功能广度不足(34 vs ~100)且无 i18n;③性能目标(<500ms 冷启动/<150MB 内存)全部停留在 PRD 口径,**零实测基准(benches/ 为空)**。

---

## 2. UI/UX 维度

### 2.1 视觉美感 — Qraft 领先项

**Qraft 实测**:
- OKLCH 色彩体系全量落地:每主题约 45 个语义变量(`src/styles/globals.css`,1944 行),半透明用 `oklch(... / x%)`、混色用 `color-mix(in oklab)`;6 套主题(daylight/obsidian/deep-sea/twilight/emerald-night/custom)+ 系统跟随。
- Windows Mica 三层材质架构(`--mica-tint` / `--layer-base` / `--layer-content`),Rust 侧 window_vibrancy 应用;macOS NSVisualEffectView::Sidebar;Linux CSS `backdrop-filter` 回退。
- 自定义 accent 时前景色按 WCAG 2.x 相对亮度自动切换(`src/lib/design-tokens.ts:299 pickAccentForeground`),有守护测试。
- 主题切换仅改 `<html data-palette>` 属性,无 React 重渲染、无 FOUC(`main.tsx:13` 启动前注入)。

**对比**:DevToys 用 Fluent/Mica 但主题不可深度定制;IT-Tools 仅亮暗两态、Naive UI 默认观感;CyberChef 无主题工程。**此项 Qraft 为四者最强**。

**缺口(实例)**:
- U8:~34 处硬编码任意值字号绕过语义 token(如 `text-[10px]`),daylight 亮色下 9–10px 小字对比度处于边缘(docs 评估 U8)。
- U6:旧版 SideNav.tsx(506 行)生产零引用仍在仓库,属视觉/代码双负债。

### 2.2 界面布局

**Qraft**:自定义标题栏(32px,Mica 一体化拖拽区)+ 侧栏(展开 224px/折叠 56px)+ 主区;Welcome Dashboard(hero 渐变 + 4 KPI 卡 + 最近使用 + 收藏);4 视图常驻 keepalive(`display:none` 切换,输入/滚动位置不丢),LRU 上限 8 个工具实例(`lib/keepalive.ts`)。

**差距**:布局模式单一(固定侧栏+主区)。DevToys 提供紧凑间距(compact spacing)选项适配高密度用户;CyberChef 四区操作台(操作列表/配方/输入/输出)对复杂任务信息密度更高。Qraft 的双栏 ResizablePanel(minSize 15–20%,14 处)覆盖了大部分场景,但无「专注模式/全宽工具」切换。

### 2.3 交互模式 — 最大结构性差距所在

**Qraft 已有**:Ctrl+K 命令面板(cmdk,36 条目)、Ctrl+Shift+F 全局文本搜索(VSCode 风,跨编辑器 Tab 橙色高亮 + 锚点脉冲定位)、收藏可排序、最近使用(上限 12)、14 个可自定义快捷键、Esc 层级仲裁(搜索 > 面板 > 弹窗 > 页面)。

**竞品杀手锏,Qraft 缺失**:

| 能力 | DevToys / CyberChef 做法 | 对用户的影响 |
|---|---|---|
| **Smart Detection** | 监控剪贴板,自动识别 JSON/JWT/Base64/图片等类型,侧栏点亮灯泡图标并自动粘贴进匹配工具 | 消除「找工具→粘贴」两步,是 DevToys 的招牌体验 |
| **工具链 chaining** | 工具输出框旁灯泡一键把输出转入下一工具(JSON→Base64→QR 链式) | 多步任务从 N 次复制粘贴降为 N−1 次点击 |
| **Auto Bake** | 输入或配方变化即时产出结果,可关 | 所见即所得 |
| **PiP 小窗** | Compact Overlay 置顶小窗 | 边看视频/文档边用工具 |
| **CLI** | DevToys CLI 与 GUI 共享扩展 | 脚本化调用同一批工具 |
| **URL 分享** | CyberChef 配方+输入编码进 URL | 协作复现 |

**Qraft 自身交互缺陷(实例,已核实)**:
1. **3 个快捷键在设置中可见、可配置,但从未接线**:`execute_tool`(Ctrl+Enter)、`clear_input`(Ctrl+L)、`copy_output`(Ctrl+Shift+C)定义于 `src/types/config.ts:73-75` 与 SettingsPanel,但 `App.tsx:149-161` 仅接线 11 个导航类快捷键。用户配置了一个不生效的快捷键,属于信任伤害。
2. **useShortcut 缺 `e.repeat` 守卫**(`src/hooks/useShortcut.ts`):长按任一快捷键会连续触发,波及全部 14 个绑定(评估报告 U5)。
3. Ctrl+P「切换工具」实际行为是打开命令面板,与 Ctrl+K 语义重复。

### 2.4 可访问性

**Qraft 实测(量化)**:
- `aria-*` 属性 **385 处 / 79 个文件**;`role` 48 处(status/alert/region);sr-only DialogTitle 9 处(cmdk 弹窗可及名称)。
- `focus-visible` **188 处 / 31 文件**,统一 ring 基线;SideNav 有 ↑↓ 方向键循环导航及专门 a11y 回归测试;FolderTree/编辑器左栏有 tabIndex 树形键盘导航。
- 快捷键监听用捕获阶段注册,避免被 Monaco `stopPropagation` 吞掉(`useShortcut.ts:127`)——这是多数 Electron/Web 应用都做错的细节。

**缺口**:
- 全库 **0 处** `prefers-reduced-motion` / `prefers-contrast` / `forced-colors` 适配备(grep 已核实)。搜索锚点脉冲动画、Loader 旋转、Mica 过渡对前庭敏感用户无关闭途径。
- Dialog 关闭按钮 sr-only 文案为英文 "Close",与全中文 UI 不一致(读屏体验割裂)。
- 对照:DevToys 基于 WinUI,天然获得 UIA 自动化树 + Narrator 全量支持;IT-Tools/CyberChef 的 a11y 反而是弱项,Qraft 在同类 Web 系实现中处于上游,但距离原生应用还有 reduced-motion 这类低成本补齐项。

### 2.5 响应式设计

**Qraft**:定位桌面,min 窗口 800×600(tauri.conf.json),窗口状态持久化;响应式手段为 react-resizable-panels(~14 处)+ 容器查询(5 处,如编辑器侧栏 `@max-[240px]/sidebar`)+ 少量断点(全库仅 6 处 sm:/md:/lg:)。窄窗口(<800px)下侧栏折叠后仍可能挤压工具双栏,无专门的窄窗布局态。

**对比**:IT-Tools 作为 PWA 天然覆盖手机/平板(Qraft 无移动端,Tauri 2 支持但未规划);DevToys 官方宣传 "Modern and responsive UI" 且有触摸友好的默认间距 + 紧凑切换。**此项 Qraft 明显落后,但因产品定位为桌面工具,权重可下调**。

---

## 3. 功能维度

### 3.1 功能完整性

数量对比:**Qraft 34**(8 分类)|DevToys 30 内置 + 第三方扩展|IT-Tools ~100+(10 分类)|CyberChef 300+ 操作。

分类级对照(以 IT-Tools 为广度标尺),Qraft 缺失的高频工具:

| 类别 | 缺失工具(IT-Tools 已有) | 高频度判断 |
|---|---|---|
| Crypto | bcrypt、RSA 密钥对生成、HMAC、Token 生成器 | ★★★(后端已有 sha/blake3 基建,增量成本低) |
| Converter | JSON↔CSV、JSON/TOML 三向、罗马数字、大小写转换工具页(现仅有快捷键)、温度单位 | ★★★(JSON→CSV 是表格场景刚需) |
| Network | IPv4 子网计算器、MAC 地址查询/生成 | ★★(后端已有 IP 解析基础) |
| Text | 文本统计(字数/行数/频率)、Email 规范化、ASCII 图、Emoji 选择器 | ★★ |
| Data | IBAN 校验、电话号码解析 | ★ |
| Web | Basic Auth 生成器、chmod 计算器、Docker run→compose、crontab 生成(Qraft 只有解析) | ★★ |

**Qraft 反超项(独有价值)**:
- **文件夹分析器**:流式扫描(max_entries 200k、Top 扩展名、20 容量堆维护最大文件、重复文件洞察)——四个对标项目均无对应物(CyberChef 只能单文件)。
- Monaco 编辑器中文本地化右键菜单、JSON 折叠计数摘要(`monaco-fold-summary.ts`)。
- 证书解码(@peculiar/x509)、色盲模拟、Markdown 5 套排版主题 + 导出。
- 文件关联(7 组扩展名 role=Editor)+ 单实例 + 拖放授权打开。

### 3.2 核心功能的有效性

**Qraft 架构优势**:10 个重计算工具走 Rust IPC(Base64/JWT/URL/GZip/JSON 格式化/哈希/UUID/时间戳/颜色/PNG 压缩 + folder_analyzer),带**超时(默认 5s)/取消(CancellationToken)/panic(catch_unwind)三重隔离**(`src-tauri/src/core/executor.rs:100-135`),`spawn_blocking` 防 tokio 阻塞。24 个纯前端 TS 工具与 PRD「React 层禁止业务逻辑」存在意识偏离(F3),一致性欠佳。

**大输入处理对比**:
- Qraft:>10MB 拒绝(流式路径实际是「全量读入内存一次性解析」的折中,json_formatter.rs L147 注释自认);哈希工具是真流式(64KB 分块恒定内存,GB 级可用)。
- CyberChef:**2GB 文件**直接拖入 + Auto Bake 可关 + 断点/单步。
- 差距:Qraft 的 10MB 上限对「日志切片」「大 CSV」场景不够;且流式 JSON 并非真流式。

**质量保障量化**:前端 803 用例/77 文件全绿;Rust 内联测试 366 个 + 集成 10 个;lint 0 errors(149 warnings)。**缺口**:无覆盖率设施(@vitest/coverage 未装)、无 E2E(playwright/tauri-driver 均无,roadmap 曾虚假勾选已修正)——对标 IT-Tools 每个工具自带 `.test.ts` + `.e2e.spec.ts` 双层。

### 3.3 用户操作流程效率

**Qraft 强项**:keepalive + 输入跨会话持久化(tool_prefs JSON 合并写 COALESCE_WINDOW_MS=8000 防写放大;编辑器 Tab 工作区跨重启恢复);执行历史留痕(200 字符预览,内存上限 200);复制反馈统一(80 字符预览 toast)。「昨天关掉今天接着干」的连续性优于所有 Web 竞品。

**效率短板**:
1. 无剪贴板感知(每次都要手动粘贴);
2. 无工具链传递(多步任务需反复复制粘贴,见 §2.3 表);
3. 大部分工具需手动点「执行」,无 Auto Bake 式实时模式(useDeferredValue 只是渲染优化,不是自动执行);
4. 无批量处理(CyberChef Fork 操作可按行拆分并行跑配方)。

### 3.4 增值功能

| 能力 | Qraft | DevToys | IT-Tools | CyberChef |
|---|---|---|---|---|
| 扩展系统 | ❌(ExtensionsPage 如实标注「规划中」) | ✅ SDK + 文档 | 部分(插件式目录结构) | ❌ |
| CLI | ❌ | ✅ 独立 CLI 应用 | ❌ | ❌(可自托管) |
| 自动更新 | ✅(内置,但签名链路断裂 S1) | ✅ | ✅(PWA 即时) | N/A(Web) |
| 多语言 | ❌(中文硬编码;config 预留 `language:'en'` 字段未消费) | 多语言 | ✅ 9 语言 | 多语言 |
| 零遥测/隐私 | ✅✅(仅更新检查 + 用户主动 IP 查询,PRIVACY.md 白名单,Cargo 注释强制约束依赖引入) | ✅ | Web 需托管方信誉 | ✅ 客户端 |
| 安全加固 | CSP 无 unsafe-eval、capabilities 最小白名单、AuthorizedPaths 文件沙箱(组件级前缀防误配)、IP 白名单校验防 SSRF | 一般 | 一般 | 一般 |

i18n 是增值面最刺眼的缺口:中文硬编码直接把潜在用户盘缩小到中文开发者;types/config.ts:105 已预留字段说明早有规划但未落地。

---

## 4. 性能维度

### 4.1 加载速度

**Qraft 目标 vs 实测现状**:

| 指标 | 目标(prd/01、prd/12) | 预算 | 实测 |
|---|---|---|---|
| 冷启动(点击图标到可交互) | <500ms | 800ms | **❌ 无三平台实测基线** |
| 小输入工具执行 | <50ms | — | **❌ benches/ 目录仅有 .gitkeep,criterion 未建立** |
| 10MB JSON 解析 | <500ms | 1s | ❌ 无实测(实现上走 spawn_blocking,理论可达) |
| 安装包体积 | <25MB(上限 30MB) | — | Rust 二进制 18.6MB(lto=thin)✅ 达标方向正确 |

**前端加载工程(实测数据,docs/release-readiness-assessment.md v2.1)**:
- 入口 index chunk **196KB**;dist 总计 **21.8MB**(Monaco 资源占 65%);
- Monaco AMD 资源经闭包分析裁剪 **23.4MB → 14.2MB**(scripts/copy-monaco.mjs);editor.main.css 由阻塞 link 改非阻塞预取;
- 34 工具全部 React.lazy 分包;rolldown advancedChunks 解决过 mermaid 686KB 静态拖入问题;最大懒加载 chunk:vendor-mermaid 1463KB、markdown-worker 517KB、vendor-katex 509KB;
- reflect-metadata 移入 CertificateDecoder 懒 chunk(P5 修复)。

**横向量化基线(第三方基准)**:Tauri 2 冷启动中位 **320–420ms**(Windows 580ms±20,johal.in 12 应用样本)vs Electron 1120–1800ms;Tauri IPC 往返 0.12ms vs Electron 0.45ms。Qraft 架构选型即站在 <500ms 目标的正确一侧;DevToys(.NET NativeAOT)冷启动同为百毫秒级;IT-Tools 首访受网络往返制约(缓存后 PWA 秒开)。**剩余风险**:入口虽小,首开某重型工具(mermaid/markdown/katex)时懒 chunk 合计 >2MB 需磁盘读取,首次进入该工具会有可感知延迟——无预加载策略(如空闲时 prefetch 高频 chunk)。

### 4.2 响应时间

- 渲染层:`useDeferredValue` 模式覆盖 **9+ 工具**(JSON 树视图仅激活时解析);Markdown 渲染移入 **Web Worker**(失败永久熔断回退主线程);长文档 `content-visibility:auto`;字符统计 useMemo 化(P2 已修)。
- 执行层:Rust 引擎小输入理论 <50ms(spawn_blocking + 编译期 inventory 注册,零反射查找);PNG 压缩 oxipng(parallel+zopfli)。
- **缺口**:全部为定性推断,无 perf.mark/criterion 数字支撑;PRD 要求「PR 不能让冷启动增加 >20ms」(prd/17-dev-workflow.md:580)但无 CI 门禁可执行该规则。

### 4.3 资源利用率

- 目标:空闲内存 <150MB(预算 200MB);内存配额 256MB **计划中未实现**(prd/05-rust-core-engine.md L734「待补内存配额」)。
- 参照:Tauri 应用空闲 42–89MB vs Electron 187–312MB(多来源一致);DevToys .NET 约 80–150MB。Qraft 架构上限良好,LRU(8) 及时 dispose Monaco 实例,虚拟化列表覆盖 HistoryPanel 与 DuplicateDetector(万行去重结果)。
- **风险点**:4 视图 + 8 工具 keepalive 常驻 DOM,叠加 Monaco 多 Tab,长时间使用内存曲线无实测;folder_analyzer inspect 上限 64MB 单文件读入,接近上限时峰值内存可观。

### 4.4 可扩展性

- 新增工具成本低:Rust 侧 inventory 编译期注册 + Tool trait;前端 registry.ts 一处 lazy 注册 + tool-catalog 元数据。双轨制(backendId 可选)灵活。
- 但**面向第三方的扩展系统为零**(ExtensionsPage 仅内置清单),DevToys 已有 SDK+文档+发布渠道;这是生态位差距而非技术差距。
- 平台扩展:三平台构建配置齐备(NSIS/WiX/dmg/AppImage/deb),但 Linux WebKitGTK 发行版碎片化(WebKitGTK 4.1 依赖)是 Tauri 通病,无 CI 矩阵验证证据。

### 4.5 稳定性

- **强项**:panic=unwind + catch_unwind 隔离(Cargo.toml 注释明确不可改 abort);流式任务注册表支持中途取消;原子写(atomicwrites)防配置损坏;JSONL 历史 + 裁剪防膨胀;错误边界 + sonner 兜底;IPC safeInvoke 不抛异常契约。
- **已知不稳定项**:①updater 签名链路断裂 = 发布硬阻断 S1(评估报告唯一 No-Go 项);②Windows 未代码签名 → SmartScreen 首启劝退(README 自己承认);③WebView2 由系统自动更新而 WebKitGTK 由发行版锁定,三平台渲染行为差异无快照测试兜底(无 E2E/视觉回归)。

---

## 5. 改进建议优先级矩阵

排序依据:**用户影响 × 实施难度 × 与项目目标一致性**(项目目标 = 本地优先、快、省心、好看)。

### P0 —— 高影响 × 低难度(1–2 天/项,立即做)

| # | 建议 | 依据 | 验收指标 |
|---|---|---|---|
| 1 | **补齐性能实测基线**:启用 criterion(json 小/大档)+ 写三平台冷启动/空闲内存测量脚本并入 release-checklist | PRD 目标全部无实测,benches/ 为空;没有数字就没有回归防线 | CI 产物含冷启动 ms、空闲 MB、10MB JSON ms 三组数 |
| 2 | **修复 3 个幽灵快捷键**:接线 Ctrl+Enter/Ctrl+L/Ctrl+Shift+C,或先从设置面板隐藏 | 设置里可配置却不生效 = 直接信任伤害;App.tsx:149 已有接线框架,工作量小时级 | 设置中每一项均有真实行为 + 测试 |
| 3 | **useShortcut 加 e.repeat 守卫** | 一行修复,14 个快捷键受益(U5) | 长按不连发,单测覆盖 |
| 4 | **prefers-reduced-motion 支持**:全局动画开关(媒体查询 + 设置项) | a11y 最大缺口,globals.css 单点改动;符合「省心」目标 | 动画敏感设置生效,守护测试更新 |
| 5 | **清理死代码**:删除 SideNav.tsx 等 U6 遗留 | 506 行零引用,维护噪音 | lint/report 无生产零引用组件 |

### P1 —— 高影响 × 中难度(1–2 周/项,v0.2–v1.0)

| # | 建议 | 依据 | 要点 |
|---|---|---|---|
| 6 | **轻量 Smart Detection**:启动/窗口聚焦时读剪贴板,用 tool-catalog 元数据做类型探测(JWT/Base64/JSON/证书正则特征),命令面板顶部推荐 + 一键带入 | DevToys 最大差异化;Qraft 已有元数据与命令面板基建,无需灯泡全量方案即可获得 80% 收益 | 探测失败静默;可设置关闭;不自动粘贴(避免剪贴板隐私争议,与 PRIVACY.md 口径一致) |
| 7 | **工具输出→输入链**:先支持 Base64→JWT→二维码三条高频链(输出区「发送到…」菜单) | 补齐流程效率最大短板;keepalive 架构使跨工具传值实现成本低 | 覆盖 5 条链路即发布 |
| 8 | **i18n 落地(en/zh)**:引入轻量方案(如 i18next 或编译期字典),tool-catalog 元数据双语先行,工具文案渐进迁移 | 中文硬编码限制用户盘;IT-Tools 9 语言证明社区愿为此贡献翻译 | config.language 字段激活;新增文案禁裸中文(lint 规则) |
| 9 | **补齐 6 个高频工具**:JSON↔CSV、bcrypt/HMAC、IPv4 子网计算、文本统计、ULID、Basic Auth | §3.1 清单;sha/regex/IP 基建已在,多为组合题 | 每工具带 store 单测,对齐 IT-Tools 工具级测试惯例 |
| 10 | **修复 updater 签名链(S1)**:收缩到 Windows 单平台或补 minisign secret 流程 | 评估报告唯一硬阻断,影响所有用户的更新安全 | 端到端更新 E2E 通过 |
| 11 | **重型 chunk 空闲预取**:requestIdleCallback prefetch mermaid/katex/markdown-worker | 首次进入 Markdown 工具 >2MB 磁盘读取可感知;入口 196KB 的成果不该被懒加载尖峰吃掉 | 首次进入 Markdown 工具无可感知卡顿 |

### P2 —— 中影响 × 高难度(v1.x)

| # | 建议 | 依据 |
|---|---|---|
| 12 | **Auto Bake 式实时执行开关**(工具级 opt-in,大输入自动退避) | 对标 CyberChef;需防抖与超时联动,注意 10MB 场景回退手动 |
| 13 | **256MB 内存配额强制执行 + 内存遥测面板**(本地 dev 工具) | PRD 待办;防止 keepalive 长会话内存爬升无感知 |
| 14 | **E2E + 覆盖率门禁**:tauri-driver/WebDriver 桥 Playwright,@vitest/coverage 阈值 60% 起步 | 对齐 IT-Tools 双层测试;发布清单目前靠手工冒烟 |
| 15 | **10MB 上限提升至 128MB + 真流式 JSON 解析**(serde StreamDeserializer) | 对标 CyberChef 2GB;改动核心执行路径,风险高收益中 |
| 16 | **扩展系统 SDK**(对标 DevToys) | 生态护城河,但投入数月;建议在用户基数验证后再投 |
| 17 | **代码签名**(Windows EV + macOS notarization) | 消除 SmartScreen/Gatekeeper 劝退;纯成本项(~$200–500/年),视分发规模决策 |

### 明确不建议做的

- **移动端适配**(IT-Tools 强项):与桌面定位冲突,Tauri mobile 成本高,放弃。
- **追赶 CyberChef 的 300+ 操作**:不同物种,Qraft 的对手是 DevToys/IT-Tools 的「高频 30–100 工具」区间。
- **替换 Monaco**:裁剪管线已把成本压到合理区间,换 CodeMirror 迁移成本 > 收益。

---

## 附录 A:关键证据文件索引

| 结论 | 证据位置 |
|---|---|
| 幽灵快捷键 | src/types/config.ts:73-75;src/App.tsx:149-161(仅 11 个接线);src/components/SettingsPanel.tsx:824-826 |
| 无 reduced-motion | 全 src grep `prefers-reduced-motion` 0 命中 |
| benches 为空 | src-tauri/benches/(仅 .gitkeep);prd/11-testing-strategy.md:318-365(计划) |
| 性能目标口径 | prd/01-project-overview.md:374-380;prd/12-performance.md:76-102(预算列) |
| bundle 数据 | docs/release-readiness-assessment.md §三(dist 21.8MB/入口 196KB/Monaco 裁剪 23.4→14.2MB) |
| updater S1 | docs/release-readiness-assessment.md(No-Go 结论) |
| 三重隔离 | src-tauri/src/core/executor.rs:100-135;Cargo.toml profile.release panic="unwind" 注释 |
| Tauri/Electron 基准 | Nickel suite 2026-02;johal.in 2026-04(420ms/89MB vs 1120ms/312MB);tech-insider 2026-04(IPC 0.12ms vs 0.45ms) |
| DevToys Smart Detection | devtoys.app;devtoys.app/doc/articles/.../support-smart-detection.html |
| IT-Tools 规模/i18n | github.com/CorentinTh/it-tools(40.3k★);DeepWiki(9 语言/PWA/工具双层测试) |
| CyberChef 能力 | github.com/gchq/CyberChef README(2GB/Auto Bake/Breakpoints/Magic) |

## 附录 B:评分口径

A=品类最佳实践,B=合格有短板,C=明显落后;± 细分。评分为本报告基于代码实查与公开资料的相对判断,非用户调研数据。
