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

describe('applyOverlays', () => {
  it('叠加对象写回后 PDF 仍可解析且页数不变', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]); // letter 尺寸(pt)
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    const scale = 612 / 600; // 渲染宽 600px 时的换算系数
    const items: OverlayItem[] = [
      { id: 'ov-1', kind: 'text', page: 1, x: 40, y: 80, text: 'Hello', fontSize: 14 },
      { id: 'ov-2', kind: 'highlight', page: 2, x: 20, y: 30, text: '', width: 100, height: 16 },
      { id: 'ov-3', kind: 'strike', page: 1, x: 10, y: 10, text: '', width: 60, height: 14 },
    ];
    const { base64: out, errors } = await applyOverlays(base64, items, scale);
    expect(errors).toEqual([]);
    const re = await PDFDocument.load(b64ToUint8(out));
    expect(re.getPageCount()).toBe(2);
  });

  it('页号越界的对象计入 errors 而不失败', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    const bad: OverlayItem[] = [{ id: 'ov-x', kind: 'text', page: 99, x: 0, y: 0, text: 'x' }];
    const { errors } = await applyOverlays(base64, bad, 1);
    expect(errors).toHaveLength(1);
  });

  it('超出字体覆盖的文本条目跳过并报错(其余条目正常写入)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base64 = uint8ToB64(await doc.save());
    const items: OverlayItem[] = [
      { id: 'ov-cjk', kind: 'text', page: 1, x: 10, y: 10, text: '你好' },
      { id: 'ov-latin', kind: 'text', page: 1, x: 10, y: 60, text: 'Hello' },
    ];
    const { base64: out, errors } = await applyOverlays(base64, items, 1);
    // jsdom fetch 不可用 → 回退 Helvetica,中文条目被跳过并计入 errors
    expect(errors.some((e) => e.includes('ov-cjk'))).toBe(true);
    const re = await PDFDocument.load(b64ToUint8(out));
    expect(re.getPageCount()).toBe(1);
  });
});
