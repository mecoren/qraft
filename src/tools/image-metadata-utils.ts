/**
 * 图片元数据解析器 —— PNG / JPEG / WebP / GIF / BMP 容器级字节直读
 *
 * 纯函数、零依赖、零网络:输入图片字节,输出结构化报告。
 * 口径对标 exiftool 的常用字段子集(尺寸/位深/颜色类型/EXIF/chunk 清单),
 * 不做像素级解码(压缩数据一律跳过),因此任意大图片都只扫头部与元数据段。
 *
 * 关键实测结论(2026-09-13,Pillow 真实夹具交叉验证,细节见
 * docs/superpowers/plans/2026-09-13-image-metadata.md):
 * - WebP VP8(有损)尺寸是经验布局:LE32 的 bits 0-13 = 宽、bits 16-29 = 高
 *   (非 RFC 字段名直读;Pillow 四组尺寸 16/200/256/320 全部吻合);
 * - Pillow 写 EXIF 时把 RATIONAL(type 5)写成 LONG 对(type 4, cnt 2),
 *   值区仍为 [num, den] —— 本解析器按宽容策略同样按 num/den 渲染;
 * - JPEG 真实 APP0(JFIF)先于 APP1(EXIF),两者都要读。
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'unknown';

/** PNG 文本 chunk(tEXt / zTXt / iTXt)解出的键值条目 */
export interface PngTextEntry {
  keyword: string;
  text: string;
  /** zTXt / iTXt 压缩条目标记 */
  compressed?: boolean;
  /** iTXt 语言标签 */
  language?: string;
}

/** EXIF 单条目:name 为规范英文字段名(不翻译,展示层直接用) */
export interface ExifEntry {
  tag: string;
  name: string;
  value: string;
}

export interface ImageMetadataReport {
  format: ImageFormat;
  formatLabel: string;
  width: number | null;
  height: number | null;
  bitDepth: number | null;
  colorInfo: string | null;
  interlaced: boolean | null;
  frameCount: number | null;
  animate: boolean | null;
  transparency: boolean | null;
  dpi: number | null;
  backgroundColor: string | null;
  exif: ExifEntry[];
  textEntries: PngTextEntry[];
  pngChunks: { type: string; bytes: number }[];
  /** 解析失败原因;非空时其余字段为兜底空值 */
  error?: string;
}

/** 空报告骨架:解析失败时的兜底形态 */
function emptyReport(error: string): ImageMetadataReport {
  return {
    format: 'unknown',
    formatLabel: '-',
    width: null,
    height: null,
    bitDepth: null,
    colorInfo: null,
    interlaced: null,
    frameCount: null,
    animate: null,
    transparency: null,
    dpi: null,
    backgroundColor: null,
    exif: [],
    textEntries: [],
    pngChunks: [],
    error,
  };
}

/** PNG 颜色类型码 → 展示名 */
const PNG_COLOR_TYPES: Record<number, string> = {
  0: 'Grayscale',
  2: 'RGB',
  3: 'Indexed',
  4: 'Grayscale + Alpha',
  6: 'RGBA',
};

/** EXIF 常见 tag 白名单(规范英文名即展示名,不进 i18n) */
const EXIF_TAGS: Record<number, string> = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x0128: 'ResolutionUnit',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8827: 'ISOSpeedRatings',
  0x9000: 'ExifVersion',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9201: 'ShutterSpeedValue',
  0x9202: 'ApertureValue',
  0x9204: 'ExposureBiasValue',
  0x9207: 'MeteringMode',
  0x9209: 'Flash',
  0x920a: 'FocalLength',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
  0xa432: 'ISO',
  0xa433: 'ISOSpeed',
  0xa434: 'ISOSpeedLatitudeyyy',
};

/** Orientation 值 → 人类可读旋转描述(值保留原数字前缀) */
const ORIENTATION_NAMES: Record<number, string> = {
  1: 'Normal',
  2: 'Mirror horizontal',
  3: 'Rotate 180',
  4: 'Mirror vertical',
  5: 'Mirror horizontal + rotate 270',
  6: 'Rotate 90 CW',
  7: 'Mirror horizontal + rotate 90',
  8: 'Rotate 270 CW',
};

// —— 基础读取小工具 ——

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function findNull(bytes: Uint8Array, from: number): number {
  const i = bytes.indexOf(0, from);
  return i < 0 ? bytes.length : i;
}

