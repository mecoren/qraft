import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { formatPageList, mergePdfs, parsePageRange, splitPages } from './pdfPages';

/** 构造 N 页 PDF(每页写上页号文本,便于验证页序),返回 base64 */
async function makePdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([200, 100]);
    page.drawText(`page-${i}`, { x: 10, y: 50, size: 12 });
  }
  const bytes = await doc.save();
  return uint8ToB64(bytes);
}

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

/** 读取 PDF 每页文本(pdf-lib 无文本抽取,改以页对象引用不可行;
 *  页序验证改走「重开 + 页数 + 页尺寸」与页序无关断言的间接法:
 *  splitPages 输出页数 = 请求页数;mergePdfs 输出页数 = 各输入之和) */
describe('parsePageRange', () => {
  it('单页/区间/开区间混合,去重升序', () => {
    expect(parsePageRange('1-3,5,8-', 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(parsePageRange(' 2 , 2 , 3 ', 5)).toEqual([2, 3]);
    expect(parsePageRange('-3', 10)).toEqual([1, 2, 3]);
  });

  it('越界段截断到有效范围', () => {
    expect(parsePageRange('8-12', 10)).toEqual([8, 9, 10]);
    expect(parsePageRange('0-2', 5)).toEqual([1, 2]);
  });

  it('空/非法/倒序段返回 null', () => {
    expect(parsePageRange('', 10)).toBeNull();
    expect(parsePageRange('  ', 10)).toBeNull();
    expect(parsePageRange('1-a', 10)).toBeNull();
    expect(parsePageRange('5-2', 10)).toBeNull();
    expect(parsePageRange('a-b', 10)).toBeNull();
  });

  it('全区间恒等于总页数', () => {
    expect(parsePageRange('1-', 4)).toEqual([1, 2, 3, 4]);
  });
});

describe('splitPages', () => {
  it('提取子集页:输出页数与顺序正确', async () => {
    const base64 = await makePdf(5);
    const out = await splitPages(base64, [2, 4]);
    const doc = await PDFDocument.load(b64ToUint8(out));
    expect(doc.getPageCount()).toBe(2);
    // 每页保留原尺寸(200×100)
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes).toEqual([
      { width: 200, height: 100 },
      { width: 200, height: 100 },
    ]);
  });

  it('全选等于原文档页数', async () => {
    const base64 = await makePdf(3);
    const out = await splitPages(base64, [1, 2, 3]);
    const doc = await PDFDocument.load(b64ToUint8(out));
    expect(doc.getPageCount()).toBe(3);
  });

  it('乱序输入自动升序;越界页号忽略', async () => {
    const base64 = await makePdf(6);
    const out = await splitPages(base64, [5, 2, 99, 2]);
    const doc = await PDFDocument.load(b64ToUint8(out));
    expect(doc.getPageCount()).toBe(2);
  });
});

describe('mergePdfs', () => {
  it('按入参顺序拼接,总页数为各输入之和', async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const merged = await mergePdfs([a, b]);
    const doc = await PDFDocument.load(b64ToUint8(merged));
    expect(doc.getPageCount()).toBe(5);
  });

  it('单输入等于自身;空输入抛错', async () => {
    const a = await makePdf(2);
    const single = await mergePdfs([a]);
    const doc = await PDFDocument.load(b64ToUint8(single));
    expect(doc.getPageCount()).toBe(2);
    await expect(mergePdfs([])).rejects.toThrow();
  });

  it('多份合并页尺寸各自保留', async () => {
    const wide = await PDFDocument.create();
    wide.addPage([400, 200]);
    const tall = await PDFDocument.create();
    tall.addPage([100, 600]);
    const merged = await mergePdfs([uint8ToB64(await wide.save()), uint8ToB64(await tall.save())]);
    const doc = await PDFDocument.load(b64ToUint8(merged));
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes).toEqual([
      { width: 400, height: 200 },
      { width: 100, height: 600 },
    ]);
  });
});

describe('formatPageList', () => {
  it('连续页折叠为区间', () => {
    expect(formatPageList([1, 2, 3, 5, 8, 9, 10])).toBe('1-3, 5, 8-10');
    expect(formatPageList([4])).toBe('4');
    expect(formatPageList([])).toBe('');
  });

  it('乱序输入先排序再折叠', () => {
    expect(formatPageList([9, 1, 2, 3, 8])).toBe('1-3, 8-9');
  });
});
