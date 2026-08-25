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

// —— 裁剪:删除 min/vs 中运行时不可达的文件 ——
// 背景(2026-08 实测):monaco-editor 0.56 的 min/vs 同时携带两套产物:
//   1) AMD 运行时真正使用的「根级哈希 chunk」依赖图(editor.main.js 的 define 依赖
//      + assets/*.js worker 载荷,经 MonacoEnvironment.getWorker / toUrl 加载);
//   2) 旧版布局遗留:vs/language/**(旧 worker/contribution)、vs/index.js 聚合入口
//      及其独占的 toggleHighContrast chunk、nls/lang 下除 zh-cn 外的全部 locale。
// 应用只经 @monaco-editor/loader require('vs/editor/editor.main'),第 2 类永不加载,
// 却整包进入安装包(实测 monaco 占 dist 23.4MB)。
// 做法:解析每个文件的 define("id",[deps],…) 依赖数组做静态闭包分析,另用正则捕捉
// require.toUrl("./assets/x.js") 形态的动态引用;白名单之外的文件一律删除。

/** 递归列出目录下相对 vs 根的 POSIX 风格路径集合 */
async function listFilesRel(rootDir, rel = '') {
  const out = [];
  for (const entry of await fs.readdir(rootDir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRel(path.join(rootDir, entry.name), relPath)));
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}

/** POSIX 相对路径解析(基于 vs 根),如 'language/typescript' + '../../base/x' → 'base/x' */
function resolveRel(fromDir, spec) {
  const parts = (fromDir ? fromDir.split('/') : []).concat(spec.split('/'));
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

/**
 * 计算运行时可达文件集合(相对 vs 根的路径)。
 * @param {string} vsDir min/vs 根目录绝对路径
 */
async function collectReachable(vsDir) {
  const jsFiles = (await listFilesRel(vsDir)).filter((f) => f.endsWith('.js'));
  const jsSet = new Set(jsFiles); // 相对路径全集,用于校验动态引用目标确实存在
  // 注册表:模块 id → 相对路径。同时登记「路径推导 id」(vs/xxx)与文件内显式 define 名,
  // 因为哈希 chunk 文件名与 define 的模块 id 不一定一致。
  const byId = new Map();
  const defineDeps = new Map(); // relPath → string[](define 依赖模块 id 列表)
  const dynamicRefs = new Map(); // relPath → string[](引号相对路径动态引用目标)
  const modIdOf = new Map(); // relPath → 该文件的规范模块 id(相对依赖以此归一化)
  for (const rel of jsFiles) {
    const content = await fs.readFile(path.join(vsDir, rel), 'utf8');
    const pathId = `vs/${rel.replace(/\.js$/, '')}`;
    byId.set(pathId, rel);
    const m = /^define\("([^"]+)"\s*,\s*\[([^\]]*)\]/m.exec(content);
    modIdOf.set(rel, m ? m[1] : pathId);
    if (m) {
      byId.set(m[1], rel);
      defineDeps.set(
        rel,
        m[2]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean),
      );
    }
    // 动态引用捕捉:除 define 静态依赖外,min/vs 存在两类运行时才解析的引用——
    //   1) worker 载荷经 toUrl("./assets/xx.js") 构造 URL;
    //   2) basic-languages 贡献表经动态 require(["../abap-xxxx"],…) 按语言懒加载。
    // 二者共同形态是「引号包裹的相对路径字符串」,统一抽取;哈希文件名不会误配。
    for (const d of content.matchAll(/["'](\.{1,2}\/[^"']+)["']/g)) {
      // AMD 会在模块 id 后自动补 .js,故动态引用串可能不带扩展名
      const bare = resolveRel(path.posix.dirname(rel), d[1]);
      const target = jsSet.has(bare) ? bare : jsSet.has(`${bare}.js`) ? `${bare}.js` : null;
      if (target !== null) {
        if (!dynamicRefs.has(rel)) dynamicRefs.set(rel, []);
        dynamicRefs.get(rel).push(target);
      }
    }
  }
  /** 模块 id → 相对文件路径(剥掉 "!" 插件后缀;未知 id 返回 null 由调用方忽略) */
  const toFile = (id) => {
    const bare = id.replace(/!.*$/, '');
    return byId.get(bare) ?? null;
  };
  /** 按导入方的模块 id 目录归一化相对依赖(AMD 规则):'../x' 相对父模块所在目录 */
  const normalizeDep = (importerRel, dep) => {
    if (dep === 'require' || dep === 'module' || dep === 'exports') return null;
    if (dep.startsWith('./') || dep.startsWith('../')) {
      return resolveRel(path.posix.dirname(modIdOf.get(importerRel)), dep);
    }
    return dep;
  };
  // 注意:入口文件不预置进 reachable——若预置,出队时会被下方 has 检查跳过,
  // 导致入口的 define 依赖从未展开(已踩坑)。保留动作统一由出队路径完成。
  const reachable = new Set();
  const queue = ['vs/editor/editor.main'];
  while (queue.length > 0) {
    const id = queue.pop();
    const rel = toFile(id);
    if (!rel || reachable.has(rel)) continue;
    reachable.add(rel);
    if (process.env.DEBUG_TRIM) {
      console.log(`[trim-debug] +${rel} deps=${JSON.stringify(defineDeps.get(rel) ?? [])}`);
    }
    for (const rawDep of defineDeps.get(rel) ?? []) {
      const dep = normalizeDep(rel, rawDep);
      if (dep !== null) queue.push(dep);
    }
    // 动态引用目标是「文件相对路径」而非模块 id,直接入队(toFile 对其返回 null 风险:
    // 若恰好形如 vs/ 前缀会误走注册表——故这里单独分支处理)
    for (const target of dynamicRefs.get(rel) ?? []) queue.push(`file:${target}`);
  }
  // 展开 file: 形态的动态引用(循环直至不动点,新纳入文件可能再引用他人)
  let grew = true;
  while (grew) {
    grew = false;
    for (const rel of [...reachable]) {
      for (const target of dynamicRefs.get(rel) ?? []) {
        if (!reachable.has(target)) {
          reachable.add(target);
          grew = true;
          if (process.env.DEBUG_TRIM) console.log(`[trim-debug] +(dyn) ${target}`);
        }
      }
      // 动态纳入文件的 define 静态依赖也要展开
      for (const rawDep of defineDeps.get(rel) ?? []) {
        const dep = normalizeDep(rel, rawDep);
        const depFile = dep === null ? null : toFile(dep);
        if (depFile && !reachable.has(depFile)) {
          reachable.add(depFile);
          grew = true;
        }
      }
    }
  }
  return reachable;
}