/**
 * 解析图片字节为元数据报告。
 * 不识别 / 截断的输入返回带 error 的报告,永不抛异常。
 */
export function parseImageMetadata(bytes: Uint8Array): ImageMetadataReport {
  if (bytes.length < 8) return emptyReport('文件过小或不是受支持的图片格式');
  // 魔数嗅探(顺序:PNG → JPEG → RIFF/WebP → GIF → BMP)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return parsePng(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && bytes.length >= 12 && ascii(bytes, 8, 12) === 'WEBP') {
    return parseWebp(bytes);
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return parseGif(bytes);
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return parseBmp(bytes);
  return emptyReport('不是受支持的图片格式(支持 PNG / JPEG / WebP / GIF / BMP)');
}

// —— PNG ——

function parsePng(bytes: Uint8Array): ImageMetadataReport {
  const report = emptyReport('');
  report.format = 'png';
  report.formatLabel = 'PNG';
  const chunks: { type: string; bytes: number }[] = [];
  const texts: PngTextEntry[] = [];
  let pos = 8;
  let sawIend = false;
  while (pos + 8 <= bytes.length && !sawIend) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos, Math.min(8, bytes.length - pos));
    const length = dv.getUint32(0);
    const type = ascii(bytes, pos + 4, pos + 8);
    if (pos + 8 + length > bytes.length) {
      // chunk 长度越界:头部已解析的部分仍可用
      report.error = 'PNG 数据截断(chunk 越界)';
      break;
    }
    chunks.push({ type, bytes: length });
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR' && length >= 13) {
      const dv2 = new DataView(data.buffer, data.byteOffset, 13);
      report.width = dv2.getUint32(0);
      report.height = dv2.getUint32(4);
      report.bitDepth = data[8];
      const colorType = data[9];
      report.colorInfo = PNG_COLOR_TYPES[colorType] ?? `Unknown (${colorType})`;
      report.interlaced = data[12] === 1;
      report.transparency = colorType === 4 || colorType === 6;
    } else if (type === 'pHYs' && length >= 9) {
      const dv3 = new DataView(data.buffer, data.byteOffset, 9);
      const ppm = dv3.getUint32(0);
      if (data[8] === 1 && ppm > 0) report.dpi = Math.round(ppm * 0.0254);
    } else if (type === 'tEXt') {
      const nul = findNull(data, 0);
      texts.push({ keyword: ascii(data, 0, nul), text: ascii(data, nul + 1, data.length) });
    } else if (type === 'zTXt') {
      const nul = findNull(data, 0);
      // zlib 压缩文本:解压失败时保留标记不解内容(浏览器 DecompressionStream 可用,
      // 但为保持纯函数同步语义,这里仅标注压缩、不展开 —— UI 展示 "(compressed)")
      texts.push({
        keyword: ascii(data, 0, nul),
        text: '(compressed)',
        compressed: true,
      });
    } else if (type === 'iTXt') {
      const nul = findNull(data, 0);
      const keyword = ascii(data, 0, nul);
      const rest = data.subarray(nul + 1);
      if (rest.length >= 2) {
        const compFlag = rest[0];
        const langEnd = findNull(rest, 2);
        const lang = ascii(rest, 2, langEnd);
        const trEnd = findNull(rest, langEnd + 1);
        const bodyStart = trEnd + 1;
        texts.push({
          keyword,
          text: compFlag === 1 ? '(compressed)' : decodeUtf8(rest, bodyStart, rest.length),
          compressed: compFlag === 1,
          language: lang || undefined,
        });
      }
    }
    pos += 12 + length;
    if (type === 'IEND') sawIend = true;
    if (chunks.length > 200) break; // 防御:超长 chunk 表截断
  }
  if (report.width === null && !report.error) report.error = 'PNG IHDR 缺失或损坏';
  report.pngChunks = chunks;
  report.textEntries = texts;
  if (!report.error) report.error = undefined;
  return report;
}

/** UTF-8 解码(TextDecoder 在 jsdom 与浏览器均可用的同步 API) */
function decodeUtf8(bytes: Uint8Array, start: number, end: number): string {
  try {
    return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
  } catch {
    return ascii(bytes, start, end);
  }
}

// —— JPEG ——

