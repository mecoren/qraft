# 发布阻断项与高优先级修复实施计划

> **执行状态(2026-08-25)**:✅ 全部 7 个任务已执行完成。验证:typecheck 通过;lint 0 errors;前端 **800 测试全绿**(基线 783 + 新增 17);Rust 300 测试全绿;`pnpm audit --prod --audit-level moderate` exit=0;dist 体积 **31MB → 21.8MB**(Monaco 23.4MB → 14.2MB)。执行中的两处计划偏差:① 裁剪脚本需额外捕捉「引号相对路径」动态引用(basic-languages 按语言懒加载 chunk 不带 .js 后缀),静态 define 闭包不足以覆盖;② pnpm overrides 保留在 package.json(pnpm@9.12 实测生效,启动时的 WARN 为过渡期提示不影响解析结果)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性解决评估报告（docs/release-readiness-assessment.md）中的发布阻断项与高优先级项：Monaco 冗余资源裁剪、keepalive 内存上限、前端依赖审计接入 CI + dompurify 漏洞、仓库临时文件清理、accent 对比度防护、复制反馈统一。

**Architecture:** 五条主线：(1) copy-monaco.mjs 增加 AMD 引用闭包分析，删除 min/vs 中运行时不可达的旧版布局产物；(2) ToolPanel visited 数组引入 LRU 容量上限（纯函数 + 组件接线）；(3) pnpm overrides 升级 dompurify 后在 ci/release 两个 workflow 补 pnpm audit 门禁，同时把 temp-*/sharp-bin 移出版本控制；(4) design-tokens 新增 WCAG 亮度计算自动选择 accent 前景色并注入 CSS 变量；(5) 收敛复制反馈到共享 helper 并给 HashCalculator 补复制按钮。

**Tech Stack:** Node ESM 脚本（fs 递归 + 正则解析 AMD define）、React 19 + vitest + @testing-library、GitHub Actions、Tailwind v4 CSS 变量。

## Global Constraints

- **不执行任何 `git commit` / `git stash`**：工作区已有另一计划（2026-08-24-startup-perf-and-ui-polish）的未提交产物，本计划同样只改工作区文件。`git rm --cached` 仅暂存删除条目，不产生提交。
- Node >= 22，pnpm >= 9（package.json engines）。
- 每个任务完成后保持三项全绿：`pnpm typecheck`、`pnpm lint`、`pnpm test`（当前基线 783 测试）。
- 新增注释使用中文，解释「为什么」而非「是什么」。
- 不改动 Rust 端（src-tauri）。
- 主题颜色一律走 CSS 变量注入，禁止在组件内硬编码色值。

## 已核实的关键事实（执行者必读）

1. **min/vs 双产物结构（monaco-editor 0.56）**：AMD 运行时入口 `vs/editor/editor.main.js`（3KB）的 define 依赖全部指向**根级哈希 chunk**（`../json.worker-BizpAl9O` 等）+ `vs/nls.messages-loader!`；worker 载荷经 `MonacoEnvironment.getWorker` 从 `assets/*.js` 加载（`editor.main.js` 内 `toUrl("../assets/editor.worker-lj3bdIIn.js")`，各 worker chunk 内 `require.toUrl("./assets/xx.worker-*.js")`）。**`vs/language/{css,html,json,typescript}/`（7.6MB）是旧版布局遗留**——仅被 `tsMode/jsonMode/cssMode/htmlMode-*.js` 以 `moduleId:"vs/language/typescript/tsWorker"` 字符串引用，该路径在新架构下因 getWorker 覆盖而永不被 AMD 加载。`vs/index.js` 聚合入口（依赖 toggleHighContrast-qGX7E9o7.js 1.2MB）不被 editor.main 图引用。`nls/lang/` 含 15 个 locale 共 ~1.9MB，index.html 只脚本引入 `zh-cn.js`。
2. **ToolPanel keepalive**：`src/components/ToolPanel.tsx:58` `visited` 只增不减；渲染遍历 visited，非当前工具 `display:none`（第 90 行）。卸载即销毁 Monaco 实例（code-editor.tsx:565 automaticLayout:true）。
3. **dompurify**：直依赖 `^3.4.12` 锁 3.4.12；monaco-editor@0.56.0 传递依赖 dompurify@3.4.8；mermaid@11.17.0 → dompurify@3.4.12。`pnpm audit --prod` 当前报 5 个漏洞（3 moderate / 2 low），moderate 均需 >=3.4.13 或 <=3.4.10 已修。
4. **CI audit job**：ci.yml 与 release.yml 的 audit job 均已具备 pnpm/action-setup + setup-node + install 步骤，只有 cargo audit，无 pnpm audit。
5. **git 已跟踪的临时文件**：temp-alpha-check.cjs、temp-fold-debug.mjs、temp-fold-summary-test.mjs、temp-logo-check.cjs、temp-build-check/、temp-sharp-bin/（26.4MB）、vitest-result.json。`.gitignore` 无对应规则。
6. **自定义主题注入链**：design-tokens.ts `deriveCustomPalette()`（primaryForeground 恒白 oklch(0.99 0 0)，第 299 行）→ color-theme.ts `applyPalette()` 自定义分支仅注入 `--primary/--ring/--sidebar-primary/--sidebar-ring/--accent/--sidebar-accent` 六个变量（102-108 行）→ globals.css `[data-palette='custom']` 第 460/480 行 `--primary-foreground/--sidebar-primary-foreground` 恒白。
7. **复制反馈三范式**：copy-action.tsx（showAlert 带 description）✅ 基准；UuidGenerator.tsx `handleCopyAll` 与 TimestampConverter.tsx `handleCopy` 用裸 `navigator.clipboard.writeText` 静默无反馈 ❌；ColorConverter.tsx 同 ❌；DuplicateDetector.tsx 自己 toast.success 文案不一 ⚠️。CodeEditor 有 `actions?: ReactNode` 插槽（code-editor.tsx:165），HashCalculator 输出编辑器未使用。

