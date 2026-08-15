// 生成 1024x1024 应用图标 PNG
// 输入: assets/app-icon.svg(Codex 风格品牌图标,单一来源)
// 输出: assets/source-icon.png(作为 pnpm tauri icon 的输入源,不进入构建产物)
//
// 设计说明:
// - 参考 OpenAI Codex 图标的极简几何风格:圆形底座 + 环形 + 内部抽象图形
// - 保留 Qraft 品牌蓝(#497FF8),用同色系渐变(亮蓝→深蓝)增强体积感
// - 图形语义:圆环代表"环形/容器/工具箱",内部 </> 代表"代码/开发者工具"
// - 透明背景 + 图形水平垂直居中,约占画布 87% 宽度,保证小尺寸清晰可辨
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
