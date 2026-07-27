# 依赖全量升级需求文档

> **版本**：v1.0
> **创建日期**：2026-07-26
> **关联问题**：`globals.css` 引用未安装的 `tailwindcss-animate` 导致 Vite 启动报错；同时按用户要求把全部依赖升级到最新稳定版（含 TypeScript v7）

---

## 1. 需求理解

1. **立即修复**：`src/styles/globals.css` 第 2 行 `@plugin "tailwindcss-animate"` 在仅安装 `tw-animate-css` 的环境下无法解析，导致 `@tailwindcss/vite:generate:serve` 报 `Can't resolve 'tailwindcss-animate'`。
2. **全量升级**：把 `package.json` 中所有 dependencies 与 devDependencies 一次性升到 npm 最新稳定版（含大版本跨越，如 TS 5→7、Vite 5→8、Zod 3→4、Vitest 2→4、ESLint 9→10、lucide-react 0.x→1.x 等），并修复由 breaking changes 引起的构建/类型/测试失败。

## 2. 功能需求

### 2.1 立即修复（P0）

| 需求 ID | 描述 | 验收标准 |
|---------|------|---------|
| FIX-01 | 修正 `globals.css` 动画库引用 | 把 `@plugin "tailwindcss-animate"` 改为 `@import "tw-animate-css"`；Vite dev 启动无报错；HTTP 200 响应正常 |

### 2.2 依赖升级到最新稳定版

#### 2.2.1 MAJOR 大版本跨越（高风险，需配套代码/配置改动）

| 需求 ID | 包 | 当前 | 目标 | 影响面 |
|---------|----|------|------|--------|
| MAJ-01 | `typescript` | ^5.5.0 | ^7.0.2 | 全量类型重新检查；tsconfig 配置可能需调整 |
| MAJ-02 | `vite` | ^5.4.0 | ^8.1.5 | `vite.config.ts`、HMR、构建 target 配置 |
| MAJ-03 | `vitest` | ^2.0.0 | ^4.1.10 | `vitest.config.ts`、所有测试用例 |
| MAJ-04 | `eslint` | ^9.10.0 | ^10.8.0 | `eslint.config.js` flat config 兼容 |
| MAJ-05 | `@eslint/js` | ^9.10.0 | ^10.0.1 | 配合 ESLint 10 |
| MAJ-06 | `eslint-plugin-react-hooks` | ^5.0.0 | ^7.1.1 | hook 规则可能更严格 |
| MAJ-07 | `globals` | ^15.0.0 | ^17.7.0 | `eslint.config.js` 引用 |
| MAJ-08 | `@vitejs/plugin-react` | ^4.3.0 | ^6.0.4 | `vite.config.ts`、`vitest.config.ts` |
| MAJ-09 | `zod` | ^3 | ^4.4.3 | `@hookform/resolvers` 解析器；所有 schema 定义文件 |
| MAJ-10 | `date-fns` | ^3 | ^4.4.0 | `HistoryPanel.tsx` 等使用方 |
| MAJ-11 | `lucide-react` | ^0.400 | ^1.27.0 | 13+ 个组件文件使用图标 |
| MAJ-12 | `sonner` | ^1.5 | ^2.0.7 | `ui/sonner.tsx`、`App.tsx` Toaster |
| MAJ-13 | `react-resizable-panels` | ^2 | ^4.12.2 | 当前代码未实际使用（仅 prd 文档提及），低风险 |

#### 2.2.2 Minor / Patch 升级（低风险）

| 需求 ID | 包 | 当前 | 目标 |
|---------|----|------|------|
| MIN-01 | `react` / `react-dom` | ^19.0.0 | ^19.2.8 |
| MIN-02 | `@types/react` / `@types/react-dom` | ^19.0.0 | ^19.2.x |
| MIN-03 | `@tauri-apps/api` | ^2.0.0 | ^2.11.1 |
| MIN-04 | `@tauri-apps/cli` | ^2.0.0 | ^2.11.4 |
| MIN-05 | `@tauri-apps/plugin-clipboard-manager` | ^2.0.0 | ^2.3.2 |
| MIN-06 | `@tauri-apps/plugin-dialog` | ^2.0.0 | ^2.7.2 |
| MIN-07 | `@tauri-apps/plugin-shell` | ^2.0.0 | ^2.3.5 |
| MIN-08 | `@tauri-apps/plugin-updater` | ^2.0.0 | ^2.10.1 |
| MIN-09 | `@hookform/resolvers` | ^5.4.3 | ^5.5.3 |
| MIN-10 | `cmdk` | ^1 | ^1.1.1 |
| MIN-11 | `@tanstack/react-virtual` | ^3 | ^3.14.8 |
| MIN-12 | `tailwindcss` | 4 | ^4.3.3 |
| MIN-13 | `@tailwindcss/vite` | 4 | ^4.3.3 |
| MIN-14 | `prettier` | ^3.3.0 | ^3.9.6 |
| MIN-15 | `typescript-eslint` | ^8.0.0 | ^8.65.0 |
| MIN-16 | `react-router-dom` | ^7 | ^7.18.1 |
| MIN-17 | `react-hook-form` | ^7 | ^7.83.0 |
| MIN-18 | `zustand` | ^5 | ^5.0.14 |
| MIN-19 | `eslint-plugin-react-refresh` | ^0.4.0 | ^0.5.3 |

