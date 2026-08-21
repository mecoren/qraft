#!/usr/bin/env node
// 同步 monaco-editor 的 min/vs 到 public/monaco/vs,让 @monaco-editor/loader 走本地路径。
//
// 为什么需要这个脚本:
// - @monaco-editor/loader 默认从 https://cdn.jsdelivr.net 加载 Monaco;
//   生产 CSP script-src 'self' 会拦掉跨域脚本,导致 WebView2 内编辑器永远出不来。
// - dev 模式 Tauri 不注入 devCsp,所以看不出问题;一旦打包,Monaco 就消失了。
// - 拷到 public/monaco/vs 后由 Vite/Tauri 静态服务,跟项目一起随应用打包,保持
//   「local-first / 零网络」语义,同时不背 CSP 复杂度。
//
// 拷贝策略:
// - 只同步 min/vs(已压缩、含 worker),跳过 dev/esm 和 source map(占空间且运行时无用)。
// - 每次执行都是「先清空目标目录再拷」,保证版本对齐、不留旧文件。
// - 失败立即 throw,让 CI 也能立刻看到错误。

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'monaco-editor', 'min', 'vs');
const DEST = path.join(ROOT, 'public', 'monaco', 'vs');
// Monaco 0.56 的 min 构建不包含 codicon 图标基础样式，导致折叠按钮等 gutter 图标
// 显示为缺失字形占位（X）。从 esm 构建中把 codicon 的 CSS/TTF 一并同步到 public，
// 由前端在编辑器挂载前显式加载。
const CODICON_SRC = path.join(
  ROOT,
  'node_modules',
  'monaco-editor',
  'esm',
  'vs',
  'base',
  'browser',
  'ui',
  'codicons',
  'codicon',
);
const CODICON_DEST = path.join(DEST, 'base', 'browser', 'ui', 'codicons', 'codicon');

/** 递归删除目标目录(忽略不存在的情况) */
async function rmrf(target) {
  if (!existsSync(target)) return;
  await fs.rm(target, { recursive: true, force: true });
}

/** 递归拷贝目录 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function main() {
  if (!existsSync(SRC)) {
    throw new Error(
      `monaco-editor 未安装或版本无 min/vs: ${SRC}\n` +
        '请先执行 `pnpm install` 确认 monaco-editor 已下载到 node_modules。',
    );
  }

  const start = Date.now();
  await rmrf(DEST);
  await copyDir(SRC, DEST);

  // 同步 codicon 基础样式，确保 gutter 折叠/展开等图标能正确渲染
  if (!existsSync(CODICON_SRC)) {
    throw new Error(
      `monaco-editor 的 codicon 资源不存在: ${CODICON_SRC}\n` +
        '请确认 monaco-editor 已安装且包含 esm/vs/base/browser/ui/codicons/codicon。',
    );
  }
  await copyDir(CODICON_SRC, CODICON_DEST);

  // 简单核验:loader.js 必须存在,否则相当于拷贝失败
  const loaderJs = path.join(DEST, 'loader.js');
  if (!existsSync(loaderJs)) {
    throw new Error(`拷贝完成但未发现 ${loaderJs},请检查源目录结构`);
  }
  // codicon 核验:CSS 与字体文件必须存在
  const codiconCss = path.join(CODICON_DEST, 'codicon.css');
  const codiconTtf = path.join(CODICON_DEST, 'codicon.ttf');
  if (!existsSync(codiconCss) || !existsSync(codiconTtf)) {
    throw new Error(
      `codicon 资源拷贝不完整: ${codiconCss} / ${codiconTtf} 缺失`,
    );
  }

  const elapsed = Date.now() - start;
  console.log(
    `[copy-monaco] monaco-editor/min/vs + codicon → public/monaco/vs 完成 (${elapsed}ms)`,
  );
}

main().catch((err) => {
  console.error('[copy-monaco] 失败:', err);
  process.exit(1);
});