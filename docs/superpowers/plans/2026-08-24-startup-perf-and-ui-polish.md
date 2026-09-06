# 启动性能与 UI 打磨优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除启动时被静态加载的重型依赖(mermaid 686KB、asn1-cms 113KB、monaco 包装器 22KB、Monaco CSS 342KB 阻塞渲染),并消除 8 个工具在大输入下逐键同步重计算造成的输入卡顿,外加一处加载态 UI 统一打磨。

**Architecture:** 三条主线:(1) 用 rolldown 原生 `advancedChunks` 替换 `manualChunks`,把 Vite 虚拟模块 `vite/preload-helper` 与共享依赖 `tslib` 钉进独立小 chunk —— 二者此前分别被 rolldown 并入 mermaid 分包与证书 ASN.1 分包,导致入口 chunk 为拿到它们而**静态**加载这两个与启动无关的重型库(已实测验证修复有效);(2) 把 Monaco loader 配置从 main.tsx 移到惰性的编辑器模块图内、把 index.html 中阻塞渲染的 Monaco CSS 改为非阻塞预取;(3) 为逐键全量解析输入的工具补上项目既有模式 `useDeferredValue`(DuplicateDetector.tsx 已用此模式),让大文本输入不再被 JSON.parse / sql-formatter / diff 等重计算卡住。

**Tech Stack:** Vite 8(rolldown 内核)+ React 19 + TypeScript + vitest + Tauri 2

## Global Constraints

- **用户明确要求:不提交代码。所有任务不得执行 `git commit` / `git stash`;仅修改工作区文件。**(覆盖本技能默认的「每任务一提交」步骤)
- Node >= 22,pnpm >= 9(package.json engines)。
- 构建目标锁定 `['es2022', 'chrome120', 'safari16']`,不得改动(vite.config.ts 注释说明 esbuild 降级限制与 BigInt 依赖)。
- 每个任务完成后必须保持三项全绿:`pnpm typecheck`、`pnpm lint`、`pnpm test`(783 个测试基线)。
- 所有新增注释使用中文,遵循代码库现有注释风格(解释「为什么」而非「是什么」)。
- 不改动 Rust 端(src-tauri)与本计划的 UI 视觉规范;主题 token 一律走 CSS 变量,禁止硬编码色值。
- 工具组件的 keepalive 架构(App.tsx display:none 切换、registry.ts memo+lazy)是既定设计,**不要**为「省内存」移除常驻挂载。

## 背景:已核实的问题清单(含证据)

| #   | 问题                                                                                                                                                                                                                                                                                                           | 证据                                                                                                                                         | 影响                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | 入口 chunk 静态导入 `vendor-@mermaid-js/parser`(686KB,min/gzip 152KB)只为拿 Vite preload-helper                                                                                                                                                                                                                | `dist/assets/index-*.js` 含 `import{c as w}from"./vendor-@mermaid-js/parser-*.js"`,`w` 即 `__vitePreload`;dist/index.html modulepreload 该包 | 启动多下载/解析 ~686KB                          |
| 2   | 入口 modulepreload `vendor-@peculiar/asn1-cms`(113KB):radix 右键菜单族与 @peculiar 族共享 tslib,rolldown 把 tslib 并进了 asn1-cms 分包                                                                                                                                                                         | sourcemap 显示 asn1-cms chunk sources 含 `tslib@2.8.1/tslib.es6.mjs`;react-context-menu chunk 有 `import{_t,ft,gt}from"...asn1-cms..."`      | 启动多下载 ~113KB(27KB gzip)                    |
| 3   | main.tsx 顶层静态 `import monacoLoader from '@monaco-editor/loader'` → monaco 包装 chunk 进入入口静态图                                                                                                                                                                                                        | dist/index.html modulepreload `monaco-QzYrj-lY.js`(21.5KB);src 内其余 monaco 引用全是 type-only                                              | 启动多执行 22KB JS + loader.config              |
| 4   | index.html 以 `<link rel="stylesheet">` 阻塞式加载 editor.main.css(341.9KB)+ codicon.css,仅编辑器工具需要                                                                                                                                                                                                      | public/monaco/vs/editor/editor.main.css 实测 341.9KB                                                                                         | 首屏渲染被 CSS 解析阻塞                         |
| 5   | 8 个工具在 useMemo 中对**整个输入**做同步解析/转换,无 useDeferredValue:JsonPathTester(JSON.parse+JSONPath)、JsonYamlConverter(JSON.parse/YAML.parse)、JsonArrayTable(JSON.parse)、SqlFormatter(sql-formatter)、XmlFormatter(DOM 解析)、XmlXsdTester(DOM+遍历)、ListComparer(O(n·m) 对比)、IpParser(逐字符解析) | 各文件 useMemo 依赖 `[input…]`,输入框 onChange 直写 state;DuplicateDetector.tsx:241 已示范 `useDeferredValue` 模式                           | 粘贴大文本后每个按键都触发全量重算,输入明显卡顿 |
| 6   | ToolPanel 的 Suspense fallback 是纯虚线框文字「加载工具…」,无旋转指示器;项目其他加载态统一用 `<Loader2 className="animate-spin" />`(font-picker.tsx:210、IpParser.tsx:273)                                                                                                                                     | ToolPanel.tsx:91-99                                                                                                                          | 加载态视觉不一致                                |

