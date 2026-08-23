# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 新增「IP 地址解析器」纯前端工具(转换器分类):分析 IPv4 / IPv6 地址与 CIDR 记法(如 `192.168.1.130/26`),实时计算子网掩码、通配符掩码、CIDR 网络地址、广播地址、可用主机范围与数量、总地址数、二/十六进制与整数表示等网络信息;识别 RFC 1918 私网、环回、链路本地、CGNAT、组播等特殊地址段(RFC 6890)与 IPv4 传统 A-E 分类、IPv6 作用域(fc00::/7 唯一本地、2001:db8::/32 文档段等);全部计算在本地离线完成,不发起任何网络请求
  - 新增 `src/tools/ip-parser.ts`(BigInt 实现 128bit 解析,支持 `::` 压缩与内嵌 IPv4 尾部)、`src/tools/IpParser.tsx`(参考 iplocation.net Lookup Summary 的信息卡布局)与配套测试
  - 注册 UI 组件(`registry.ts`)、工具目录条目(`tool-catalog.ts`)与全局搜索锚点(`search-anchors.ts`)

### Fixed

- 开发环境与正式安装版的数据隔离:`tauri dev` 不再读写正式版数据目录,且应用标识符由 `dev.qraft.app` 调整为 `cn.qraft.app`(生产:`%APPDATA%\cn.qraft.app`;开发:`cn.qraft.app.dev` → `%APPDATA%\cn.qraft.app.dev`)。此前开发与安装版共用同一标识符,开发时清缓存会连带清掉安装版的编辑器打开文件列表与历史记录
  - 新增 `src-tauri/tauri.dev.conf.json`,开发构建覆盖应用标识符为 `cn.qraft.app.dev`(配置、历史、WebView2 用户数据、窗口状态、单实例锁全部分离,开发版与安装版可同时运行)
  - `package.json` 的 `tauri` 脚本改为经 `scripts/tauri.mjs` 包装:拦截 `dev` 子命令自动注入 `--config src-tauri/tauri.dev.conf.json`(已显式携带 `--config/-c` 时不重复注入),其余子命令(`build` / `icon` 等)原样透传,发布流程不受影响;`TAURI_WRAPPER_PRINT=1` 可只打印最终参数用于调试

### Changed

- 更新源由自建服务器改为接入 GitHub Releases(`https://github.com/mecoren/qraft/releases`)
  - `src-tauri/tauri.conf.json` 的 `plugins.updater.endpoints` 改为 `https://github.com/mecoren/qraft/releases/latest/download/latest.json`(`tauri-plugin-updater` 官方 GitHub 通道,保留签名校验)
  - 新增「不同版本不同安装方式」:`src-tauri/src/shell/updater.rs` 引入 `PackageType`(msi/nsis/portable/dmg/app-archive/appimage/deb/archive)与 `InstallMode`(windows-msi/windows-nsis/in-place/macos-dmg/linux-deb)枚举及解析函数,`CheckUpdateResponse` 携带 `packageType` / `installMode` / `installModeLabel` 字段,前端据此展示安装方式
  - `app_check_update` 在 Windows 上按可执行文件路径(`Program Files` 等系统目录)探测当前为 MSI 安装版还是便携版,决定目标更新包类型
  - 新增 `app_open_release_page` 命令(打开 GitHub Releases),作为 msi/dmg/deb 等系统安装版的手动整包下载兜底入口;`SettingsPanel.tsx` 新增「前往 GitHub Releases 下载」按钮

- 更新流程按安装方式真正分流(优化)
  - `app_install_update` 对系统安装版(msi/dmg/deb)返回 `MANUAL_INSTALL_REQUIRED` 信号,前端自动跳转 GitHub Releases 下载整包;对就地覆盖类(portable/AppImage/zip)走 `download_and_install` 自动更新
  - in-place 自动更新通过 `update-download-progress` / `update-download-finished` 事件广播下载进度,前端 `UpdateSection` 显示 `Progress` 进度条与百分比

