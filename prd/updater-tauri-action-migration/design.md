# 设计文档:修复自动更新发布链路(迁移到 tauri-action)

> 需求背景见同目录 [requirements.md](./requirements.md)

## 目标架构

```
push tag v* ──► audit job(cargo/pnpm 审计,保持不变)
                     │
                     ▼
              build job(matrix: win/mac/linux × x64/arm64)
                     │
                     ├─ SBOM 生成(保持不变,改存独立 artifact)
                     ├─ tauri-action:构建 + 创建 Release + 上传资产
                     │    └─ 自动生成 latest.json,跨 matrix 合并签名信息
                     └─ Windows Portable 补充打包(raw exe → zip,独立 artifact)
                     │
                     ▼
              publish-extras job(tag 且非 dry-run 时)
                     └─ softprops 把 SBOM + Portable 追加到已存在的 Release
```

## 关键技术决策

### 1. `createUpdaterArtifacts: true`(tauri.conf.json)

Tauri v2 的更新器产物开关。缺失它是本次事故的根源:不开则无 `.sig` 签名、无更新产物,`latest.json` 无从谈起。启用后:

- 所有 bundle 附带 `.sig`(minisign 签名,与 conf 中已有 `pubkey` 配对);
- CI 构建时若未设置 `TAURI_SIGNING_PRIVATE_KEY` 会**直接失败**——这是刻意的安全保护(防止产物被篡改后仍可分发)。

### 2. tauri-action 替代「裸构建 + 手动重命名 + softprops 发布」

- 旧的 build 步骤(`pnpm tauri build`)与 `Package and rename artifacts` 两步合并为单步 tauri-action 调用;
- `tagName` 条件传入:tag 推送时发版;workflow_dispatch(dry-run)时留空 → 只构建、只传 artifact、不创建 Release;
- `includeUpdaterJson: true`:tauri-action 在每个平台构建完成后生成对应平台的 manifest 条目,并在同一 tag 的多次矩阵运行间**读取并合并** `latest.json`,最终 release 上只有一份全平台清单。

### 3. 命名策略:updater 托管资产用默认名,附加资产保留自定义名

updater 的下载 URL 必须逐字节匹配 Release 资产名。自定义重命名(`Qraft-x.y.z-Windows-Amd64-Installer.msi`)发生在构建之后,若保留会导致 manifest URL 与资产不一致 → 404。因此:

| 资产 | 命名 | 是否进 latest.json |
|---|---|---|
| msi / nsis / dmg / AppImage / deb | Tauri 默认名(如 `Qraft_0.1.5_x64_en-US.msi`) | 是 |
| `.sig` 签名 | 与包同名 + `.sig` | 是(signature 字段) |
| Portable zip(Windows) | 保持 `Qraft-x.y.z-Windows-Amd64-Portable.zip` | 否 |
| SBOM cdx.json | 保持现有命名 | 否 |

代价:Release 下载页文件名风格变化,不影响功能;README/文档中的下载链接如引用旧命名需同步更新。

### 4. Portable 与 SBOM 通过补充 job 追加

tauri-action 不产 Portable zip,也不感知 SBOM。方案:

- build job 内:Windows 平台在 tauri-action 之后压缩 raw exe 上传独立 artifact;
- 新增 `publish-extras` job(needs: build,仅 tag + 非 dry-run):用 softprops/action-gh-release 按 tag 定位 tauri-action 已创建的 Release,**追加**上传这些文件(softprops 对已存在 release 是增量添加文件而非覆盖)。

## 实现步骤

1. [tauri.conf.json](../../src-tauri/tauri.conf.json):`bundle` 下新增 `"createUpdaterArtifacts": true`;
2. 重写 [.github/workflows/release.yml](../../.github/workflows/release.yml) 的 build job:
   - 删除 `Build Tauri app` + 两个 `Package and rename artifacts` + 原 `Upload artifacts`;
   - 新增 tauri-action 步骤(env 注入 GITHUB_TOKEN 与签名密钥 secrets,args 带 `--target ${{ matrix.rust-target }}`);
   - 保留 SBOM / Linux arm64 linker / Rust cache / 系统依赖等步骤不动;
   - Windows 平台追加 Portable 打包步骤。
3. 新增 `publish-extras` job:tag 触发时把 SBOM artifact + Portable artifact 追加到 Release;
4. 用户侧一次性配置:GitHub repo Settings → Secrets 添加 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(私钥须与 conf 中 pubkey 同一对,若已丢失需重新生成并同步更新 pubkey);
5. 验证:先跑一次 workflow_dispatch dry-run 确认三平台可构建;再打 `v0.1.5` tag 正式发布,通过代理 curl 校验 `latest.json` 与各资产 HTTP 200,应用内检查更新端到端验证。

## 边界条件与潜在风险

- **签名密钥丢失**:pubkey 已提交但私钥只在维护者本地/Secrets。若首次迁移时才建 Secret,旧版本(v0.1.2)安装的应用会因 pubkey 变化拒升级——影响面仅为 v0.1.2 用户跨密钥升级这一窗口,可在 v0.1.5 发布说明中提示重新下载。
- **tag 并发**:concurrency 组已按 ref 取消重复运行,tauri-action 多矩阵写同一 Release 有官方幂等支持,无需额外锁。
- **版本回退场景**:latest.json 一旦指向更高版本不可降级回传,发布错误版本时按 checklist 第 7 节回滚预案处理。
- **内地直连超时**:不在本次范围;迁移完成后可另行评估在 endpoints 里追加镜像地址。