---

### Task 1: Monaco 资源裁剪（AMD 引用闭包分析）

**Files:**

- Modify: `scripts/copy-monaco.mjs`

**Interfaces:**

- Consumes: node_modules/monaco-editor/min/vs 目录结构（事实 1）
- Produces: public/monaco/vs 仅含运行时可达文件；脚本输出 `[copy-trim] kept N files, deleted M files, freed X.X MB`
- 运行时契约（后续构建与打包依赖）: loader.js、editor/editor.main.js、editor/editor.main.css、assets/ts.worker-*.js、nls/lang/zh-cn.js、basic-languages/ 全部存在

- [ ] **Step 1: 在 copyDir 之后插入裁剪函数**

在 `scripts/copy-monaco.mjs` 的 `copyDir` 函数后追加：

```javascript
// —— 裁剪:删除 min/vs 中运行时不可达的文件 ——
// 背景:monaco-editor 0.56 的 min/vs 同时携带两套产物:AMD 入口 editor.main.js 的
// define 依赖图(根级哈希 chunk + assets worker 载荷),以及旧版布局遗留
// (vs/language/** 旧 worker、vs/index.js 聚合入口及其独占 chunk、非中文 locale)。
// 应用只经 loader require('vs/editor/editor.main'),遗留部分永不加载却整包进安装包。
// 做法:解析每个文件的 define("id",[deps],…) 依赖数组做闭包分析,另用正则捕捉
// require.toUrl("./assets/x.js") 形态的动态引用;白名单之外的文件一律删除。

/** 递归列出目录下相对 vs 根的 POSIX 风格路径集合 */
async function listFilesRel(rootDir, rel = '') {
  const out = [];
  for (const entry of await fs.readdir(rootDir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...(await listFilesRel(path.join(rootDir, entry.name), relPath)));
    else if (entry.isFile()) out.push(relPath);
  }
  return out;
}

/** POSIX 相对路径解析(基于 vs 根),如 'language/typescript' + '../../base/x' → 'base/x' */
function resolveRel(fromDir, spec) {
  const parts = (fromDir ? fromDir.split('/') : []).concat(spec.split('/'));
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

/**
 * 计算运行时可达文件集合(相对 vs 根的路径)。
 * @param {string} vsDir min/vs 根目录绝对路径
 */
async function collectReachable(vsDir) {
  const jsFiles = (await listFilesRel(vsDir)).filter((f) => f.endsWith('.js'));
  // 注册表:模块 id → 相对路径。同时登记「路径推导 id」(vs/xxx)与文件内显式 define 名。
  const byId = new Map();
  const defineDeps = new Map(); // relPath → string[](依赖模块 id)
  const dynamicRefs = new Set(); // require.toUrl("./x.js") 动态引用目标
  for (const rel of jsFiles) {
    const content = await fs.readFile(path.join(vsDir, rel), 'utf8');
    const pathId = `vs/${rel.replace(/\.js$/, '')}`;
    byId.set(pathId, rel);
    const m = /^define\("([^"]+)"\s*,\s*\[([^\]]*)\]/m.exec(content);
    if (m) {
      byId.set(m[1], rel);
      defineDeps.set(
        rel,
        m[2]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean),
      );
    }
    // 动态引用:worker 载荷经 toUrl("./assets/xx.worker-*.js") 构造 URL,闭包必须纳入
    for (const d of content.matchAll(/toUrl\(\s*["'](\.[^"']+\.js)["']\s*\)/g)) {
      dynamicRefs.add(resolveRel(path.posix.dirname(rel), d[1]));
    }
  }
  const dirOf = (rel) => path.posix.dirname(rel);
  /** 模块 id → 相对文件路径(剥掉 ! 插件后缀;找不到返回 null 由调用方忽略) */
  const toFile = (id) => {
    const bare = id.replace(/!.*$/, '');
    return byId.get(bare) ?? (byId.has(`vs/${bare}`) ? byId.get(`vs/${bare}`) : null);
  };
  const reachable = new Set();
  const queue = ['vs/editor/editor.main'];
  reachable.add('editor/editor.main.js');
  while (queue.length > 0) {
    const id = queue.pop();
    const rel = toFile(id);
    if (!rel || reachable.has(rel)) continue;
    reachable.add(rel);
    for (const dep of defineDeps.get(rel) ?? []) queue.push(dep);
    for (const dyn of dynamicRefs) {
      if (!reachable.has(dyn)) queue.push(dyn); // toUrl 目标按相对路径直接入队
    }
  }
  return reachable;
}

/**
 * 执行裁剪:保留闭包 + 白名单,删除其余,返回释放字节数。
 * 白名单:loader.js(AMD 引导)、editor.main.css(样式)、nls/lang/zh-cn.js
 * (index.html 经典 script 直引,无 define)、basic-languages/**(动态注册兜底)。
 */
async function trimUnreachable(vsDir) {
  const reachable = await collectReachable(vsDir);
  const whitelist = new Set(['loader.js', 'editor/editor.main.css']);
  for (const rel of await listFilesRel(vsDir)) {
    if (rel.startsWith('basic-languages/') || rel === 'nls/lang/zh-cn.js') whitelist.add(rel);
  }
  let freed = 0;
  let deleted = 0;
  for (const rel of await listFilesRel(vsDir)) {
    if (reachable.has(rel) || whitelist.has(rel)) continue;
    const abs = path.join(vsDir, rel);
    freed += (await fs.stat(abs)).size;
    deleted += 1;
    await fs.rm(abs);
  }
  // 清理删空后的残留空目录(language/ 等)
  for (const name of ['language', 'assets', 'editor', 'nls']) {
    const dir = path.join(vsDir, name);
    if (existsSync(dir)) {
      const rest = await fs.readdir(dir, { recursive: true });
      const filesLeft = rest.filter((r) => {
        try {
          return fs.statSync(path.join(dir, r)).isFile();
        } catch {
          return false;
        }
      });
      if (filesLeft.length === 0) await fs.rm(dir, { recursive: true, force: true });
    }
  }
  console.log(
    `[copy-trim] freed ${(freed / 1024 / 1024).toFixed(1)} MB (${deleted} files unreachable)`,
  );
  return freed;
}
```

