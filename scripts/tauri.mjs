#!/usr/bin/env node
// Tauri CLI 包装器:开发环境与正式安装版的数据隔离。
//
// 背景:`tauri dev` 与打包安装版若共用同一应用标识符,会读写同一个
// %APPDATA% 数据目录;开发时清缓存/改配置会直接破坏正常安装版的数据
// (编辑器打开文件列表、历史记录等)。
//
// 方案:开发构建使用独立标识符(cn.qraft.app.dev),由 src-tauri/tauri.dev.conf.json
// 提供(正式版为 cn.qraft.app)。本包装器拦截 `dev` 子命令并自动注入 --config
// 指向该覆盖配置:
// - 仅对 `dev` 注入,`build` / `icon` 等其余子命令原样透传,发布流程零影响
// - 命令行已显式携带 --config/-c 时不重复注入
// - 设置 TAURI_WRAPPER_PRINT=1 时只打印最终参数不执行,用于验证/调试
//
// 用法不变:pnpm tauri dev / pnpm tauri build(package.json 的 tauri 脚本指向本文件)。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEV_CONFIG = path.join(ROOT, 'src-tauri', 'tauri.dev.conf.json');

/** 解析最终传给 Tauri CLI 的参数列表 */
function buildArgs(argv) {
  const args = [...argv];
  // 第一个非选项参数视为子命令(tauri 的全局选项都带 - 前缀)
  const subcmd = args.find((a) => !a.startsWith('-'));
  const hasConfigFlag = args.some(
    (a) => a === '--config' || a.startsWith('--config=') || a === '-c',
  );
  if (subcmd !== 'dev' || hasConfigFlag) {
    return args;
  }
  return [...args, '--config', DEV_CONFIG];
}

function main() {
  const argv = process.argv.slice(2);
  const finalArgs = buildArgs(argv);

  if (process.env.TAURI_WRAPPER_PRINT) {
    console.log(finalArgs.map((a) => JSON.stringify(a)).join(' '));
    return;
  }

  // 定位 @tauri-apps/cli 的 JS 启动器(bin.tauri → ./tauri.js),
  // 通过 node 直接执行,避免依赖具体的包管理器(pnpm/npm/yarn 皆可用)
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve('@tauri-apps/cli/package.json');
  const pkg = JSON.parse(require('node:fs').readFileSync(pkgJsonPath, 'utf8'));
  const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tauri;
  if (!binEntry) {
    console.error('[tauri-wrapper] cannot locate @tauri-apps/cli bin entry');
    process.exit(1);
  }
  const cliJs = path.join(path.dirname(pkgJsonPath), binEntry);

  const result = spawnSync(process.execPath, [cliJs, ...finalArgs], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[tauri-wrapper] failed to run tauri CLI: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
