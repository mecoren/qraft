#!/usr/bin/env bash
# 统一升级 Qraft 版本号 —— 唯一升级入口
# 用法: scripts/bump-version.sh 0.2.0
#
# 版本唯一数据源: package.json 的 version 字段
# - 前端(SettingsPanel / WelcomePage)在构建时经 Vite define 自动注入
#   __APP_VERSION__,无需手动修改任何前端源码
# - 本脚本同步其余后端配置: src-tauri/Cargo.toml / src-tauri/tauri.conf.json
# - Rust 端 app_version 命令使用编译期 CARGO_PKG_VERSION,随 Cargo.toml 自动同步
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

# Cargo.toml 用 awk 在 [package] 段内替换 version 字段,不影响 [dependencies] 中的版本
OLD_CARGO=$(grep -E '^version\s*=' src-tauri/Cargo.toml | head -n 1 | sed -E 's/^version\s*=\s*"([^"]+)".*/\1/')
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
echo ""
echo "Note: 前端版本号无需修改 —— SettingsPanel / WelcomePage 在构建时"
echo "      由 Vite 从 package.json 自动注入 __APP_VERSION__。"