- [ ] **Step 2: main() 中拷贝完成后调用裁剪 + 结果断言**

在 `main()` 的 codicon 校验之后、loaderJs 校验之前插入：

```javascript
// 裁剪不可达产物(见 trimUnachable 注释):旧版 language/**、聚合入口、非中文 locale 等
await trimUnreachable(DEST);

// 裁剪后核验:运行时关键路径必须存活,否则视为闭包分析出错,立即失败
const mustExist = [
  DEST,
  path.join(DEST, 'loader.js'),
  path.join(DEST, 'editor', 'editor.main.js'),
  path.join(DEST, 'editor', 'editor.main.css'),
  path.join(DEST, 'nls', 'lang', 'zh-cn.js'),
];
for (const p of mustExist) {
  if (!existsSync(p)) throw new Error(`裁剪后缺少运行时关键文件: ${p}`);
}
const assetsLeft = existsSync(path.join(DEST, 'assets'))
  ? (await fs.readdir(path.join(DEST, 'assets'))).filter((f) => f.endsWith('.js'))
  : [];
if (assetsLeft.length === 0) throw new Error('裁剪后 assets/ 无任何 worker 载荷,闭包分析有误');
if (existsSync(path.join(DEST, 'language'))) throw new Error('裁剪后仍存在旧版 language/ 目录');
```

- [ ] **Step 3: 运行脚本验证**

Run: `pnpm copy:monaco`
Expected: 输出含 `[copy-trim] freed ≈10 MB`（预期区间 9~11MB）；无 throw。