function parseJpeg(bytes: Uint8Array): ImageMetadataReport {
  const report = emptyReport('');
  report.format = 'jpeg';
  report.formatLabel = 'JPEG';
  report.exif = [];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      report.error = 'JPEG 段结构损坏(非 marker 对齐)';
      break;
    }
    const marker = bytes[pos + 1]!;
    // 无长度字段的 marker(填充字节 / SOI / EOI)
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9) break; // EOI
    const segLen = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (segLen < 2 || pos + 2 + segLen > bytes.length) {
      if (!report.error) report.error = 'JPEG 数据截断';
      break;
    }
    const seg = bytes.subarray(pos + 4, pos + 2 + segLen);
    // APP0 JFIF 密度
    if (marker === 0xe0 && seg.length >= 14 && ascii(seg, 0, 5) === 'JFIF\0') {
      const unit = seg[7]!;
      const x = (seg[8]! << 8) | seg[9]!;
      if (x > 0) {
        if (unit === 1) report.dpi = x;
        else if (unit === 2) report.dpi = Math.round(x * 2.54);
      }
    }
    // APP1 EXIF(Exif\0\0 前缀)
    if (marker === 0xe1 && seg.length > 6 && ascii(seg, 0, 6) === 'Exif\0\0') {
      try {
        report.exif.push(...parseTiff(seg.subarray(6)));
      } catch {
        // EXIF 段损坏不致命:保留已解析部分
      }
    }
    // SOF0/1/2/3/5/6/7/9/10/13/14/15:帧头
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (seg.length >= 6) {
        const h = (seg[1]! << 8) | seg[2]!;
        const w = (seg[3]! << 8) | seg[4]!;
        const comps = seg[5]!;
        report.width = w;
        report.height = h;
        report.colorInfo = `${comps} 分量`;
      }
    }
    // SOS(0xda)起是熵编码字节流,不再有段结构:元数据扫描到此为止
    if (marker === 0xda) break;
    pos += 2 + segLen;
  }
  if (report.width === null && !report.error) report.error = '未找到 JPEG 帧头(SOF)';
  if (!report.error) report.error = undefined;
  return report;
}

// —— TIFF(EXIF 载体,JPEG APP1 与 WebP EXIF chunk 共用) ——

/**
 * 解析 TIFF 结构为 EXIF 条目。
 * 支持 II/MM 双端序、IFD0 + ExifSubIFD(0x8769)一级嵌套;
 * Pillow 的 RATIONAL-as-LONG 宽容策略:type 4 且 cnt 2 按 num/den 渲染。
 */
function parseTiff(tiff: Uint8Array): ExifEntry[] {
  if (tiff.length < 8) throw new Error('TIFF 头过短');
  const endian = ascii(tiff, 0, 2);
  const le = endian === 'II';
  if (!le && endian !== 'MM') throw new Error('TIFF 端序标记非法');
  const dv = (offset: number, size: number) =>
    new DataView(tiff.buffer, tiff.byteOffset + offset, size);
  const ifd0Offset = dv(4, 4).getUint32(0, le);
  const entries: ExifEntry[] = [];
  const visited = new Set<number>(); // 防环:偏移只处理一次
  const readIfd = (ifdOff: number, depth: number): void => {
    if (depth > 2 || visited.has(ifdOff) || ifdOff + 2 > tiff.length) return;
    visited.add(ifdOff);
    const count = dv(ifdOff, 2).getUint16(0, le);
    if (count > 512) return; // 防御:条目数异常
    for (let i = 0; i < count; i++) {
      const eOff = ifdOff + 2 + i * 12;
      if (eOff + 12 > tiff.length) return;
      const e = dv(eOff, 12);
      const tag = e.getUint16(0, le);
      const type = e.getUint16(2, le);
      const cnt = e.getUint32(4, le);
      const name = EXIF_TAGS[tag];
      if (tag === 0x8769 && type === 4 && cnt === 1) {
        // ExifSubIFD 指针:递归一级
        readIfd(e.getUint32(8, le), depth + 1);
        continue;
      }
      if (!name || cnt === 0) continue;
      const value = renderTiffValue(tiff, le, type, cnt, tag, eOff + 8);
      if (value !== null)
        entries.push({ tag: `0x${tag.toString(16).padStart(4, '0')}`, name, value });
    }
    // 链式 IFD(同级下一目录):元数据场景一般不用,忽略
  };
  readIfd(ifd0Offset, 0);
  return entries;
}

