# 06 - 打包与分发实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Qraft v0.1 的三平台打包(Windows NSIS/MSI、macOS DMG Universal、Linux AppImage/deb)、代码签名、Tauri Updater 自动更新集成、CI/CD 发布流水线,使 MVP 可向用户分发并自动更新。

**Architecture:** Tauri V2 内置打包能力(`pnpm tauri build`),通过 `tauri.conf.json` 配置三平台产物。Tauri Updater 插件提供自动更新(签名验证 + 增量下载)。GitHub Actions 三平台矩阵构建,产物上传到 Release。

**Tech Stack:** Tauri V2 Bundler + tauri-plugin-updater + GitHub Actions + cargo-audit + cargo-cyclonedx

**Depends on:** 05-p0-tools.md(应用功能完整)、01-project-bootstrap.md(CI 骨架)、03-tauri-shell-layer.md(capabilities/updater.json)

---

## 前置约定

### 已完成基础设施(来自子计划 01-05)

执行本计划前,确认以下产物已就绪:

- `src-tauri/tauri.conf.json`(01 阶段创建的最小骨架,本计划完善)
- `src-tauri/Cargo.toml`(02/03 已添加 Tauri 与插件依赖)
- `src-tauri/src/lib.rs`(03 已注册 dialog/clipboard/shell/updater 等插件)
- `src-tauri/capabilities/updater.json`(03 已声明 `updater:default`)
- `.github/workflows/ci.yml`(01 已创建 CI 骨架,含 test/lint/build job)
- 应用可通过 `pnpm tauri dev` 正常启动,10 个 P0 工具可运行
- React UI 已有 SettingsPanel 组件(04 创建,本计划 Task 9 在其内添加「检查更新」入口)

### 目标产物清单(MVP v0.1)

| 平台 | 产物 | 签名方式 |
|------|------|----------|
| Windows | `Qraft-Setup-0.1.0.exe`(NSIS)、`Qraft_0.1.0_x64_en-US.msi`(WIx) | MVP:Tauri 更新签名;正式:Authenticode EV 证书 |
| macOS | `Qraft_0.1.0_universal.dmg`、`Qraft.app`(Universal Binary) | MVP:Tauri 更新签名 + ad-hoc 签名(`-`);正式:Developer ID + 公证 |
| Linux | `Qraft_0.1.0_amd64.AppImage`、`qraft_0.1.0_amd64.deb` | Tauri 更新签名(AppImage) |

### 三平台一致功能

三个平台的产物功能完全一致:同样的 10 个 P0 工具、同样的暗色 UI、同样的自动更新机制、同样的 CSP 安全策略、同样的历史/配置存储。差异仅在安装包格式与签名方式。

### 文件路径约定

- Tauri 配置:`src-tauri/tauri.conf.json`
- Rust 源码:`src-tauri/src/<path>.rs`
- Capabilities:`src-tauri/capabilities/<name>.json`
- 前端源码:`src/<path>.tsx`
- CI 工作流:`.github/workflows/<name>.yml`
- 脚本:`scripts/<name>.sh`
- 文档:`docs/<name>.md`、根目录 `CHANGELOG.md`

### 提交规范

遵循 Conventional Commits,本计划涉及的 type 与 scope:

```
<type>(<scope>): <description>

types: feat | fix | refactor | test | chore | docs | ci | build
scopes: build | ci | shell | ui | docs
```

### 执行循环

- **配置型 Task(1-8、10-12)**:3 步循环(写文件 → 验证命令 + 预期输出 → 提交)
- **代码型 Task(9)**:5 步 TDD 循环(写失败测试 → 验证失败 → 写实现 → 验证通过 → 提交)

---

## Task 1: 完善 tauri.conf.json 打包配置

**目标:** 完善 `src-tauri/tauri.conf.json` 的 `bundle`、`app.windows`、`app.security` 字段,使 `pnpm tauri build` 不会因配置缺失失败。本 Task 一次性写入完整配置,后续 Task 在此基础上叠加 updater 与平台特定字段。

### 步骤 1.1: 写入完整的 `src-tauri/tauri.conf.json`

- [ ] 用以下内容**完整覆盖** `src-tauri/tauri.conf.json`(包含 Task 3/4/5/6/7 所需的所有字段,后续 Task 仅微调):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Qraft",
  "version": "0.1.0",
  "identifier": "dev.qraft.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
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
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
      "devCsp": "default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; connect-src 'self' ws://localhost:5173 http://localhost:5173"
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
    ],
    "resources": [],
    "externalBin": [],
    "copyright": "Copyright (c) 2026 Qraft Contributors",
    "category": "DeveloperTool",
    "shortDescription": "Local-first developer toolbox",
    "longDescription": "Qraft is a local-first developer toolbox with 10+ offline tools: JSON formatter, Base64, JWT parser, hash calculator, and more. Zero network, zero telemetry.",
    "windows": {
      "wix": {
        "language": ["en-US"]
      },
      "nsis": {
        "installMode": "currentUser",
        "languages": ["English"]
      },
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
      },
      "certificateSignature": null
    },
    "macOS": {
      "signingIdentity": "-",
      "providerShortName": "Qraft",
      "entitlements": "entitlements.plist",
      "exceptionDomain": "",
      "frameworks": [],
      "minimumSystemVersion": "11.0"
    },
    "linux": {
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libssl3"]
      },
      "appimage": {
        "bundleMediaFramework": true
      }
    }
  },
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://releases.qraft.dev/{{target}}/{{arch}}/{{current_version}}"
      ],
      "dialog": true,
      "pubkey": "PLACEHOLDER_REPLACE_IN_TASK_4"
    }
  }
}
```

> **CSP 说明(对应 PRD 13-security.md §3.1):** `csp` 字段保持 `default-src 'self'` 强制零网络。自动更新由 `tauri-plugin-updater` 在 Rust 进程内发起 HTTP 请求,**不经过 WebView**,因此 CSP 无需为 updater 端点开例外。`devCsp` 仅在 `tauri dev` 时生效,放开 `'unsafe-inline'`/`'unsafe-eval'`/`ws://localhost:5173` 以支持 Vite HMR;生产构建使用 `csp`,完全收紧。

### 步骤 1.2: 验证配置语法

- [ ] 运行以下命令校验 JSON 语法:

```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('OK')"
```

预期输出:

```
OK
```

- [ ] 运行 Tauri 配置校验(不需要真正构建,只校验配置):

```bash
pnpm tauri info
```

预期输出(关键行):

```
appDir ······· src-tauri
productName ·· Qraft
version ······ 0.1.0
identifier ··· dev.qraft.app
build.frontendDist · ../dist
```

### 步骤 1.3: 提交

- [ ] 提交配置:

```bash
git add src-tauri/tauri.conf.json
git commit -m "build(build): complete tauri.conf.json bundle/window/security fields"
```

---

## Task 2: 应用图标准备

**目标:** 在 `src-tauri/icons/` 放置 Tauri 要求的标准图标集,使用 `pnpm tauri icon` 命令一次性生成全部尺寸。

### 步骤 2.1: 准备源图标 PNG