UI 其余方面(焦点环、aria-label、空状态、tooltip、过渡动画、主题 token 化、滚动条统一、虚拟化列表)经核查均已达标,不在本次范围(YAGNI)。

---

### Task 1: advancedChunks 分包修复(preload-helper 与 tslib 隔离)

**Files:**

- Modify: `vite.config.ts:48-69`(build.rollupOptions.output)

**Interfaces:**

- Consumes: 无(纯构建配置)
- Produces: 产物 chunk 布局契约,后续任务的构建验证依赖它:
  - 存在 ~1KB 的 `dist/assets/runtime-*.js`(承载 `__vitePreload`)
  - 存在 `vendor-tslib-*.js`
  - `dist/index.html` 的 modulepreload 列表**不含** `mermaid` 与 `peculiar`

- [ ] **Step 1: 记录基线(修复前证据)**

Run: `pnpm build; Select-String -Path dist\index.html -Pattern 'modulepreload' | Select-String 'mermaid|peculiar'`
Expected: 输出两行 modulepreload(`vendor-@mermaid-js/parser-*` 与 `vendor-@peculiar/asn1-cms-*`)。

- [ ] **Step 2: 替换 manualChunks 为 advancedChunks**

将 `vite.config.ts` 中 `rollupOptions:` 起的整段(manualChunks 函数)替换为:

```ts
    // 依赖分包:把体积大/变更频率低的第三方库单独成 chunk,
    // 提升浏览器/WebView 缓存命中率,避免任意工具改动都让用户重新下载整个 vendor。
    // 使用 rolldown 原生 advancedChunks(而非 manualChunks):
    // Vite 的虚拟模块 vite/preload-helper 不受 manualChunks 管辖,会被 rolldown
    // 放进「第一个被共享的大依赖」chunk —— 实测曾落入 mermaid 分包,导致入口为拿到
    // 该辅助函数而静态加载整个 686KB 的 @mermaid-js/parser。这里用最高优先级组把它
    // 钉进独立的 runtime 小 chunk,入口只静态依赖 ~1KB 的 runtime。
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'runtime', test: /vite[\\/]preload-helper/, priority: 300 },
            // tslib 被 radix 系(首屏侧边栏右键菜单)与 @peculiar 系(证书工具,懒加载)
            // 共同依赖;不显式钉出时 rolldown 会把它并进 asn1-cms 分包,导致入口为拿
            // tslib 而静态加载 ~113KB 的证书 ASN.1 解析器。高优先级组强制其独立成小包。
            { name: 'vendor-tslib', test: /[\\/]tslib[\\/]/, priority: 150 },
            // @monaco-editor/(loader|react) 仅编辑器类工具(懒加载 chunk)使用。
            // 注意不能用 id.includes('monaco-editor') 这类宽泛匹配:pnpm 的
            // .pnpm/@monaco-editor+react@… 目录名同样含该子串,且实测 rolldown 会把
            // 入口必需的 react 本体寄存进该组 chunk,入口为拿 react 又得静态加载它。
            // 显式钉出后,包装层(~22KB)只在打开编辑器工具时才随懒 chunk 加载。
            { name: 'vendor-@monaco-editor', test: /[\\/]@monaco-editor[\\/]/, priority: 150 },
            // 同理显式钉出 react 本体,避免被寄存进某个懒加载分包导致入口静态依赖它
            { name: 'vendor-react', test: /[\\/]node_modules[\\/]react[\\/]/, priority: 160 },
            {
              name(id) {
                if (id.includes('@tauri-apps')) return 'tauri';
                const parts = id.split('node_modules/');
                const last = parts[parts.length - 1];
                const match = last.split('/')[0];
                if (match.startsWith('@')) {
                  // 作用域包(@xxx/yyy)取两级
                  const scoped = last.split('/').slice(0, 2).join('/');
                  return `vendor-${scoped}`;
                }
                return `vendor-${match}`;
              },
              test: /node_modules/,
            },
          ],
        },
      },
    },
```