/** TIFF 条目值渲染:按类型取数并转字符串,未知类型返回 null */
function renderTiffValue(
  tiff: Uint8Array,
  le: boolean,
  type: number,
  cnt: number,
  tag: number,
  valFieldOff: number,
): string | null {
  const dv = (offset: number, size: number) =>
    new DataView(tiff.buffer, tiff.byteOffset + offset, size);
  // 值区:总字节数 ≤ 4 内联,否则 valField 是相对 TIFF 起点的偏移
  const sizeOf = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4 }[type];
  if (!sizeOf || cnt > 1024) return null;
  const total = sizeOf * cnt;
  const inline = total <= 4;
  let dataOff: number;
  if (inline) {
    dataOff = valFieldOff;
  } else {
    const ptr = dv(valFieldOff, 4).getUint32(0, le);
    if (ptr + total > tiff.length) return null;
    dataOff = ptr;
  }
  if (type === 2) {
    // ASCII:去尾部 NUL
    let end = dataOff;
    const max = Math.min(dataOff + cnt, tiff.length);
    while (end < max && tiff[end] !== 0) end++;
    return decodeUtf8(tiff, dataOff, end);
  }
  if (type === 3) {
    const v = dv(dataOff, 2).getUint16(0, le);
    if (cnt === 2) {
      const v2 = dv(dataOff + 2, 2).getUint16(0, le);
      return `${v}/${v2}`; // SHORT 对(如 FNumber 打包)
    }
    // Orientation 附加旋转语义名
    if (tag === 0x0112 && ORIENTATION_NAMES[v]) return `${v} (${ORIENTATION_NAMES[v]})`;
    return String(v);
  }
  if (type === 4) {
    // Pillow 宽容项:LONG 对(cnt=2)按 num/den;单 LONG 直接数值
    if (cnt === 2) {
      const num = dv(dataOff, 4).getUint32(0, le);
      const den = dv(dataOff + 4, 4).getUint32(0, le);
      return `${num}/${den}`;
    }
    return String(dv(dataOff, 4).getUint32(0, le));
  }
  if (type === 5) {
    const num = dv(dataOff, 4).getUint32(0, le);
    const den = dv(dataOff + 4, 4).getUint32(0, le);
    return `${num}/${den}`;
  }
  if (type === 7) {
    return decodeUtf8(tiff, dataOff, Math.min(dataOff + cnt, tiff.length));
  }
  if (type === 1) {
    return cnt === 1 ? String(tiff[dataOff]) : `${cnt} bytes`;
  }
  if (type === 9) {
    return String(dv(dataOff, 4).getInt32(0, le));
  }
  return null;
}

// —— WebP ——