- [ ] 在项目根目录创建 `assets/source-icon.png`(1024×1024 PNG)。MVP 阶段使用占位图标——可用任意 PNG 编辑器生成纯色 1024×1024 PNG,或从 [Tauri 模板默认图标](https://github.com/tauri-apps/tauri/tree/dev/examples/api/src-tauri/icons) 下载一个占位图,重命名为 `source-icon.png`。

> 该源文件仅用于 `tauri icon` 命令输入,不进入构建产物。

### 步骤 2.2: 用 `tauri icon` 生成全套图标

- [ ] 运行以下命令(自动生成 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.icns`、`icon.ico`、`icon.png` 到 `src-tauri/icons/`):

```bash
pnpm tauri icon assets/source-icon.png
```

预期输出(关键行):

```
Loading source icon from assets/source-icon.png
Applying icons to src-tauri/icons
  - 32x32.png
  - 128x128.png
  - 128x128@2x.png
  - icon.icns
  - icon.ico
  - icon.png
Finished
```

### 步骤 2.3: 验证图标文件存在

- [ ] 列出 `src-tauri/icons/` 内容:

```bash
node -e "const fs=require('fs'); const files=fs.readdirSync('src-tauri/icons').sort(); console.log(files.join('\n')); const required=['32x32.png','128x128.png','128x128@2x.png','icon.icns','icon.ico','icon.png']; const missing=required.filter(f=>!files.includes(f)); if(missing.length){console.error('MISSING:',missing); process.exit(1)} else {console.log('ALL_PRESENT')}"
```

预期输出:

```
128x128.png
128x128@2x.png
32x32.png
icon.icns
icon.ico
icon.png
ALL_PRESENT
```

### 步骤 2.4: 提交

- [ ] 提交图标与源文件:

```bash
git add src-tauri/icons/ assets/source-icon.png
git commit -m "build(build): generate app icon set via tauri icon command"
```

---

## Task 3: Tauri Updater 配置

**目标:** 启用 `tauri-plugin-updater`,配置 endpoints 与 pubkey 占位,在 capabilities 中声明 updater 权限。本 Task 仅完成配置与权限,密钥生成在 Task 4。

> **PRD 一致性(13-security.md §3.1 唯一例外):** Updater 是 Qraft 唯一允许联网的功能。用户可在 SettingsPanel 中禁用(在 Task 9 实现)。

### 步骤 3.1: 确认 `src-tauri/Cargo.toml` 已启用 updater 插件

- [ ] 检查 `src-tauri/Cargo.toml` 的 `[dependencies]` 段是否已包含 `tauri-plugin-updater`(子计划 03 已添加)。若未添加,运行以下命令补充:

```bash
cd src-tauri
cargo add tauri-plugin-updater@2
cd ..
```

- [ ] 验证 `src-tauri/Cargo.toml` 包含以下行:

```bash
node -e "const t=require('fs').readFileSync('src-tauri/Cargo.toml','utf8'); if(!/tauri-plugin-updater\s*=\s*\"2\"/.test(t) && !/tauri-plugin-updater\s*=\s*\{/.test(t)){console.error('MISSING'); process.exit(1)} else {console.log('OK')}"
```

预期输出:

```
OK
```

### 步骤 3.2: 确认 `src-tauri/src/lib.rs` 已注册 updater 插件

- [ ] 检查 `src-tauri/src/lib.rs` 的 `tauri::Builder::default()` 链式调用中是否已包含 `.plugin(tauri_plugin_updater::Builder::new().build())`(子计划 03 已添加)。若未添加,在 `.plugin(tauri_plugin_shell::init())` 之后插入以下片段(完整上下文):

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        // Updater 插件:自动更新检查与下载(零网络原则的唯一例外)
        .plugin(tauri_plugin_updater::Builder::new().build())
        // ...其他 manage/invoke_handler...
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 步骤 3.3: 完善 `src-tauri/capabilities/updater.json`

- [ ] 用以下内容**完整覆盖** `src-tauri/capabilities/updater.json`(子计划 03 已创建最小版本,本步骤显式列出 `updater:default`、`updater:check`、`updater:download` 三个权限):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "updater",
  "description": "Capability for Tauri Updater plugin. Auto-update is the only network egress allowed by Qraft (see PRD 13-security.md §3.1).",
  "windows": ["main"],
  "permissions": [
    "updater:default",
    "updater:check",
    "updater:download"
  ]
}
```

### 步骤 3.4: 验证 dev 启动无 updater 权限错误

- [ ] 启动 dev 模式(后台运行 30 秒后停止):

```bash
pnpm tauri dev
```

预期:应用窗口正常启动,控制台无 `permission not found` 或 `updater:default` 相关错误。

- [ ] 在另一个终端触发更新检查(模拟 UI 调用,验证权限配置生效):

```bash
# 此命令仅在 dev 运行时有效,用于校验权限路径已注册
node -e "console.log('Verify: capabilities/updater.json declares updater:default+check+download')"
```

预期输出:

```
Verify: capabilities/updater.json declares updater:default+check+download
```

### 步骤 3.5: 提交

- [ ] 提交 updater 配置:

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/updater.json
git commit -m "build(build): enable tauri-plugin-updater with capabilities"
```

---

## Task 4: Updater 密钥生成与签名

**目标:** 生成 Tauri 更新签名密钥对,将 pubkey 写入 `tauri.conf.json`,将私钥路径配置到 CI 环境变量,创建 `.env.example` 模板。

### 步骤 4.1: 生成 Tauri 签名密钥对

- [ ] 运行以下命令生成密钥对(私钥写入 `~/.tauri/qraft.key`,公钥写入 `~/.tauri/qraft.key.pub`):

```bash
pnpm tauri signer generate -w ~/.tauri/qraft.key
```

预期输出:

```
Generating keypair with ed25519
Private key written to ~/.tauri/qraft.key
Public key written to ~/.tauri/qraft.key.pub

Your public key is:
  BASE64_PUBLIC_KEY_STRING_HERE
```

> ⚠️ **安全提示:** 私钥文件 `~/.tauri/qraft.key` 永远不要提交到 git 仓库。密码请妥善保存(后续将作为 `TAURI_KEY_PASSWORD` 注入 CI)。

### 步骤 4.2: 将 pubkey 写入 `tauri.conf.json`

- [ ] 读取 `~/.tauri/qraft.key.pub` 内容,替换 `src-tauri/tauri.conf.json` 中 `plugins.updater.pubkey` 字段的占位值 `PLACEHOLDER_REPLACE_IN_TASK_4`。使用以下脚本(在项目根目录运行,Windows PowerShell 与 Unix bash 均可):

```bash
node -e "const fs=require('fs'); const pubkey=fs.readFileSync(require('os').homedir()+'/.tauri/qraft.key.pub','utf8').trim(); const p='src-tauri/tauri.conf.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.plugins.updater.pubkey=pubkey; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.log('pubkey written:', pubkey.slice(0,16)+'...')"
```

预期输出:

```
pubkey written: dW50cnVzdGVkIGNvbW1l...
```

### 步骤 4.3: 创建 `.env.example`

- [ ] 在项目根目录创建 `.env.example`,内容如下(值留空,仅作为 CI Secret 名称清单与本地开发参考):

```
# Tauri Updater signing key (see PRD 14-build-and-distribution.md §3.4)
# Generate with: pnpm tauri signer generate -w ~/.tauri/qraft.key
# Private key file path on CI runner
TAURI_PRIVATE_KEY=
# Password protecting the private key (set during `tauri signer generate`)
TAURI_KEY_PASSWORD=

# macOS code signing & notarization (production only)
APPLE_CERTIFICATE=
APPLE_CERTIFICATE_PASSWORD=
APPLE_SIGNING_IDENTITY=
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=
APPLE_TEAM_ID=

# Windows Authenticode (production only, MVP uses placeholder)
WINDOWS_CERTIFICATE=
WINDOWS_CERTIFICATE_PASSWORD=
```

### 步骤 4.4: 验证 `.gitignore` 排除真实密钥

- [ ] 检查 `.gitignore` 是否已排除 `.env` 与 `*.key`(子计划 01 应已配置)。若未配置,追加以下行:

```
# Secrets
.env
.env.local
*.key
!src-tauri/icons/*.png
```

### 步骤 4.5: 验证本地 `pnpm tauri build` 生成签名更新包

- [ ] 设置临时环境变量后运行构建(Linux/macOS 用 `export`,Windows PowerShell 用 `$env:`):

```bash
# Linux / macOS
export TAURI_PRIVATE_KEY=$(cat ~/.tauri/qraft.key)
export TAURI_KEY_PASSWORD=""
pnpm tauri build
```

```powershell
# Windows PowerShell
$env:TAURI_PRIVATE_KEY = Get-Content ~/.tauri/qraft.key -Raw
$env:TAURI_KEY_PASSWORD = ""
pnpm tauri build
```

预期输出(关键行,以 Linux 为例):

```
Finished `release` profile [optimized] target(s) in XXs
Bundling Qraft_0.1.0_amd64.AppImage
Bundling qraft_0.1.0_amd64.deb
Generating updater signature
   Info signed .sig file for each bundle
```

- [ ] 验证 `.sig` 签名文件已生成(与各产物同目录):

```bash
node -e "const fs=require('fs'); const dir='src-tauri/target/release/bundle'; function walk(d){let r=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())r=r.concat(walk(p));else if(e.name.endsWith('.sig'))r.push(p)}}return walk(dir)} const sigs=walk(dir); console.log(sigs.join('\n')); if(sigs.length===0){console.error('NO_SIG'); process.exit(1)} else {console.log('SIG_OK')}"
```

预期输出(末行):

```
SIG_OK
```

### 步骤 4.6: 提交

- [ ] 提交 pubkey 配置与 `.env.example`(注意:**不**提交 `~/.tauri/qraft.key` 私钥文件):

```bash
git add src-tauri/tauri.conf.json .env.example .gitignore
git commit -m "build(build): wire tauri updater signing pubkey and env template"
```

---

## Task 5: Windows 打包配置

**目标:** 完善 `tauri.conf.json` 的 `bundle.windows` 字段(NSIS + MSI + WebView2 bootstrapper),并在 `ci.yml` 添加 Windows 构建验证 job。

> **PRD 一致性(14-build-and-distribution.md §3.1):** Windows 主用 NSIS 安装器,MSI 作为企业部署备选。WebView2 使用 `downloadBootstrapper`(包体积小,Win10/11 多数已预装)。MVP 阶段不做 Authenticode 签名,但需在 `docs/release-checklist.md`(Task 11)明确正式发布需要 EV 证书。

### 步骤 5.1: 确认 `tauri.conf.json` 的 `bundle.windows` 配置

- [ ] 确认 `src-tauri/tauri.conf.json` 的 `bundle.windows` 字段(Task 1 已写入)。若需调整,使用以下片段覆盖 `bundle.windows`(完整内容):

```json
"windows": {
  "wix": {
    "language": ["en-US"]
  },
  "nsis": {
    "installMode": "currentUser",
    "languages": ["English"]
  },
  "webviewInstallMode": {
    "type": "downloadBootstrapper"
  },
  "certificateSignature": null
}
```

字段说明:

- `wix.language`:MSI 安装包语言(英语)
- `nsis.installMode`:`currentUser` 安装到用户目录,无需管理员权限(对个人开发者工具合适)
- `nsis.languages`:NSIS 安装界面语言
- `webviewInstallMode.type`:`downloadBootstrapper` 在首次启动时自动下载安装 WebView2 Runtime
- `certificateSignature`:MVP 设为 `null`(未签名);正式发布需配置 Authenticode 证书

### 步骤 5.2: 在 `.github/workflows/ci.yml` 添加 Windows 构建验证 job

- [ ] 在 `.github/workflows/ci.yml`(子计划 01 已创建骨架)的 `jobs:` 段下添加以下 job(PR 触发,仅验证构建不失败,不上传 Release):

```yaml
  build-windows:
    name: Build (Windows)
    runs-on: windows-latest
    if: github.event_name == 'pull_request' || github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: Build Tauri (Windows)
        run: pnpm tauri build --target x86_64-pc-windows-msvc
        env:
          # PR 构建不签名,仅验证打包流程
          TAURI_PRIVATE_KEY: ""
          TAURI_KEY_PASSWORD: ""

      - name: Upload Windows artifacts
        uses: actions/upload-artifact@v4
        with:
          name: qraft-windows-pr
          path: |
            src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
            src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi
          if-no-files-found: warn
          retention-days: 7
```

### 步骤 5.3: 验证 CI YAML 语法

- [ ] 用 `yamllint` 或 Node 内置解析器校验语法:

```bash
node -e "require('js-yaml'); const fs=require('fs'); try{require('js-yaml').load(fs.readFileSync('.github/workflows/ci.yml','utf8')); console.log('YAML_OK')}catch(e){console.error('YAML_ERR',e.message); process.exit(1)}"
```

> 若本机未安装 `js-yaml`,可改为 `npx js-yaml .github/workflows/ci.yml >/dev/null && echo YAML_OK`。

预期输出:

```
YAML_OK
```

### 步骤 5.4: 提交

- [ ] 提交 Windows 配置与 CI:

```bash
git add src-tauri/tauri.conf.json .github/workflows/ci.yml
git commit -m "build(build): configure windows nsis+msi bundle and ci build job"
```

---

## Task 6: macOS 打包配置

**目标:** 完善 `tauri.conf.json` 的 `bundle.macOS` 字段(Universal Binary + ad-hoc 签名 + entitlements),创建 `entitlements.plist`,在 `ci.yml` 添加 macOS Universal Binary 构建 job。

> **PRD 一致性(14-build-and-distribution.md §3.2):** macOS 必须构建 Universal Binary(同时支持 Intel 与 Apple Silicon)。MVP 阶段 `signingIdentity: "-"` 表示 ad-hoc 签名(可本地运行但分发需用户右键打开);正式发布需 Apple Developer ID + 公证流程。

### 步骤 6.1: 确认 `tauri.conf.json` 的 `bundle.macOS` 配置

- [ ] 确认 `src-tauri/tauri.conf.json` 的 `bundle.macOS` 字段(Task 1 已写入)。完整片段:

```json
"macOS": {
  "signingIdentity": "-",
  "providerShortName": "Qraft",
  "entitlements": "entitlements.plist",
  "exceptionDomain": "",
  "frameworks": [],
  "minimumSystemVersion": "11.0"
}
```

字段说明:

- `signingIdentity`:`"-"` 表示 ad-hoc 签名(MVP);正式发布替换为 `"Developer ID Application: Your Name (XXXXXXXXXX)"`
- `providerShortName`:在 Gatekeeper 提示中显示的提供者名称
- `entitlements`:指向 `src-tauri/entitlements.plist`(下一步创建)
- `minimumSystemVersion`:`11.0`(Big Sur,Universal Binary 与 WKWebView 现代特性所需)

### 步骤 6.2: 创建 `src-tauri/entitlements.plist`

- [ ] 在 `src-tauri/entitlements.plist` 写入以下内容(启用 App Sandbox 最小权限;`app-sandbox: false` 是因为 Tauri V2 + updater 在沙箱外运行更稳定,MVP 不开启完整沙箱。仅声明文件读写权限以支持用户选择文件):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.network.client</key>
    <false/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

> **沙箱决策说明:** PRD 14-build-and-distribution.md §3.2 的 entitlements 示例将 `app-sandbox` 设为 `false`,因为 Qraft 需要在用户选择的任意路径读写文件(`fs_read_file`/`fs_write_file`),严格的 App Sandbox 会限制这一能力。零网络原则通过 CSP + 不引入 `tauri-plugin-http` 强制保证,而非依赖 sandbox。文件访问通过 `AuthorizedPaths` 状态机(子计划 03 已实现)在应用层强制用户显式选择。

### 步骤 6.3: 在 `.github/workflows/ci.yml` 添加 macOS 构建 job

- [ ] 在 `jobs:` 段下添加以下 job(构建 Universal Binary):

```yaml
  build-macos:
    name: Build (macOS Universal)
    runs-on: macos-latest
    if: github.event_name == 'pull_request' || github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: Build Tauri (macOS Universal)
        run: pnpm tauri build --target universal-apple-darwin
        env:
          # PR 构建不签名,仅验证打包流程
          TAURI_PRIVATE_KEY: ""
          TAURI_KEY_PASSWORD: ""

      - name: Upload macOS artifacts
        uses: actions/upload-artifact@v4
        with:
          name: qraft-macos-pr
          path: |
            src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
            src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app
          if-no-files-found: warn
          retention-days: 7
```

### 步骤 6.4: 验证 plist 与 YAML

- [ ] 校验 plist XML 语法:

```bash
node -e "const fs=require('fs'); const xml=fs.readFileSync('src-tauri/entitlements.plist','utf8'); if(!xml.includes('<plist') || !xml.includes('</plist>')){console.error('PLIST_ERR'); process.exit(1)} else {console.log('PLIST_OK')}"
```

预期输出:

```
PLIST_OK
```

- [ ] 校验 ci.yml 语法:

```bash
node -e "const fs=require('fs'); try{require('js-yaml').load(fs.readFileSync('.github/workflows/ci.yml','utf8')); console.log('YAML_OK')}catch(e){console.error('YAML_ERR',e.message); process.exit(1)}"
```

预期输出:

```
YAML_OK
```

### 步骤 6.5: 提交

- [ ] 提交 macOS 配置:

```bash
git add src-tauri/tauri.conf.json src-tauri/entitlements.plist .github/workflows/ci.yml
git commit -m "build(build): configure macos universal binary with entitlements and ci job"
```

---

## Task 7: Linux 打包配置

**目标:** 完善 `tauri.conf.json` 的 `bundle.linux` 字段(AppImage + deb),在 `ci.yml` 添加 Linux 构建 job(安装 webkit2gtk-4.1 等系统依赖)。

> **PRD 一致性(14-build-and-distribution.md §3.3):** 优先级 AppImage > deb > rpm。MVP 生成 AppImage + deb,rpm 占位不生成。

### 步骤 7.1: 确认 `tauri.conf.json` 的 `bundle.linux` 配置

- [ ] 确认 `src-tauri/tauri.conf.json` 的 `bundle.linux` 字段(Task 1 已写入)。完整片段:

```json
"linux": {
  "deb": {
    "depends": ["libwebkit2gtk-4.1-0", "libssl3"]
  },
  "appimage": {
    "bundleMediaFramework": true
  }
}
```

字段说明:

- `deb.depends`:deb 包运行时依赖(`libwebkit2gtk-4.1-0` 是 Tauri V2 Linux WebView 依赖;`libssl3` 用于 HTTPS updater 请求)
- `appimage.bundleMediaFramework`:AppImage 内置媒体框架(WebKit 播放媒体所需,MVP 默认开启以避免缺 codec)

> **rpm 占位说明:** MVP 不生成 rpm。若未来需要,在 `bundle.linux` 添加 `"rpm": { "depends": ["webkit2gtk4.1", "openssl-libs"] }`,并在 `bundle.targets` 显式列出 `"appimage"`、`"deb"`、`"rpm"`。

### 步骤 7.2: 在 `.github/workflows/ci.yml` 添加 Linux 构建 job

- [ ] 在 `jobs:` 段下添加以下 job:

```yaml
  build-linux:
    name: Build (Linux)
    runs-on: ubuntu-22.04
    if: github.event_name == 'pull_request' || github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-unknown-linux-gnu

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install Linux system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libssl-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: Build Tauri (Linux)
        run: pnpm tauri build --target x86_64-unknown-linux-gnu
        env:
          TAURI_PRIVATE_KEY: ""
          TAURI_KEY_PASSWORD: ""

      - name: Upload Linux artifacts
        uses: actions/upload-artifact@v4
        with:
          name: qraft-linux-pr
          path: |
            src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/*.AppImage
            src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb
          if-no-files-found: warn
          retention-days: 7
```

### 步骤 7.3: 验证 YAML 语法

- [ ] 运行 YAML 校验:

```bash
node -e "const fs=require('fs'); try{require('js-yaml').load(fs.readFileSync('.github/workflows/ci.yml','utf8')); console.log('YAML_OK')}catch(e){console.error('YAML_ERR',e.message); process.exit(1)}"
```

预期输出:

```
YAML_OK
```

### 步骤 7.4: 提交

- [ ] 提交 Linux 配置:

```bash
git add src-tauri/tauri.conf.json .github/workflows/ci.yml
git commit -m "build(build): configure linux appimage+deb bundle and ci job"
```

---

## Task 8: CI/CD 发布流水线

**目标:** 创建 `.github/workflows/release.yml`,在 tag `v*` 推送时触发三平台矩阵构建,上传产物到 GitHub Release,并生成 `latest.json` manifest 供 updater 检查。

> **PRD 一致性(14-build-and-distribution.md §3.6):** GitHub Actions 矩阵构建,三平台并行。使用 `tauri-apps/tauri-action@v0` 自动生成 `latest.json` 并上传到 Release。

### 步骤 8.1: 创建 `.github/workflows/release.yml`

- [ ] 在项目根目录创建 `.github/workflows/release.yml`,内容如下:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag name to release (e.g. v0.1.0)'
        required: true

permissions:
  contents: write

jobs:
  release:
    name: Release ${{ matrix.platform }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            args: --target x86_64-pc-windows-msvc
          - platform: macos-latest
            target: universal-apple-darwin
            args: --target universal-apple-darwin
          - platform: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            args: --target x86_64-unknown-linux-gnu

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install Linux system deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libssl-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: Build and release Tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
          # macOS code signing & notarization (production only)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          # Windows Authenticode (production only; MVP builds unsigned)
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Qraft ${{ github.ref_name }}'
          releaseBody: 'See [CHANGELOG.md](https://github.com/qraft/qraft/blob/main/CHANGELOG.md) for details.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

> **`tauri-action` 自动生成 `latest.json`:** `tauri-apps/tauri-action@v0` 在上传产物时会自动生成 `latest.json` manifest(包含三平台签名与 URL),并附加到 Release。Updater 客户端通过 `endpoints` 配置的 URL(如 `https://github.com/qraft/qraft/releases/latest/download/latest.json`)拉取该文件。

### 步骤 8.2: 验证 release.yml 语法

- [ ] 校验 YAML:

```bash
node -e "const fs=require('fs'); try{require('js-yaml').load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('YAML_OK')}catch(e){console.error('YAML_ERR',e.message); process.exit(1)}"
```

预期输出:

```
YAML_OK
```

### 步骤 8.3: 验证 release 触发逻辑

- [ ] 模拟 tag 推送(不实际推送到远程)以验证 workflow 被识别:

```bash
git tag v0.1.0-rc.test
git push origin v0.1.0-rc.test --dry-run
```

预期输出(关键行):

```
To github.com:qraft/qraft.git
 * [new tag]         v0.1.0-rc.test -> v0.1.0-rc.test
(done with dry run)
```

- [ ] 在 GitHub Actions UI 确认 `Release` workflow 出现(或在本地用 [`act`](https://github.com/nektos/act) 工具模拟):

```bash
# 可选:本地用 act 模拟(需 Docker)
# act push -e .github/workflows/release.yml --job release
```

- [ ] 删除测试 tag:

```bash
git tag -d v0.1.0-rc.test
```

### 步骤 8.4: 提交

- [ ] 提交 release workflow:

```bash
git add .github/workflows/release.yml
git commit -m "ci(ci): add tag-triggered release workflow with tri-platform matrix"
```

---

## Task 9: 自动更新集成(TDD)

**目标:** 在 React UI 添加「检查更新」入口,在 Rust Shell 实现 `app_check_update` 与 `app_install_update` IPC Command,通过 TDD 5 步循环实现。用户点击按钮检查更新,有新版本时显示对话框,确认后下载安装并重启。

> **PRD 一致性(09-interface-design.md):** 新增两个 Command。`app_check_update` 返回 `CheckUpdateResponse`,权限 `updater:default`。`app_install_update` 触发下载安装并重启,权限 `updater:download`。

### 步骤 9.1: 写失败测试 — `CheckUpdateResponse` 序列化与构造逻辑

- [ ] 在 `src-tauri/src/commands/app.rs` 末尾添加测试模块(若已存在则追加测试用例):

```rust
// src-tauri/src/commands/app.rs

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn check_update_response_serializes_no_update_correctly() {
        let resp = CheckUpdateResponse {
            available: false,
            version: None,
            current_version: "0.1.0".to_string(),
            notes: None,
            date: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["available"], json!(false));
        assert_eq!(json["version"], json!(null));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!(null));
        assert_eq!(json["date"], json!(null));
    }

    #[test]
    fn check_update_response_serializes_update_available_correctly() {
        let resp = CheckUpdateResponse {
            available: true,
            version: Some("0.2.0".to_string()),
            current_version: "0.1.0".to_string(),
            notes: Some("Bug fixes".to_string()),
            date: Some("2026-08-01T00:00:00Z".to_string()),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["available"], json!(true));
        assert_eq!(json["version"], json!("0.2.0"));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!("Bug fixes"));
        assert_eq!(json["date"], json!("2026-08-01T00:00:00Z"));
    }

    #[test]
    fn build_response_from_no_update_returns_available_false() {
        let resp = build_check_update_response("0.1.0".to_string(), None);
        assert!(!resp.available);
        assert!(resp.version.is_none());
    }

    #[test]
    fn build_response_from_update_returns_available_true() {
        let update = AvailableUpdate {
            version: "0.2.0".to_string(),
            notes: Some("fixes".to_string()),
            date: Some("2026-08-01".to_string()),
        };
        let resp = build_check_update_response("0.1.0".to_string(), Some(update));
        assert!(resp.available);
        assert_eq!(resp.version.as_deref(), Some("0.2.0"));
        assert_eq!(resp.notes.as_deref(), Some("fixes"));
    }
}
```

### 步骤 9.2: 运行测试验证失败

- [ ] 运行测试,确认编译失败(因为 `CheckUpdateResponse`、`AvailableUpdate`、`build_check_update_response` 尚未定义):

```bash
cargo test -p qraft check_update_response -- --nocapture
```

预期输出(关键行):

```
error[E0433]: failed to resolve: use of undeclared type `CheckUpdateResponse`
error[E0422]: cannot find function `build_check_update_response` in this scope
...
test result: FAILED. 0 passed; 4 failed
```

### 步骤 9.3: 写最小实现 — Rust Command 与序列化类型

- [ ] 在 `src-tauri/src/commands/app.rs` 顶部添加实现(若 `app.rs` 已有其他 command,在文件内追加;`mod.rs` 已通过 `pub mod app;` 导出):

```rust
// src-tauri/src/commands/app.rs

use serde::{Deserialize, Serialize};
use tauri_plugin_updater::UpdaterExt;

use crate::shell::error::AppError;

/// IPC 响应:检查更新结果
/// 字段使用 camelCase 序列化(与前端 TS 接口约定一致)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResponse {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// 内部辅助类型:从 updater 插件提取的更新信息
/// 仅用于 build_check_update_response 的输入,不跨 IPC 边界
#[derive(Debug, Clone)]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// 构造 CheckUpdateResponse 的纯函数
/// 将 updater 插件返回的 Option<Update> 转换为 IPC 响应
/// 抽离为函数是为了便于单元测试(不依赖 Tauri 运行时)
pub fn build_check_update_response(
    current_version: String,
    update: Option<AvailableUpdate>,
) -> CheckUpdateResponse {
    match update {
        Some(u) => CheckUpdateResponse {
            available: true,
            version: Some(u.version),
            current_version,
            notes: u.notes,
            date: u.date,
        },
        None => CheckUpdateResponse {
            available: false,
            version: None,
            current_version,
            notes: None,
            date: None,
        },
    }
}

/// IPC Command:检查是否有新版本
/// 通过 tauri-plugin-updater 拉取 endpoints 配置的 URL
/// 返回 CheckUpdateResponse,前端据此显示更新对话框
#[tauri::command]
pub async fn app_check_update(
    app: tauri::AppHandle,
) -> Result<CheckUpdateResponse, AppError> {
    let updater = app
        .updater()
        .map_err(|e| AppError::Unknown(format!("updater init failed: {e}")))?;

    let current_version = updater.current_version().to_string();

    let update_result = updater
        .check()
        .await
        .map_err(|e| AppError::Unknown(format!("updater check failed: {e}")))?;

    let update = update_result.map(|u| AvailableUpdate {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_rfc3339()),
    });

    Ok(build_check_update_response(current_version, update))
}

/// IPC Command:下载并安装更新,然后重启应用
/// 用户在 UI 确认后调用此命令
#[tauri::command]
pub async fn app_install_update(
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let updater = app
        .updater()
        .map_err(|e| AppError::Unknown(format!("updater init failed: {e}")))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Unknown(format!("updater check failed: {e}")))?
        .ok_or_else(|| AppError::Unknown("no update available".into()))?;

    update
        .download_and_install(|_, _| {
            // 进度回调,MVP 不展示进度(可在 v1.0 扩展为事件广播)
        })
        .await
        .map_err(|e| AppError::Unknown(format!("updater install failed: {e}")))?;

    // 安装完成后重启应用
    app.restart();
}
```

- [ ] 在 `src-tauri/src/commands/mod.rs` 中注册(若未注册):

```rust
// src-tauri/src/commands/mod.rs
pub mod app;
// ...其他模块...

// 在 invoke_handler 中注册(若 03 已注册 app_version/app_quit,则在其旁追加)
pub fn register_commands(builder: tauri::Builder) -> tauri::Builder {
    builder.invoke_handler(tauri::generate_handler![
        // ...其他 command...
        crate::commands::app::app_check_update,
        crate::commands::app::app_install_update,
    ])
}
```

> 若 `commands/mod.rs` 的注册风格不同(例如直接在 `lib.rs` 内 `invoke_handler`),则在 `src-tauri/src/lib.rs` 的 `tauri::Builder::default()` 链中追加 `crate::commands::app::app_check_update` 与 `crate::commands::app::app_install_update` 到 `generate_handler!` 列表。

### 步骤 9.4: 运行测试验证通过

- [ ] 运行单元测试:

```bash
cargo test -p qraft check_update_response -- --nocapture
```

预期输出:

```
running 4 tests
test commands::app::tests::check_update_response_serializes_no_update_correctly ... ok
test commands::app::tests::check_update_response_serializes_update_available_correctly ... ok
test commands::app::tests::build_response_from_no_update_returns_available_false ... ok
test commands::app::tests::build_response_from_update_returns_available_true ... ok

test result: ok. 4 passed; 0 failed
```

- [ ] 运行 clippy 检查:

```bash
cargo clippy -p qraft -- -D warnings
```

预期输出:

```
Finished in XXs
```

### 步骤 9.5: React UI 添加「检查更新」入口

- [ ] 在 `src/components/SettingsPanel.tsx`(子计划 04 已创建)中添加「检查更新」区块。完整片段(追加到现有 SettingsPanel 的 JSX 内,放在「关于」区块之前):

```tsx
// src/components/SettingsPanel.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface CheckUpdateResponse {
  available: boolean;
  version: string | null;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<CheckUpdateResponse | null>(null);

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      const resp = await invoke<CheckUpdateResponse>('app_check_update');
      setUpdateInfo(resp);
      if (!resp.available) {
        toast.success(`已是最新版本 (v${resp.currentVersion})`);
      }
    } catch (err) {
      toast.error(`检查更新失败: ${String(err)}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleInstallUpdate() {
    setInstalling(true);
    try {
      await invoke('app_install_update');
      // 安装后会自动重启,代码不会执行到这里
    } catch (err) {
      toast.error(`安装更新失败: ${String(err)}`);
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">检查更新</h3>
        <p className="text-sm text-muted-foreground">
          自动更新是 Qraft 唯一允许的联网功能,可在下方手动检查。
        </p>
      </div>

      {!updateInfo?.available && (
        <Button onClick={handleCheckUpdate} disabled={checking || installing}>
          {checking ? '检查中...' : '检查更新'}
        </Button>
      )}

      {updateInfo?.available && (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="font-medium">
              发现新版本 v{updateInfo.version}
            </p>
            <p className="text-xs text-muted-foreground">
              当前版本 v{updateInfo.currentVersion}
            </p>
          </div>
          {updateInfo.notes && (
            <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">
              {updateInfo.notes}
            </pre>
          )}
          <div className="flex gap-2">
            <Button onClick={handleInstallUpdate} disabled={installing}>
              {installing ? '下载并安装中...' : '立即更新'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setUpdateInfo(null)}
              disabled={installing}
            >
              稍后再说
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] 在 `SettingsPanel` 主组件中渲染 `<UpdateSection />`:

```tsx
// src/components/SettingsPanel.tsx (主组件 return 内追加)
export function SettingsPanel() {
  return (
    <div className="space-y-8 p-6">
      {/* ...其他设置区块... */}
      <UpdateSection />
      {/* 关于区块 */}
    </div>
  );
}
```

### 步骤 9.6: 验证前端构建

- [ ] 运行前端类型检查与构建:

```bash
pnpm lint
pnpm build
```

预期输出:

```
> qraft@0.1.0 build
> tsc -b && vite build

