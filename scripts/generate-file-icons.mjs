#!/usr/bin/env node
// 生成文件关联类型图标(ICO)。
//
// 图标来源:node_modules/material-icon-theme/icons/<name>.svg —— 与应用内
// 文件图标(src/tools/code-editor-workspace/fileIcons.ts 经 Vite ?url 打包)
// 完全同一批 SVG,保证资源管理器中文件关联图标与「打开的编辑器」标签栏
// 图标视觉一致。
//
// 产出:src-tauri/icons/file-assoc/<name>.ico(16/24/32/48/64/128/256 七尺寸,
// PNG 容器 ICO,Vista+ 原生支持)。
// ICO 名称即 installer-hooks.nsh 中 _Qraft_AssocTypeIcon 的注册名,增删时两处同步。
//
// 用法:NODE_OPTIONS='' node scripts/generate-file-icons.mjs
// 依赖:sharp(开发依赖)。

import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THEME_DIR = path.join(ROOT, 'node_modules', 'material-icon-theme', 'icons');
const ICO_DIR = path.join(ROOT, 'src-tauri', 'icons', 'file-assoc');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * 需要生成的图标名(= material-icon-theme/icons/<name>.svg)。
 * 与 fileIcons.ts 的 FILE_EXT_ICONS 映射保持一致:每个 ProgID 一枚图标,
 * ProgID → 图标的对应关系注册在 src-tauri/windows/installer-hooks.nsh。
 */
const ICON_NAMES = [
  'file', // txt / 兜底
  'json', // json
  'markdown', // md / markdown
  'table', // csv
  'log', // log
  'xml', // xml
  'yaml', // yaml / yml
  'toml', // toml
  'settings', // ini / conf / env(配置类,与应用内 .env 前缀规则同源)
  'javascript', // js
  'typescript', // ts
  'react', // jsx / tsx
  'python', // py
  'rust', // rs
  'go', // go
  'java', // java
  'c', // c / h
  'cpp', // cpp / hpp
  'console', // sh / bash
  'database', // sql
  'vue', // vue
  'svelte', // svelte
];

/** 将多枚 PNG(含 size 字段)打包为 ICO(PNG 容器,Vista+ 原生支持) */
function packIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = header.length + entries.length;
  const blobs = pngs.map((png, i) => {
    const e = entries.subarray(i * 16, (i + 1) * 16);
    e.writeUInt8(png.size >= 256 ? 0 : png.size, 0); // width(256→0)
    e.writeUInt8(png.size >= 256 ? 0 : png.size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.data.length, 8); // bytes
    e.writeUInt32LE(offset, 12); // offset
    offset += png.data.length;
    return png.data;
  });
  return Buffer.concat([header, entries, ...blobs]);
}

async function main() {
  // 清空输出目录,避免残留已废弃的图标(如旧版自定义设计的 ico)
  await rm(ICO_DIR, { recursive: true, force: true });
  await mkdir(ICO_DIR, { recursive: true });

  for (const name of ICON_NAMES) {
    const svgPath = path.join(THEME_DIR, `${name}.svg`);
    const svg = await readFile(svgPath, 'utf8');
    // material-icon-theme 的 SVG 画布为 16×16,按目标尺寸换算渲染密度
    const pngs = await Promise.all(
      SIZES.map(async (size) => ({
        size,
        data: await sharp(Buffer.from(svg), { density: (72 * size) / 16 })
          .resize(size, size)
          .png()
          .toBuffer(),
      })),
    );
    await writeFile(path.join(ICO_DIR, `${name}.ico`), packIco(pngs));
    console.log(`[file-icons] ${name}.ico (${SIZES.length} sizes)`);
  }
  console.log(`[file-icons] 来源: ${THEME_DIR}`);
  console.log(`[file-icons] 产出: ${ICO_DIR}`);
}

main().catch((err) => {
  console.error('[file-icons] 生成失败:', err);
  process.exit(1);
});
