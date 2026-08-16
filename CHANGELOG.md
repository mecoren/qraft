# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
