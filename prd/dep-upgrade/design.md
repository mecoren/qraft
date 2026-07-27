# 依赖全量升级设计文档

> **版本**：v1.0
> **创建日期**：2026-07-26
> **关联需求**：`/prd/dep-upgrade/requirements.md`

---

## 1. 需求理解

1. 修复 `globals.css` 引用未安装包 `tailwindcss-animate` 的错误（已通过把 `@plugin "tailwindcss-animate"` 改为 `@import "tw-animate-css"` 解决，详见 §5 修复记录）。
2. 把 `package.json` 中所有依赖一次性升级到 npm 最新稳定版，并修复由此引发的 breaking change。

## 2. 关键技术决策

### 2.1 升级策略：一次性全量升级 + 分批验证

**选择**：直接把 `package.json` 中所有版本号改到最新稳定版，运行 `pnpm install`，然后按 `typecheck → lint → test → build` 顺序修复错误。

**理由**：
- 用户明确要求一次性升级；
- 多数 MAJOR 升级（如 `@vitejs/plugin-react` 4→6、`eslint-plugin-react-hooks` 5→7、`globals` 15→17）属于工具链内部联动，必须同时升；
- 分阶段升级反而会触发工具链内部版本不匹配（如 ESLint 9 + @eslint/js 10 不兼容）。

**备选方案（未采用）**：分阶段升级，先 minor/patch 再按工具链分组升 MAJOR——更安全但耗时更长，且用户已选择一次性方案。

### 2.2 版本号写法约定

- 所有依赖统一用 `^x.y.z`（caret）范围，允许 patch/minor 自动升；
- 例外：`tailwindcss` 与 `@tailwindcss/vite` 当前为 `"4"`（裸大版本号），改为 `"^4.3.3"` 以接受 patch 更新；
- 不使用 `latest`、`*` 等浮动版本，确保 lockfile 可复现。

### 2.3 工具链联动升级映射

