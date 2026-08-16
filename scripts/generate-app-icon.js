// 生成 1024x1024 应用图标 PNG
// 输入: assets/app-icon.svg(品牌图标,单一来源)
// 输出: assets/source-icon.png(作为 pnpm tauri icon 的输入源,不进入构建产物)
//
// 设计说明:
// - IDE 窗口图标:浅灰 #F5F5F5 圆角方形底色 + 近黑 #1A1A1A 图形
// - 图形语义:圆角窗口外框 + 顶部标题栏(左侧标签 + 右侧三个窗口控制圆点)
//   + 内容区 </> 代码符号,细节与原设计稿完全一致
// - 图形占满整个画布(无透明留白),保证小尺寸清晰可辨
//
// 依赖: sharp(devDependency,负责 SVG→PNG 栅格化)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIZE = 1024;

const svgPath = path.join(__dirname, '..', 'assets', 'app-icon.svg');
const outPath = path.join(__dirname, '..', 'assets', 'source-icon.png');

const source = fs.readFileSync(svgPath, 'utf8');

await sharp(Buffer.from(source))
  .resize(SIZE, SIZE)
  .png()
  .toFile(outPath);

console.log(`generated ${outPath} (${SIZE}x${SIZE})`);
