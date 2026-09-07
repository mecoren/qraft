/**
 * PDF 叠加编辑逻辑 —— pdf-lib 在原页上方绘制编辑层(纯逻辑,便于单测)
 *
 * 「编辑 PDF」在本工具的落地口径:对既有 PDF 的**增量叠加**——在原页面
 * 指定坐标绘制文本/便签/矩形(高亮)/删除线,不重组页面结构、不改动原内容
 * 流(即 pdf-lib 的增量保存语义,原文件内容对象保持只读引用)。
 *
 * 坐标系:UI 记录**归一化比例**(page-space):x/width/fontSize 相对页宽,
 * y/height 相对页高,取值 0~1。缩放(zoom)或容器 resize 只改变渲染宽度,
 * 比例坐标天然免换算——这是缩放错位修复的关键:坐标不再绑定放置时刻的
 * 绝对像素。写回时乘以 PDF 页尺寸(pt)得到用户空间坐标(原点左下)。
 *
 * 文本绘制:内置标准字体 Helvetica(WinAnsi 拉丁覆盖,零额外体积)。
 * 值含中文等超出覆盖的字符时该条目跳过并计入 errors(用户可改用高亮/删除
 * 线表达;嵌入 CJK 字库需携带数十 MB 字体,明确不纳入 v1,边界在 UI 报错
 * 消息中可见)。
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

/** 叠加对象类型 */
export type OverlayKind = 'text' | 'note' | 'highlight' | 'strike';

/** 单个叠加对象(UI 状态;坐标为页内归一化比例 0~1) */
export interface OverlayItem {
  id: string;
  kind: OverlayKind;
  /** 1-based 页号 */
  page: number;
  /** 左上角 x(相对页宽的比例 0~1) */
  x: number;
  /** 左上角 y(相对页高的比例 0~1) */
  y: number;
  /** text: 文本内容;note: 便签文字 */
  text: string;
  /** 字号(text;相对页宽的比例) */
  fontSize?: number;
  /** 高亮/删除线的宽高(相对页宽/页高的比例) */
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
 * 坐标为归一化比例,按各页自身尺寸换算为 pt(CSS y 自页顶向下 →
 * PDF y 自页底向上:pdfY = pageHeight - ratioY * pageHeight - h)。
 */
export async function applyOverlays(
  base64: string,
  items: readonly OverlayItem[],
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
      drawOverlay(page, font, item);
    } catch (e) {
      errors.push(`${item.kind}#${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 叠加不涉及表单,关闭 save 的内置表单外观重建(与本模块无关且可能因
  // 原表单值含 CJK 抛错)
  const bytes = await doc.save({ updateFieldAppearances: false });
  return { base64: uint8ToBase64(bytes), errors };
}

/** 在单页上绘制一个叠加对象(归一化比例 → 各页 pt 坐标);文本先探测可编码性 */
function drawOverlay(
  page: ReturnType<PDFDocument['getPages']>[number],
  font: PDFFont,
  item: OverlayItem,
): void {
  const { width: pageW, height: pageH } = page.getSize();
  const color = hexToRgb(item.color ?? DEFAULT_OVERLAY_COLORS[item.kind]);
  const x = item.x * pageW;
  if (item.kind === 'text' || item.kind === 'note') {
    // fontSize 相对页宽:字号 pt = ratio * pageW(与 UI 端 ratio * slotW 同源)
    const fontSize = (item.fontSize ?? 0.02) * pageW;
    // 可编码性探测:中文等超出字体覆盖时本条目跳过(per-item catch 兜底)
    font.encodeText(item.text);
    // 文本基线(自页顶):y 比例 + 0.8 字号;字号纵向偏移在 pt 系按页宽换算
    const baselineFromTop = item.y * pageH + fontSize * 0.8;
    page.drawText(item.text, {
      x,
      y: pageH - baselineFromTop,
      size: fontSize,
      font,
      color,
    });
    return;
  }
  const w = (item.width ?? 0.2) * pageW;
  const h = (item.height ?? 0.03) * pageH;
  if (item.kind === 'highlight') {
    page.drawRectangle({
      x,
      y: pageH - item.y * pageH - h,
      width: w,
      height: h,
      color,
      opacity: 0.35,
    });
    return;
  }
  // strike:删除线横杠(矩形窄条),以矩形纵向中心为线位
  const strikeH = Math.max(h * 0.08, 1.2);
  page.drawRectangle({
    x,
    y: pageH - item.y * pageH - h / 2,
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