Run: `Get-ChildItem public\monaco\vs -Recurse -File | Measure-Object Length -Sum`
Expected: 总计约 12~14MB（裁剪前 23.3MB）；`Test-Path public\monaco\vs\language` 为 False。

- [ ] **Step 4: 构建产物核验**

Run: `pnpm build; "{0:N1} MB" -f ((Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)`
Expected: dist 总体积从 31MB 降至约 21MB；`dist\monaco\vs\loader.js` 存在。

- [ ] **Step 5: 三绿回归**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 全部通过（测试不触碰 public/monaco）。

---

### Task 2: ToolPanel keepalive LRU 上限

**Files:**

- Create: `src/lib/keepalive.ts`
- Test: `src/lib/keepalive.test.ts`
- Modify: `src/components/ToolPanel.tsx:56-67`（visited 更新逻辑）
- Modify: `src/components/ToolPanel.tsx:90`（容器补 data-tool-id 便于测试断言）
- Test: `src/components/ToolPanel.test.tsx`（追加淘汰用例）

**Interfaces:**

- Produces: `pushVisited(visited: string[], toolId: string, max: number): string[]`（纯函数）; `MAX_KEEPALIVE_TOOLS = 8` 常量
- 语义: toolId 已存在则移到末尾（最近使用）；否则追加；超限时从头淘汰，但永不淘汰 toolId 本身且至少保留 1 个

- [ ] **Step 1: 写失败测试 `src/lib/keepalive.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { pushVisited } from './keepalive';

describe('pushVisited(LRU keepalive 容量管理)', () => {
  it('新工具追加到末尾', () => {
    expect(pushVisited(['a', 'b'], 'c', 8)).toEqual(['a', 'b', 'c']);
  });

  it('重复访问移到末尾(刷新最近使用位序)', () => {
    expect(pushVisited(['a', 'b', 'c'], 'a', 8)).toEqual(['b', 'c', 'a']);
  });

  it('超过容量淘汰最旧的工具', () => {
    expect(pushVisited(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('永不淘汰当前工具(即使它最旧)', () => {
    expect(pushVisited(['a', 'b'], 'a', 2)).toEqual(['b', 'a']);
  });

  it('max<=1 时至少保留当前工具', () => {
    expect(pushVisited(['a', 'b', 'c'], 'd', 1)).toEqual(['d']);
  });

  it('空列表初始化', () => {
    expect(pushVisited([], 'x', 8)).toEqual(['x']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/lib/keepalive.test.ts`
Expected: FAIL（Cannot find module './keepalive'）

- [ ] **Step 3: 实现 `src/lib/keepalive.ts`**

```typescript
/**
 * 工具页 keepalive 容量管理(LRU)。
 *
 * 背景:ToolPanel 对访问过的工具全部常驻挂载(display:none 切显隐),其中编辑器类
 * 工具各自持有 Monaco 实例(单个数十 MB 级)。无上限驻留会在长会话中击穿
 * 「空闲内存 <150MB」目标,因此限制同时挂载的工具数量,超出时淘汰最久未访问者。
 *
 * 语义:最近访问的工具排在数组末尾;容量超限从头(最旧)淘汰,但当前工具永不淘汰,
 * 且至少保留 1 个。被淘汰工具的组件卸载、Monaco dispose;其输入状态凡存于
 * zustand store 者(如 jsonFormatterStore)切回自动恢复,纯本地 state 者重置——
 * 这是内存目标的必要取舍。
 */

/** 同时挂载的最大工具数:覆盖一次典型多工具交叉比对会话,同时约束 Monaco 实例总量 */
export const MAX_KEEPALIVE_TOOLS = 8;

export function pushVisited(visited: string[], toolId: string, max: number): string[] {
  // 移除既有同名项再追加 → 兼具「去重」与「刷新位序」两个语义
  const next = visited.filter((id) => id !== toolId);
  next.push(toolId);
  while (next.length > Math.max(max, 1)) {
    const oldestIdx = next.indexOf(next.find((id) => id !== toolId) ?? next[0]);
    next.splice(oldestIdx, 1);
  }
  return next;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/lib/keepalive.test.ts`
Expected: 6 passed

- [ ] **Step 5: 接入 ToolPanel**

`src/components/ToolPanel.tsx` 顶部 import 区新增：

```typescript
import { MAX_KEEPALIVE_TOOLS, pushVisited } from '@/lib/keepalive';
```

将第 63-65 行 setTimeout 回调替换：

