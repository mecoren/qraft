# 需求文档:Release 资产精简与命名统一

## 背景

当前 Release 页资产共 33 个,存在两类问题:

1. **冗余资产**:rpm(msi) 与 deb/AppImage(NSIS) 功能重复,无人消费;
2. **命名混乱**:安装包用 Tauri 默认名(`Qraft_0.1.5_x64_en-US.msi`、`Qraft_0.1.5_aarch64.dmg`),只有 Windows Portable 是 `Qraft-0.1.5-Windows-Amd64-Portable.exe` 风格,用户无法一眼分辨平台/架构。

## 需求

1. 删除 rpm 与 msi 两类冗余产物;
2. 所有安装包按统一格式重命名:`Qraft-{版本}-{系统}-{架构}-{类型}.{扩展名}`,与既有 Portable 命名风格一致;
3. 重命名不得破坏自动更新链路:latest.json 中各 platform 条目的下载 URL 必须与 Release 资产名逐字节一致。

## 验收标准

- 新 Release 资产列表无 rpm/msi;
- 所有资产名符合 `Qraft-{version}-{Windows|MacOS|Linux}-{Amd64|Arm64}-{Setup|Portable|...}` 风格;
- 应用内「检查更新」端到端可用(latest.json URL 与资产名一致、signature 校验通过)。
