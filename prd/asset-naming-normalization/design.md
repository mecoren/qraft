# 设计文档:Release 资产精简与命名统一

> 需求背景见同目录 [requirements.md](./requirements.md)
> 前置约束:`prd/updater-tauri-action-migration/design.md` §3 —— latest.json 的下载 URL 必须与 Release 资产名逐字节一致。

## 现状(基于 v0.1.5 实测 latest.json)

latest.json 实际引用的资产(updater 消费,改名必须同步改 JSON):

| platform key | 资产名(v0.1.5 实测) |
|---|---|
| windows-x86_64(-msi) | `Qraft_0.1.5_x64_en-US.msi` |
| windows-x86_64-nsis | `Qraft_0.1.5_x64-setup.exe` |
| windows-aarch64(-msi) | `Qraft_0.1.5_arm64_en-US.msi` |
| windows-aarch64-nsis | `Qraft_0.1.5_arm64-setup.exe` |
| darwin-aarch64(-app) | `Qraft_aarch64.app.tar.gz` |
| darwin-x86_64(-app) | `Qraft_x64.app.tar.gz` |
| linux-x86_64(-appimage) | `Qraft_0.1.5_amd64.AppImage` |
| linux-aarch64(-appimage) | `Qraft_0.1.5_aarch64.AppImage` |
| linux-x86_64-deb | `Qraft_0.1.5_amd64.deb` |
| linux-aarch64-deb | `Qraft_0.1.5_arm64.deb` |
| linux-x86_64-rpm | `Qraft-0.1.5-1.x86_64.rpm` |
| linux-aarch64-rpm | `Qraft-0.1.5-1.aarch64.rpm` |

dmg 不进 latest.json,但作为下载资产一并重命名。`.sig` 的签名内容内嵌于 latest.json(signature 字段),重命名 `.sig` 资产不影响校验。

## 关键技术决策

### 1. 精简:tauri.conf.json `bundle.targets` 从 `"all"` 改为显式列表

`["nsis", "dmg", "deb", "appimage"]` —— 不再产出 msi/rpm,latest.json 相应 key 自然消失(tauri-action 按实际产物生成条目)。

### 2. 命名统一:构建后新增 normalize-assets job,「改资产名 + 同步重写 latest.json」

tauri-action 不支持自定义产物名,且 latest.json 引用默认名。方案:全部矩阵构建完成、tauri-action 发布完毕后,新增 `normalize-assets` job(仅 tag 且非 dry-run):

1. `gh release download` 拉取 latest.json;
2. 按映射表 sed 重写 JSON 中所有 URL 的文件名部分;
3. 遍历 Release 资产,同名映射 PATCH 改名(`gh api -X PATCH .../releases/assets/{id}`,免重传);
4. `gh release upload --clobber` 覆盖写回 latest.json。

顺序:先改资产名、后写 latest.json —— 中间秒级窗口内检查更新的客户端可能拿到旧 JSON 指向已改名资产而 404,可接受(发布时段性操作,非常态)。

### 3. 映射表(版本号取自 tauri.conf.json,与 Portable 步骤同源)

| 旧名 | 新名 |
|---|---|
| `Qraft_{v}_x64-setup.exe` | `Qraft-{v}-Windows-Amd64-Setup.exe` |
| `Qraft_{v}_arm64-setup.exe` | `Qraft-{v}-Windows-Arm64-Setup.exe` |
| `Qraft_x64.app.tar.gz` | `Qraft-{v}-MacOS-Amd64.app.tar.gz` |
| `Qraft_aarch64.app.tar.gz` | `Qraft-{v}-MacOS-Arm64.app.tar.gz` |
| `Qraft_{v}_x64.dmg` | `Qraft-{v}-MacOS-Amd64.dmg` |
| `Qraft_{v}_aarch64.dmg` | `Qraft-{v}-MacOS-Arm64.dmg` |
| `Qraft_{v}_amd64.deb` | `Qraft-{v}-Linux-Amd64.deb` |
| `Qraft_{v}_arm64.deb` | `Qraft-{v}-Linux-Arm64.deb` |
| `Qraft_{v}_amd64.AppImage` | `Qraft-{v}-Linux-Amd64.AppImage` |
| `Qraft_{v}_aarch64.AppImage` | `Qraft-{v}-Linux-Arm64.AppImage` |

`.sig` 跟随主文件名(同一 sed 替换对 `X.sig` 同样生效)。Portable / SBOM / latest.json 命名不变。

## 实现步骤

1. [tauri.conf.json](../../src-tauri/tauri.conf.json):`bundle.targets` 改为 `["nsis", "dmg", "deb", "appimage"]`;
2. [release.yml](../../.github/workflows/release.yml):新增 `normalize-assets` job(needs: build,tag 且非 dry-run,ubuntu + `gh`),含映射表 sed、资产 PATCH 改名、latest.json 回写三个 step(实为一个 bash step 内三段);
3. 存量 v0.1.5 Release 一次性清洗:同一映射脚本对已发布 Release 跑一遍(删 msi/rpm 资产、去 latest.json 对应 key、改名其余资产);v0.1.5 刚发布、msi/rpm 用户约等于零,风险可忽略;
4. 验证:下一次发版后核对资产名与 latest.json URL 逐字节一致;应用内检查更新端到端。

## 边界条件与潜在风险

- **改名窗口期**:资产改名到 latest.json 回写之间(秒级),更新检查可能 404;一次性秒级窗口,可接受。
- **msi 安装的老用户**:v0.1.5 之后无 msi 产物,其 `windows-*-msi` key 消失,updater 回退匹配 `windows-x86_64` 主 key(指向 nsis),下载的是 NSIS 安装器,需手动跑一次安装;0.x 阶段用户量趋零,发布说明中提示即可。
- **updater 端到端回归是硬性验收**:改名后必须真机验证「检查更新 → 下载 → 签名校验 → 安装」。
- **版本号来源**:映射表用 tauri.conf.json 的 version(与 Portable 步骤同源),而非 tag 名,避免本地 conf 与 tag 脱节导致映射落空。