注意:正则必须写成 `/vite[\\/]preload-helper/`、`/[\\/]tslib[\\/]/`(方括号内的 `\\/` 表示正斜杠或反斜杠各一个字符)。若误写成四个反斜杠会导致组永远匹配不到、静默退回旧行为。

> **执行期修正记录:** 初版配置曾用 `id.includes('monaco-editor') return 'monaco'` 隔离 Monaco 包装层;Task 2 执行时经 sourcemap 核实该规则反而把 react 本体寄存进了 'monaco' chunk(pnpm 虚拟路径 `.pnpm/@monaco-editor+react@…` 含同名子串),入口为拿 react 仍静态依赖它。最终版如上:`@monaco-editor` 与 `react` 各自显式成组。

- [ ] **Step 3: 构建并断言产物布局**

Run:

```powershell
pnpm build
Select-String -Path dist\index.html -Pattern 'modulepreload' | Select-String 'mermaid|peculiar'
Get-ChildItem dist\assets -Filter 'runtime-*.js' | ForEach-Object { $_.Name }
Get-ChildItem dist\assets -Filter '*tslib*' -Recurse | ForEach-Object { $_.Name }
```

Expected:

- 第一条 Select-String **无输出**(两个重型包均退出启动预载)
- `runtime-*.js` 存在且 ≈1KB
- `vendor-tslib-*.js` 存在且 <10KB

再确认入口静态 import 列表不含 mermaid(双重保险):

```powershell
$idx = Get-ChildItem dist\assets\index-*.js | Select-Object -First 1
[regex]::Matches((Get-Content $idx.FullName -Raw), 'from"\./[^"]+"') | ForEach-Object Value | Sort-Object -Unique | Select-String 'mermaid'
```

Expected: 无输出。

- [ ] **Step 4: 回归三件套**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: typecheck 无输出、lint 通过、783 个测试全部 passed。(vite.config.ts 不在 tsc/eslint 影响面内,test 与构建产物无关,但作为安全网必须跑。)

---

### Task 2: Monaco loader 配置延迟至编辑器模块图

**Files:**

- Create: `src/lib/monaco-loader-config.ts`
- Modify: `src/main.tsx:3,9-27`(删除 import 与 config 调用,保留说明性注释迁移)
- Modify: `src/components/ui/code-editor.tsx`(顶部 import 区追加一行 side-effect import)
- Modify: `src/tools/code-editor-workspace/EditorWorkbench.tsx`(同上)
- Modify: `src/tools/TextCompare.tsx`(同上)

**Interfaces:**

- Consumes: `@monaco-editor/loader` 默认导出的 `.config()`(唯一运行时引用点,由 grep 核实)
- Produces: `configureMonacoLoader(): void`(幂等;但消费方一律以 side-effect import 使用,不直接调用)。Task 3 的 code-editor.tsx 编辑依赖本任务先完成。

**为什么是这三个文件:** 全仓运行时引入 `@monaco-editor/react` 的只有 code-editor.tsx(Editor)、EditorWorkbench.tsx(DiffEditor)、TextCompare.tsx(DiffEditor);其余(monaco-theme.ts / monaco-context-menu.tsx / MarkdownPreview.tsx 等)均为 `import type`,编译期擦除。side-effect import 保证「任何一条打开编辑器的路径」都会先执行配置。

- [ ] **Step 1: 运行编辑器相关测试确认基线绿**

Run: `pnpm vitest run src/tools/CodeEditor.test.tsx src/tools/TextCompare.test.tsx 2>&1 | Select-Object -Last 4`
Expected: 全部 passed。(若无 TextCompare.test.tsx 则跳过该文件参数。)

- [ ] **Step 2: 新建 src/lib/monaco-loader-config.ts**

