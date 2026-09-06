/**
 * PDF 渲染 —— pdfjs-dist 渲染器(worker 经 Vite `?url` 与 Web Worker 加载)
 *
 * 职责:
 * - `loadPdfDocument`:加载 base64 PDF 字节为 pdfjs 文档(解析页数/页元数据)。
 * - `renderPageToCanvas`:把指定页渲染进目标 canvas(按 CSS 尺寸 × dpr 缩放,
 *   锐利度对齐系统 PDF 阅读器)。
 * - `PdfPageRenderer`:受控渲染器:监听可见区滚动,只渲染进入视口附近(±1 屏)
 *   的页,滚出范围释放 canvas(大文档内存可控)。
 *
 * pdfjs v4 为纯 ESM(`pdfjs-dist/build/pdf.mjs`);动态 import 保证该模块
 * 仅在 PDF 工具挂载后加载(拆 chunk,不进首屏)。
 * standard_fonts / cmaps 资源由 Vite 静态拷贝进产物(见 copy-pdf-assets.mjs),
 * 以 `import.meta.url` 相对解析,WebView file:// 下可直达。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
// Vite ?url 导入:dev 下指向 node_modules 服务路径,构建时拷为静态资产
// (dist/assets/pdf.worker.min-*.mjs),两种环境均可经 fetch/Worker 加载
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** pdfjs 模块类型(动态加载;v4 ESM 入口) */
type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** 惰性加载 pdfjs(拆 chunk;worker/字体路径在此配置一次) */
export function getPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return mod;
  });
  return pdfjsPromise;
}

/** 加载 base64 PDF 为 pdfjs 文档;解析失败抛 pdfjs PasswordException / 错误 */
export async function loadPdfDocument(base64: string): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const bytes = base64ToUint8(base64);
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    // 标准 14 字体 + CJK 支持:目录型运行时资源(vite 的 closeBundle 钩子
    // 整目录拷至 dist/assets/pdf,见 vite.config.ts),保持 URL 原样交给
    // pdfjs 按需加载 —— @vite-ignore 告知 Vite 不做构建期资产解析
    standardFontDataUrl: new URL(
      /* @vite-ignore */ './assets/pdf/standard_fonts/',
      import.meta.url,
    ).toString(),
    cMapUrl: new URL(/* @vite-ignore */ './assets/pdf/cmaps/', import.meta.url).toString(),
    cMapPacked: true,
  });
  return task.promise;
}

/** 渲染一页到 canvas(按 CSS 像素 × dpr);返回实际渲染的 CSS 尺寸 */
export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  // 页 1pt = 1/72in;CSS 尺寸按宽度等比缩放
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width / dpr, height: viewport.height / dpr };
}

/**
 * 页尺寸索引:渲染前一次性抓取每页视口(宽高比),让 slot 在首渲染前就有
 * 正确高度 —— 千页文档滚动条不再从「全 400px」跳变到真实高度,
 * 也让二分定位可见窗口成为可能(页高先验已知)。
 * pdfjs 的 getPage 带 LRU 缓存,这里逐页 getPage 的成本远低于逐页渲染。
 */
export async function collectPageAspect(
  pdf: PDFDocumentProxy,
  pageCount: number,
): Promise<Array<{ width: number; height: number }>> {
  const aspects: Array<{ width: number; height: number }> = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdf.getPage(n);
    const v = page.getViewport({ scale: 1 });
    aspects.push({ width: v.width, height: v.height });
  }
  return aspects;
}

/**
 * 受控页渲染器:滚动容器内按可见性渲染/回收页 canvas。
 *
 * 页序模型:每页一个 slot(占位 div,高度由页尺寸索引 × 当前渲染宽度
 * 预置,首渲染前即准确);渲染时 canvas 填充 slot。视口附近
 * (± `preloadScreens` 屏)之外的页 canvas 释放为空,控制长文档内存。
 *
 * 千页文档优化:
 * - 页顶偏移前缀和 + 二分查找定位可见窗口,替代逐页 getBoundingClientRect
 *   全量扫描(1000+ 页时每次滚动省下上千次布局查询);
 * - 渲染并发上限(`maxConcurrent`),超出排队,避免同时发起几十个
 *   canvas 渲染把内存与 GPU 拉满;
 * - 滚动回调 rAF 合并,高频滚动事件不再逐次全量调度。
 */
export class PdfPageRenderer {
  private readonly pdf: PDFDocumentProxy;
  private readonly container: HTMLElement;
  /** 页 slot 元素(按页序) */
  private readonly slots: HTMLElement[];
  /** 已渲染页号 → canvas */
  private readonly rendered = new Map<number, HTMLCanvasElement>();
  /** 渲染中的页号(防并发重复渲染) */
  private readonly pending = new Set<number>();
  /** 等待渲染的页号队列(超出并发上限时排队) */
  private readonly queue: number[] = [];
  /** 每页顶边在文档流内的累计偏移(前缀和,px;与 slots 等长) */
  private readonly pageTops: number[];
  /** 渲染页宽(CSS 像素,所有页一致) */
  private readonly pageWidth: number;
  /** 页间隙(px;.pdf-pages 容器的 gap-4) */
  private static readonly PAGE_GAP = 16;
  private readonly preloadScreens = 1;
  /** 单帧内并发页渲染上限(排队队列按需续灌) */
  private readonly maxConcurrent = 4;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;