#### 2.2.3 已是最新版（无需变更）

`@radix-ui/*` 全套 13 个、`tailwind-merge`、`tw-animate-css`、`monaco-editor`、`@monaco-editor/react`、`clsx`、`class-variance-authority`、`@testing-library/*`、`jsdom`、`@types/node`、`@tanstack/react-virtual`、`tailwind-merge`。

## 3. 非功能需求

| 维度 | 要求 |
|------|------|
| **不破坏现有功能** | `pnpm test` 全部通过；`pnpm typecheck` 无错误；`pnpm build` 成功产出 |
| **保留 lockfile 一致性** | 升级后 `pnpm-lock.yaml` 重新生成，无残留旧版本 |
| **配置文件最小改动** | 仅在 breaking change 必要时改 `tsconfig.json` / `vite.config.ts` / `vitest.config.ts` / `eslint.config.js`，不做无关重构 |
| **Tauri 兼容** | `@tauri-apps/*` 升级后 `src-tauri/Cargo.toml` 中 Tauri 版本无需联动（前端 JS 包独立） |
| **不引入新依赖** | 仅升级版本，不新增包；如 breaking change 必须新增替代包，需在设计文档中说明 |

## 4. 范围与边界

### 4.1 包含

- 修正 `globals.css` 动画库引用错误
- `package.json` 全量版本号升级
- `pnpm install` 重新生成 lockfile
- 修复因升级引起的 TypeScript 编译错误
- 修复因升级引起的 ESLint 报错
- 修复因升级引起的测试失败
- 必要的配置文件调整（tsconfig / vite / vitest / eslint）

### 4.2 不包含

- Rust 端（`src-tauri/`）依赖升级（`Cargo.toml` 保持现状）
- Tauri 主版本跨越（仍保持 v2）
- 业务功能变更或重构
- UI 视觉调整
- 性能优化

## 5. 验收标准

| 编号 | 验收项 | 命令 |
|------|--------|------|
| AC-01 | Vite dev 启动无 `tailwindcss-animate` 解析错误 | `pnpm dev`（HTTP 200） |
| AC-02 | TypeScript 类型检查通过 | `pnpm typecheck` |
| AC-03 | ESLint 通过 | `pnpm lint` |
| AC-04 | 单元测试全部通过 | `pnpm test` |
| AC-05 | 生产构建成功 | `pnpm build` |
| AC-06 | `package.json` 中所有包版本对齐最新稳定版 | `pnpm outdated` 无输出（或仅剩无法升级的） |
| AC-07 | 应用启动后核心功能可用（手动验证） | `pnpm tauri dev` 后切换主题、运行工具、查看历史 |

## 6. 风险与回滚

| 风险 | 缓解措施 |
|------|----------|
| TS v7 严格度提升导致大量类型错误 | 逐文件修复；必要时局部 `// @ts-expect-error`，但优先正确类型 |
| Vite v8 配置 API 变化导致 build 失败 | 参考 Vite v8 迁移指南；保持 `defineConfig` 简单结构 |
| Zod v4 schema 语法变化导致表单验证失效 | 检查 `@hookform/resolvers` 是否已支持 zod v4；必要时调整 schema 写法 |
| lucide-react v1 移除某些图标 | 替换为等价图标 |
| 升级中途卡死无法回退 | 升级前在 git 上打 tag `pre-dep-upgrade`；如失败可 `git reset --hard` 回滚 |

**回滚策略**：所有变更在单一 commit 中提交前，可通过 `git checkout -- .` 丢弃；提交后通过 `git revert` 回滚。`pnpm-lock.yaml` 不手动修改，由 `pnpm install` 重新生成。
