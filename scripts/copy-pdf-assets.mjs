#!/usr/bin/env node
// 同步 pdfjs-dist 的运行时资源到 src/tools/pdf/assets/pdf/,让 PDF 工具零网络运行。
//
// 为什么需要这个脚本:
// - pdfjs 渲染需要 standard_fonts(标准 14 字体的内嵌替代)与 cmaps(CJK 纵排/
//   CID 字体的映射表);缺失时部分 PDF 文本空白或警告。
// - 官方资源在 node_modules/pdfjs-dist/{standard_fonts,cmaps},Vite 不会自动
//   拷贝非 import 资源;拷到 src/tools/pdf/assets/pdf/ 后走 `new URL(..., import.meta.url)`
//   相对解析,dev 与打包(file://)下均可直达,保持「local-first / 零网络」。
//
// 拷贝策略:与 copy-monaco 一致「先清空再拷」,保证版本对齐。

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const DEST = path.join(ROOT, 'src', 'tools', 'pdf', 'assets', 'pdf');

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

async function main() {
  const fontsSrc = path.join(PKG, 'standard_fonts');
  const cmapsSrc = path.join(PKG, 'cmaps');
  if (!existsSync(fontsSrc) || !existsSync(cmapsSrc)) {
    throw new Error(`pdfjs-dist 资源目录不存在: ${fontsSrc} / ${cmapsSrc}`);
  }
  await fs.rm(DEST, { recursive: true, force: true });
  await copyDir(fontsSrc, path.join(DEST, 'standard_fonts'));
  await copyDir(cmapsSrc, path.join(DEST, 'cmaps'));

  // 核验:关键字体必须存在,否则视为拷贝失败
  for (const rel of [
    'standard_fonts/FoxitSerif.pfb',
    'cmaps/Adobe-Japan1-UCS2.bcmap',
  ]) {
    if (!existsSync(path.join(DEST, rel))) {
      throw new Error(`拷贝完成但缺少关键资源: ${rel}`);
    }
  }
  console.log('[copy-pdf-assets] pdfjs standard_fonts + cmaps → src/tools/pdf/assets/pdf/ 完成');
}

main().catch((err) => {
  console.error('[copy-pdf-assets] 失败:', err);
  process.exit(1);
});