```typescript
const h = setTimeout(() => {
  // LRU 容量上限:超出 MAX_KEEPALIVE_TOOLS 时淘汰最久未访问的工具(真卸载,
  // 触发其 Monaco 实例 dispose),防止长会话内存无界增长
  setVisited((v) => pushVisited(v, id, MAX_KEEPALIVE_TOOLS));
}, 0);
```

第 90 行容器 div 增加 data 属性：

```typescript
            <div key={id} data-tool-id={id} className={cn('h-full', id !== toolId && 'hidden')}>
```

- [ ] **Step 6: 追加集成用例到 `src/components/ToolPanel.test.tsx`**

describe 块末尾追加：

```typescript
  it('evicts the least-recently-used tool beyond the keepalive cap', async () => {
    const { rerender } = render(<ToolPanel toolId="base64_codec" />);
    await screen.findByTestId('output', {}, { timeout: LAZY_TIMEOUT });
    // 依次访问共 9 个工具(base64_codec + 8 个),触发容量上限淘汰 base64_codec
    const tour = [
      'url_codec',
      'jwt_parser',
      'uuid_generator',
      'hash_calculator',
      'timestamp_converter',
      'color_converter',
      'regex_tester',
      'json_minifier',
    ];
    for (const id of tour) rerender(<ToolPanel toolId={id} />);
    // 等待最后一个工具的 effect(setTimeout 0)落盘
    await waitFor(
      () => expect(screen.getAllByTestId(/^tool-container-/).length).toBeLessThanOrEqual(8),
      { timeout: LAZY_TIMEOUT },
    );
    expect(screen.queryByTestId('tool-container-base64_codec')).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-container-json_minifier')).toBeInTheDocument();
    // 切回被淘汰的工具:应重新走懒加载挂载而非恢复旧 DOM
    rerender(<ToolPanel toolId="base64_codec" />);
    await waitFor(
      () => expect(screen.getByTestId('tool-container-base64_codec')).toBeInTheDocument(),
      { timeout: LAZY_TIMEOUT },
    );
  });
```

注意：getAllByTestId 支持正则匹配；若现有版本类型报错则改为 `screen.getAllByTestId('tool-container-url_codec').concat(...)` 简化或用 `document.querySelectorAll('[data-tool-id]')` 断言长度。

- [ ] **Step 7: 三绿回归**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 通过（基线 783 + 新增 ≥7 个用例）

---

### Task 3: dompurify 升级（pnpm overrides）

**Files:**

- Modify: `package.json`（dependencies.dompurify、新增 pnpm.overrides）
- Modify: `pnpm-lock.yaml`（由 pnpm install 自动再生）

**Interfaces:**

- Consumes: 事实 3（三条 dompurify 引入路径）
- Produces: 全仓 dompurify 单一实例 >=3.4.13；`pnpm audit --prod` 退出码 0

- [ ] **Step 1: 修改 package.json**

dependencies 中 `"dompurify": "^3.4.12"` 改为 `"dompurify": "^3.4.13"`；顶层（与 "engines" 平级）新增：

```json
  "pnpm": {
    "overrides": {
      "dompurify": "^3.4.13"
    }
  },
```

override 的原因：monaco-editor 对 dompurify 的声明范围允许解析到 3.4.8，仅升直依赖无法消除传递路径上的 moderate 漏洞；dompurify 为纯浏览器端 sanitizer，minor 升级对 monaco/mermaid 无破坏面。

- [ ] **Step 2: 安装并核对解析结果**

Run: `pnpm install; pnpm why dompurify`
Expected: 所有路径均指向同一 >=3.4.13 版本。

- [ ] **Step 3: 审计清零验证**

Run: `pnpm audit --prod`
Expected: `0 vulnerabilities found`（或仅剩 low 且无 moderate 及以上）。

- [ ] **Step 4: 渲染相关回归（markdown/dompurify 消费方）**

Run: `pnpm vitest run src/tools/markdown-render.test.ts src/tools/markdown-mermaid.test.ts src/tools/MarkdownPreview.test.tsx`
Expected: 全部通过。

- [ ] **Step 5: 全量三绿**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 通过。

---

### Task 4: CI 接入 pnpm audit 门禁

**Files:**

- Modify: `.github/workflows/ci.yml`（audit job,cargo audit 步骤之后）
- Modify: `.github/workflows/release.yml`（audit job,同位置）

- [ ] **Step 1: 两个 workflow 的 audit job 末尾追加相同步骤**

```yaml
- name: pnpm audit (生产依赖)
  # 安全底线(prd/13-security.md):与 cargo audit 同级的强制门禁。
  # --prod 排除 devDependencies;阈值 moderate 与既有 cargo audit 口径一致。
  run: pnpm audit --prod --audit-level moderate
  working-directory: .
```