```ts
/**
 * Monaco AMD loader 路径配置(惰性化)。
 *
 * 为什么不放 main.tsx:@monaco-editor/loader 只有编辑器类工具会用,放启动入口会把
 * 它(连同 @monaco-editor/react 包装层,~22KB chunk)拖进首屏静态依赖图。
 * 配置只需满足「任何 Editor/DiffEditor 挂载前已执行」,因此放到编辑器模块图的
 * 模块作用域:三个运行时消费方(code-editor.tsx / EditorWorkbench.tsx /
 * TextCompare.tsx)都以 side-effect import 本模块,天然先于组件挂载执行。
 *
 * 加载策略 —— 走项目内置资源,不联网:
 * - 默认 loader 会从 https://cdn.jsdelivr.net 拉 monaco-editor,但生产 CSP
 *   script-src 'self' 会拦掉跨域脚本,WebView2 里编辑器就出不来;
 *   dev 模式 Tauri 不注入 devCsp 所以看不出问题,prod 才会爆。
 * - 这里指向 scripts/copy-monaco.mjs 同步到 public/monaco/vs 的目录,
 *   配合 CSP 的 worker-src 'self' blob: 让 Monaco 内的 worker 也能起。
 * - 必须在任何 <Editor /> 挂载之前调用;本模块 import 即执行,幂等可重入。
 *
 * 中文本地化说明(「先 import nls.messages.zh-cn 再加载 monaco」同源):
 * - zh-cn.js 是纯脚本,仍由 index.html 在 <head> 里经典 <script> 静态引入,
 *   严格早于应用入口执行,已把 globalThis._VSCODE_NLS_MESSAGES 设为中文消息表;
 *   Monaco 的 localize() 每次调用时懒读该全局,查找栏/折叠提示等内置 UI 即为中文。
 * - 故意不配置 'vs/nls'.availableLanguages:该配置会让 vs/nls.messages-loader
 *   插件 AMD-require zh-cn.js,但纯脚本无 define() 注册、回调永不触发,
 *   editor.main 将永久挂起(编辑器空白),是已踩过的坑,勿回退。
 */
import monacoLoader from '@monaco-editor/loader';

let configured = false;

export function configureMonacoLoader(): void {
  if (configured) return;
  configured = true;
  monacoLoader.config({
    paths: {
      vs: `${import.meta.env.BASE_URL}monaco/vs`,
    },
  });
}

// import 即配置:见文件头说明
configureMonacoLoader();
```

- [ ] **Step 3: 修改 main.tsx**

删除第 3 行 `import monacoLoader from '@monaco-editor/loader';` 与第 9-27 行整段「Monaco 加载策略」注释及 `monacoLoader.config({...})` 调用(该段注释内容已整体迁入新文件头)。main.tsx 保留:`reflect-metadata` 导入、react-dom、App、theme/platform 初始化等其余全部内容不变。

- [ ] **Step 4: 三个消费方追加 side-effect import**

`src/components/ui/code-editor.tsx` 在 `import { Popover, ... } from './popover';` 之后追加:

```ts
// Monaco loader 路径配置(import 即执行,保证任何 Editor 挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';
```

`src/tools/code-editor-workspace/EditorWorkbench.tsx` 与 `src/tools/TextCompare.tsx`:在各自最后一个 import 之后追加同一行(含同款中文注释)。ESLint import 顺序规则如报错,按其提示放置即可(该行为 side-effect import,通常置于普通 import 末尾)。

- [ ] **Step 5: 构建并断言 monaco 退出启动图**

Run:

```powershell
pnpm build
Select-String -Path dist\index.html -Pattern 'modulepreload' | Select-String 'monaco'
```

Expected: 无输出(modulepreload 不再含 monaco 包装 chunk)。同时确认懒 chunk 仍在:

```powershell
Get-ChildItem dist\assets -Recurse -Filter '*CodeEditor*' | ForEach-Object Name
```

Expected: CodeEditor-*.js 存在(~56KB,首次打开编辑器工具时才加载)。

- [ ] **Step 6: 回归三件套**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿。

---

### Task 3: Monaco CSS 非阻塞预取(消除 342KB 渲染阻塞)

**Files:**

- Modify: `index.html:10-48`
- Modify: `src/components/ui/code-editor.tsx:49-76`(泛化 ensureMonacoCodiconStyle)

**Interfaces:**

