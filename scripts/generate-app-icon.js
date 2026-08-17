// 生成 1024x1024 应用图标 PNG
// 输入: assets/logo.svg(透明背景 + 近黑 #1A1A1A 图形,与品牌 Logo 同源)
// 输出: assets/source-icon.png(作为 pnpm tauri icon 的输入源,不进入构建产物)
//
// 设计说明:
// - 应用图标:透明背景 + 近黑 #1A1A1A 图形(圆角窗口外框 + 顶部标题栏
//   + 右侧三个窗口控制圆点 + 内容区 </> 代码符号),Windows 任务栏/开始菜单
//   等直接使用深色图形,不做反色
// - 图形占满画布:原始 SVG 图形四周有约 8% 透明留白,任务栏上会显得小;
//   这里用 trim() 裁掉透明边距后按 98% 画布重排,保证小尺寸下图形醒目,
//   同时保留 2% 安全边距避免贴边
// - 浅灰瓦片底旧版保留在 assets/app-icon.svg 作为参考,不再作为图标来源
//
// 依赖: sharp(devDependency,负责 SVG→PNG 栅格化)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIZE = 1024;
/** 图形四周保留的安全边距比例(占画布 2%),避免小尺寸下图形贴边 */
const PAD_RATIO = 0.02;
const PAD = Math.round(SIZE * PAD_RATIO);
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const svgPath = path.join(__dirname, '..', 'assets', 'logo.svg');
const outPath = path.join(__dirname, '..', 'assets', 'source-icon.png');

const source = fs.readFileSync(svgPath, 'utf8');

await sharp(Buffer.from(source))
  .resize(SIZE, SIZE)
  // 裁掉透明边缘,让图形紧贴内容边界
  .trim()
  // 按 98% 画布等比缩放居中(不拉伸),保留 2% 安全边距
  .resize(SIZE - PAD * 2, SIZE - PAD * 2, {
    fit: 'contain',
    background: TRANSPARENT,
  })
  .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: TRANSPARENT })
  .png()
  .toFile(outPath);

console.log(`generated ${outPath} (${SIZE}x${SIZE})`);