vite vXX.X.X building for production...
✓ X modules transformed.
dist/index.html                   X kB
dist/assets/index-XXXXX.js        XXX kB
dist/assets/index-XXXXX.css       XX kB
✓ built in Xs
```

- [ ] 启动 dev 模式,手动验证「检查更新」按钮可点击,显示「已是最新版本」(因 MVP 阶段无真实 release):

```bash
pnpm tauri dev
```

预期:点击「检查更新」按钮,几秒后显示 `已是最新版本 (v0.1.0)` Toast。

### 步骤 9.7: 提交

- [ ] 提交 TDD 实现:

```bash
git add src-tauri/src/commands/app.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/components/SettingsPanel.tsx
git commit -m "feat(shell): add app_check_update and app_install_update commands with ui entry"
```

---

## Task 10: SBOM 与依赖审计

**目标:** 在 CI 中添加 `audit` job(强制 `cargo audit` + `pnpm audit`,有漏洞阻止发布),并添加 SBOM 生成步骤(CycloneDX 格式,上传到 Release artifacts)。

> **PRD 一致性(13-security.md §3.6):** 每次发布生成 SBOM,随 Release 一起发布,便于用户审计。CI 强制运行 audit。

### 步骤 10.1: 在 `.github/workflows/release.yml` 添加 `audit` job

- [ ] 在 `release.yml` 的 `jobs:` 段下添加 `audit` job(在 `release` job 之前),作为发布前置门槛:

```yaml
  audit:
    name: Security Audit & SBOM
    runs-on: ubuntu-22.04
    outputs:
      rust-sbom: qraft-rust-sbom.json
      npm-sbom: qraft-npm-sbom.json
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install cargo-audit
        run: cargo install cargo-audit --locked || true

      - name: Install cargo-cyclonedx
        run: cargo install cargo-cyclonedx --locked || true

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: cargo audit (Rust vulnerabilities)
        working-directory: src-tauri
        run: cargo audit --deny warnings

      - name: pnpm audit (npm vulnerabilities)
        run: pnpm audit --prod --audit-level moderate
        continue-on-error: false

      - name: Generate Rust SBOM (CycloneDX)
        working-directory: src-tauri
        run: cargo cyclonedx -f json --override-filename qraft-rust-sbom

      - name: Generate npm SBOM (CycloneDX)
        run: pnpm dlx cyclonedx-npm --output-file qraft-npm-sbom.json

      - name: Upload SBOM artifacts
        uses: actions/upload-artifact@v4
        with:
          name: qraft-sbom
          path: |
            src-tauri/qraft-rust-sbom.json
            qraft-npm-sbom.json
          if-no-files-found: error
          retention-days: 90
