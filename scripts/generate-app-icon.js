// 生成 1024x1024 应用图标 PNG
// 输入: assets/toolbox.svg(Koboyo toolbox 图标,单一来源)
// 输出: assets/source-icon.png(作为 pnpm tauri icon 的输入源,不进入构建产物)
//
// 合成方式:透明背景 + #497FF8 单色 toolbox,图形水平垂直居中,
// 约占画布 80% 宽度,保持 SVG 220:166 的宽高比。
// 因源图标为手绘填充风(线条偏细),用同色粗描边(stroke)加粗轮廓,
// 保证小尺寸下依旧清晰可辨。
//
// 依赖: sharp(devDependency,负责 SVG→PNG 栅格化)。
// 来源: https://koboyo.com/icons/svg/toolbox.svg(免费可商用,无需署名)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIZE = 1024;
/** 品牌蓝(ARGB 0xFF497FF8 → #497FF8) */
const BRAND = '#497FF8';
/** 同色描边宽度(SVG 坐标系 220 宽,约 5%,用于加粗手绘线条) */
const STROKE_WIDTH = 12;

/** SVG viewBox 尺寸(与 assets/toolbox.svg 保持一致) */
const VB_W = 220;
const VB_H = 166;
/** 字形宽度占画布的百分比 */
const SCALE_FACTOR = 0.8;

const svgPath = path.join(__dirname, '..', 'assets', 'toolbox.svg');
const outPath = path.join(__dirname, '..', 'assets', 'source-icon.png');

// 提取源 SVG 中的所有 <path ...> 元素,保持它们原有的 d 数据
const source = fs.readFileSync(svgPath, 'utf8');
const paths = [...source.matchAll(/<path\s+d="([^"]*)"/g)].map((m) => m[1]);
if (paths.length === 0) {
  throw new Error(`no <path> found in ${svgPath}`);
}

// 字形整体缩放,使其宽度 = SIZE * SCALE_FACTOR
const scale = (SIZE * SCALE_FACTOR) / VB_W;
const tx = (SIZE - VB_W * scale) / 2;
const ty = (SIZE - VB_H * scale) / 2;

// 透明背景:无 <rect>;fill + 同色粗 stroke 让手绘线条更粗更清晰
const composited = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <g
    transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)}) scale(${scale.toFixed(6)})"
    fill="${BRAND}"
    stroke="${BRAND}"
    stroke-width="${STROKE_WIDTH}"
    stroke-linejoin="round"
    stroke-linecap="round"
  >
    ${paths.map((d) => `<path d="${d}"/>`).join('')}
  </g>
</svg>`;

await sharp(Buffer.from(composited))
  .png()
  .toFile(outPath);

console.log(`generated ${outPath} (${SIZE}x${SIZE}, ${paths.length} path(s))`);
