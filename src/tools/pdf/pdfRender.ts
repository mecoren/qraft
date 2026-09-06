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
 * 受控页渲染器:滚动容器内按可见性渲染/回收页 canvas。
 *
 * 页序模型:每页一个 slot(占位 div,高度按页元数据预置);渲染时 canvas
 * 填充 slot。视口附近(± `preloadScreens` 屏)之外的页 canvas 释放为空,
 * 控制长文档内存。
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
  /** 渲染页宽(CSS 像素,所有页一致) */
  private readonly pageWidth: number;
  private readonly preloadScreens = 1;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 每页渲染完成后的回调(仅用于滚动定位等副作用,可为空) */
  onPageRendered: ((pageNumber: number) => void) | null = null;

  constructor(
    pdf: PDFDocumentProxy,
    container: HTMLElement,
    slots: HTMLElement[],
    pageWidth: number,
  ) {
    this.pdf = pdf;
    this.container = container;
    this.slots = slots;
    this.pageWidth = pageWidth;
  }

  /** 按当前滚动位置渲染可见范围内的页(滚动/resize 事件调用) */
  scheduleRender(): void {
    void this.renderVisible();
  }

  /** 立即渲染可见范围内的页 */
  async renderVisible(): Promise<void> {
    const containerRect = this.container.getBoundingClientRect();
    const preload = containerRect.height * (this.preloadScreens + 1);
    for (let i = 0; i < this.slots.length; i++) {
      const pageNumber = i + 1;
      const slotRect = this.slots[i].getBoundingClientRect();
      const visible =
        slotRect.bottom > containerRect.top - preload &&
        slotRect.top < containerRect.bottom + preload;
      if (visible && !this.rendered.has(pageNumber) && !this.pending.has(pageNumber)) {
        void this.renderPage(pageNumber, this.slots[i]);
      } else if (!visible && this.rendered.has(pageNumber)) {
        this.releasePage(pageNumber);
      }
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
      const { height } = await renderPageToCanvas(
        this.pdf,
        pageNumber,
        canvas,
        this.pageWidth,
      );
      const slotRect = slot.getBoundingClientRect();
      // slot 尚未挂载或已卸载:丢弃本次渲染
      if (slotRect.width === 0 && slotRect.height === 0) return;
      slot.style.height = `${height}px`;
      this.rendered.set(pageNumber, canvas);
      slot.appendChild(canvas);
      this.onPageRendered?.(pageNumber);
    } catch (e) {
      // 单页渲染失败不中断整体;留空占位(背景白页)
      console.warn(`pdf render page ${pageNumber} failed:`, e);
    } finally {
      this.pending.delete(pageNumber);
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
      for (const pageNumber of this.rendered.keys()) this.releasePage(pageNumber);
      void this.renderVisible();
    }, 150);
  }

  /** 销毁:释放全部 canvas */
  destroy(): void {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
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