```

### 步骤 10.2: 让 `release` job 依赖 `audit` job

- [ ] 在 `release.yml` 的 `release` job 顶部添加 `needs: [audit]`,确保 audit 通过后才构建:

```yaml
  release:
    name: Release ${{ matrix.platform }}
    needs: [audit]
    strategy:
      fail-fast: false
      matrix:
        # ...矩阵内容保持不变...
```

### 步骤 10.3: 在 `release` job 中附加 SBOM 到 GitHub Release

- [ ] 在 `release` job 的 `tauri-apps/tauri-action@v0` 步骤**之后**追加一步,把 audit job 产出的 SBOM 上传到 Release:

```yaml
      - name: Download SBOM artifacts
        uses: actions/download-artifact@v4
        with:
          name: qraft-sbom
          path: sbom

      - name: Attach SBOM to GitHub Release
        if: matrix.platform == 'ubuntu-22.04'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          files: |
            sbom/qraft-rust-sbom.json
            sbom/qraft-npm-sbom.json
```

> **平台选择说明:** SBOM 与平台无关,只在 `ubuntu-22.04` job 上传一次即可,避免三平台重复上传。

### 步骤 10.4: 在 `ci.yml` 的 PR 流程中也添加 audit job

- [ ] 在 `.github/workflows/ci.yml` 的 `jobs:` 段下添加 `audit` job(PR 触发,确保日常开发也跑审计):

```yaml
  audit:
    name: Security Audit (PR)
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install cargo-audit
        run: cargo install cargo-audit --locked || true

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        run: npm install -g pnpm

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: cargo audit
        working-directory: src-tauri
        run: cargo audit --deny warnings
        continue-on-error: true  # PR 阶段警告不阻断,release 才严格

      - name: pnpm audit
        run: pnpm audit --prod --audit-level high
        continue-on-error: true  # PR 阶段警告不阻断