function parseWebp(bytes: Uint8Array): ImageMetadataReport {
  const report = emptyReport('');
  report.format = 'webp';
  report.formatLabel = 'WebP';
  report.exif = [];
  let pos = 12; // RIFF 头
  const end = Math.min(
    bytes.length,
    12 + ((bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) + 4),
  );
  let sawImageChunk = false;
  while (pos + 8 <= bytes.length && pos + 8 <= end + 7) {
    const fourcc = ascii(bytes, pos, pos + 4);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos + 4, 4);
    const len = dv.getUint32(0, true);
    if (len > bytes.length - pos - 8) {
      if (!report.error) report.error = 'WebP 数据截断(chunk 越界)';
      break;
    }
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (fourcc === 'VP8 ') {
      // 有损:帧 tag(3B)+ sync 9d012a(3B)+ 尺寸 4B(经验布局:
      // LE32 bits0-13 宽 / bits16-29 高,Pillow 夹具交叉验证)
      if (data.length >= 10 && ascii(data, 3, 6) === '\x9d\x01\x2a') {
        const dv2 = new DataView(data.buffer, data.byteOffset + 6, 4);
        const v = dv2.getUint32(0, true);
        report.width = v & 0x3fff;
        report.height = (v >>> 16) & 0x3fff;
        sawImageChunk = true;
      }
    } else if (fourcc === 'VP8L') {
      // 无损:首字节 sig 0x2F + LE32(低 14 位宽 | 高 14 位高 | alpha 1 | version 3)
      if (data.length >= 5 && data[0] === 0x2f) {
        const dv2 = new DataView(data.buffer, data.byteOffset + 1, 4);
        const v = dv2.getUint32(0, true);
        report.width = (v & 0x3fff) + 1;
        report.height = ((v >>> 14) & 0x3fff) + 1;
        report.transparency = ((v >>> 28) & 1) === 1;
        sawImageChunk = true;
      }
    } else if (fourcc === 'VP8X') {
      // 扩展格式:canvas 尺寸 = 3×24-bit LE(各减 1)
      if (data.length >= 10) {
        const w = 1 + (data[4]! | (data[5]! << 8) | (data[6]! << 16));
        const h = 1 + (data[7]! | (data[8]! << 8) | (data[9]! << 16));
        if (!sawImageChunk) {
          report.width = w;
          report.height = h;
        }
        if (data[0]! & 0x10) report.transparency = true; // alpha flag
      }
    } else if (fourcc === 'EXIF') {
      try {
        report.exif.push(...parseTiff(data));
      } catch {
        // EXIF chunk 损坏不致命
      }
    } else if (fourcc === 'ANMF') {
      // 动画帧:每帧一个 ANMF(展示帧数,尺寸以 VP8X 为准)
      report.frameCount = (report.frameCount ?? 0) + 1;
      report.animate = true;
    }
    // chunk 数据按偶数字节对齐:奇数长度补 1
    const padded = len + (len % 2);
    pos += 8 + padded;
  }
  if (report.width === null && !report.error) report.error = '未找到 WebP 图像数据(VP8/VP8L/VP8X)';
  if (!report.error) report.error = undefined;
  return report;
}

// —— GIF ——

