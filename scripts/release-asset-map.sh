#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Release 资产命名规范化映射 —— 单一事实来源
#
# 供 .github/workflows/release.yml 的两个作业 source:
#   - publish-updater-manifest:由 .sig 资产名推导 latest.json 的下载 URL
#   - normalize-assets:把 Release 上的资产改名到规范化命名
#
# 两者必须一致:updater 的下载 URL 与 Release 资产名需逐字节相同,映射漂移
# 会让更新检查 404。调整命名规则时只改本文件。
#
# 用法:
#   source scripts/release-asset-map.sh
#   mapfile -t MAP_SED < <(release_asset_map_sed "$VER")
#   new_name=$(printf '%s' "$old_name" | sed "${MAP_SED[@]}")
# ---------------------------------------------------------------------------

# 输出 sed 参数数组(每行一个元素),供 mapfile 读取。
# $1 = 版本号(取自 tauri.conf.json —— tag 名与本地 conf 可能脱节)
#
# 对主文件名与配套 .sig 同样生效;darwin 的更新产物名不带版本号
# (Qraft_x64.app.tar.gz),与 dmg 的命名规则不同。
release_asset_map_sed() {
  local ver="$1"
  printf '%s\n' \
    -e "s|Qraft_${ver}_x64-setup\.exe|Qraft-${ver}-Windows-Amd64-Setup.exe|g" \
    -e "s|Qraft_${ver}_arm64-setup\.exe|Qraft-${ver}-Windows-Arm64-Setup.exe|g" \
    -e "s|Qraft_x64\.app\.tar\.gz|Qraft-${ver}-MacOS-Amd64.app.tar.gz|g" \
    -e "s|Qraft_aarch64\.app\.tar\.gz|Qraft-${ver}-MacOS-Arm64.app.tar.gz|g" \
    -e "s|Qraft_${ver}_x64\.dmg|Qraft-${ver}-MacOS-Amd64.dmg|g" \
    -e "s|Qraft_${ver}_aarch64\.dmg|Qraft-${ver}-MacOS-Arm64.dmg|g" \
    -e "s|Qraft_${ver}_amd64\.deb|Qraft-${ver}-Linux-Amd64.deb|g" \
    -e "s|Qraft_${ver}_arm64\.deb|Qraft-${ver}-Linux-Arm64.deb|g" \
    -e "s|Qraft_${ver}_amd64\.AppImage|Qraft-${ver}-Linux-Amd64.AppImage|g" \
    -e "s|Qraft_${ver}_aarch64\.AppImage|Qraft-${ver}-Linux-Arm64.AppImage|g"
}

# updater manifest 的平台条目表:每行 "platform key|Release 上的 .sig 资产名"
#
# - 同一产物的多个 key(如 windows-x86_64 与 -nsis 变体)共享同一份签名与
#   URL,这是 tauri-action 既有 manifest 的形态,保持兼容;
# - Linux 取 .deb:AppImage 同样产出,但历史 manifest 与各版本更新链路都走
#   deb,切换会让老客户端的更新目标失效;
# - 资产名不在此写死,由 release_asset_map_sed 从 .sig 名推导,避免两处命名
#   规则各写一份。
release_updater_entries() {
  local ver="$1"
  printf '%s\n' \
    "windows-x86_64|Qraft_${ver}_x64-setup.exe.sig" \
    "windows-x86_64-nsis|Qraft_${ver}_x64-setup.exe.sig" \
    "windows-aarch64|Qraft_${ver}_arm64-setup.exe.sig" \
    "windows-aarch64-nsis|Qraft_${ver}_arm64-setup.exe.sig" \
    "darwin-x86_64|Qraft_x64.app.tar.gz.sig" \
    "darwin-x86_64-app|Qraft_x64.app.tar.gz.sig" \
    "darwin-aarch64|Qraft_aarch64.app.tar.gz.sig" \
    "darwin-aarch64-app|Qraft_aarch64.app.tar.gz.sig" \
    "linux-x86_64|Qraft_${ver}_amd64.deb.sig" \
    "linux-aarch64|Qraft_${ver}_arm64.deb.sig"
}