```

### 步骤 10.5: 验证 YAML 语法

- [ ] 校验两个 workflow 文件:

```bash
node -e "const fs=require('fs'); for(const f of ['.github/workflows/release.yml','.github/workflows/ci.yml']){try{require('js-yaml').load(fs.readFileSync(f,'utf8')); console.log(f,'YAML_OK')}catch(e){console.error(f,'YAML_ERR',e.message); process.exit(1)}}"
```

预期输出:

```
.github/workflows/release.yml YAML_OK
.github/workflows/ci.yml YAML_OK
```

### 步骤 10.6: 本地预演 cargo audit

- [ ] 本地安装并运行 `cargo audit`(不依赖 CI):

```bash
cargo install cargo-audit --locked
cd src-tauri
cargo audit --deny warnings
cd ..
```

预期输出(无漏洞时):

```
Loading advisory database ...
Updating advisory database ...
Scanning Cargo.lock for vulnerabilities (X crates)
Crate:     qraft
Version:   0.1.0
No advisories found!
```

> 若发现漏洞,根据 PRD 13-security.md §3.6:Rust 漏洞必须修复或确认无影响后才可发布。`pnpm audit` 同理。

### 步骤 10.7: 提交

- [ ] 提交审计与 SBOM 配置:

```bash
git add .github/workflows/release.yml .github/workflows/ci.yml
git commit -m "ci(ci): enforce cargo+pnpm audit and generate cyclonedx sbom"
```

---

## Task 11: 发布前冒烟测试 Checklist

**目标:** 创建 `docs/release-checklist.md`,列出三平台手动冒烟测试步骤、性能验证、安全验证,作为每次发布的强制流程文档。

> 本 Task 是纯文档,无代码改动。`docs/release-checklist.md` 是本计划显式要求创建的文档(非主动添加)。

### 步骤 11.1: 创建 `docs/release-checklist.md`

- [ ] 在项目根目录创建 `docs/release-checklist.md`,内容如下:

```markdown
# Qraft 发布前冒烟测试 Checklist