- Consumes: Task 2 完成后的 code-editor.tsx(本任务在其模块初始化区扩展样式注入)
- Produces: 无对外接口;验收依据为 dist/index.html 内容与编辑器功能正常

**策略:** index.html 里两条 `<link rel="stylesheet">` 改为 `<link rel="preload" as="style">` —— 浏览器仍会尽早就取(本地磁盘,几乎零成本),但不应用、不阻塞首屏渲染;code-editor.tsx 模块初始化时注入真正的 stylesheet(命中 preload 缓存,即时生效),保证编辑器挂载前样式就绪。zh-cn.js 保持经典同步 script 不动:Monaco 的 localize 懒读全局表,时序契约「严格早于入口模块求值」已在原注释中论证,动它风险大于收益(94KB 本地脚本解析仅数毫秒)。

- [ ] **Step 1: 修改 index.html 头部**

把两条样式 link(editor.main.css 与 codicon.css)及其上方两段注释整体替换为:

```html
<!--
     * Monaco 编辑器样式改为「非阻塞预取」:
     * - editor.main.css(~342KB)与 codicon.css 仅编辑器类工具需要,若以
     *   rel="stylesheet" 放这里会阻塞首屏渲染。rel="preload" as="style" 只提前
     *   取文件(本地磁盘,近零成本)不应用不阻塞;真正的注入发生在
     *   src/components/ui/code-editor.tsx 模块初始化(ensureMonacoStyles),
     *   早于任何 Monaco 组件挂载,且命中 preload 缓存即时生效。
     * - Tauri 用 tauri://localhost 静态根,/monaco/... 直接命中 dist/monaco/...
     *   复制产物;dev 由 vite dev server 按 public/ 路径提供。
     -->
<link rel="preload" href="/monaco/vs/editor/editor.main.css" as="style" />
<link rel="preload" href="/monaco/vs/base/browser/ui/codicons/codicon/codicon.css" as="style" />
```

(zh-cn.js 的 `<script>` 及其注释原样保留。)

- [ ] **Step 2: 泛化 code-editor.tsx 的样式注入函数**

将 code-editor.tsx 第 49-76 行(注释块 + `MONACO_CODICON_HREF_SUFFIX` + `ensureMonacoCodiconStyle` + 调用)替换为:

