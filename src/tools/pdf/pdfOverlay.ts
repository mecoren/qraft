/**
 * PDF 叠加编辑逻辑 —— pdf-lib 在原页上方绘制编辑层(纯逻辑,便于单测)
 *
 * 「编辑 PDF」在本工具的落地口径:对既有 PDF 的**增量叠加**——在原页面
 * 指定坐标绘制文本/便签/矩形(高亮)/删除线,不重组页面结构、不改动原内容
 * 流(即 pdf-lib 的增量保存语义,原文件内容对象保持只读引用)。
 *
 * 坐标系:UI 记录 CSS 像素(page-space,渲染视口同系);写入时换算回
 * PDF 用户空间(原点左下、单位 pt)。缩放系数 scale = pdfWidth / cssWidth。
 *
 * 文本绘制:内置标准字体 Helvetica(WinAnsi 拉丁覆盖,零额外体积)。
 * 值含中文等超出覆盖的字符时该条目跳过并计入 errors(用户可改用高亮/删除
 * 线表达;嵌入 CJK 字库需携带数十 MB 字体,明确不纳入 v1,边界在 UI 报错
 * 消息中可见)。
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

/** 叠加对象类型 */
export type OverlayKind = 'text' | 'note' | 'highlight' | 'strike';

/** 单个叠加对象(UI 状态;坐标为页内 CSS 像素) */
export interface OverlayItem {
  id: string;
  kind: OverlayKind;
  /** 1-based 页号 */
  page: number;
  /** 左上角 x(CSS px,页内坐标系) */
  x: number;
  /** 左上角 y(CSS px,页内坐标系) */
  y: number;
  /** text: 文本内容;note: 便签文字 */
  text: string;
  /** 字号(text;CSS px 度量) */
  fontSize?: number;
  /** 高亮/删除线的宽高(CSS px) */
  width?: number;
  height?: number;
  /** 16 进制颜色(#RRGGBB);缺省按类型默认色 */
  color?: string;
}

/** 文档全部叠加对象(store 持久化单元) */
export type OverlayState = Record<string, OverlayItem[]>; // docId → items

/** 各类型默认颜色 */
export const DEFAULT_OVERLAY_COLORS: Record<OverlayKind, string> = {
  text: '#1f2937',
  note: '#f59e0b',
  highlight: '#fde047',
  strike: '#ef4444',
};

/** 16 进制颜色 → pdf-lib rgb(非法输入回退黑色) */
export function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  const n = Number.parseInt(m[1], 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/**
 * 把叠加对象写回 PDF 字节(覆盖保存的核心步骤)。
 * 单个对象绘制失败跳过并计入 errors(畸形页号等),不让整次保存失败。
 *
 * `scale` 为「PDF 页宽 pt / 渲染 CSS 宽 px」,由渲染层测得;
 * CSS y(自页顶向下)→ PDF y(自页底向上):pdfY = pageHeight - cssY*scale - h。
 */
export async function applyOverlays(
  base64: string,
  items: readonly OverlayItem[],
  scale: number,
): Promise<{ base64: string; errors: string[] }> {
  const doc = await PDFDocument.load(base64ToUint8(base64));
  // 内置标准字体(WinAnsi 拉丁);不可编码条目由 per-item catch 兜底报错
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const errors: string[] = [];
  for (const item of items) {
    const page = pages[item.page - 1];
    if (!page) {
      errors.push(`page ${item.page}: 不存在`);
      continue;
    }
    try {
      drawOverlay(page, font, item, scale);
    } catch (e) {
      errors.push(`${item.kind}#${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 叠加不涉及表单,关闭 save 的内置表单外观重建(与本模块无关且可能因
  // 原表单值含 CJK 抛错)
  const bytes = await doc.save({ updateFieldAppearances: false });
  return { base64: uint8ToBase64(bytes), errors };
}

/** 在单页上绘制一个叠加对象(页内坐标系换算);文本先探测可编码性 */
function drawOverlay(
  page: ReturnType<PDFDocument['getPages']>[number],
  font: PDFFont,
  item: OverlayItem,
  scale: number,
): void {
  const { height: pageH } = page.getSize();
  const color = hexToRgb(item.color ?? DEFAULT_OVERLAY_COLORS[item.kind]);
  const x = item.x * scale;
  if (item.kind === 'text' || item.kind === 'note') {
    const fontSize = (item.fontSize ?? 14) * scale;
    // 可编码性探测:中文等超出字体覆盖时本条目跳过(per-item catch 兜底)
    font.encodeText(item.text);
    const baselineCss = item.y + (item.fontSize ?? 14) * 0.8;
    page.drawText(item.text, {
      x,
      y: pageH - baselineCss * scale,
      size: fontSize,
      font,
      color,
    });
    return;
  }
  const w = (item.width ?? 80) * scale;
  const h = (item.height ?? 20) * scale;
  const rectY = pageH - (item.y + h) * scale;
  if (item.kind === 'highlight') {
    page.drawRectangle({ x, y: rectY, width: w, height: h, color, opacity: 0.35 });
    return;
  }
  // strike:删除线横杠(矩形窄条)
  const strikeH = Math.max(h * 0.08, 1.2);
  page.drawRectangle({
    x,
    y: pageH - (item.y + h / 2) * scale,
    width: w,
    height: strikeH,
    color,
    opacity: 0.85,
  });
}

function base64ToUint8(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
