# 01 - 项目脚手架与 CI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Qraft Monorepo 脚手架,配置 Rust + Tauri + React + TypeScript 工具链,建立 CI 流水线,使后续子计划可在统一基础上开发。

**Architecture:** 单一 Monorepo,根目录放前端配置(package.json/vite/tsconfig/tailwind),`src-tauri/` 放 Rust 后端,`.github/workflows/` 放 CI。本阶段不写业务代码,只搭骨架。

**Tech Stack:** Rust stable (edition 2024) + Tauri V2 + React 19 + TypeScript 5.5 + Vite 5 + pnpm 9 + Tailwind CSS 3.4 + ESLint + Prettier + GitHub Actions

**Depends on:** 无(本计划是所有后续子计划的基础)

---

## 执行约定

本子计划以配置文件为主,严格 TDD 5 步循环不适用,改用 **3 步循环**:

1. **写文件** — 给出完整文件内容
2. **验证** — 给出命令与预期输出
3. **提交** — 给出 `git add <files>` + `git commit -m "<conventional commit>"`

少数涉及代码的任务(Task 10、Task 11)仍可使用"写代码 → `cargo check`/`pnpm typecheck` 验证 → 提交"的变体循环。

---

## 文件结构总览

| 文件 | 职责 |
|------|------|
| `.nvmrc` | Node.js 版本锁定(22) |
| `.npmrc` | pnpm 配置(engine-strict) |
| `.editorconfig` | 编辑器基础格式规范 |
| `.gitignore` | Git 忽略规则(Rust/Node/Tauri/平台) |
| `.gitattributes` | Git 换行符与 diff 配置 |
| `.env.example` | 环境变量模板 |
| `.prettierrc` | Prettier 格式化规则 |
| `.prettierignore` | Prettier 忽略清单 |
| `eslint.config.js` | ESLint flat config(TS + React) |
| `package.json` | Node 项目清单 + scripts + deps |
| `pnpm-lock.yaml` | pnpm 锁文件(生成) |
| `vite.config.ts` | Vite 构建配置(HMR + alias + Tauri 端口) |
| `tsconfig.json` | TypeScript 主配置(strict + `@/*` paths) |
| `tsconfig.node.json` | TypeScript Node 上下文配置(vite.config) |
| `tailwind.config.ts` | Tailwind CSS 配置(darkMode class) |
| `postcss.config.js` | PostCSS 配置(tailwind + autoprefixer) |
| `index.html` | Vite 入口 HTML |
| `src/main.tsx` | React 入口 |
| `src/App.tsx` | 根组件(Hello World) |
| `src/vite-env.d.ts` | Vite 类型声明 |
| `src/styles/globals.css` | 全局样式(Tailwind 指令) |
| `src-tauri/rust-toolchain.toml` | Rust 工具链锁定 |
| `src-tauri/rustfmt.toml` | Rust 格式化规则 |
| `src-tauri/clippy.toml` | Clippy MSRV 配置 |
| `src-tauri/Cargo.toml` | Rust 依赖清单(Tauri + plugins) |
| `src-tauri/Cargo.lock` | Cargo 锁文件(生成) |
| `src-tauri/build.rs` | Tauri 构建脚本 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置(CSP + bundle + window) |
| `src-tauri/capabilities/default.json` | Tauri V2 权限配置 |
| `src-tauri/src/main.rs` | Rust 入口 |
| `src-tauri/src/lib.rs` | Rust 库(Tauri Builder + 插件注册) |
| `.github/workflows/ci.yml` | GitHub Actions CI 工作流 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 模板 |
| `README.md` | 项目说明与开发指南 |

---

## Task 1: 创建 Monorepo 根目录结构

**Files:**
- Create: `src-tauri/src/`、`src-tauri/capabilities/`、`src-tauri/icons/`、`src-tauri/tests/fixtures/`、`src-tauri/benches/`、`src/components/ui/`、`src/tools/`、`src/store/`、`src/hooks/`、`src/lib/`、`src/types/`、`src/styles/`、`scripts/`、`docs/`、`.github/workflows/`
- Create: 各空目录下的 `.gitkeep`

- [ ] **Step 1: 创建目录树**

