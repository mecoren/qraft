# 需求文档:修复自动更新发布链路(迁移到 tauri-action)

## 背景

用户报告「检查更新失败」。根因排查(已实测验证):

1. 本机直连 GitHub 连接超时(网络层问题,叠加因素);
2. 通过代理访问更新端点,返回 **HTTP 404** —— Release 上根本不存在 `latest.json`;
3. 最新 release v0.1.2 的 14 个资产中**没有任何 `.sig` 签名文件**;
4. 根因:[tauri.conf.json](../../src-tauri/tauri.conf.json) 缺少 `"createUpdaterArtifacts": true`,Tauri 构建从未生成更新器产物;且 [.github/workflows/release.yml](../../.github/workflows/release.yml) 使用裸构建 + softprops 发布,没有生成 `latest.json` 的环节。

即:自动更新的客户端配置完好,但服务端(Release 资产)从第一个版本起就缺失必需文件。

## 需求理解

将 CI 发布流程迁移到官方 [tauri-action](https://github.com/tauri-apps/tauri-action),由其负责多平台构建、Release 创建、资产上传以及 **`latest.json` 自动生成与跨矩阵合并**,使应用内「检查更新」端到端可用。

## 关键决策

- 采用 tauri-action(用户选定):官方维护、自动处理 `latest.json` 合并、减少自研脚本维护成本。
- 放弃自定义安装包命名(`Qraft-x.y.z-Windows-Amd64-Installer.msi` 等):updater 托管的产物必须使用 tauri-action 生成的默认命名,否则 manifest URL 与资产名不一致会导致 404。Portable 等非 updater 资产保留自定义命名作为附加上传。

## 边界条件与风险

- 需要 GitHub Actions Secrets 配置 `TAURI_SIGNING_PRIVATE_KEY`(及可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`);启用 `createUpdaterArtifacts` 后若密钥缺失,CI 构建会直接失败(这是预期保护)。
- 本地版本已是 0.1.5,远端最新 release 为 0.1.2:首次迁移发布的 tag 必须 ≥ 0.1.5,否则 updater 版本比较会误判。
- 内地用户直连 GitHub 超时问题独立存在,不在本次范围(可后续评估镜像端点)。

## 验收标准

1. 推送 ≥ v0.1.5 的 tag 触发 CI,三平台构建成功并创建 Release;
2. Release 资产包含各平台安装包、对应 `.sig` 签名文件、以及单一 `latest.json`;
3. `latest.json` 中每个平台条目的 url/signature 与实际资产可访问、可校验(通过代理 curl 验证 HTTP 200);
4. 从旧版本(v0.1.2 等)应用内「检查更新」能发现新版本并完成升级(有条件时验证);
5. workflow_dispatch(dry-run)路径不受影响,只出产物不发版。
