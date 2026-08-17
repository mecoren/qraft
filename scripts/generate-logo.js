// 生成透明 Logo 与反色 Logo 的 PNG 资产
// 输入:
//   - assets/logo.svg          透明背景 + 近黑 #1A1A1A 图形(亮色主题用)
//   - assets/logo-inverted.svg 透明背景 + 浅灰 #F5F5F5 图形(暗色主题用)
// 输出:
//   - assets/logo-transparent.png  1024x1024 透明 PNG
//   - assets/logo-inverted.png     1024x1024 反色 PNG
//   - public/favicon.png           32x32 PNG 兜底(favicon.svg 的主 favicon 兜底)
//
// 设计说明:
// - 两版 SVG 均无背景瓦片,透明背景;图形元素/形状/比例完全一致,仅颜色互为反色
// - 与 assets/app-icon.svg(桌面图标,含浅灰瓦片底)保持同源图形,桌面图标链路不受影响
//
// 依赖: sharp(devDependency,负责 SVG→PNG 栅格化)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.join(__dirname, '..');
const SIZE = 1024;
const FAVICON_SIZE = 32;

const sources = [
  { name: 'transparent', svg: 'logo.svg', png: 'logo-transparent.png', size: SIZE },
  { name: 'inverted', svg: 'logo-inverted.svg', png: 'logo-inverted.png', size: SIZE },
  { name: 'favicon', svg: 'logo.svg', png: null, size: FAVICON_SIZE },
];

for (const { name, svg, png, size } of sources) {
  const svgPath = path.join(root, 'assets', svg);
  const outPath = path.join(root, png ? 'assets' : 'public', png ?? 'favicon.png');
  const source = fs.readFileSync(svgPath, 'utf8');

  await sharp(Buffer.from(source))
    .resize(size, size)
    .png()
    .toFile(outPath);

  console.log(`generated ${outPath} (${size}x${size})`);
}
