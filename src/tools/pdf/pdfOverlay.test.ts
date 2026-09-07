import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyOverlays, hexToRgb, type OverlayItem } from './pdfOverlay';

function uint8ToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('hexToRgb', () => {
  it('#RRGGBB 正常解析', () => {
    const c = hexToRgb('#ff0000');
    expect(c.red).toBeCloseTo(1);
    expect(c.green).toBe(0);
    expect(c.blue).toBe(0);
  });

  it('非法输入回退黑色', () => {
    const c = hexToRgb('not-a-color');
    expect(c.red).toBe(0);
    expect(c.green).toBe(0);
    expect(c.blue).toBe(0);
  });
});

describe('applyOverlays(归一化坐标契约)', () => {
  it('叠加对象写回后 PDF 仍可解析且页数不变', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]); // letter 尺寸(pt)
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    // 归一化坐标:比例 0~1,不再需要 scale 参数
    const items: OverlayItem[] = [
      { id: 'ov-1', kind: 'text', page: 1, x: 0.1, y: 0.2, text: 'Hello', fontSize: 0.02 },
      {
        id: 'ov-2',
        kind: 'highlight',
        page: 2,
        x: 0.05,
        y: 0.1,
        text: '',
        width: 0.2,
        height: 0.03,
      },
      { id: 'ov-3', kind: 'strike', page: 1, x: 0.03, y: 0.05, text: '', width: 0.1, height: 0.02 },
    ];
    const { base64: out, errors } = await applyOverlays(base64, items);
    expect(errors).toEqual([]);
    const re = await PDFDocument.load(b64ToUint8(out));
    expect(re.getPageCount()).toBe(2);
  });

  it('归一化坐标与渲染宽度无关:不同页尺寸写回均成功且不改变页面几何', async () => {
    // 缩放错位修复的核心保证:同一比例坐标不再依赖任何渲染宽度(旧实现的
    // scale 基于挂接时刻渲染宽,缩放后过期);写回只乘各页自身 pt 尺寸
    const items: OverlayItem[] = [
      {
        id: 'ov-h',
        kind: 'highlight',
        page: 1,
        x: 0.3,
        y: 0.4,
        text: '',
        width: 0.2,
        height: 0.05,
      },
      { id: 'ov-t', kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'Hi', fontSize: 0.02 },
    ];
    for (const size of [
      [595.28, 841.89] as [number, number], // A4
      [744.1, 1052.36] as [number, number], // A4 ×1.25(模拟 zoom 125% 下的更大渲染基准)
    ]) {
      const doc = await PDFDocument.create();
      doc.addPage(size);
      const base64 = uint8ToB64(await doc.save());
      const { base64: out, errors } = await applyOverlays(base64, items);
      expect(errors).toEqual([]);
      const re = await PDFDocument.load(b64ToUint8(out));
      expect(re.getPageCount()).toBe(1);
      const { width, height } = re.getPage(0).getSize();
      expect(width).toBeCloseTo(size[0]);
      expect(height).toBeCloseTo(size[1]);
    }
  });

  it('页号越界的对象计入 errors 而不失败', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    const bad: OverlayItem[] = [{ id: 'ov-x', kind: 'text', page: 99, x: 0, y: 0, text: 'x' }];
    const { errors } = await applyOverlays(base64, bad);
    expect(errors).toHaveLength(1);
  });

  it('超出字体覆盖的文本条目跳过并报错(其余条目正常写入)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    const items: OverlayItem[] = [
      { id: 'ov-cjk', kind: 'text', page: 1, x: 0.02, y: 0.02, text: '你好' },
      { id: 'ov-latin', kind: 'text', page: 1, x: 0.02, y: 0.1, text: 'Hello' },
    ];
    const { base64: out, errors } = await applyOverlays(base64, items);
    // jsdom fetch 不可用 → 回退 Helvetica,中文条目被跳过并计入 errors
    expect(errors.some((e) => e.includes('ov-cjk'))).toBe(true);
    const re = await PDFDocument.load(b64ToUint8(out));
    expect(re.getPageCount()).toBe(1);
  });
});