（release.yml 同样追加；该 job 此前已装好 pnpm/node/依赖，无需额外步骤。）

- [ ] **Step 2: 本地等价命令验证门禁可通过**

Run: `pnpm audit --prod --audit-level moderate`
Expected: 退出码 0（依赖 Task 3 完成）。

- [ ] **Step 3: YAML 语法校验**

Run: `node -e "const y=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log(y.includes('pnpm audit'))"`
（或任意 YAML parser）确认步骤文本就位、缩进与相邻步骤一致（2 空格层级）。

---

### Task 5: 仓库清理（temp-* / sharp-bin 出库）

**Files:**

- Modify: `.gitignore`
- Index 变更（不提交）: temp-alpha-check.cjs、temp-fold-debug.mjs、temp-fold-summary-test.mjs、temp-logo-check.cjs、temp-build-check/、temp-sharp-bin/、vitest-result.json

- [ ] **Step 1: 确认无脚本引用 temp-sharp-bin**

Run: `Select-String -Path scripts\*.mjs,scripts\*.cjs -Pattern 'sharp-bin|temp-' -List`
Expected: 无匹配（sharp 是 package.json devDependency，temp-sharp-bin 只是手工解包残留）。

- [ ] **Step 2: .gitignore 追加规则**

文件末尾「Testing」段之前插入：

```gitignore
# Temporary working files(调试脚本/手工解包/测试结果快照,不入库)
temp-*
temp-*/
vitest-result.json
```

- [ ] **Step 3: 出库（仅暂存删除,工作区文件保留,不提交）**

```powershell
git rm -r --cached temp-alpha-check.cjs temp-fold-debug.mjs temp-fold-summary-test.mjs temp-logo-check.cjs temp-build-check temp-sharp-bin vitest-result.json
```

Run: `git status --short | Select-String 'temp-|vitest-result'`
Expected: 显示 `D`（staged 删除）。文件本体仍在磁盘上。

说明：从历史中彻底移除需用户后续 commit（本次不执行）；ignore 规则保证不再复发。

---

### Task 6: accent 对比度防护（TDD）

**Files:**

- Modify: `src/lib/design-tokens.ts`（新增解析/亮度函数 + deriveCustomPalette 使用）
- Test: `src/lib/design-tokens.test.ts`（新建,若已存在则追加）
- Modify: `src/lib/color-theme.ts:101-117`(注入前景色变量)
- Test: `src/lib/color-theme.test.ts`(若存在则追加,否则新建最小用例)
- Modify: `src/components/SettingsPanel.tsx:304-309,358-371`（HEX 校验与错误提示）

**Interfaces:**

- Produces: `parseHexColor(hex: string): [number, number, number] | null`; `pickAccentForeground(accentHex: string): string`（返回 oklch 颜色串）; applyPalette 自定义分支额外注入 `--primary-foreground` / `--sidebar-primary-foreground`,预设分支移除之

- [ ] **Step 1: 写失败测试**

`src/lib/design-tokens.test.ts`（新文件）：

```typescript
import { describe, expect, it } from 'vitest';
import { deriveCustomPalette, parseHexColor, pickAccentForeground } from './design-tokens';

describe('parseHexColor', () => {
  it('解析 6 位 HEX', () => {
    expect(parseHexColor('#FF0000')).toEqual([255, 0, 0]);
    expect(parseHexColor('#4e8cff')).toEqual([78, 140, 255]);
  });
  it('非法输入返回 null', () => {
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#GGGGGG')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});

describe('pickAccentForeground(对比度最大化选前景)', () => {
  it('深色 accent 选近白前景', () => {
    expect(pickAccentForeground('#111111')).toBe('oklch(0.99 0 0)');
  });
  it('极浅 accent 选近黑前景(修复白字浅底不可读)', () => {
    expect(pickAccentForeground('#FFFF00')).toBe('oklch(0.15 0 0)');
    expect(pickAccentForeground('#FFFFFF')).toBe('oklch(0.15 0 0)');
  });
  it('中等亮度 accent 维持近白前景(保持现有视觉习惯)', () => {
    expect(pickAccentForeground('#4E8CFF')).toBe('oklch(0.99 0 0)');
  });
  it('非法输入回退近白前景(与旧行为一致)', () => {
    expect(pickAccentForeground('oops')).toBe('oklch(0.99 0 0)');
  });
});

describe('deriveCustomPalette 对比度防护', () => {
  it('浅色 accent 时 primaryForeground 切换为深色', () => {
    expect(deriveCustomPalette('#FFFF00').primaryForeground).toBe('oklch(0.15 0 0)');
    expect(deriveCustomPalette('#FFFF00').sidebarPrimaryForeground).toBe('oklch(0.15 0 0)');
  });
});
```

