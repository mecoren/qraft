# Qraft

<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="https://raw.githubusercontent.com/mecoren/qraft/main/assets/logo-inverted.png"
  />
  <img
    alt="Qraft"
    src="https://raw.githubusercontent.com/mecoren/qraft/main/assets/logo-transparent.png"
    width="480"
  />
</picture>

> A local-first developer toolbox built with Rust + Tauri + React.
>
> 本地优先的开发者工具箱 —— 快速、离线可用、数据不出设备。

## 为什么是 Qraft

日常开发中大量「小工具时刻」——转个 Base64、看段 JWT、格式化一段 JSON、比两份文本差异——不值得为此打开一个网页并把数据交给别人的服务器。Qraft 把这些高频工具装进一个轻量桌面应用：

- **本地优先**：所有工具计算在本地完成（Rust 核心引擎 + 系统 WebView），无账号、无遥测、无云端上传。仅有的两类网络请求（IP 归属查询、应用更新检查）见[隐私声明](PRIVACY.md)。
- **快**：Rust 执行引擎带超时/取消/panic 三重隔离；10MB 级 JSON 秒级处理；冷启动以百毫秒计。
- **省心**：执行历史自动留痕、输入状态跨会话保留、Ctrl+K 全局命令面板直达任何工具。
- **好看**：OKLCH 色彩体系与 7 套主题（含 Windows Mica 材质）、亮暗双模式、编辑器字号五档可调。

## 工具箱一览

| 分类 | 工具 |
|------|------|
| 编解码 | Base64、JWT 解析、URL 编码、GZip、HTML 实体、证书解码 |
| 测试工具 | 正则表达式、JSONPath、XML/XSD 校验 |
| 格式化 | JSON 格式化（含压缩/树视图/JSONPath）、SQL、XML |
| 生成器 | UUID、哈希/校验和（MD5~SHA-512）、密码、乱数假文、二维码 |
| 图像处理 | 图片格式转换、PNG 压缩、色盲模拟 |
| 编辑器 | Monaco 内核文本编辑器（多 Tab 工作区、Markdown 分屏预览、全局搜索） |
| 文本处理 | 文本比较、列表比对、重复行检测 |
| 转换器 | 时间戳/日期、进制、颜色、Cron 表达式解析、IP 归属、JSON↔YAML、JSON 数组转表格 |
| 文件 | 文件夹分析器（流式扫描 + 大小/重复文件洞察） |

## 下载安装

前往 [GitHub Releases](https://github.com/mecoren/qraft/releases) 下载对应平台的安装包：

| 平台 | 格式 | 说明 |
|------|------|------|
| Windows 10/11 x64 | `.exe`（NSIS） | 首次运行可能提示 SmartScreen（当前未做代码签名），选择「仍要运行」即可 |
| macOS 11+ | `.dmg` / `.app.tar.gz` | Intel 与 Apple Silicon 分别提供 |
| Linux | `.AppImage` / `.deb` | 需要 WebKitGTK 4.1 运行环境 |

应用内置自动更新（基于 GitHub Releases）。发布早期版本可能未启用更新签名，届时请手动下载新版覆盖安装。

## 隐私

Qraft 不收集任何数据。唯一的对外请求发生在你主动使用 **IP 归属查询**工具（ip-api.com）与应用**检查更新**（GitHub）时，详见 [PRIVACY.md](PRIVACY.md)。

## 开发

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (managed via `.nvmrc`)
- [pnpm](https://pnpm.io/) 9+ (`corepack enable`)
- [Rust](https://www.rust-lang.org/) stable (1.85+, managed via `src-tauri/rust-toolchain.toml`)

### Platform-specific requirements

- **Windows**: Visual Studio Build Tools 2022 with C++ desktop workload + WebView2
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

### Getting Started

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

### Scripts

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `pnpm dev`         | Start Vite dev server (frontend only)  |
| `pnpm tauri dev`   | Start Tauri + React development        |
| `pnpm build`       | Build frontend for production          |
| `pnpm tauri build` | Build desktop app for current platform |
| `pnpm test`        | Run frontend tests                     |
| `pnpm lint`        | Run ESLint                             |
| `pnpm format`      | Format code with Prettier              |
| `pnpm typecheck`   | Run TypeScript type checking           |

### Project Structure

```
qraft/
├── src/              # React frontend
├── src-tauri/        # Rust core engine + Tauri shell
├── .github/          # CI/CD workflows
├── prd/              # Product requirement documents & architecture specs
└── docs/             # Release checklist & readiness assessments
```

### Tech Stack

- **Rust** (stable, edition 2024) — Core engine
- **Tauri V2** — Desktop framework
- **React 19** + **TypeScript 6** — UI
- **Vite 8** (rolldown) — Build tool
- **Tailwind CSS 4** — Styling
- **pnpm 9** — Package manager

## License

MIT
