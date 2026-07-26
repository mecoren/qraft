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
