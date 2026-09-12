/**
 * PDF 页面级操作 —— pdf-lib 页树操作封装(纯逻辑,便于单测)
 *
 * 职责:
 * - `parsePageRange`:解析 "1-3,5,8-" 形式的页码范围(逗号分隔;开区间
 *   补全到总页数;去重升序输出),供拆分/提取共用同一口径。
 * - `splitPages`:按范围提取页生成新 PDF(提取模式的底层实现)。
 * - `mergePdfs`:把多份 PDF 按给定顺序合并为一份。
 * - `extractPagesAsImages`:pdfjs 逐页渲染为 PNG 字节(转图片)。
 *
 * 设计说明:
 * - 页树操作走 pdf-lib 的 copyPages(保真复制页对象与资源),渲染
 *   (pdfjs)与修改(pdf-lib)各司其职,与 pdfForm/pdfOverlay 同构。
 * - 全部函数不触碰 UI / store;输入输出均为 base64 或 Uint8Array。
 */
import { PDFDocument } from 'pdf-lib';
import { loadPdfDocument } from './pdfRender';

/** base64 → 字节(与 pdfForm/pdfOverlay 同款本地实现) */
function base64ToUint8(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 字节 → base64(分块避免栈溢出) */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 解析页码范围表达式(逗号分隔的 `N` / `N-M` / `N-` / `-M` 段)。
 * 越界段截断到 [1, pageCount];空段忽略;输出去重升序页号数组。
 * 表达式整体为空 / 无有效段时返回 null(调用方走提示,不静默全选)。
 */
export function parsePageRange(expr: string, pageCount: number): number[] | null {
  const segments = expr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const pages = new Set<number>();
  for (const seg of segments) {
    const m = /^(\d*)(?:-(\d*))?$/.exec(seg);
    if (!m) return null; // 非法段令整体非法(如 "1-a")
    const rawStart = m[1] === '' ? undefined : Number(m[1]);
    const rawEnd = m[2] === undefined ? rawStart : m[2] === '' ? undefined : Number(m[2]);
    const start = Math.min(Math.max(rawStart ?? 1, 1), pageCount);
    const end = Math.min(Math.max(rawEnd ?? pageCount, 1), pageCount);
    if (start > end) return null; // 倒序段(如 "5-2")令整体非法
    for (let p = start; p <= end; p++) pages.add(p);
  }
  const list = [...pages].sort((a, b) => a - b);
  return list.length > 0 ? list : null;
}

/**
 * 按页号列表提取生成新 PDF(升序去重由 parsePageRange 保证;
 * 直接传入原始列表时此处再防御一次)。返回新文档 base64。
 */
export async function splitPages(base64: string, pageNumbers: readonly number[]): Promise<string> {
  const src = await PDFDocument.load(base64ToUint8(base64), {
    // 提取页资源跨文档复制需要 XObject 表;忽略加密元数据不阻断页复制
    ignoreEncryption: true,
  });
  const total = src.getPageCount();
  const indices = [
    ...new Set([...pageNumbers].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)),
  ].map((p) => p - 1);
  const out = await PDFDocument.create();
  // 由目标文档发起 copyPages(源页归属 src,反向 addPage 会触发 ForeignPageError)
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  const bytes = await out.save();
  return uint8ToBase64(bytes);
}

/**
 * 合并多份 PDF(按数组顺序);返回合并结果 base64。
 * 空数组抛错由调用方拦截,此处防御性返回与入参等长的文档数。
 */
export async function mergePdfs(base64List: readonly string[]): Promise<string> {
  if (base64List.length === 0) throw new Error('mergePdfs: empty input');
  const out = await PDFDocument.create();
  for (const base64 of base64List) {
    const src = await PDFDocument.load(base64ToUint8(base64), { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) out.addPage(page);
  }
  const bytes = await out.save();
  return uint8ToBase64(bytes);
}

export interface PdfImageRequest {
  /** 要渲染的页号(升序) */
  pageNumbers: readonly number[];
  /** 输出 CSS 宽度(像素);高度按页宽比自适应 */
  scale: number;
  /** 输出格式 */
  format: 'png' | 'jpeg';
  /** jpeg 质量(0-1;png 忽略) */
  quality?: number;
}

export interface PdfImageResult {
  pageNumber: number;
  format: 'png' | 'jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * 把指定页渲染为图片字节(pdfjs → canvas → blob)。
 * scale 为 1pt → CSS 像素系数(1 = 72dpi 原尺寸,2 = 144dpi 高清)。
 */
export async function extractPagesAsImages(
  base64: string,
  request: PdfImageRequest,
): Promise<PdfImageResult[]> {
  const pdf = await loadPdfDocument(base64);
  const results: PdfImageResult[] = [];
  try {
    for (const pageNumber of request.pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) continue;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: request.scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d context unavailable');
      if (request.format === 'jpeg') {
        // JPEG 无透明通道,先铺白底防止透明区域渲染成纯黑
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
          request.format === 'png' ? 'image/png' : 'image/jpeg',
          request.quality,
        );
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      results.push({
        pageNumber,
        format: request.format,
        bytes,
        width: canvas.width,
        height: canvas.height,
      });
    }
  } finally {
    void pdf.destroy();
  }
  return results;
}

/** 页号数组 → 展示文本("1-3, 5, 8" 折叠连续段) */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(start === end ? `${sorted[start]}` : `${sorted[start]}-${sorted[end]}`);
    start = end + 1;
  }
  return parts.join(', ');
}

export { base64ToUint8 as pagesBase64ToUint8, uint8ToBase64 as pagesUint8ToBase64 };