function parseGif(bytes: Uint8Array): ImageMetadataReport {
  const report = emptyReport('');
  report.format = 'gif';
  report.formatLabel = 'GIF';
  const dv = (offset: number, size: number) =>
    new DataView(bytes.buffer, bytes.byteOffset + offset, size);
  if (bytes.length < 13) {
    report.error = 'GIF 头截断';
    return report;
  }
  report.width = dv(6, 2).getUint16(0, true);
  report.height = dv(8, 2).getUint16(0, true);
  const flags = bytes[10]!;
  const gctSize = flags & 0x80 ? 2 << (flags & 7) : 0;
  const bgIndex = bytes[11]!;
  report.interlaced = null;
  report.frameCount = 0;
  let gceTransparent = false;
  if (gctSize > 0 && 13 + bgIndex * 3 + 3 <= bytes.length && gctSize > bgIndex) {
    const r = bytes[13 + bgIndex * 3]!;
    const g = bytes[13 + bgIndex * 3 + 1]!;
    const b = bytes[13 + bgIndex * 3 + 2]!;
    report.backgroundColor = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  // 逐块扫描:扩展块(0x21)/图像描述符(0x2C)/结尾(0x3B)
  let pos = 13 + gctSize * 3;
  while (pos < bytes.length) {
    const b = bytes[pos]!;
    if (b === 0x3b) break;
    if (b === 0x21) {
      // 扩展:block id(1)+ 长度前缀子块串
      const label = bytes[pos + 1];
      pos += 2;
      if (label === 0xf9 && bytes[pos] === 4) {
        if ((bytes[pos + 1]! & 1) === 1) gceTransparent = true;
      }
      // 跳过子块串(每块:长度 N + N 字节,0 结束)
      while (pos < bytes.length && bytes[pos] !== 0) {
        pos += 1 + bytes[pos]!;
      }
      pos += 1;
    } else if (b === 0x2c) {
      report.frameCount = (report.frameCount ?? 0) + 1;
      if (pos + 10 > bytes.length) break;
      const descFlags = bytes[pos + 9]!;
      pos += 10;
      if (descFlags & 0x80) pos += 3 * (2 << (descFlags & 7)); // 局部色表
      if (pos < bytes.length) {
        pos += 1; // LZW 最小码长
        while (pos < bytes.length && bytes[pos] !== 0) {
          pos += 1 + bytes[pos]!;
        }
        pos += 1;
      } else {
        report.error = 'GIF 数据截断';
        break;
      }
    } else {
      // 未知块:无法安全前进,终止扫描(已得头部信息)
      break;
    }
  }
  report.animate = (report.frameCount ?? 0) > 1;
  report.transparency = gceTransparent;
  report.bitDepth = null;
  report.colorInfo = gctSize > 0 ? `全局色表 ${gctSize} 色` : '无全局色表';
  report.dpi = null;
  report.error = report.width === 0 || report.height === 0 ? 'GIF 尺寸为 0' : undefined;
  return report;
}

// —— BMP ——

const BMP_COMPRESSIONS: Record<number, string> = {
  0: 'BI_RGB',
  1: 'BI_RLE8',
  2: 'BI_RLE4',
  3: 'BI_BITFIELDS',
};

function parseBmp(bytes: Uint8Array): ImageMetadataReport {
  const report = emptyReport('');
  report.format = 'bmp';
  report.formatLabel = 'BMP';
  if (bytes.length < 54) {
    report.error = 'BMP 头截断';
    return report;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 54);
  const dibSize = dv.getUint32(14, true);
  if (dibSize < 40) {
    // BITMAPCOREHEADER(12B)不支持本工具范围
    report.error = `不支持的 DIB 头大小(${dibSize})`;
    return report;
  }
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const h = Math.abs(hRaw);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  report.width = w;
  report.height = h;
  report.bitDepth = bpp;
  const compName = BMP_COMPRESSIONS[compression] ?? `Unknown (${compression})`;
  report.colorInfo = `${compName} · ${hRaw < 0 ? '自顶向下' : '自底向上'}`;
  report.error = undefined;
  return report;
}

// —— 纯文本导出(UI 复制动作用) ——

/** 结构字段标签(全部由 UI 注入 i18n 文案) */
export interface ReportFieldLabels {
  fileName: string;
  fileSize: string;
  format: string;
  dimensions: string;
  bitDepth: string;
  color: string;
  dpi: string;
  interlaced: string;
  transparency: string;
  frames: string;
  background: string;
  error: string;
}

/** reportToText 的标签注入参数(节名 + 字段名,由 UI 传 i18n 文案) */
export interface ReportLabels {
  file: string;
  exif: string;
  text: string;
  chunks: string;
  fields: ReportFieldLabels;
}

/** 结构字段键值渲染回调(label, value) → 行文本 */
export type FieldRenderer = (label: string, value: string) => string;

/**
 * 报告 → 纯文本(复制动作用)。
 * 标签全部由调用方注入(i18n 文案),本函数只负责结构与拼装。
 */
export function reportToText(
  report: ImageMetadataReport & { fileName?: string; fileSize?: number },
  labels: ReportLabels,
  renderField: FieldRenderer,
): string {
  const f = labels.fields;
  const lines: string[] = [];
  if (report.fileName) lines.push(renderField(f.fileName, report.fileName));
  if (report.fileSize !== undefined) lines.push(renderField(f.fileSize, `${report.fileSize} B`));
  if (report.format !== 'unknown') {
    lines.push(renderField(f.format, report.formatLabel));
  }
  if (report.width !== null && report.height !== null) {
    lines.push(renderField(f.dimensions, `${report.width} × ${report.height}`));
  }
  if (report.bitDepth !== null) lines.push(renderField(f.bitDepth, String(report.bitDepth)));
  if (report.colorInfo) lines.push(renderField(f.color, report.colorInfo));
  if (report.dpi !== null) lines.push(renderField(f.dpi, String(report.dpi)));
  if (report.interlaced !== null) lines.push(renderField(f.interlaced, String(report.interlaced)));
  if (report.transparency !== null)
    lines.push(renderField(f.transparency, String(report.transparency)));
  if (report.frameCount !== null) lines.push(renderField(f.frames, String(report.frameCount)));
  if (report.backgroundColor) lines.push(renderField(f.background, report.backgroundColor));
  if (report.error) lines.push(renderField(f.error, report.error));
  if (report.exif.length > 0) {
    lines.push('', `${labels.exif}:`);
    for (const e of report.exif) lines.push(renderField(e.name, e.value));
  }
  if (report.textEntries.length > 0) {
    lines.push('', `${labels.text}:`);
    for (const t of report.textEntries) lines.push(renderField(t.keyword, t.text));
  }
  if (report.pngChunks.length > 0) {
    lines.push('', `${labels.chunks}:`);
    for (const c of report.pngChunks) lines.push(renderField(c.type, `${c.bytes} B`));
  }
  return lines.join('\n');
}