| 工具链 | 必须同步升的包 |
|--------|----------------|
| Vite | `vite` + `@vitejs/plugin-react` + `vitest`（共享底层） |
| ESLint | `eslint` + `@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `globals` |
| TypeScript | `typescript` + `@types/react` + `@types/react-dom` + `@types/node`（types 跟随运行时） |
| React 生态 | `react` + `react-dom` + `@types/react` + `@types/react-dom` |
| Tauri | `@tauri-apps/api` + `@tauri-apps/cli` + 4 个 `@tauri-apps/plugin-*` |
| Zod | `zod` + `@hookform/resolvers`（需 resolver 支持 zod v4） |

### 2.4 各 MAJOR 升级的预期 breaking change 与应对

#### 2.4.1 TypeScript 5 → 7

- **预期变化**：更严格的类型推断、可能默认开启的新选项、`lib.d.ts` 更新。
- **应对**：保留 `tsconfig.json` 现有 strict 选项不动；逐文件修复编译错误；若 v7 默认开启新检查（如 `noUncheckedIndexedAccess`）导致大量误报，再讨论是否关闭。
- **配置**：`tsconfig.json` 当前已 `strict: true` + `noUnusedLocals` + `noUnusedParameters`，结构干净，预计影响小。

#### 2.4.2 Vite 5 → 8

- **预期变化**：跨 6/7/8 三个大版本，可能有 `defineConfig` API 变化、`build.target` 默认值变化、HMR 行为调整。
- **应对**：`vite.config.ts` 当前配置非常简单（plugins + alias + server.port + build.target），预计无需改动；若 v8 要求 Node 版本升级，需检查 `.nvmrc`（当前应 ≥ 22，已满足）。
- **风险**：`build.target: ['es2021', 'chrome100', 'safari13']` 在 v8 中可能默认值变化，需验证 Tauri WebView2 仍兼容。

#### 2.4.3 Vitest 2 → 4

- **预期变化**：API 稳定，主要是底层 Vite 升级联动；`globals: true` / `environment: 'jsdom'` 等配置项保留。
- **应对**：`vitest.config.ts` 结构简单，预计无需改动；运行 `pnpm test` 看是否所有用例通过。

#### 2.4.4 ESLint 9 → 10 + 全套插件

- **预期变化**：flat config 已在 v9 落地，v10 主要是规则调整；`eslint-plugin-react-hooks` v7 可能新增规则。
- **应对**：`eslint.config.js` 当前已是 flat config 结构；保持现状，运行 `pnpm lint` 看具体报错；若 v7 hooks 插件规则过严，可在 rules 中局部关闭。

#### 2.4.5 Zod 3 → 4

- **预期变化**：zod v4 API 简化，部分 schema 写法变化（如 `z.coerce.*`、`z.discriminatedUnion` 行为）；`@hookform/resolvers` 需 ≥ 5.5 才支持 zod v4（当前目标 5.5.3 满足）。
- **应对**：搜索 `from 'zod'` 的所有用法，逐一检查 schema 定义；预计变动小（项目内 zod 仅用于配置校验）。

#### 2.4.6 date-fns 3 → 4

- **预期变化**：v4 主要是 ESM-only 与 Tree-shaking 改进，API 大体兼容。
- **应对**：检查 `HistoryPanel.tsx` 等使用方，确认 `formatDistanceToNow` / `format` 等函数签名未变。

#### 2.4.7 lucide-react 0.x → 1.x

- **预期变化**：1.0 是稳定版发布，图标名可能规范化（如 `X` → `Close`），部分罕见图标可能被移除。
- **应对**：13+ 个组件文件使用图标，全部跑 `pnpm typecheck` 即可发现缺失图标；按错误信息替换为等价图标。

#### 2.4.8 sonner 1 → 2

- **预期变化**：API 基本兼容，主要是默认样式调整。
- **应对**：检查 `ui/sonner.tsx` 的 `<Toaster>` props 是否仍存在；`toast.success/error` 调用方式不变。

#### 2.4.9 react-resizable-panels 2 → 4

- **现状**：项目代码中**未实际使用**（仅 prd 文档提及），可放心升级；如升级后引发类型错误，可考虑直接卸载。

## 3. 实施步骤

### 步骤 1：升级前快照（保险）

```bash
git tag pre-dep-upgrade
git status  # 确认工作区干净（globals.css 修复已提交或 stash）
```

### 步骤 2：批量改写 `package.json`

按 §2.3 工具链联动映射，把所有版本号改为最新稳定版（见需求文档 §2.2.1 / §2.2.2 表格中的"目标"列）。

### 步骤 3：重新安装依赖

```bash
pnpm install
```

预期会重新生成 `pnpm-lock.yaml`。

### 步骤 4：逐项验证并修复

按以下顺序（ cheapest first ）：

1. **typecheck**：`pnpm typecheck` → 修复 TS 错误（zod schema、lucide 图标名、@types 联动）
2. **lint**：`pnpm lint` → 修复 ESLint 错误（hooks 规则、新规则）
3. **test**：`pnpm test` → 修复测试失败（vitest API、jsdom 行为）
4. **build**：`pnpm build` → 修复构建失败（vite 配置、esbuild target）

每一步遇到错误就修，修完再跑下一步，避免错误叠加。

### 步骤 5：手动验证核心功能

```bash
pnpm dev  # 启动 Vite dev server，确认 HTTP 200、无控制台报错
pnpm tauri dev  # 启动 Tauri 应用（可选，耗时较长）
```

### 步骤 6：提交

把所有改动（`package.json`、`pnpm-lock.yaml`、配置文件、源码修复）合并为一次 commit。

## 4. 验证策略

| 验证项 | 命令 | 通过标准 |
|--------|------|---------|
| 依赖安装 | `pnpm install` | exit code 0，无 peer 警告（或警告可解释） |
| 类型检查 | `pnpm typecheck` | exit code 0 |
| Lint | `pnpm lint` | exit code 0 |
| 单元测试 | `pnpm test` | 全部通过，无 skipped/failed |
| 生产构建 | `pnpm build` | 产出 `dist/` 目录，无报错 |
| 开发服务器 | `pnpm dev` | HTTP 200，浏览器控制台无报错 |
| 过期检查 | `pnpm outdated` | 无输出（或仅剩 peer 限制无法升的） |

## 5. 已完成修复记录

### 5.1 `globals.css` 动画库引用修复（FIX-01）

**根因分析**（systematic-debugging）：

- **错误**：`[plugin:@tailwindcss/vite:generate:serve] Can't resolve 'tailwindcss-animate' in 'src/styles'`
- **现象**：Vite dev 启动后 `@tailwindcss/vite` 插件尝试解析 `tailwindcss-animate` 模块失败
- **根因**：
  1. `globals.css` 第 2 行 `@plugin "tailwindcss-animate"` 使用 Tailwind v4 的 JS 插件加载语法
  2. 项目 `package.json` 安装的是 `tw-animate-css`（v4 兼容的 CSS-only 替代包），未安装 `tailwindcss-animate`
  3. `tw-animate-css` 的 `package.json` 中 `exports` 字段指向 `./dist/tw-animate.css`（CSS 文件，非 JS 插件），必须用 `@import` 加载而非 `@plugin`