  /** 每页渲染完成后的回调(仅用于滚动定位等副作用,可为空) */
  onPageRendered: ((pageNumber: number) => void) | null = null;

  /**
   * @param pageAspects 页尺寸索引(collectPageAspects 产物);缺省时回退
   * 均一 A4 比例(1:1.414)—— 预计算失败时 UI 仍可用,只是高度略偏。
   */
  constructor(
    pdf: PDFDocumentProxy,
    container: HTMLElement,
    slots: HTMLElement[],
    pageWidth: number,
    pageAspects?: ReadonlyArray<{ width: number; height: number }>,
  ) {
    this.pdf = pdf;
    this.container = container;
    this.slots = slots;
    this.pageWidth = pageWidth;
    // 前缀和:第 i 页顶边 = Σ(前 i 页高 + gap) + 容器 padding(16)
    this.pageTops = new Array<number>(slots.length);
    let top = 16; // .pdf-pages 的 p-4 上内边距
    for (let i = 0; i < slots.length; i++) {
      this.pageTops[i] = top;
      const aspect = pageAspects?.[i];
      const height = aspect ? (aspect.height / aspect.width) * pageWidth : pageWidth * 1.414;
      // 初始占位高度立即置入 slot:首渲染前滚动条即准确
      slots[i].style.height = `${Math.round(height)}px`;
      top += Math.round(height) + PdfPageRenderer.PAGE_GAP;
    }
  }

  /** 二分定位:文档流 y 坐标所在的页序号(0-based;超出末页返回最后一页) */
  private pageAtOffset(y: number): number {
    const tops = this.pageTops;
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 滚动回调:rAF 合并多次滚动事件为一次可见性计算 */
  scheduleRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      void this.renderVisible();
    });
  }

  /** 立即渲染可见范围内的页(滚动/resize 事件调用) */
  async renderVisible(): Promise<void> {
    // 可见窗口由容器 scrollTop + pageTops 前缀和二分得出,
    // 不逐页查 getBoundingClientRect(千页文档的关键优化)
    const viewHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    const preload = viewHeight * (this.preloadScreens + 1);
    const first = this.pageAtOffset(scrollTop - preload);
    const last = this.pageAtOffset(scrollTop + viewHeight + preload);
    for (let i = first; i <= last && i < this.slots.length; i++) {
      const pageNumber = i + 1;
      if (this.rendered.has(pageNumber) || this.pending.has(pageNumber)) continue;
      if (this.queue.includes(pageNumber)) continue;
      if (this.pending.size >= this.maxConcurrent) {
        this.queue.push(pageNumber);
      } else {
        void this.renderPage(pageNumber, this.slots[i]);
      }
    }
    // 已渲染页滚出窗口:释放(canvas 显存/内存回收)
    for (const pageNumber of [...this.rendered.keys()]) {
      const idx = pageNumber - 1;
      if (idx < first || idx > last) this.releasePage(pageNumber);
    }
  }

  /** 渲染单页到 slot(canvas 以绝对定位填满 slot) */
  private async renderPage(pageNumber: number, slot: HTMLElement): Promise<void> {
    this.pending.add(pageNumber);
    try {
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.setAttribute('data-testid', `pdf-page-canvas-${pageNumber}`);
      // 渲染期间 slot 可能被滚出,先挂载再画,完成后视需要回收
      const { height } = await renderPageToCanvas(this.pdf, pageNumber, canvas, this.pageWidth);
      const slotRect = slot.getBoundingClientRect();
      // slot 尚未挂载或已卸载:丢弃本次渲染
      if (slotRect.width === 0 && slotRect.height === 0) return;
      // 渲染返回的 CSS 高度与预置高度同源(等比缩放),仅作校正回填
      slot.style.height = `${height}px`;
      this.rendered.set(pageNumber, canvas);
      slot.appendChild(canvas);
      this.onPageRendered?.(pageNumber);
    } catch (e) {
      // 单页渲染失败不中断整体;留空占位(背景白页)
      console.warn(`pdf render page ${pageNumber} failed:`, e);
    } finally {
      this.pending.delete(pageNumber);
      // 空出并发名额:从队列续灌下一页(仍可见时才会被渲染)
      const next = this.queue.shift();
      if (next !== undefined) {
        const idx = next - 1;
        if (idx >= 0 && idx < this.slots.length) {
          void this.renderPage(next, this.slots[idx]);
        }
      }
    }
  }

  /** 回收页 canvas(滚出预载范围时释放显存/内存) */
  private releasePage(pageNumber: number): void {
    const canvas = this.rendered.get(pageNumber);
    if (!canvas) return;
    canvas.remove();
    canvas.width = 0;
    canvas.height = 0;
    this.rendered.delete(pageNumber);
  }

  /** 容器宽度变化:重渲染全部已渲染页(rAF + 防抖) */
  scheduleRerenderAll(): void {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      for (const pageNumber of [...this.rendered.keys()]) this.releasePage(pageNumber);
      void this.renderVisible();
    }, 150);
  }

  /** 销毁:释放全部 canvas 与排队回调 */
  destroy(): void {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.queue.length = 0;
    for (const pageNumber of [...this.rendered.keys()]) this.releasePage(pageNumber);
  }
}

/** base64 → Uint8Array(与 pdfForm.ts 同策略;渲染侧独立实现避免循环依赖) */
function base64ToUint8(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