```ts
/**
 * Monaco 本地样式表注入(仅编辑器类工具需要)。
 *
 * 背景:index.html 曾以 <link rel="stylesheet"> 阻塞式加载 editor.main.css
 * (~342KB),但它只有编辑器工具用到,白白拖慢首屏。现改为:
 * - index.html 用 rel="preload" as="style" 尽早预取(不应用、不阻塞);
 * - 本模块初始化时在此注入真正的 stylesheet —— 早于任何 Monaco 组件挂载,
 *   且命中 preload 缓存,编辑器首帧即为有样式状态。
 *
 * 覆盖两份资源:
 * - editor.main.css:Monaco 全部内置 UI 样式。Tauri 的 AMD loader
 *   (public/monaco/loader.js)只动态注入 <script>,从不创建 <style>/<link>,
 *   editor.main.js 也未引用 .css,因此必须自行注入(prod 缺失则编辑器完全无样式)。
 * - codicon.css:Monaco 0.56 min 构建缺 .codicon 基础类(font-family/图标 content,
 *   min 版 css 只含 @font-face data URI),缺失时 gutter 折叠按钮显示为方框叉。
 *   copy-monaco.mjs 已把它拷到 public/monaco/vs/base/browser/ui/codicons/...。
 *
 * 幂等:已存在同 href(先前注入)则跳过;浏览器自动复用 HTTP 缓存。
 * typeof document 守卫兼容 jsdom 之外的极端环境。
 */
const MONACO_STYLE_SUFFIXES = [
  'monaco/vs/editor/editor.main.css',
  'monaco/vs/base/browser/ui/codicons/codicon/codicon.css',
] as const;

function ensureMonacoStyles(): void {
  if (typeof document === 'undefined') return;
  for (const suffix of MONACO_STYLE_SUFFIXES) {
    const existing = document.querySelector(`link[rel="stylesheet"][href*="${suffix}"]`);
    if (existing) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${import.meta.env.BASE_URL}${suffix}`;
    document.head.appendChild(link);
  }
}
ensureMonacoStyles();
```

- [ ] **Step 3: 构建 + 断言 index.html 形态**

Run:

```powershell
pnpm build
Select-String -Path dist\index.html -Pattern '<link rel="stylesheet"[^>]*monaco'
Select-String -Path dist\index.html -Pattern 'rel="preload"[^>]*monaco' | Measure-Object | ForEach-Object Count
```

Expected: 第一条无输出(不再有阻塞式 monaco 样式表);第二条输出 `2`(两条 preload)。

- [ ] **Step 4: 手工冒烟(dev)**

Run: `pnpm dev`(另一终端 `pnpm tauri dev` 或直接浏览器开 http://localhost:1420)
Steps: 打开「JSON 格式化」→ 正常;切到「文本比较」→ DiffEditor 出现且 gutter 折叠图标正常(非方框叉);DevTools Network 看 editor.main.css 在首屏即发起请求但 render-blocking 列为否(浏览器直开时可查)。
Expected: 编辑器渲染、折叠图标、查找栏(Ctrl+F 中文文案)全部正常。

- [ ] **Step 5: 回归三件套**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿。

---

### Task 4: JSON 解析类工具接入 useDeferredValue(JsonPathTester / JsonYamlConverter / JsonArrayTable)

**Files:**

- Modify: `src/tools/JsonPathTester.tsx:7,17-18,20-35`
- Modify: `src/tools/JsonYamlConverter.tsx:5,33-44`
- Modify: `src/tools/JsonArrayTable.tsx:5,72-81`

**Interfaces:**

- Consumes: React 19 `useDeferredValue`(项目既有用法参考 DuplicateDetector.tsx:241)
- Produces: 无接口变化;组件 props/store 契约不变,现有测试即回归网

**测试设计说明(重要):** jsdom/非并发环境下 `useDeferredValue` 会同步 flush(DuplicateDetector.test.tsx:271 注释已记录该语义),无法在单测中断言「延迟」。因此本任务不新增行为测试——这是性能重构,回归保障 = 既有测试套件全绿 + 手工冒烟(粘贴 5MB 文本输入仍流畅)。**禁止**为了「写出失败的测试」而 mock 掉 React 并发特性,那是假测试。

- [ ] **Step 1: 基线测试**

Run: `pnpm vitest run src/tools/JsonPathTester.test.tsx src/tools/json-entity.test.ts 2>&1 | Select-Object -Last 4`
Expected: passed(JsonPathTester 若无独立测试文件,跑 JsonYamlConverter 相关即可;两者均可能并入集成测试,以实际存在文件为准,不存在则直接进入 Step 2)。

- [ ] **Step 2: JsonPathTester.tsx**

import 行(L7)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件开头(L17-18)与 useMemo(L20-35)改为:

```ts
export function JsonPathTester(_props: ToolProps): JSX.Element {
  const [json, setJson] = useState('');
  const [path, setPath] = useState('$.');
  // 大文档下 JSON.parse + JSONPath 全量执行可达百毫秒级:defer 让输入框保持跟手,
  // 重计算在低优先级渲染中追赶(useDeferredValue 项目既有模式,见 DuplicateDetector)
  const deferredJson = useDeferredValue(json);

  const result = useMemo(() => {
    if (!deferredJson.trim()) return '';
    let data: unknown;
    try {
      data = JSON.parse(deferredJson);
    } catch (e) {
      return `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!path.trim()) return '';
    try {
      const out = JSONPath({ path, json: data as object, wrap: true });
      return JSON.stringify(out, null, 2);
    } catch (e) {
      return `JSONPath 表达式错误: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferredJson, path]);
```

- [ ] **Step 3: JsonYamlConverter.tsx**

import 行(L5)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件 state 区(L33 起)与 useMemo 改为:

```ts
export function JsonYamlConverter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('json2yaml');
  const [indent, setIndent] = useState('2');
  // 大文档 YAML/JSON 互转较慢:defer 输入优先,转换低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      return convertJsonYaml(deferredInput, direction, Number(indent));
    } catch (e) {
      return `转换失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferredInput, direction, indent]);
```

- [ ] **Step 4: JsonArrayTable.tsx**

import 行(L5)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件改为:

```ts
export function JsonArrayTable(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  // 大数组建表开销大:defer 输入优先,建表低优先级追赶
  const deferredInput = useDeferredValue(input);

  const result = useMemo((): { table: TableData | null; error: string | null } => {
    if (!deferredInput.trim()) return { table: null, error: null };
    try {
      return { table: jsonArrayToTable(deferredInput), error: null };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [deferredInput]);
```

- [ ] **Step 5: 回归三件套 + 手工冒烟**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿。

手工:`pnpm dev` → 三个工具各粘贴 ~2MB 文本,连续输入字符应无明显顿挫(优化前 SqlFormatter/JsonPath 场景可感知卡顿;本任务三工具同理)。

---

### Task 5: 格式化类工具接入 useDeferredValue(SqlFormatter / XmlFormatter / XmlXsdTester)

**Files:**

- Modify: `src/tools/SqlFormatter.tsx:7,34-51`
- Modify: `src/tools/XmlFormatter.tsx:8,98-110`
- Modify: `src/tools/XmlXsdTester.tsx:7,85-92`

**Interfaces:**

- Consumes / Produces: 同 Task 4(无接口变化,回归网为既有测试)

- [ ] **Step 1: SqlFormatter.tsx**

import 行(L7)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件改为:

```ts
export function SqlFormatter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlLanguage>('sql');
  const [indent, setIndent] = useState('2');
  const [keywordCase, setKeywordCase] = useState<'upper' | 'lower' | 'preserve'>('upper');
  // sql-formatter 对长 SQL 词法分析较重:defer 输入优先,格式化低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      return format(deferredInput, {
        language: dialect,
        tabWidth: Number(indent),
        keywordCase,
      });
    } catch (e) {
      return `格式化失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferredInput, dialect, indent, keywordCase]);