/**
 * 执行裁剪:保留闭包 + 白名单,删除其余,返回释放字节数。
 * 白名单:loader.js(AMD 引导)、editor.main.css(样式)、basic-languages/**(语言
 * 贡献动态注册兜底)、nls/lang/zh-cn.js(index.html 经典 script 直引,无 define)。
 */
async function trimUnreachable(vsDir) {
  const reachable = await collectReachable(vsDir);
  const whitelist = new Set(['loader.js', 'editor/editor.main.css']);
  for (const rel of await listFilesRel(vsDir)) {
    if (rel.startsWith('basic-languages/') || rel === 'nls/lang/zh-cn.js') whitelist.add(rel);
  }
  let freed = 0;
  let deleted = 0;
  for (const rel of await listFilesRel(vsDir)) {
    if (reachable.has(rel) || whitelist.has(rel)) continue;
    const abs = path.join(vsDir, rel);
    freed += (await fs.stat(abs)).size;
    deleted += 1;
    await fs.rm(abs);
  }
  // 清理删空后的残留空目录(language/ 等),避免留下无效骨架
  for (const name of ['language', 'assets', 'editor', 'nls']) {
    const dir = path.join(vsDir, name);
    if (!existsSync(dir)) continue;
    const rest = await listFilesRel(dir);
    if (rest.length === 0) await fs.rm(dir, { recursive: true, force: true });
  }
  console.log(
    `[copy-trim] kept ${reachable.size} reachable files, deleted ${deleted}, ` +
      `freed ${(freed / 1024 / 1024).toFixed(1)} MB`,
  );
  return freed;
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

  // 裁剪不可达产物(见 trimUnreachable 注释):旧版 language/**、聚合入口、非中文 locale 等
  await trimUnreachable(DEST);

  // 裁剪后核验:运行时关键路径必须存活,否则视为闭包分析出错,立即失败
  for (const rel of [
    'loader.js',
    'editor/editor.main.js',
    'editor/editor.main.css',
    'nls/lang/zh-cn.js',
  ]) {
    if (!existsSync(path.join(DEST, rel))) {
      throw new Error(`裁剪后缺少运行时关键文件: ${rel}`);
    }
  }
  const assetsDir = path.join(DEST, 'assets');
  const assetsLeft = existsSync(assetsDir)
    ? (await fs.readdir(assetsDir)).filter((f) => f.endsWith('.js'))
    : [];
  if (assetsLeft.length === 0) {
    throw new Error('裁剪后 assets/ 无任何 worker 载荷,闭包分析有误');
  }
  if (existsSync(path.join(DEST, 'language'))) {
    throw new Error('裁剪后仍存在旧版 language/ 目录');
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