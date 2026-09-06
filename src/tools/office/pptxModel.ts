/**
 * PowerPoint(pptx/pptm)简易渲染器 —— 基于 jszip 解析 OOXML
 *
 * 简易只读预览,目标是「能看」而非像素级还原:
 * - 幻灯片尺寸:presentation.xml 的 sldSz(EMU → px,1px = 9525 EMU)
 * - 每页:ppt/slides/slideN.xml 的文本段落(sp → p → r → t 文本节点)
 * - 图片:ppt/media/ 内资源经 ZIP 内联 data URL 展示(仅做封面式展示,
 *   不做定位还原;图形/图表/艺术字不支持)
 *
 * 设计取舍:pptx-preview 等库拉入 echarts/lodash 等重依赖(数 MB),
 * 远超「简易功能」的体积预算;自研 ~200 行解析已覆盖文本 + 图片的核心
 * 信息提取,失败时兜底提示「预览受限」。
 */
import JSZip from 'jszip';

/** 单个文本段落(一次换行单位;p 文本节点拼接) */
export interface SlideParagraph {
  text: string;
}

/** 单张幻灯片的模型 */
export interface SlideModel {
  /** 段落列表(保持文档顺序;空段落保留空行) */
  paragraphs: SlideParagraph[];
  /** 本页引用的图片 data URL(按 rId 顺序;仅图片信息,不定位) */
  images: string[];
}

/** 整个演示文稿的模型 */
export interface PptxModel {
  /** 幻灯片画布尺寸(逻辑像素) */
  width: number;
  height: number;
  slides: SlideModel[];
}

/** EMU(English Metric Unit)→ CSS px:1px = 9525 EMU */
const EMU_PER_PX = 9525;

/** XML 文本节点解析:DOMParser 系浏览器内置,无需 sanitize(仅提取文本) */
function xmlText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('invalid XML in pptx part');
  }
  return doc.documentElement.textContent ?? '';
}

/** 从 slide XML 提取段落:遍历 <a:p> 段落,拼接内层 <a:t> 文本 */
function extractParagraphs(slideXml: string): SlideParagraph[] {
  const paragraphs: SlideParagraph[] = [];
  const doc = new DOMParser().parseFromString(slideXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('invalid slide XML');
  }
  const pNodes = Array.from(doc.getElementsByTagNameNS('*', 'p'));
  for (const p of pNodes) {
    const ts = Array.from(p.getElementsByTagNameNS('*', 't'));
    // <a:p> 是 drawing 命名空间下的段落;过滤掉误命中的其它 p 元素
    if (ts.length === 0) {
      if (p.namespaceURI?.includes('drawingml') && p.localName === 'p')
        paragraphs.push({ text: '' });
      continue;
    }
    paragraphs.push({ text: ts.map((t) => t.textContent ?? '').join('') });
  }
  return paragraphs;
}

/** 提取 slide 的图片 rId 列表并解析为 data URL */
async function extractImages(slideXml: string, relXml: string, zip: JSZip): Promise<string[]> {
  const relDoc = new DOMParser().parseFromString(relXml, 'application/xml');
  const rels = Array.from(relDoc.getElementsByTagName('Relationship'));
  const imageTargets = rels
    .filter((r) => (r.getAttribute('Type') ?? '').includes('/image'))
    .map((r) => r.getAttribute('Target') ?? '');
  if (imageTargets.length === 0) return [];

  // slide 内 <a:blip r:embed="rId3"> 引用顺序(决定展示顺序)
  const slideDoc = new DOMParser().parseFromString(slideXml, 'application/xml');
  const embeds = Array.from(slideDoc.getElementsByTagNameNS('*', 'blip'))
    .map((b) => b.getAttributeNS('*', 'embed') ?? '')
    .filter(Boolean);

  const byRid = new Map<string, string>();
  for (const rel of rels) {
    const id = rel.getAttribute('Id') ?? '';
    const target = rel.getAttribute('Target') ?? '';
    const type = rel.getAttribute('Type') ?? '';
    if (type.includes('/image')) byRid.set(id, target);
  }

  const orderedTargets = embeds.map((rid) => byRid.get(rid)).filter(Boolean) as string[];
  const targets = orderedTargets.length > 0 ? orderedTargets : imageTargets;

  const images: string[] = [];
  for (const target of targets) {
    // Target 形如 ../media/image1.png(slide 目录相对),统一归一化到 ppt/ 根
    const norm = target.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
    const entry = zip.file(`ppt/${norm}`) ?? zip.file(norm);
    if (!entry) continue;
    const base64 = await entry.async('base64');
    const ext = norm.split('.').pop()?.toLowerCase() ?? 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    images.push(`data:${mime};base64,${base64}`);
  }
  return images;
}

/**
 * 解析 pptx 字节为演示文稿模型。
 * 解析失败(非法 ZIP / 缺 presentation.xml)抛 Error,由调用方展示错误态。
 */
export async function parsePptx(bytes: Uint8Array): Promise<PptxModel> {
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file('ppt/presentation.xml');
  if (!presFile) throw new Error('missing ppt/presentation.xml');
  const presXml = await presFile.async('text');

  // 幻灯片尺寸:sldSz 的 cx/cy 属性(EMU)
  let width = 960;
  let height = 540;
  const sldSz = new DOMParser()
    .parseFromString(presXml, 'application/xml')
    .getElementsByTagName('sldSz')[0];
  if (sldSz) {
    const cx = Number(sldSz.getAttribute('cx') ?? '0');
    const cy = Number(sldSz.getAttribute('cy') ?? '0');
    if (cx > 0 && cy > 0) {
      width = Math.round(cx / EMU_PER_PX);
      height = Math.round(cy / EMU_PER_PX);
    }
  }

  // 依据 sldIdLst 的 r:id 顺序映射 slide 文件名(presentation.xml.rels)
  const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presRelsFile) throw new Error('missing presentation rels');
  const presRelsXml = await presRelsFile.async('text');
  const relDoc = new DOMParser().parseFromString(presRelsXml, 'application/xml');
  const relsById = new Map<string, string>();
  for (const rel of Array.from(relDoc.getElementsByTagName('Relationship'))) {
    relsById.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
  }

  const presDoc = new DOMParser().parseFromString(presXml, 'application/xml');
  const slideTargets = Array.from(presDoc.getElementsByTagName('sldId'))
    .map((s) => s.getAttributeNS('*', 'id') ?? '')
    .map((rid) => relsById.get(rid) ?? '')
    .filter(Boolean)
    .map((target) => target.replace(/^\/+/, ''))
    .map((target) => (target.startsWith('ppt/') ? target : `ppt/${target}`));

  // 兜底:rels 顺序缺失时按 slideN.xml 数字序
  if (slideTargets.length === 0) {
    const names: string[] = [];
    zip.forEach((relPath) => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(relPath);
      if (m) names.push(relPath);
    });
    names.sort((a, b) => {
      const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
      return na - nb;
    });
    slideTargets.push(...names);
  }

  const slides: SlideModel[] = [];
  for (const slidePath of slideTargets) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const slideXml = await slideFile.async('text');
    // 关系文件:ppt/slides/_rels/slideN.xml.rels
    const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const relsFile = zip.file(relsPath);
    const relsXml = relsFile ? await relsFile.async('text') : '<Relationships/>';
    const paragraphs = extractParagraphs(slideXml);
    const images = await extractImages(slideXml, relsXml, zip);
    slides.push({ paragraphs, images });
  }

  if (slides.length === 0) throw new Error('no slides found');
  return { width, height, slides };
}

export { xmlText };