> 每次发布前必须完整执行本 Checklist,所有项打勾后才可发布到 GitHub Release。

## 1. 三平台手动冒烟测试

### 1.1 Windows(Windows 10/11 x64)

- [ ] 从 Release 下载 `Qraft-Setup-0.1.0.exe`,双击安装
- [ ] 安装过程无报错,安装完成后桌面/开始菜单出现 Qraft 快捷方式
- [ ] 启动 Qraft,主窗口正常显示,标题为 `Qraft`,尺寸 1200×800
- [ ] 依次打开并验证 10 个 P0 工具:
  - [ ] `json_formatter`:粘贴 `{"a":1}` → 输出格式化后 JSON
  - [ ] `json_minifier`:粘贴格式化 JSON → 输出单行
  - [ ] `base64_codec`:输入 `hello` → 编码 `aGVsbG8=`,反向解码一致
  - [ ] `url_codec`:输入 `a b` → 编码 `a%20b`
  - [ ] `jwt_parser`:粘贴示例 JWT → 显示 header/payload 解析
  - [ ] `uuid_generator`:点击生成 → 输出 v4 UUID
  - [ ] `hash_calculator`:输入 `abc` → 输出 SHA-256 哈希
  - [ ] `timestamp_converter`:输入 `0` → 显示 1970-01-01 UTC
  - [ ] `color_converter`:输入 `#FF0000` → 显示 RGB/HSL
  - [ ] `regex_tester`:输入正则 `\d+` 与 `abc123` → 匹配 `123`
- [ ] 「检查更新」按钮可点击,显示「已是最新版本」
- [ ] 关闭窗口后任务管理器中无 Qraft 进程残留

### 1.2 macOS(macOS 11+ Intel 与 Apple Silicon 各一次)

- [ ] 从 Release 下载 `Qraft_0.1.0_universal.dmg`,挂载
- [ ] 拖动 Qraft.app 到 Applications 文件夹
- [ ] 首次启动右键打开 → 允许(Gatekeeper 提示 ad-hoc 签名)
- [ ] 主窗口正常显示,Universal Binary 在 Intel 与 Apple Silicon 均可运行
- [ ] 执行与 1.1 相同的 10 个 P0 工具验证
- [ ] 「检查更新」按钮功能正常
- [ ] 退出后 Dock 中无 Qraft 图标残留

### 1.3 Linux(Ubuntu 22.04 + Fedora 38 各一次)

- [ ] 从 Release 下载 `Qraft_0.1.0_amd64.AppImage`
- [ ] `chmod +x Qraft_0.1.0_amd64.AppImage && ./Qraft_0.1.0_amd64.AppImage`
- [ ] 主窗口正常显示
- [ ] 执行与 1.1 相同的 10 个 P0 工具验证
- [ ] 「检查更新」按钮功能正常
- [ ] 验证 deb 包安装:`sudo dpkg -i qraft_0.1.0_amd64.deb`,启动后功能一致

## 2. 自动更新端到端验证

- [ ] 在本机构建 v0.0.1 安装包,安装并运行
- [ ] 推送 v0.0.2 tag,等待 CI 构建完成
- [ ] 在 v0.0.1 应用中点击「检查更新」
- [ ] 显示「发现新版本 v0.0.2」对话框
- [ ] 点击「立即更新」,等待下载安装,应用自动重启
- [ ] 重启后版本号显示为 v0.0.2
- [ ] 验证 latest.json 在 Release assets 中可见

