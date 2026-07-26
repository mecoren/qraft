// 生成 1024x1024 纯色 PNG 占位图标
// 用于 pnpm tauri icon 命令的输入源,不进入构建产物
// 颜色:# 6366F1(靛蓝色,Indigo-500,作为 Qraft 的品牌占位色)

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 1024;
const HEIGHT = 1024;
// RGB 色值(R, G, B)
const R = 0x63;
const G = 0x66;
const B = 0xf1;

// PNG 签名
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// CRC32 查找表
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// IHDR chunk
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(WIDTH, 0);
ihdrData.writeUInt32BE(HEIGHT, 4);
ihdrData.writeUInt8(8, 8); // bit depth
ihdrData.writeUInt8(2, 9); // color type: 2 = truecolor RGB
ihdrData.writeUInt8(0, 10); // compression
ihdrData.writeUInt8(0, 11); // filter
ihdrData.writeUInt8(0, 12); // interlace
const ihdr = makeChunk('IHDR', ihdrData);

// IDAT chunk: 每行前加 filter byte (0 = None),后跟 WIDTH * 3 字节 RGB
const rowSize = 1 + WIDTH * 3;
const raw = Buffer.alloc(rowSize * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const offset = y * rowSize;
  raw[offset] = 0; // filter: None
  for (let x = 0; x < WIDTH; x++) {
    const px = offset + 1 + x * 3;
    raw[px] = R;
    raw[px + 1] = G;
    raw[px + 2] = B;
  }
}
const compressed = zlib.deflateSync(raw);
const idat = makeChunk('IDAT', compressed);

// IEND chunk
const iend = makeChunk('IEND', Buffer.alloc(0));

const png = Buffer.concat([SIGNATURE, ihdr, idat, iend]);

const outPath = path.join(__dirname, '..', 'assets', 'source-icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(`generated ${outPath} (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