```

- [ ] **Step 2: XmlFormatter.tsx**

import 行(L8,当前为 `import { useMemo, useState, type JSX } from 'react';`)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件改为:

```ts
export function XmlFormatter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<IndentMode>('2');
  const [attrNewLine, setAttrNewLine] = useState(false);
  // DOMParser + 序列化对大 XML 较重:defer 输入优先,格式化低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      return formatXml(deferredInput, mode, attrNewLine);
    } catch (e) {
      return `格式化失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferredInput, mode, attrNewLine]);
```

- [ ] **Step 3: XmlXsdTester.tsx**

注意该文件 react 导入分两处:顶部 L7 `import { useMemo, type JSX } from 'react';` 与中部单独的 `import { useState } from 'react';`。顶部行改为:

```ts
import { useDeferredValue, useMemo, type JSX } from 'react';
```

组件改为(中部孤立 useState 导入保持不动):

```ts
export function XmlXsdTester(_props: ToolProps): JSX.Element {
  const [xsd, setXsd] = useState('');
  const [xml, setXml] = useState('');
  // 校验需 DOM 解析 + 全树遍历:defer 双侧输入,校验低优先级追赶
  const deferredXml = useDeferredValue(xml);

  const verdict = useMemo(() => {
    if (!deferredXml.trim() || !xsd.trim()) return null;
    return validateXmlAgainstXsd(deferredXml, xsd);
  }, [deferredXml, xsd]);
```

(xsd 侧不 defer:XSD 通常较小且变更频率低,保持结论即时性;xml 侧是大输入来源。)

- [ ] **Step 4: 回归三件套 + 手工冒烟**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿。手工冒烟同 Task 4 Step 5,对象换成这三个工具。

---

### Task 6: ListComparer 与 IpParser 接入 useDeferredValue

**Files:**

- Modify: `src/tools/ListComparer.tsx:7,75-85`
- Modify: `src/tools/IpParser.tsx:8,156-168`

**Interfaces:** 同 Task 4/5。

- [ ] **Step 1: ListComparer.tsx**

import 行(L7)改为:

```ts
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
```

组件改为:

```ts
export function ListComparer(_props: ToolProps): JSX.Element {
  const [listA, setListA] = useState('');
  const [listB, setListB] = useState('');
  const [mode, setMode] = useState<CompareMode>('intersection');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [trimItems, setTrimItems] = useState(true);
  // 万级行对比(规范化 + 集合运算)开销随行数平方增长:defer 双侧输入
  const deferredA = useDeferredValue(listA);
  const deferredB = useDeferredValue(listB);

  const result = useMemo(() => {
    if (!deferredA.trim() && !deferredB.trim()) return '';
    return compareLists(deferredA, deferredB, mode, caseSensitive, trimItems).join('\n');
  }, [deferredA, deferredB, mode, caseSensitive, trimItems]);
```

- [ ] **Step 2: IpParser.tsx**

import 行(L8,当前为 `import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react';`)改为:

```ts
import { useCallback, useDeferredValue, useMemo, useState, type JSX, type ReactNode } from 'react';
```

组件的 parsed useMemo(L160-168)改为(state 声明区加一行 defer):

```ts
export function IpParser(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  // analyzeIp 对超长/畸形输入逐字符回溯:defer 输入,解析低优先级追赶
  const deferredInput = useDeferredValue(input);

  const parsed = useMemo<{ result?: IpAnalysis; error?: string }>(() => {
    const text = deferredInput.trim();
    if (!text) return {};
    try {
      return { result: analyzeIp(text) };
    } catch (e) {
      return { error: e instanceof IpParseError ? e.message : String(e) };
    }
  }, [deferredInput]);
```

注意:`handleGeoQuery`(L173-184)继续用**未 defer** 的 `input` —— 归属地查询是用户显式点击触发的动作,应基于所见输入而非滞后值,勿改。

- [ ] **Step 3: 回归三件套 + 手工冒烟**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿(IpParser.test.tsx 13KB 用例是主要回归网)。手工:ListComparer 粘贴两侧各 10 万行应保持输入响应。

---

### Task 7: ToolPanel Suspense fallback 统一加载态(UI 打磨)

**Files:**

- Modify: `src/components/ToolPanel.tsx:82-99`

**Interfaces:**

- Consumes: lucide-react `Loader2` + `animate-spin`(项目加载态既有约定:font-picker.tsx:210、IpParser.tsx:273)
- Produces: 无接口变化;data-testid/role 结构保持

- [ ] **Step 1: 修改 fallback**

ToolPanel.tsx 顶部 lucide 未导入,先在 import 区加入(与现有 sonner/ErrorBoundary import 相邻即可):

```ts
import { Loader2 } from 'lucide-react';
```

再把 Suspense fallback(L91-99)替换为:

```tsx
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground"
                    >
                      {/* 与 font-picker / IpParser 的加载态同一视觉语言:Loader2 + animate-spin */}
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                      加载工具…
                    </div>
                  }
                >
```

- [ ] **Step 2: 回归三件套**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全绿(registry.test.tsx / registry.integration.test.ts 覆盖 Suspense 行为,不依赖 fallback 具体文案结构)。

- [ ] **Step 3: 手工冒烟**

`pnpm dev` → 冷启动后首次点击「Markdown 预览」「SQL 格式化」等未访问过的重型工具,应看到居中的旋转指示器 + 「加载工具…」。

---

## 收尾核对(全部任务完成后)

- [ ] `pnpm build` 后再次完整断言一次启动图:
  ```powershell
  Select-String -Path dist\index.html -Pattern 'modulepreload' | Select-String 'mermaid|peculiar|monaco'
  ```
  Expected: 无输出。
- [ ] 对比优化前后启动负载(可选,写进 PR 描述):优化前 modulepreload 合计约 +686KB(JS)+113KB+22KB 与 371KB 阻塞 CSS;优化后这些全部退出关键路径。
- [ ] `git status` 确认改动文件仅限: vite.config.ts、index.html、src/main.tsx、src/lib/monaco-loader-config.ts(新)、src/components/ui/code-editor.tsx、src/tools/code-editor-workspace/EditorWorkbench.tsx、src/tools/TextCompare.tsx、src/components/ToolPanel.tsx、以及 Task 4-6 的八个工具组件。**按用户要求不执行 git commit。**

## Self-Review 结论(已执行)

1. **Spec coverage:** 用户诉求「性能 + UI 能优化的全优化」。性能侧:启动图(Task 1-3)、交互卡顿(Task 4-6)全覆盖;UI 侧经系统核查仅剩加载态一致性一处真实缺口(Task 7),其余维度(焦点/aria/空态/tooltip/token 化/滚动条/动画/虚拟化)已有实现,列入背景表格避免虚构工作。Rust 端无证据表明存在瓶颈,YAGNI 不纳入。
2. **Placeholder scan:** 无 TBD/TODO;所有代码步骤含完整代码;所有命令含期望输出。
3. **Type consistency:** Task 2 的 `configureMonacoLoader` 在创建与消费处签名一致;Task 4-6 各 diff 中的变量名(deferredJson/deferredInput/deferredA…)在各自 useMemo 依赖数组中一一对应;Task 1 产出的 chunk 名(runtime/vendor-tslib)与后续验证命令匹配。