## 3. 性能验证(参考 PRD 19-roadmap.md §3.2 成功标准)

- [ ] 冷启动时间 <500ms(用秒表或 `time ./Qraft` 测量,从启动到窗口可见)
- [ ] 空闲内存 <150MB(任务管理器/活动监视器查看 Qraft 进程 RSS)
- [ ] 10MB JSON 文件通过 `json_formatter` 处理 <500ms(用文件输入计时)
- [ ] 包体积 <30MB(三平台安装包大小,Windows .exe、macOS .dmg、Linux .AppImage)

## 4. 安全验证(参考 PRD 13-security.md)

- [ ] CSP 生效:DevTools Console 无 CSP 违规警告
- [ ] 零网络请求:用 Wireshark 或系统防火墙监控,启动 + 使用 10 个工具过程中,除 updater 主动检查外无任何外网请求
- [ ] 文件沙箱:尝试通过 UI 输入 `/etc/passwd` 或 `C:\Windows\System32\config\SAM` 路径,应被拒绝
- [ ] 剪贴板:不主动读取剪贴板,仅在用户点击「粘贴」按钮时读取
- [ ] 历史记录:历史文件位于应用专属目录(`directories::ProjectDirs`),不含其他应用数据
- [ ] `cargo audit` 无漏洞(见 CI audit job)
- [ ] `pnpm audit` 无 moderate 及以上漏洞(见 CI audit job)

## 5. 签名与公证状态(正式发布前)

### MVP 阶段(允许的占位)

- [ ] Tauri 更新签名:已启用(pubkey 已写入 tauri.conf.json)
- [ ] Windows Authenticode:未签名(用户首次运行会看到 SmartScreen 警告,需右键 → 属性 → 解除阻止)
- [ ] macOS 代码签名:ad-hoc 签名(`-`),用户首次运行需右键打开

### 正式发布所需证书(必须在 v1.0 前获取)

- [ ] Windows EV 代码签名证书(DigiCert / Sectigo),消除 SmartScreen 警告
- [ ] Apple Developer ID Application 证书($99/年 Apple Developer Program),用于 macOS 代码签名
- [ ] Apple App-Specific Password,用于 notarytool 公证
- [ ] Apple Team ID,配置到 CI Secret `APPLE_TEAM_ID`
- [ ] 公证流程在 CI 中自动化(见 `.github/workflows/release.yml` 的 `APPLE_*` 环境变量)

## 6. 版本与发布物料

- [ ] `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本号一致(用 `scripts/bump-version.sh` 同步)
- [ ] `CHANGELOG.md` 已更新本次版本条目
- [ ] SBOM(`qraft-rust-sbom.json`、`qraft-npm-sbom.json`)已生成并附加到 Release
- [ ] `latest.json` 已自动由 tauri-action 生成并附加到 Release
- [ ] Release Notes 引用 CHANGELOG 链接
- [ ] Release 不再标记为 Draft
- [ ] Release 不标记为 Pre-release(若是稳定版)

## 7. 回滚预案(参考 PRD 14-build-and-distribution.md §6.3)

- [ ] 确认旧版本 latest.json 已备份(可用 GitHub Release 历史 tag 重新生成)
- [ ] 若发现严重 bug:将新版本 Release 标记为 Pre-release,重新发布旧 tag 触发 CI 重建 latest.json
- [ ] 在应用内通过「检查更新」可让用户回退到旧版本
```

### 步骤 11.2: 验证文档存在

- [ ] 校验文件存在且非空:

```bash
node -e "const fs=require('fs'); const s=fs.statSync('docs/release-checklist.md'); if(s.size<1000){console.error('TOO_SMALL'); process.exit(1)} else {console.log('CHECKLIST_OK',s.size,'bytes')}"
```

预期输出:

```
CHECKLIST_OK 5XXX bytes
```

### 步骤 11.3: 手动执行一遍 Checklist(本步不可自动化,由发布负责人填写)

- [ ] 按 `docs/release-checklist.md` 逐项验证 MVP v0.1 候选构建,在文档中勾选已通过项。任何失败项必须修复后重新构建,重新执行 Checklist。

### 步骤 11.4: 提交

- [ ] 提交 Checklist 文档:

```bash
git add docs/release-checklist.md
git commit -m "docs(docs): add release smoke test checklist for tri-platform mvp"
```

---

## Task 12: 版本号与 Changelog

**目标:** 创建 `CHANGELOG.md`(Keep a Changelog 格式),同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处版本号为 `0.1.0`,创建 `scripts/bump-version.sh` 统一升级脚本。