在项目根目录 `d:\DevTools\project\qraft` 下执行(PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path src-tauri/src/commands, src-tauri/src/core, src-tauri/src/store, src-tauri/src/tools, src-tauri/capabilities, src-tauri/icons, src-tauri/tests/fixtures, src-tauri/benches, src/components/ui, src/tools, src/store, src/hooks, src/lib, src/types, src/styles, scripts, docs, .github/workflows
```

预期输出:每个目录创建成功,无报错。`prd/` 已存在,不需要创建。

- [ ] **Step 2: 创建 `.gitkeep` 占位文件**

对以下空目录创建 `.gitkeep` 占位文件(本阶段不创建业务代码,这些目录将在后续子计划填充):

```powershell
@(
  "src-tauri/src/commands/.gitkeep",
  "src-tauri/src/core/.gitkeep",
  "src-tauri/src/store/.gitkeep",
  "src-tauri/src/tools/.gitkeep",
  "src-tauri/tests/fixtures/.gitkeep",
  "src-tauri/benches/.gitkeep",
  "src-tauri/icons/.gitkeep",
  "src/components/ui/.gitkeep",
  "src/tools/.gitkeep",
  "src/store/.gitkeep",
  "src/hooks/.gitkeep",
  "src/lib/.gitkeep",
  "src/types/.gitkeep",
  "scripts/.gitkeep",
  "docs/.gitkeep",
  ".github/workflows/.gitkeep"
) | ForEach-Object { New-Item -ItemType File -Force -Path $_ }
```

预期输出:16 个 `.gitkeep` 文件创建成功。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/commands/.gitkeep src-tauri/src/core/.gitkeep src-tauri/src/store/.gitkeep src-tauri/src/tools/.gitkeep src-tauri/tests/fixtures/.gitkeep src-tauri/benches/.gitkeep src-tauri/icons/.gitkeep src/components/ui/.gitkeep src/tools/.gitkeep src/store/.gitkeep src/hooks/.gitkeep src/lib/.gitkeep src/types/.gitkeep scripts/.gitkeep docs/.gitkeep .github/workflows/.gitkeep
git commit -m "chore: initialize monorepo directory structure"
```

---

## Task 2: Rust 工具链配置

**Files:**
- Create: `src-tauri/rust-toolchain.toml`
- Create: `src-tauri/rustfmt.toml`
- Create: `src-tauri/clippy.toml`

- [ ] **Step 1: 创建 `src-tauri/rust-toolchain.toml`**

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy", "rust-src"]
profile = "minimal"
```

说明:锁定 stable channel(自动满足 MSRV 1.85+),包含 rustfmt 与 clippy 组件。

- [ ] **Step 2: 创建 `src-tauri/rustfmt.toml`**

```toml
edition = "2024"
max_width = 100
tab_spaces = 4
use_field_init_shorthand = true
use_try_shorthand = true
```

说明:遵循 17-dev-workflow.md §3.2 的格式化规则。

- [ ] **Step 3: 创建 `src-tauri/clippy.toml`**

```toml
msrv = "1.85"
```

说明:告知 clippy 最低支持 Rust 版本为 1.85,启用 edition 2024 相关 lint。

- [ ] **Step 4: 验证并提交**

```bash
cd src-tauri
rustup show
cargo fmt --check
cd ..
```

预期输出:
- `rustup show` 显示 `active toolchain` 为 stable
- `cargo fmt --check` 无输出(表示格式正确,因为没有 .rs 文件则直接通过)

```bash
git add src-tauri/rust-toolchain.toml src-tauri/rustfmt.toml src-tauri/clippy.toml
git commit -m "chore(build): configure rust toolchain, rustfmt, and clippy"
```

---

## Task 3: package.json 与 pnpm 配置

**Files:**
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `package.json`

- [ ] **Step 1: 创建 `.nvmrc` 与 `.npmrc`**

`.nvmrc`:
```
22
```

`.npmrc`:
```
engine-strict=true
```

说明:Node 22 LTS(见 03-tech-stack.md §6.3),`engine-strict` 确保版本不匹配时报错。

- [ ] **Step 2: 创建 `package.json`**

```json
{
  "name": "qraft",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "A local-first developer toolbox built with Rust + Tauri + React",
  "engines": {
    "node": ">=22",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-clipboard-manager": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-updater": "^2.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.10.0",
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.10.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.0",
    "globals": "^15.0.0",
    "postcss": "^8.4.0",
    "prettier": "^3.3.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

说明:
- `packageManager` 锁定 pnpm 9.12.0(Corepack 会使用此版本)
- 版本约束遵循 03-tech-stack.md:React ^19、Tauri ^2、TypeScript ^5.5、Vite ^5、Tailwind ^3.4、pnpm ^9
- Tauri plugins(dialog/clipboard/shell/updater)按 03-tech-stack.md §3.3 添加
- `scripts` 覆盖任务要求的全部命令(dev/build/tauri/test/lint/format/typecheck)

- [ ] **Step 3: 验证依赖安装**

```bash
pnpm install
```

预期输出:
- 安装成功,无 peer dependency 警告
- 生成 `pnpm-lock.yaml` 与 `node_modules/`

- [ ] **Step 4: 提交**

```bash
git add .nvmrc .npmrc package.json pnpm-lock.yaml
git commit -m "chore(build): add package.json with pnpm and node config"
```

---

## Task 4: TypeScript 与 Vite 配置

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`

- [ ] **Step 1: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

说明:`strict: true` + `@/*` → `./src/*` 路径别名(03-tech-stack.md §3.5),`moduleResolution: bundler` 适配 Vite。

- [ ] **Step 2: 创建 `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 3: 创建 `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite 配置:Tauri + React + HMR
// - server.port 1420 是 Tauri 约定的开发端口
// - envPrefix 包含 TAURI_ENV_ 前缀变量
// - build.target 适配三平台 WebView(Chrome 100 / Safari 13)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
```

- [ ] **Step 4: 验证并提交**

```bash
pnpm typecheck
```

预期输出:无错误(此时 `src/` 下尚无 .ts/.tsx 文件,typecheck 通过)。

```bash
git add tsconfig.json tsconfig.node.json vite.config.ts
git commit -m "chore(build): configure typescript and vite"
```

---

## Task 5: Tailwind CSS 与 PostCSS 配置

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/styles/globals.css`

- [ ] **Step 1: 创建 `tailwind.config.ts` 与 `postcss.config.js`**

`tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

`postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

说明:`darkMode: 'class'` 支持暗色主题切换(15-ui-design-system.md),content 覆盖 Vite 入口与 src 下所有 TS/TSX。

- [ ] **Step 2: 创建 `src/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

说明:Tailwind 三指令,后续子计划(04)会在此基础上添加 CSS 变量与设计 token。

- [ ] **Step 3: 提交**

```bash
git add tailwind.config.ts postcss.config.js src/styles/globals.css
git commit -m "chore(build): configure tailwind css and postcss"
```

---

## Task 6: 代码规范工具(ESLint + Prettier + EditorConfig)

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.editorconfig`

- [ ] **Step 1: 创建 `eslint.config.js`**

```javascript
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// ESLint flat config(TS + React)
// 忽略 dist / src-tauri / node_modules(后者 ESLint 自动忽略)
export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
```

说明:遵循 17-dev-workflow.md §3.3 的 ESLint 规则,`no-explicit-any: error` 强制类型安全,`no-unused-vars` 忽略下划线前缀参数。

- [ ] **Step 2: 创建 `.prettierrc` 与 `.prettierignore`**

`.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

`.prettierignore`:
```
dist
node_modules
src-tauri/target
src-tauri/gen
pnpm-lock.yaml
Cargo.lock
prd
```

说明:Prettier 规则遵循 17-dev-workflow.md §3.3,忽略产物目录与 PRD 文档。

- [ ] **Step 3: 创建 `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.rs]
indent_size = 4

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

说明:Rust 文件缩进 4 空格(匹配 rustfmt),其余 2 空格;Markdown 保留尾部空格(换行语法)。

- [ ] **Step 4: 验证并提交**

```bash
pnpm lint
pnpm format:check
```

预期输出:两条命令均无错误(此时 `src/` 下尚无 .ts/.tsx 文件,lint 无目标,format:check 无需格式化的文件)。

```bash
git add eslint.config.js .prettierrc .prettierignore .editorconfig
git commit -m "chore(build): add eslint, prettier, and editorconfig"
```

---

## Task 7: Git 配置(.gitignore + .gitattributes)

**Files:**
- Create: `.gitignore`
- Create: `.gitattributes`

- [ ] **Step 1: 创建 `.gitignore`**

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
dist-ssr/
*.local

# Rust / Tauri
src-tauri/target/
src-tauri/gen/

# IDE
.vscode/*
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
desktop.ini

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Testing
coverage/
```

说明:`Cargo.lock` 与 `pnpm-lock.yaml` 不忽略(03-tech-stack.md §6.1 要求双锁文件提交)。`src-tauri/gen/` 为自动生成的 schema,不提交。

- [ ] **Step 2: 创建 `.gitattributes`**

```gitattributes
# Auto-detect text files
* text=auto

# Source files (force LF)
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.css text eol=lf
*.html text eol=lf
*.md text eol=lf
*.toml text eol=lf
*.rs text eol=lf
*.yaml text eol=lf
*.yml text eol=lf

# Binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.icns binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary

# Lock files (force LF)
pnpm-lock.yaml text eol=lf
Cargo.lock text eol=lf
```

说明:强制所有源文件使用 LF 换行(跨平台一致性),二进制文件不做换行转换。

- [ ] **Step 3: 提交**

```bash
git add .gitignore .gitattributes
git commit -m "chore: add gitignore and gitattributes"
```

---

## Task 8: Tauri Cargo.toml 与 build.rs

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`

- [ ] **Step 1: 创建 `src-tauri/Cargo.toml`**

```toml
[package]
name = "qraft"
version = "0.1.0"
description = "A local-first developer toolbox"
authors = ["Qraft Team"]
edition = "2024"
rust-version = "1.85"

[lib]
name = "qraft_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"

# —— 后续子计划将在此处添加 Core 层依赖 ——
# 02-rust-core-engine.md 将添加:
#   tokio, serde, serde_json, thiserror, anyhow, inventory,
#   async-trait, tokio-util, futures, directories, atomicwrites,
#   parking_lot, tracing, tracing-subscriber
# 禁止引入网络相关 crate(见 13-security.md §3.1):
#   tauri-plugin-http / reqwest / ureq —— 均不允许

[lints.clippy]
all = "deny"
pedantic = "warn"
nursery = "warn"
unwrap_used = "warn"
expect_used = "warn"
panic = "warn"
todo = "warn"
dbg_macro = "deny"
print_stdout = "deny"

[profile.dev]
panic = "unwind"

[profile.release]
panic = "unwind"
```

说明:
- 依赖版本遵循 03-tech-stack.md §3.3(Tauri ^2 + 4 个 plugin)
- `[lints.clippy]` 遵循 17-dev-workflow.md §3.2(严格 clippy 配置)
- `panic = "unwind"` 为后续 catch_unwind 准备(见 02-rust-core-engine.md Task 0)
- `rust-version = "1.85"` 锁定 MSRV
- 注释标注 Core 依赖将由子计划 02 添加,且明确禁止网络 crate

- [ ] **Step 2: 创建 `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

说明:Tauri 构建脚本,生成 `tauri::generate_context!()` 所需的上下文(读取 `tauri.conf.json` 与 capabilities)。

- [ ] **Step 3: 验证依赖解析**

```bash
cd src-tauri
cargo check
cd ..
```

预期输出:`Finished` 无错误。首次运行会下载依赖,耗时较长(2-5 分钟)。若出现版本冲突,检查 Cargo.toml 版本号是否拼写正确。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs
git commit -m "build(shell): initialize tauri cargo manifest and build script"
```

---

## Task 9: tauri.conf.json 与 capabilities

**Files:**
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`

- [ ] **Step 1: 创建 `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Qraft",
  "version": "0.1.0",
  "identifier": "com.qraft.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Qraft",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

说明:
- CSP 遵循 13-security.md §3.1:`default-src 'self'`(零网络出站),`img-src 'self' data:`(允许 QR 码等 data URI),`style-src 'self'`(Tailwind 构建产物),`script-src 'self'`(禁止外部脚本)
- `devUrl` 指向 Vite 的 1420 端口(与 vite.config.ts 一致)
- `beforeDevCommand` / `beforeBuildCommand` 让 Tauri CLI 自动启动前端
- 窗口 label 为 `main`(capabilities 中引用)
- 图标文件本阶段不创建,`tauri dev` / `cargo check` 不需要图标,仅 `tauri build` 需要(后续子计划 06 会通过 `pnpm tauri icon` 生成)

- [ ] **Step 2: 创建 `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-close",
    "dialog:allow-open",
    "dialog:allow-save",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "shell:allow-open",
    "updater:default"
  ]
}
```

说明:
- 遵循 13-security.md §3.5 的最小权限原则
- 每个权限明确列出,不使用通配符
- 仅授权与 Cargo.toml 中已声明插件对应的权限
- `fs:*` 权限本阶段不添加(未引入 `tauri-plugin-fs`),后续子计划按需添加

- [ ] **Step 3: 验证 JSON 合法性**

```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('tauri.conf.json OK')"
node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); console.log('capabilities OK')"
```

预期输出:
```
tauri.conf.json OK
capabilities OK
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "build(shell): configure tauri.conf.json and capabilities"
```

---

## Task 10: Rust 入口文件(main.rs + lib.rs)

**Files:**
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 `src-tauri/src/main.rs`**

```rust
// 在 release 模式下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    qraft_lib::run()
}
```

说明:最小入口,仅调用 `qraft_lib::run()`。`windows_subsystem = "windows"` 在 release 模式下隐藏控制台窗口。

- [ ] **Step 2: 创建 `src-tauri/src/lib.rs`**

```rust
// 后续子计划将在此处声明业务模块:
// pub mod core;
// pub mod commands;
// pub mod store;
// pub mod tools;

/// 启动 Tauri 应用。
///
/// 注册所需插件并启动事件循环。业务模块将在后续子计划中添加。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("critical: tauri application failed to start");
}
```

说明:
- 注册 4 个 Tauri 插件(dialog / clipboard-manager / shell / updater),与 Cargo.toml 依赖对应
- `setup(|_app| Ok(()))` 为空 setup,后续子计划在此注入 AppState
- `#[allow(clippy::expect_used)]` 豁免入口处的 `expect`(应用启动失败时 panic 是正确行为)
- `lib.rs` 顶部注释标注后续子计划将声明的模块

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri
cargo check
cargo clippy -- -D warnings
cargo fmt --check
cd ..
```

预期输出:
- `cargo check`:`Finished` 无错误
- `cargo clippy -- -D warnings`:无 warning
- `cargo fmt --check`:无输出(格式正确)

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/main.rs src-tauri/src/lib.rs
git commit -m "feat(shell): add minimal tauri entry point"
```

---

## Task 11: React 入口与 HTML

**Files:**
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/vite-env.d.ts`
- Create: `src/App.tsx`

- [ ] **Step 1: 创建 `index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Qraft</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

说明:`class="dark"` 启用 Tailwind 暗色主题(darkMode: 'class'),后续子计划 04 会实现主题切换。

- [ ] **Step 2: 创建 `src/main.tsx` 与 `src/vite-env.d.ts`**

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
```

说明:`vite-env.d.ts` 提供 Vite 客户端类型(`import.meta.env` 等)。

- [ ] **Step 3: 创建 `src/App.tsx`**

```tsx
function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <h1 className="text-4xl font-bold">Qraft</h1>
    </div>
  );
}

export default App;
```

说明:最小 Hello World 组件,使用 Tailwind 类名。`bg-background` / `text-foreground` 在后续子计划 04 的 globals.css 中定义 CSS 变量;本阶段若样式未生效,会回退到浏览器默认样式,不影响功能验证。

- [ ] **Step 4: 验证并提交**

```bash
pnpm typecheck
pnpm lint
```

预期输出:
- `pnpm typecheck`:无错误
- `pnpm lint`:无错误

```bash
git add index.html src/main.tsx src/vite-env.d.ts src/App.tsx
git commit -m "feat(ui): add react entry point and html"
```

---

## Task 12: 环境变量模板

**Files:**
- Create: `.env.example`

- [ ] **Step 1: 创建 `.env.example`**

```env
# Qraft 环境变量模板
# 复制此文件为 .env 并按需调整:cp .env.example .env

# 应用环境(development | production)
VITE_APP_ENV=development

# 日志级别(trace | debug | info | warn | error)
VITE_LOG_LEVEL=info

# Tauri 环境由 Tauri CLI 自动设置,无需手动配置:
# TAURI_ENV_DEBUG=1(开发模式)
# TAURI_ENV_RELEASE=1(生产模式)
```

说明:Qraft 是零网络本地应用,环境变量极少。后续子计划按需添加(如自动更新端点)。

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "chore: add environment variable template"
```

---

## Task 13: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  RUST_BACKTRACE: 1
  CARGO_INCREMENTAL: 0
  CARGO_NET_RETRY: 10
  RUSTUP_MAX_RETRIES: 10

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Linux deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - name: Rust format check
        working-directory: src-tauri
        run: cargo fmt --check
      - name: Clippy
        working-directory: src-tauri
        run: cargo clippy -- -D warnings
      - name: TypeScript lint
        run: pnpm lint
      - name: Typecheck
        run: pnpm typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Linux deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - name: Rust test
        working-directory: src-tauri
        run: cargo test
      - name: Frontend test
        run: pnpm test

  build:
    name: Build (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: windows-latest
            target: x86_64-pc-windows-msvc
          - os: macos-latest
            target: aarch64-apple-darwin
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - name: Install Linux deps
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build (no bundle)
        run: pnpm tauri build --target ${{ matrix.target }} --no-bundle

  audit:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: cargo audit
        run: |
          cargo install cargo-audit --locked
          cd src-tauri && cargo audit
      - name: pnpm audit
        run: pnpm audit --audit-level moderate
```

说明:
- 4 个 job:lint / test / build(三平台矩阵) / audit
- `lint`:Rust fmt + clippy + TS eslint + typecheck
- `test`:Rust cargo test + 前端 vitest
- `build`:三平台 `tauri build --no-bundle`(验证编译,不生成安装包,加速 CI)
- `audit`:cargo audit + pnpm audit(遵循 13-security.md §3.6)
- 使用 `Swatinem/rust-cache@v2` 缓存 Rust 编译产物
- Linux 需要 webkit2gtk-4.1 等系统依赖

- [ ] **Step 2: 创建 `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## 变更说明
<!-- 简述本次变更的目的 -->

## 变更类型
- [ ] 新功能 (feat)
- [ ] Bug 修复 (fix)
- [ ] 重构 (refactor)
- [ ] 文档 (docs)
- [ ] 测试 (test)
- [ ] 构建/CI (chore)

## 关联 Issue
Closes #

## Checklist
- [ ] 代码通过 `cargo fmt --check` 与 `pnpm format:check`
- [ ] 代码通过 `cargo clippy -- -D warnings` 与 `pnpm lint`
- [ ] 新增/修改的功能有测试覆盖
- [ ] 测试通过 `cargo test` 与 `pnpm test`
- [ ] 性能未退化(基准测试对比)
- [ ] 包体积未增加 >500KB
- [ ] 文档已更新(如涉及)
- [ ] CHANGELOG 已更新(用户可见变更)

## 截图/录屏
<!-- 如涉及 UI 变更,附截图或录屏 -->

## 其他说明
<!-- Reviewer 需要关注的重点、设计决策等 -->
```

说明:遵循 17-dev-workflow.md §3.6 的 PR 模板。

- [ ] **Step 3: 验证 YAML 语法并提交**

```bash
node -e "const yaml=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('ci.yml lines:', yaml.split('\n').length)"
```

预期输出:`ci.yml lines: <行数>`(确认文件存在且可读)

```bash
git add .github/workflows/ci.yml .github/PULL_REQUEST_TEMPLATE.md .github/workflows/.gitkeep
git rm --cached .github/workflows/.gitkeep 2>/dev/null || true
git commit -m "ci: add github actions workflow and pr template"
```

说明:如果 `.github/workflows/.gitkeep` 已被 git 跟踪,用 `git rm --cached` 移除(已有 ci.yml 不再需要占位文件)。

---

## Task 14: README.md 与冒烟验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 创建 `README.md`**

```markdown
# Qraft

> A local-first developer toolbox built with Rust + Tauri + React.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (managed via `.nvmrc`)
- [pnpm](https://pnpm.io/) 9+ (`corepack enable`)
- [Rust](https://www.rust-lang.org/) stable (1.85+, managed via `src-tauri/rust-toolchain.toml`)

### Platform-specific requirements

- **Windows**: Visual Studio Build Tools 2022 with C++ desktop workload + WebView2
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

## Getting Started

```bash
# Clone the repository
git clone <repo-url> qraft
cd qraft

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start development (full desktop app)
pnpm tauri dev

# Or start frontend only (HMR)
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server (frontend only) |
| `pnpm tauri dev` | Start Tauri + React development |
| `pnpm build` | Build frontend for production |
| `pnpm tauri build` | Build desktop app for current platform |
| `pnpm test` | Run frontend tests |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `pnpm typecheck` | Run TypeScript type checking |

## Project Structure

```
qraft/
├── src/              # React frontend
├── src-tauri/        # Rust + Tauri backend
├── .github/          # CI/CD workflows
├── prd/              # Product requirement documents
└── docs/             # User documentation
```

## Tech Stack

- **Rust** (stable, edition 2024) — Core engine
- **Tauri V2** — Desktop framework
- **React 19** + **TypeScript 5.5** — UI
- **Vite 5** — Build tool
- **Tailwind CSS 3.4** — Styling
- **pnpm 9** — Package manager

## License

MIT
```

说明:简短的项目说明,包含环境要求、快速开始、脚本清单、项目结构。遵循 17-dev-workflow.md §3.1 的目录概览。

- [ ] **Step 2: 验证 Rust 编译**

```bash
cd src-tauri
cargo check
cargo clippy -- -D warnings
cd ..
```

预期输出:
- `cargo check`:`Finished` 无错误
- `cargo clippy -- -D warnings`:无 warning

- [ ] **Step 3: 验证前端启动**

```bash
pnpm typecheck
pnpm lint
pnpm dev
```

预期输出:
- `pnpm typecheck`:无错误
- `pnpm lint`:无错误
- `pnpm dev`:Vite 开发服务器启动,输出类似:
  ```
  VITE v5.4.x  ready in xxx ms
  ➜  Local:   http://localhost:1420/
  ```
  在浏览器打开 `http://localhost:1420` 可看到 "Qraft" 标题。验证后按 `Ctrl+C` 停止。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: add readme and verify bootstrap"
```

---

## 完成检查清单

执行完所有 Task 后,确认以下各项均已满足:

- [ ] Monorepo 目录结构完整(17-dev-workflow.md §3.1)
- [ ] Rust 工具链锁定(stable, MSRV 1.85, edition 2024)
- [ ] Node 22 + pnpm 9 配置就绪
- [ ] TypeScript strict 模式 + `@/*` 路径别名
- [ ] Vite 5 + Tailwind 3.4 配置完成
- [ ] Tauri V2 + 4 个 plugin 依赖就绪
- [ ] CSP 为 `default-src 'self'`(零网络,13-security.md §3.1)
- [ ] capabilities/default.json 最小权限配置(13-security.md §3.5)
- [ ] ESLint + Prettier + EditorConfig 配置完成
- [ ] .gitignore + .gitattributes 配置完成
- [ ] GitHub Actions CI(lint + test + build + audit)就绪
- [ ] package.json scripts 覆盖全部命令
- [ ] `cargo check` 通过
- [ ] `pnpm dev` 可启动并显示 "Qraft"

## 后续子计划衔接

本子计划完成后,后续子计划可在此基础上开始:

| 子计划 | 将在本子计划基础上添加 |
|--------|----------------------|
| 02-rust-core-engine | Core 层依赖(tokio/serde/inventory 等)、Tool trait、ToolRegistry、ToolExecutor |
| 03-tauri-shell-layer | IPC Command、AppState、Permission Manager |
| 04-react-ui-scaffold | shadcn/ui 组件、Zustand store、路由、设计 token |
| 05-p0-tools | 10 个 P0 工具的 Rust 实现与 UI 组件 |
| 06-distribution-packaging | 应用图标、签名、自动更新、三平台安装包 |