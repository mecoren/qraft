# AGENTS.md

> 本文件是本项目 AI 编码工具的**单一真相源**。其它工具入口若存在,只应引用本文件,不要重复维护规则。

Qraft 是本地优先(Local-first)的跨平台开发者工具箱(DevToys 类应用),Rust 工具引擎 + Tauri v2 + React 前端,无遥测、无账号。

## 快速原则

- **Local-First**:无遥测;出网仅限更新检查与 `src-tauri/src/net/ip_lookup.rs` 的域名白名单(ip-api.com、flagcdn.com)。新增网络访问必须落在 Rust 侧并扩展白名单,不得绕过。
- **工具引擎纯函数约束**:Rust 工具的 `execute` 必须无状态,相同输入 + 相同 context 配置 → 相同输出;禁止在 `execute` 中调用 Tauri API,外部能力一律经 `ToolContext` 注入。
- **toolId 三处一致**:UI 注册表(`src/tools/registry.ts`)、工具目录(`src/lib/tool-catalog.ts`)、后端工具的 `register_tool!` 宏,id 必须严格一致。toolId 同时是收藏/最近使用(localStorage)的持久化引用,**改名即破坏用户数据**,应新增 id 而非修改旧 id。
- **双语同步**:zh-CN 为源语言,en-US 必须同步补齐,`src/en-locale-sweep.test.tsx` 会强制扫描英文缺失。
- **版本单一来源**:版本号只在 `package.json` 维护,经 `scripts/bump-version.sh` 同步到 `src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json`,不要手改后两处;「改版本号」请求按下方[版本发布流程](#版本发布流程改版本号时自动执行)全流程执行(脚本 + 双日志 + CI 绿),不是只改数字。
- **已发布数据契约**:`config.json`(配置)、`history.jsonl`(历史)、localStorage(收藏/最近使用)的结构变更必须有兼容或迁移策略,不直接覆盖已发布格式。
- **提交即 CI 绿**:交付的代码必须能让 CI 跑通——提交/推送前本地跑通 CI 的同等检查(见[常用命令](#常用命令)),前端改动含**全量** `pnpm test`(单文件/单用例通过不代表全量,并行负载会暴露只在 CI 出现的时序问题);红了先定位修复,不得靠重跑碰运气。本地怎么跑都绿、只在 CI 红的,见下文前端约定「测试」小节的时序竞态条目。
- **尊重 dirty worktree**:不要回滚或覆盖非本轮改动;需要动到已修改文件时先读清楚。
- **提交信息**:单行 Conventional Commits + 中文描述,如 `feat(text-editor): …`、`fix(base64): …`。

## 技术栈

| 维度 | 选型                                                       |
| ---- | ---------------------------------------------------------- |
| 桌面 | Tauri v2(Windows / macOS / Linux)                          |
| 前端 | React 19 + TypeScript 6(strict)                            |
| UI   | shadcn/ui 风格(Radix 原语)+ Tailwind CSS v4(CSS-first)     |
| 状态 | Zustand 5(persist 持久化到 localStorage)                   |
| i18n | i18next + react-i18next(zh-CN 源 / en-US)                  |
| 后端 | Rust edition 2024(MSRV 1.85)                               |
| 构建 | Vite 8(rolldown)+ pnpm 9(Node ≥ 22)                        |
| 质量 | ESLint 10、Prettier、rustfmt、clippy、Vitest 4、cargo test |

## 架构边界

**必须在 Rust**

- 工具执行引擎:超时 / 取消 / panic 三重隔离(`src-tauri/src/core/executor.rs`)。
- 后端工具实现:Base64、JSON、JWT、Hash、UUID、正则、时间戳、颜色、文件夹分析等。
- 大文件流式读取:行索引扫描 + 锚点式行窗口(`commands/fs_large_file.rs`)。
- PNG 压缩、IP 归属查询、正则引擎(`regex_lab/`)。
- 系统能力:剪贴板、对话框、Shell 打开、单实例、窗口状态、更新器、文件关联与拖放。
- 配置(`app_config_dir/config.json`)与历史(`app_data_dir/history.jsonl`)持久化。

**保留在前端**

- 全部工具 UI 与交互、虚拟滚动、主题(7 套 OKLCH 主题)、弹出窗口。
- 纯前端 TypeScript 工具:目录条目 `backendId` 缺省即纯前端,不经 IPC。
- Markdown / Mermaid / KaTeX 渲染;HTML 内容必须经 DOMPurify sanitize 后再渲染。

**跨端契约**

- 前端通过 `src/lib/ipc.ts` 包装 invoke,统一走 `CommandResponse` envelope,不要裸 `invoke`。
- IPC 命令在 `src-tauri/src/lib.rs` 的 `invoke_handler` 集中注册;`commands/` 是入口薄层,做参数校验与转发,业务逻辑放 `core/` 或领域模块。
- 拖放进应用的文件路径必须先经 `fs_authorize_dropped_paths` 授权,再做后续读取。

## 新增工具流程

1. `src/tools/<ToolName>.tsx`:组件接受 `ToolProps { toolId, metadata }`,由 ToolPanel 注入挂载。
2. `src/tools/registry.ts`:调 `registerTool(toolId, () => import(...))` 懒加载注册,每工具独立 chunk,启动不加载全部 40+ 工具。
3. `src/lib/tool-catalog.ts`:新增 `CatalogEntry` —— name/description 写中文源字面量,英文进 `EN_TOOLS` 覆盖表;选 Lucide 图标,归入 8 大分类(encoder / tester / formatter / generator / graphic / editor / text / converter);需要弹出新窗口的工具设 `popoutSize`(缺省 900×640)。
4. 文案:`src/i18n/locales/tools/<id>.zh.json` + `<id>.en.json`,扁平全前缀 key(如 `tools.base64_codec.xxx`),构建期自动合并进主 locale。
5. 纯前端工具到此完成;需要 Rust 执行时:实现 `Tool` trait + 文件底部 `register_tool!(Type, &METADATA)` + 在 `tools/mod.rs` 声明模块,并给 CatalogEntry 设 `backendId`。流式工具实现 `StreamingTool` + `register_stream_tool!`,并置 `ToolMetadata.streaming_supported = true`。
6. 执行生命周期统一走 `useTool(toolId)`(execute / executeStream / cancel,卸载自动取消),不要直接 invoke `tool_execute`。

## 目录约定

```text
src/
  components/   # 应用级组件:layout/(侧栏、标题栏)、ui/(shadcn 风格原语)、text-diff/(diff 视图 + worker)
  tools/        # 全部工具 UI;复杂工具独立子目录(code-editor-workspace/、pdf/、folder-analyzer/ 等);测试共置
  lib/          # 共享前端库:tool-catalog、ipc、theme、search-index、popout-window、open-file-routing 等
  store/        # 全局 zustand:ui(openTool 为打开工具唯一入口)、config、toolState、history、search、handoff、toolMenubar
  hooks/        # useTool、useClipboard、useShortcut、useToolHandoff、useDialogWindow 等
  i18n/         # i18next 实例 + locales/(主 locale + locales/tools/ 每工具片段)
  pages/        # WelcomePage、ExtensionsPage
  types/        # 共享 TS 类型:tool / config / history / ipc
  styles/       # globals.css:Tailwind v4 CSS-first 配置 + OKLCH 主题变量
  test/         # Vitest 全局 setup
src-tauri/
  src/
    core/       # 引擎核心:tool(trait)、registry(inventory 注册)、executor(三重隔离)、input/output、error、context
    commands/   # tauri command 入口;#[cfg(not(test))] 使 cargo test 免 Tauri 运行时
    tools/      # Rust 工具实现(base64_codec、json_formatter、jwt_parser、folder_analyzer/ 等)
    shell/      # AppState、CommandResponse、file_open、fs_reveal、updater
    store/      # config / history 持久化
    media/      # png 压缩、large_file 大文件流式读取、text_encoding
    net/        # ip_lookup(域名白名单)
    regex_lab/  # 正则引擎共享逻辑
  tests/        # 集成测试 + benches/(criterion)
scripts/        # tauri.mjs(dev 配置注入)、copy-monaco、copy-pdf-assets、bump-version 等
prd/            # 编号架构文档(01~19),权威架构参考;代码注释可能引用 PRD 编号
```

## 常用命令

```bash
pnpm install
pnpm dev          # 前端 Vite dev(predev 自动拷贝 Monaco / PDF 资产)
pnpm tauri dev    # 桌面开发;scripts/tauri.mjs 注入 tauri.dev.conf.json(dev identifier cn.wait.qraft.dev,与安装版数据隔离)
pnpm build        # tsc && vite build
pnpm test         # vitest run
pnpm lint         # eslint .
pnpm format       # prettier --write .
pnpm typecheck    # tsc --noEmit

cd src-tauri
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

- dev 端口为 **14200** 而非 Tauri 惯例的 1420(规避 Windows Hyper-V 保留端口段);改端口需同步 `tauri.conf.json` 的 `devUrl` 与 `devCsp`。
- CI(`.github/workflows/ci.yml`)执行 cargo fmt --check、clippy -D warnings、cargo test --locked、prettier、eslint、typecheck、vitest;这套就是「提交即 CI 绿」(见[快速原则](#快速原则))的本地等价清单,vitest 跑全量。

## 版本发布流程(改版本号时自动执行)

用户说「改版本号 / 升版本 / bump 到 X.Y.Z」时,按以下顺序完整执行,不要只改数字:

1. **跑同步脚本**:`bash scripts/bump-version.sh X.Y.Z`。它会改 `package.json` 并同步 `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`,随后跑 `cd src-tauri && cargo update -p qraft` 刷新 `Cargo.lock` 的 qraft 自身版本行(脚本不管 lock)。不要手改后两处版本号。
2. **筛选提交写更新日志**:`git log <上一 tag>..HEAD --oneline`(如 `git log v0.2.7..HEAD`)提取该版本跨度内全部提交,**按功能合并提炼重要变更,忽略 docs/style/chore 及纯过程性提交**;版本边界以 tag 为准,不是日期。
3. **两处更新日志都要写**(同一次提交改动):
   - `CHANGELOG.md`(repo 级,Keep a Changelog 格式):新增 `## [X.Y.Z] - YYYY-MM-DD` 段,按 Added/Fixed/Changed 分组,并在文件尾追加 `[X.Y.Z]: …/compare/v<prev>...vX.Y.Z` 链接。
   - `src/lib/changelog.ts`(应用内「关于→更新日志」数据源):在 `CHANGELOG_VERSIONS` 数组头部插入新 `VersionInfo`,summary + changes 双语(zh/en 成对);头部注释补一行「vX.Y.Z 内容基于 git log(v<prev> 标签之后至 YYYY-MM-DD)提炼」。两份内容同源,条目粒度可不同。
4. **验证到 CI 等价全绿**:`pnpm prettier --check` + `pnpm lint` + `pnpm typecheck` + `pnpm test`,以及 `cd src-tauri && cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` + `cargo test`。哪项红了修哪项,直到全绿。
5. **不主动提交**:保持工作区状态交用户确认;用户说提交时按 `chore(build): bump version to X.Y.Z` 提交,tag 命名 `vX.Y.Z`。
6. **历史教训**:0.2.7 发版时只写了 `CHANGELOG.md` 漏了 `changelog.ts`,应用内「关于」页至今缺失该版本——两份必须同步写。

## Rust 约定

- 工具实现 `Tool` trait:`metadata()` 返回 `&'static ToolMetadata`,`execute(input, ctx)` 纯函数式;工具按需构造,不持有可变状态。
- `register_tool!` 基于 `inventory` 静态注册;重复 tool id 在启动断言 panic 属快速失败,是正确行为。
- 错误走 `ToolError` / `EngineError` / `AppError` 体系,错误结构必须可序列化为前端可读形式。
- clippy:`all` deny;`pedantic` / `nursery` / `unwrap_used` / `expect_used` / `panic` / `todo` warn(测试内放宽);`dbg_macro` / `print_stdout` deny,日志用日志插件,不用 `print!`。
- 公共 API 文档注释包含 `# Errors` / `# Panics` 小节;rustfmt 行宽 100。
- release profile 的 `panic = "unwind"` 是 executor `catch_unwind` 隔离的前提,勿改 `"abort"`。
- `cargo test` 不需要 Tauri 运行时;集成测试在 `src-tauri/tests/`,基准在 `benches/`(criterion)。

## 前端约定

**React 与组件**

- React 19 函数组件 + hooks,不写类组件。
- import 类型用 inline `type` 修饰符,如 `import { useEffect, type JSX } from 'react'`;路径别名 `@/*`。
- 非显然设计决策用中文 JSDoc 块注释写在文件 / 函数头部(仓库既有惯例)。
- `@typescript-eslint/no-explicit-any` 是 error,不要写 `any`。

**状态与数据**

- Zustand:全局 store 在 `src/store/`,工具私有 store 就近放 `src/tools/`;persist 持久化到 localStorage。
- 跨 store 协作用 `useXStore.getState()`;打开工具唯一入口是 `uiStore.openTool`。
- IPC 一律经 `@/lib/ipc.ts` 调用;异步统一 `async` / `await`。

**i18n 与文案**

- 应用 chrome 文案在 `src/i18n/locales/zh-CN.json` / `en-US.json`;工具文案进 `locales/tools/<id>.{zh,en}.json` 片段,与主 locale 解耦,多工具可并行迁移。
- 工具目录的名称 / 描述用 `tool-catalog.ts` 就地 `LocalizedText { zh, en }`(不走 i18next)。
- 测试 locale 固定 zh-CN(setup 已处理),不要在用例里自建语言环境。

**样式与 UI**

- Tailwind v4 CSS-first:配置、主题变量、语义 token 全在 `src/styles/globals.css`(OKLCH + `data-palette`),没有 tailwind.config。
- 优先用 `components/ui/` 的 shadcn 风格原语;className 合并统一用 `cn()`(`@/lib/utils`);图标用 lucide-react。
- **表单控件一律用 shadcn 原语,禁止原生控件**:下拉用 `Select` + `SelectTrigger/SelectContent/SelectItem`(PdfEditor `h-7 w-20 text-xs` 为工具条内嵌尺寸基准),开关用 `Switch`,输入用 `Input`,不要写原生 `<select>/<input type="checkbox">`(样式与主题跟随断裂,如 Markdown 编辑器主题切换曾用的原生 select)。浏览器默认弹出的原生下拉/日期框不受主题变量控制,是审查红线。
- HTML 内容渲染前必须经 DOMPurify sanitize。
- **字体分工**(跟随「设置 → 字体」的两族 token):
  - 输入框、Select、开关等**非编辑器控件一律用 UI 字体**(默认继承,不要加 `font-mono`,密钥 / secret / 字母表这类"内容像代码"的输入框也不例外);
  - `font-mono` / `code` / `pre` **仅限代码与等宽内容场景**:编辑器(Monaco、行号编辑器)、代码片段、快捷键 kbd、哈希 / 时间戳 / IP / 编码结果等技术性只读展示。

**工具配置栏标准**(全仓库统一,新工具一律遵守)

- 配置区一律用 `ConfigSection` + `ConfigRow` **caption 微标签模式**(只传 `caption` / `captionHint`,不传 `label` / `hint`):左侧 96px 定宽小标签列,控件列占满剩余宽度、从左缘铺开并 `flex-wrap` 流动换行。基准实现见 `src/tools/TextProcessor.tsx` 配置区。
- `ConfigSection` 传 `headerHint` 即启用 `h-7` 紧凑标题行(左侧「配置」+ 右侧一行说明);`headerAction` 只在配置区有折叠/展开等动作时才用。栏级共性说明写进 `headerHint`,行级说明写进 `captionHint`(悬浮展示),不再使用 `label` + `hint` 双行写法。
- 行内控件统一紧凑尺寸:`Input` / `SelectTrigger` 用 `h-7 text-xs`,按钮用 `Button size="sm"`(`gap-1 px-3.5`、图标 `size-3.5`),`Switch` 必须包在带可读文字的 `<label className="flex items-center gap-1.5 text-xs text-muted-foreground">` 内或带 `aria-label`;组间间距 `gap-x-3 gap-y-2.5`。
- 配置项一律留在配置栏:会撑高面板标题栏的表单控件不得内嵌标题栏,应上移到配置区。

**工具主区左右分栏标准**(全仓库统一布局契约,新工具一律遵守)

- 凡工具主区为「输入 → 输出」或「参数 → 结果」形态(转换器 / 编解码器 / 生成器类),主区用 `ResizablePanelGroup orientation="horizontal"` 左右分栏,参照 GzipCodec(双编辑器)与 QrcodeTool(编辑器 + 非编辑器面板)两档基准,不是上下堆叠或固定 grid 对半。
- 配置项(密钥 / 算法 / 方向开关等)不进分栏,统一收进顶部 `ConfigSection / ConfigRow`;会撑高标题栏的控件(如默认 h-9 的 SelectTrigger)禁止内嵌面板标题栏,压到 h-6 或上移配置区。
- 分栏结构:`<ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">`(尺寸用**字符串**百分比,数字会被 react-resizable-panels v4 当作像素);左面板朝分隔缝一侧 `border-r`,右面板 `border-l`;`CodeEditor` 用 `className="h-full rounded-none border-0 border-r"`(或 `border-l`)贴缝。
- 非编辑器面板(预览 / 参数摘要 / 结果 / 大字号展示等)做成与 CodeEditor 同构的「编辑框」,三层结构照抄基准实现 `src/tools/CertificateDecoder.tsx` 右侧结果区:
  - 外壳 `flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-l`(`border-l` / `border-r` 取朝向分隔缝的那一侧);`min-h-0` 与 `overflow-hidden` **必须带**,否则长结果把面板撑破、标题栏被挤出可视区。
  - 标题栏固定 `flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2`,标题 `min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground`。**标题的 `min-w-0 flex-1` 不可省**:少了它标题只占内容宽,`justify-between` 形同失效,动作区紧贴标题而非右对齐(公钥解析器曾如此,复制按钮跑到标题右边);也不要自创 `shrink-0 items-center gap-2` 之类的标题栏变体。
  - 内容区 `min-h-0 flex-1 overflow-auto`;动作区只放纯文字/图标按钮(图标 `size-3.5` + `text-xs`,如 `CopyAction`),不用 Button 组件;底部状态栏可按需用 `border-t border-input px-2 py-0.5 text-xs tabular-nums text-muted-foreground`。
- 满高预览区不要嵌 Radix ScrollArea(其 viewport 的 table 包裹会打断高度链),用普通 `div.min-h-0 flex-1 overflow-auto` + flex 居中。
- **二选一语义(方向 / 模式)一律用 ConfigRow 分段控件,不得用 `Switch` 或只有两项的 `Select`**:`Switch` 只能表达「开 / 关」布尔态,读不出「生成 / 解码」「加密 / 解密」「TOTP / HOTP」这类互斥方向语义(BasicAuth / AES / GZip 曾用开关表达方向);两项下拉还会把可比选项藏进点开才见的浮层(PngCompressor 的无损 / 有损曾如此)。基准实现是 `src/tools/Base64Codec.tsx` 的方向行,已统一到 BasicAuthGenerator / AesCrypto / GzipCodec / HtmlCodec / OtpGenerator / JsonCsvConverter / HashCalculator / QrcodeTool / PngCompressor。
  - 结构:`<Tabs value={...} onValueChange={...}><TabsList className="h-7 w-fit">` + 每个 `<TabsTrigger className="gap-1 px-2 py-0.5 text-xs">`(无图标的省 `gap-1`)。
  - `h-7` + `text-xs` 必须显式覆盖(shadcn 原语默认 `h-10` / `text-sm` 会撑高整行,与同行 `h-7` 的 Switch / SelectTrigger 明显不齐);`w-fit` 也必须带——曾写死 `w-36` / `w-40`,固定宽度会在段内留下大片左右留白,`inline-flex` 随内容收缩才是期望形态。
  - tab 图标 `size-3.5`;编码 / 解码类方向用 `ArrowUpFromLine` / `ArrowDownToLine`,其余按语义取(`Lock` / `Unlock`、`Package` / `PackageOpen` 等)。
  - 边界:判断依据是「互斥的语义模式」还是「无方向的取值档位」。方向 / 模式(生成↔解码、加密↔解密、压缩↔解压、无损↔有损、TOTP↔HOTP)用分段控件;数值 / 算法 / 格式类取值(缩进 2 与 4 空格、进制、算法、UUID 版本、时区)即使只有两项也仍走 `Select`,便于后续扩展选项。忌通栏 Tab 条与自创标题栏样式。
  - 测试:Radix Tabs 在 `onMouseDown` 时激活(不是 `click`),断言写 `fireEvent.mouseDown(screen.getByTestId('dir-xxx'))`;每个 `TabsTrigger` 保留稳定 `data-testid`(如 `dir-encode` / `dir-decode`)。
- ConfigRow 的 caption 微标签(96px 定宽小标签列)放不下行级说明:该行描述统一经 `captionHint` 传 i18n 文案,渲染为标签文本上的原生 `title`——浮层样式由全局 title 接管层(`global-title-tooltip`,main.tsx 挂载)统一渲染,勿自引 Radix Tooltip 或塞回 hint 行。title 挂可见文本而非外层容器,悬停空白不弹。
- CodeEditor 的 `actions` 插槽是**无 gap 容器**:纯文本徽标 / 状态行(自身无内边距,如统计徽标)与按钮组相邻时,在按钮组上手动加 `ml-2`(8px,与树形等自带 `gap-2` 的标题栏对齐);不要改共享 CodeEditor 加全局 gap(影响全部工具标题栏)。

**测试**

- Vitest + jsdom + @testing-library/react;测试与源文件共置(`*.test.tsx`)。
- 写测试前先读 `src/test/setup.ts`:Tauri API 已 mock、Monaco 以 textarea shim、虚拟列表依赖(ResizeObserver、非零 clientHeight)已铺。
- Monaco shim 渲染为容器内**受控 textarea 且不带 testid**:对可编辑 CodeEditor 输入用 `screen.getByTestId('<容器testid>').querySelector('textarea')` 再 `fireEvent.change`;真实浏览器验证时 Monaco 内容读 `monaco.editor.getModels()`,`querySelector('textarea')` 拿到的 inputarea 恒空。
- 改 IPC / 命令契约时,前端跑 `pnpm typecheck` + `pnpm test`,Rust 跑 `cargo test`。
- **只在本机绿的时序竞态**:CI 单红而本地单跑/全量跑都绿,基本都是负载拉开的时序窗口(本机 CPU 快,慢机器上顺序反过来)。定位方式:临时把可疑的一侧推迟(如把挂载即 `focus` 改成 `setTimeout(…, 50)`),人为放大窗口逼出与 CI **一字不差**的报错,确认假设后落地守卫,再撤掉临时改动;不要用重跑变绿、`retry`、加 `waitFor` 碰运气了事。典型坑:shadcn `Popover` 是 Radix **非 modal** 分支,`DismissableLayer` 对任何外部 `focusin` 都直接 dismiss,所以点击触发它之前必须先等编辑器/挂载侧的 focus 落定(`MarkdownEditor.test.tsx` 的 Tab 关闭两例即此模式)。

## 通用代码规范

- 非显然函数 / 方法上方写文档注释:TS/JS 用多行 JSDoc,Rust 用连续 `///`;getter/setter、显然一行包装、纯字面量常量可省。
- 优先早返回,避免把主流程包进嵌套 `if`。
- hooks、变量声明、副作用、不同语义阶段和 `return` 前用空行分组。
- 函数体内少写注释;只解释隐藏约束、反直觉行为或规避原因。
- 不写历史残留注释,不引用 TODO 阶段号或外部行号。
- 不做超出当前需求的抽象、兼容垫片或提前优化。
- 改 UI 后必须实际操作验证主路径与边界,不只靠类型检查。

## 外部文档

- Tauri v2:<https://tauri.app/llms-full.txt>
- React 19:<https://react.dev/reference/react>
- Tailwind CSS v4:<https://tailwindcss.com/docs>
- shadcn/ui:<https://ui.shadcn.com>
- Zustand:<https://zustand.docs.pmnd.rs>
- i18next:<https://www.i18next.com> · <https://react.i18next.com>
- Vitest:<https://vitest.dev/guide/>