- **修复**：把第 2 行从 `@plugin "tailwindcss-animate";` 改为 `@import "tw-animate-css";`
- **验证**：`pnpm dev` 启动后 HTTP 200 响应正常，错误消失

**影响范围**：项目内 13+ 个组件使用 `animate-in` / `animate-out` / `fade-in-0` / `zoom-in-95` / `slide-in-from-*` 等 utility class，`tw-animate-css` 提供相同 class 名，无需改业务代码。

## 6. 风险与回滚

### 6.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| TS v7 严格度提升导致大量类型错误 | 中 | 中 | 逐文件修复；必要时局部 `// @ts-expect-error`，但优先正确类型 |
| Vite v8 配置 API 变化导致 build 失败 | 低 | 高 | 参考 Vite v8 迁移指南；保持 `defineConfig` 简单结构 |
| Zod v4 schema 语法变化导致表单验证失效 | 中 | 中 | 检查 `@hookform/resolvers` 是否已支持 zod v4；必要时调整 schema 写法 |
| lucide-react v1 移除某些图标 | 中 | 低 | 替换为等价图标 |
| `pnpm install` peer 依赖冲突 | 低 | 中 | 按提示手动调整版本 |
| 升级后 Tauri WebView 渲染异常 | 低 | 高 | `pnpm tauri dev` 手动验证；必要时回退 vite target |

### 6.2 回滚策略

1. **升级前**：`git tag pre-dep-upgrade`，确保工作区干净
2. **升级中**：所有改动未提交前，可 `git checkout -- .` + `pnpm install`（恢复 lockfile）回到原状
3. **升级后**：若发现严重问题，`git revert <commit>` 回滚 commit；`pnpm install` 恢复 lockfile

## 7. 文件结构

本次升级预期会修改的文件：

```
qraft/
├── package.json                          ← 版本号全量更新
├── pnpm-lock.yaml                        ← 重新生成
├── tsconfig.json                         ← 可能微调（如新增 v7 选项）
├── vite.config.ts                        ← 可能微调（v8 breaking change）
├── vitest.config.ts                      ← 可能微调（v4 breaking change）
├── eslint.config.js                      ← 可能微调（v10 规则变化）
└── src/
    ├── components/
    │   ├── ui/sonner.tsx                 ← sonner v2 适配
    │   └── ...(使用 lucide-react 的组件)  ← 图标名替换
    ├── lib/
    │   └── (使用 zod 的文件)              ← zod v4 适配
    └── ...(使用 date-fns 的文件)          ← date-fns v4 适配
```

## 8. 备选方案对比

### 8.1 一次性全量升级（已选）

**优点**：一步到位，工具链内部联动版本天然一致；只需一次 `pnpm install` 与一轮验证。

**缺点**：中间状态可能较混乱；若多个 MAJOR 同时出问题，定位困难。

### 8.2 分阶段升级（未选）

按以下顺序分批升：
1. Minor/Patch 全部
2. ESLint 全家桶
3. Vite 全家桶
4. Zod + @hookform/resolvers
5. TypeScript v7
6. lucide-react + sonner + date-fns 等业务依赖

**优点**：每阶段验证通过再进下一阶段，问题定位简单。

**缺点**：耗时长；阶段间可能出现工具链临时不兼容（如 ESLint 9 + @eslint/js 10）。

### 8.3 仅 Minor/Patch（未选）

**优点**：零风险。

**缺点**：无法满足用户"全部最新稳定版"的明确要求；TS v7 等关键升级无法落地。