### Security

- 品牌 Logo 改为透明背景并新增暗色反色版本,全面应用到应用内 Logo、favicon、README 与应用图标
  - `assets/logo.svg` 原地透明化:删除浅灰底瓦片 rect,图形元素/形状/比例不变(补充 `viewBox="0 0 614.4 614.4"`)
  - 新增 `assets/logo-inverted.svg`(透明背景 + 浅灰 `#F5F5F5` 图形)与 `scripts/generate-logo.js`(sharp 生成 1024px 透明/反色 PNG 与 `public/favicon.png` 兜底)
  - `src/components/Logo.tsx` 删除背景瓦片,图形统一 `var(--logo-fg)`;`globals.css` 删除 `--logo-bg`,仅保留 `--logo-fg`,暗色主题自动反色不变
  - 新增主题感知 `public/favicon.svg`(`prefers-color-scheme` 自动切换亮/暗图形),`index.html` 接入 SVG favicon + PNG 兜底
  - `README.md` 标题下新增亮/暗双图 banner(`<picture>` + `prefers-color-scheme`)
  - 应用图标(`src-tauri/icons/`):`scripts/generate-app-icon.js` 输入源由浅灰瓦片版 `app-icon.svg` 改为透明深色版 `logo.svg`,Windows 任务栏/开始菜单等直接使用深色图形,不做反色;渲染时 `trim()` 裁掉透明留白并按 98% 画布放大,任务栏上图形更醒目;重新生成全套平台图标(ICO / ICNS / PNG / iOS / Android / Appx)

- 应用图标全面改用最终设计稿:浅灰 `#F5F5F5` 圆角方形底色 + 近黑 `#1A1A1A` 的「圆角窗口外框 + 顶部标题栏(左侧标签 + 右侧三个窗口控制圆点)+ 内容区 `</>` 代码符号」,细节与原设计稿完全一致
  - `assets/app-icon.svg` 替换为设计稿原样内容(补充 `viewBox="0 0 614.4 614.4"`),继续作为图标单一来源
  - `src/components/Logo.tsx` 重写为完整细节版 SVG,颜色映射 `var(--logo-bg)` / `var(--logo-fg)` 主题变量
  - `globals.css` 新增 logo 主题 token:亮色默认 `#F5F5F5` / `#1A1A1A`,5 套暗色调色板(obsidian / deep-sea / twilight / emerald-night / custom)自动反色为 `#1A1A1A` / `#F5F5F5`
  - 侧栏品牌区 / 标题栏中段 / 欢迎页 Hero 的 Logo 引用点适配(移除原 primary 容器与文本色类)
  - 重新生成 `src-tauri/icons/` 全套平台图标(Windows ICO / macOS ICNS / 各尺寸 PNG / iOS / Android / Appx)
  - 打包图标(任务栏/桌面)使用亮色原版,无主题感知;暗色反色作用于应用内 Logo

- 应用图标与内嵌 Logo 重新设计:IDE 窗口图标(圆角矩形外框 + 顶部标题栏:左侧标签 + 右侧三个圆点 + 内容区 `</>` 代码符号),参考参考图纯黑风格 + 透明背景,圆角按项目 UI `--radius-lg=8px` 在 1024 画布按比例派生(约 80px)
  - 新增 `assets/app-icon.svg` 作为图标单一来源(替代 `assets/toolbox.svg`)
  - `scripts/generate-app-icon.js` 改为直接渲染 `app-icon.svg`
  - 重新生成 `src-tauri/icons/` 全套平台图标(Windows ICO / macOS ICNS / 各尺寸 PNG / iOS / Android)
  - `src/components/Logo.tsx` 简化为「外框 + `</>`」核心语义(标题栏细节在 size-4 16px 下会糊,省略),`stroke` 跟随 `currentColor`

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