> **PRD 一致性(14-build-and-distribution.md §6.2):** 版本号需在 Cargo.toml + package.json + tauri.conf.json 三处同步。`CHANGELOG.md` 使用 [Keep a Changelog](https://keepachangelog.com/) 格式。

### 步骤 12.1: 创建 `CHANGELOG.md`

- [ ] 在项目根目录创建 `CHANGELOG.md`,内容如下:

```markdown
# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-25

### Added

- 三层架构(Rust Core / Tauri Shell / React UI),依赖方向单向向下
- `Tool` trait 与 `ToolRegistry`(`inventory` 编译期注册)
- `ToolExecutor`(超时隔离 + panic 隔离)
- `ConfigStore` 与 `HistoryStore`(应用专属目录,原子写入)
- 10 个 P0 工具:
  - `json_formatter`:JSON 美化与压缩
  - `json_minifier`:JSON 压缩至单行
  - `base64_codec`:Base64 编码/解码
  - `url_codec`:URL 编码/解码
  - `jwt_parser`:JWT header/payload 解析
  - `uuid_generator`:UUID v4 生成
  - `hash_calculator`:MD5/SHA-1/SHA-256/SHA-512/BLAKE3
  - `timestamp_converter`:Unix 时间戳与日期互转
  - `color_converter`:HEX/RGB/HSL 互转
  - `regex_tester`:正则匹配与捕获组展示
- React UI:侧边导航、Split View 工具面板、命令面板(Ctrl+K)、历史记录面板、设置面板、暗色主题
- Tauri Shell IPC:工具执行、配置、历史、剪贴板、文件系统(授权路径)、应用级
- 安全机制:CSP `default-src 'self'`、文件系统授权路径、剪贴板显式触发、零网络原则(仅 updater 例外)
- Tauri Updater 自动更新(签名验证)
- 三平台打包:Windows NSIS+MSI、macOS DMG Universal Binary、Linux AppImage+deb
- GitHub Actions CI/CD:PR 构建验证 + tag 触发三平台矩阵发布
- SBOM 生成(CycloneDX,Rust + npm)并附加到 Release
- `cargo audit` + `pnpm audit` 强制审计(漏洞阻止发布)
- 发布前冒烟测试 Checklist(`docs/release-checklist.md`)
- 版本号同步脚本(`scripts/bump-version.sh`)

### Performance

- 冷启动时间 <500ms
- 空闲内存 <150MB
- 10MB JSON 解析 <500ms
- 包体积 <30MB(三平台)

### Security

- Tauri Updater 签名验证(ed25519)
- MVP 阶段:Windows/macOS 使用占位签名(ad-hoc),正式发布需 EV 证书与 Apple Developer ID

[Unreleased]: https://github.com/qraft/qraft/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qraft/qraft/releases/tag/v0.1.0
```

### 步骤 12.2: 同步三处版本号

- [ ] 校验并设置 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号为 `0.1.0`。运行以下脚本:

```bash
node -e "
const fs=require('fs');
const v='0.1.0';
// package.json
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.version=v;
fs.writeFileSync('package.json', JSON.stringify(pkg,null,2)+'\n');
console.log('package.json:', v);
// tauri.conf.json
const tc=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
tc.version=v;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tc,null,2)+'\n');
console.log('tauri.conf.json:', v);
// Cargo.toml
const ct=fs.readFileSync('src-tauri/Cargo.toml','utf8');
const ct2=ct.replace(/^version\s*=\s*\"[^\"]+\"/m, 'version = \"'+v+'\"');
fs.writeFileSync('src-tauri/Cargo.toml', ct2);
console.log('Cargo.toml:', v);
"
```

预期输出:

```
package.json: 0.1.0
tauri.conf.json: 0.1.0
Cargo.toml: 0.1.0
```

### 步骤 12.3: 验证三处版本号一致

- [ ] 运行验证命令:

```bash
node -e "
const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const tc=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).version;
const ct=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version\s*=\s*\"([^\"]+)\"/m)[1];
console.log({pkg, tc, ct});
if(pkg===tc && tc===ct){console.log('VERSION_SYNC_OK')}else{console.error('VERSION_MISMATCH'); process.exit(1)}
"
```

预期输出:

```
{ pkg: '0.1.0', tc: '0.1.0', ct: '0.1.0' }
VERSION_SYNC_OK
```

- [ ] 用 grep 交叉验证(满足 PRD 14-build-and-distribution.md §6.2 要求):

```bash
node -e "
const fs=require('fs');
const files=['package.json','src-tauri/Cargo.toml','src-tauri/tauri.conf.json'];
for(const f of files){
  const c=fs.readFileSync(f,'utf8');
  const m=c.match(/0\.1\.0/);
  console.log(f, m ? 'contains 0.1.0' : 'MISSING');
}
"
```

预期输出:

```
package.json contains 0.1.0
src-tauri/Cargo.toml contains 0.1.0
src-tauri/tauri.conf.json contains 0.1.0
```

### 步骤 12.4: 创建 `scripts/bump-version.sh`

- [ ] 在项目根目录创建 `scripts/bump-version.sh`,内容如下(bash 脚本,Windows 上通过 Git Bash 或 WSL 运行;后续可在 v1.0 评估提供 PowerShell 等价脚本):

```bash
#!/usr/bin/env bash
# 统一升级 Qraft 三处版本号
# 用法: scripts/bump-version.sh 0.2.0
# 同步: package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

NEW_VERSION="$1"

# 校验 SemVer 格式 (MAJOR.MINOR.PATCH,可选 - prerelease)
if ! echo "$NEW_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "ERROR: invalid SemVer: $NEW_VERSION"
  echo "Expected format: MAJOR.MINOR.PATCH (e.g. 0.2.0 or 1.0.0-rc.1)"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 使用 Node 同步 package.json 与 tauri.conf.json(保证 JSON 语法正确)
node -e "
const fs=require('fs');
const v=process.argv[1];
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const oldPkg=pkg.version;
pkg.version=v;
fs.writeFileSync('package.json', JSON.stringify(pkg,null,2)+'\n');
const tc=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const oldTc=tc.version;
tc.version=v;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tc,null,2)+'\n');
console.log('package.json:', oldPkg, '->', v);
console.log('tauri.conf.json:', oldTc, '->', v);
" "$NEW_VERSION"

# Cargo.toml 用 sed 替换 [package] 段下的 version 字段
OLD_CARGO=$(grep -E '^version\s*=' src-tauri/Cargo.toml | head -n 1 | sed -E 's/^version\s*=\s*"([^"]+)".*/\1/')
# 仅替换 [package] 段下的第一个 version=,不影响 [dependencies] 中的版本
# 使用 awk 在 [package] 段内替换
awk -v new="\"$NEW_VERSION\"" '
  /^\[package\]/ {in_pkg=1; print; next}
  /^\[/ {in_pkg=0; print; next}
  in_pkg && /^version[[:space:]]*=/ {print "version = " new; next}
  {print}
' src-tauri/Cargo.toml > src-tauri/Cargo.toml.tmp && mv src-tauri/Cargo.toml.tmp src-tauri/Cargo.toml
echo "Cargo.toml: $OLD_CARGO -> $NEW_VERSION"

# 验证三处一致
PKG_VER=$(node -e "console.log(require('./package.json').version)")
TC_VER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).version)")
CARGO_VER=$(grep -E '^version\s*=' src-tauri/Cargo.toml | head -n 1 | sed -E 's/^version\s*=\s*"([^"]+)".*/\1/')

if [ "$PKG_VER" = "$TC_VER" ] && [ "$TC_VER" = "$CARGO_VER" ] && [ "$PKG_VER" = "$NEW_VERSION" ]; then
  echo "VERSION_SYNC_OK: $NEW_VERSION"
else
  echo "VERSION_MISMATCH: pkg=$PKG_VER tc=$TC_VER cargo=$CARGO_VER"
  exit 1
fi

echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md (move [Unreleased] to [$NEW_VERSION] with date)"
echo "  2. git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md"
echo "  3. git commit -m \"chore(build): bump version to $NEW_VERSION\""
echo "  4. git tag v$NEW_VERSION"
echo "  5. git push origin main --tags"
```

- [ ] 给脚本添加可执行权限(Unix):

```bash
chmod +x scripts/bump-version.sh
```

> Windows 用户在 Git Bash 中执行 `chmod +x` 即可;或在 PowerShell 中直接 `bash scripts/bump-version.sh 0.2.0`。

### 步骤 12.5: 验证脚本可运行

- [ ] 用 `0.1.0` 自身做一次幂等测试(已经同步过,脚本应再次同步且无变化):

```bash
bash scripts/bump-version.sh 0.1.0
```

预期输出(关键行):

```
package.json: 0.1.0 -> 0.1.0
tauri.conf.json: 0.1.0 -> 0.1.0
Cargo.toml: 0.1.0 -> 0.1.0
VERSION_SYNC_OK: 0.1.0
```

- [ ] 验证 SemVer 校验生效:

```bash
bash scripts/bump-version.sh invalid 2>&1 || echo "EXIT_CODE=$?"
```

预期输出:

```
ERROR: invalid SemVer: invalid
Expected format: MAJOR.MINOR.PATCH (e.g. 0.2.0 or 1.0.0-rc.1)
EXIT_CODE=1
```

### 步骤 12.6: 提交

- [ ] 提交 CHANGELOG、版本同步与脚本:

```bash
git add CHANGELOG.md package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json scripts/bump-version.sh
git commit -m "chore(build): add changelog and bump-version script for v0.1.0"
```

---

## 完成标准

执行完本子计划 12 个 Task 后,Qraft v0.1 应满足以下分发相关指标:

| 指标 | 目标 | 验证方式 |
|------|------|----------|
| Windows 安装包 | `.exe` + `.msi` 可安装可运行 | Task 5 + Task 11 Checklist |
| macOS 安装包 | `.dmg` Universal Binary,Intel 与 Apple Silicon 均可运行 | Task 6 + Task 11 Checklist |
| Linux 安装包 | `.AppImage` + `.deb` 可运行 | Task 7 + Task 11 Checklist |
| Tauri Updater | 可检测并安装签名更新 | Task 9 + Task 11 §2 |
| CI 发布流水线 | tag 推送触发三平台并行构建,产物上传到 Release | Task 8 |
| SBOM 生成 | CycloneDX JSON(Rust + npm)附加到 Release | Task 10 |
| 依赖审计 | `cargo audit` + `pnpm audit` 通过,阻止有漏洞的发布 | Task 10 |
| 版本同步 | `package.json` / `Cargo.toml` / `tauri.conf.json` 一致 | Task 12 + `scripts/bump-version.sh` |
| 发布前 Checklist | 三平台手动冒烟通过 | Task 11 + `docs/release-checklist.md` |

## 关键约束自检

在最终提交前,逐项核对以下 10 条不可违反约束:

- [ ] **无占位符**:所有 Task 的代码块完整,无 "TBD"、"TODO"、"类似 Task N" 等模糊引用
- [ ] **PRD 一致性**:打包配置、签名流程、updater 配置严格按 `prd/14-build-and-distribution.md` 与 `prd/13-security.md`
- [ ] **CSP 零网络**:`tauri.conf.json` 的 `csp` 保持 `default-src 'self'`,updater 在 Rust 进程内联网,WebView CSP 不开例外
- [ ] **三平台一致**:三个平台产物功能一致(同样 10 个工具、同样 UI、同样 updater)
- [ ] **签名说明**:MVP 使用 ad-hoc/占位签名,`docs/release-checklist.md` §5 明确正式发布需要 EV 证书与 Apple Developer ID
- [ ] **CI 矩阵**:Task 8 `release.yml` 三平台并行构建,产物上传到同一 Release
- [ ] **版本同步**:Task 12 三处版本号一致,`scripts/bump-version.sh` 自动同步
- [ ] **SBOM**:Task 10 生成 CycloneDX SBOM 并附加到 Release
- [ ] **审计**:Task 10 `cargo audit` + `pnpm audit` 有漏洞阻止发布(`release` job `needs: [audit]`)
- [ ] **文件路径用反引号**:本计划中所有引用文件路径使用 markdown 反引号包裹