Run: `pnpm vitest run src/lib/design-tokens.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 2: design-tokens.ts 实现**

在 `deriveCustomPalette` 之前插入：

```typescript
/** 解析 #RGB/#RRGGBB 十六进制颜色为 [r,g,b](0-255);非法返回 null */
export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1];
  const full =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** sRGB 通道 → 线性值(WCAG 2.x 公式) */
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 近白前景(oklch 0.99 ≈ #fbfbfb)与近黑前景(oklch 0.15 ≈ #262626)的相对亮度 */
const FG_LIGHT_LUM = 0.961;
const FG_DARK_LUM = 0.023;

/**
 * 按 WCAG 对比度选择 accent 上的可读前景色。
 *
 * 阈值取 3:1(WCAG 1.4.11 非文本/UI 组件下限):低于 3:1 说明白字已不可读,
 * 切换近黑前景;否则维持近白以保持现有按钮视觉习惯。
 * 非法输入回退近白(与历史行为一致,由调用方负责上游校验提示)。
 */
export function pickAccentForeground(accentHex: string): string {
  const rgb = parseHexColor(accentHex);
  if (!rgb) return 'oklch(0.99 0 0)';
  const lum = 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
  const contrastOnLight = (FG_LIGHT_LUM + 0.05) / (lum + 0.05);
  const contrastOnDark = (lum + 0.05) / (FG_DARK_LUM + 0.05);
  return contrastOnLight >= 3 ? 'oklch(0.99 0 0)' : 'oklch(0.15 0 0)';
}
```

`deriveCustomPalette` 中替换两行：

```typescript
    primary: accent,
    primaryForeground: pickAccentForeground(accent),
```

```typescript
    sidebarPrimary: accent,
    sidebarPrimaryForeground: pickAccentForeground(accent),
```

- [ ] **Step 3: color-theme.ts 注入前景变量**

`applyPalette` 自定义分支（108 行 `--sidebar-accent` 之后）追加：

```typescript
// 前景色随 accent 亮度派生(pickAccentForeground):预设块中的恒白默认值
// 在浅色 accent 下会造成「白字浅底」不可读,必须一并覆盖
root.style.setProperty('--primary-foreground', palette.primaryForeground);
root.style.setProperty('--sidebar-primary-foreground', palette.sidebarPrimaryForeground);
```

else 分支追加对应 removeProperty 两行（`--primary-foreground`、`--sidebar-primary-foreground`）。

- [ ] **Step 4: SettingsPanel HEX 校验**

ThemeSection 中增加校验状态（customAccent useState 之后）：

```typescript
// HEX 手输校验:type=color 拾取器恒合法,仅手输可能产生非法中间态
const [accentInvalid, setAccentInvalid] = useState(false);

const handleCustomAccentChange = (hex: string) => {
  setCustomAccent(hex);
  const valid = parseHexColor(hex) !== null;
  setAccentInvalid(!valid);
  // 非法输入不落库不应用,避免半输入状态污染主题;合法时即时生效(原有行为)
  if (valid && paletteId === 'custom') {
    setPalette('custom', hex);
  }
};
```

import 区补充 `parseHexColor`（来自 '@/lib/design-tokens'）。JSX 的 Input（365-371 行）追加 `aria-invalid={accentInvalid}`；下方说明文字改为条件提示：

```typescript
            {accentInvalid ? (
              <p className="text-xs text-destructive" role="alert">
                无效的 HEX 色值,请使用 #RRGGBB 格式
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">实时预览,修改后自动持久化</p>
            )}
```

- [ ] **Step 5: 测试通过 + 三绿**

Run: `pnpm vitest run src/lib/design-tokens.test.ts; pnpm typecheck; pnpm lint; pnpm test`
Expected: 全部通过。若 globals.test.ts 因 CSS 未变不受影响;SettingsPanel 相关测试如有快照需同步更新。

---

### Task 7: 复制反馈统一 + HashCalculator 复制按钮

**Files:**

- Modify: `src/lib/toast-alert.ts`（新增共享 helper;先读现状再插入）
- Modify: `src/components/copy-action.tsx`（复用 helper,DRY）
- Modify: `src/tools/UuidGenerator.tsx:55-59`（handleCopyAll）
- Modify: `src/tools/TimestampConverter.tsx:71-73`（handleCopy）
- Modify: `src/tools/ColorConverter.tsx:128-149`（三处复制按钮）
- Modify: `src/tools/DuplicateDetector.tsx:298-301`（文案统一走 helper）
- Modify: `src/tools/HashCalculator.tsx:109-117`（输出编辑器加 actions）
- Test: `src/tools/HashCalculator.test.tsx`（追加复制用例）

**Interfaces:**

- Produces: `copyTextWithFeedback(text: string): Promise<boolean>` —— 写入剪贴板并以统一文案弹 toast（成功「已复制到剪贴板」带 80 字符预览,失败「复制失败」）;全项目复制交互唯一入口

- [ ] **Step 1: toast-alert.ts 增加 helper（置于 showAlert 之后）**

```typescript
import { writeClipboardText } from '@/lib/clipboard';

/**
 * 复制文本到剪贴板并给出统一反馈。
 *
 * 背景:历史上复制反馈存在三种范式(CopyAction 弹窗 / 裸 writeText 静默 / 各自
 * toast.success),用户无法建立一致的认知模型。此 helper 收敛为唯一实现:
 * 成功展示「已复制到剪贴板」+ 内容预览(>80 字符截断),失败明确报错。
 * CopyAction 与各工具页的复制按钮均应经由它实现。
 */
export async function copyTextWithFeedback(text: string): Promise<boolean> {
  if (!text) return false;
  const ok = await writeClipboardText(text);
  if (ok) {
    showAlert({
      variant: 'success',
      title: '已复制到剪贴板',
      description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
  } else {
    showAlert({ variant: 'destructive', title: '复制失败' });
  }
  return ok;
}
```

（注意检查 toast-alert.ts 是否已有 clipboard import 造成循环依赖：clipboard.ts 只依赖 ipc.ts,无环。）

- [ ] **Step 2: copy-action.tsx 改为调用 helper**

onClick 体替换为：

```typescript
      onClick={() => {
        void copyTextWithFeedback(text);
      }}
```

并删除本文件的 writeClipboardText/showAlert import,改 `import { copyTextWithFeedback } from '@/lib/toast-alert';`。

- [ ] **Step 3: 四个旧工具切换到 helper**

- UuidGenerator.tsx：

```typescript
async function handleCopyAll() {
  if (output?.text) await copyTextWithFeedback(output.text);
}
```

- TimestampConverter.tsx：

```typescript
async function handleCopy(value: string) {
  await copyTextWithFeedback(value);
}
```

- ColorConverter.tsx：三处 `onClick={() => handleCopy(extra.hex)}` 保持不变,其内部 handleCopy 同 TimestampConverter 方式替换。
- DuplicateDetector.tsx:298-301:定位现有 `toast.success(...)` 调用,整体替换为 `void copyTextWithFeedback(text)`;若该文件因此不再使用 sonner 则移除 import(lint 会提示)。

- [ ] **Step 4: HashCalculator 输出编辑器补复制动作**

import 增加 `import { CopyAction } from '@/components/copy-action';`;109-116 行 CodeEditor 增加 actions 属性:

```typescript
            <CodeEditor
              readOnly
              value={output?.text ?? ''}
              language="plaintext"
              className="flex-1"
              data-testid="output"
              searchAnchor="hash_calculator:output"
              actions={
                output?.text ? <CopyAction text={output.text} testId="copy-hash" /> : undefined
              }
            />
```

- [ ] **Step 5: HashCalculator 测试追加用例**

`src/tools/HashCalculator.test.tsx` describe 末尾追加(沿用该文件既有的 invoke mock 模式):

```typescript
  it('copies hash result with unified feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(true);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<HashCalculator toolId="hash_calculator" />);
    const input = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '计算' }));
    expect(await screen.findByTestId('copy-hash')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('copy-hash'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\w{64}/)));
    expect(await screen.findByText('已复制到剪贴板')).toBeInTheDocument();
  });
```

（若该文件现有 mock 结构不同,以现有模式为准适配;核心断言为 writeText 收到 64 位 hex 且出现成功提示。）

- [ ] **Step 6: 三绿回归**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: 通过;若 UuidGenerator/TimestampConverter/ColorConverter 既有用例曾直接断言 navigator.clipboard.writeText,行为不变仍通过。

---

## Self-Review 记录

- 覆盖核对:用户四类问题 ↔ 任务映射:包体积→Task1;内存→Task2;安全(pnpm audit/漏洞/sharp-bin)→Task3/4/5;UI(accent 对比度/复制统一/HashCalculator)→Task6/7。✅
- 类型一致性:pushVisited/copyTextWithFeedback/pickAccentForeground 的签名在各消费处一致。✅
- 占位符扫描:无 TBD/TODO;Task7 Step5 提供完整测试代码并注明适配方式。✅
