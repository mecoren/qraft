import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, downloadText, downloadTsv } from './file-utils';

/**
 * downloadCsv / downloadTsv / downloadText 下载链路:
 * - CSV/TSV 出口必须前置 UTF-8 BOM,Excel 双击打开中文不乱码
 * - 其余文本下载不掺 BOM,保持字节精确
 * 不 mock Blob:捕获传给 createObjectURL 的真实 blob,读 text() 验编码内容
 */

let clickSpy: ReturnType<typeof vi.fn>;
let createdBlobs: Blob[];
const realCreateElement = document.createElement.bind(document);

beforeEach(() => {
  clickSpy = vi.fn();
  createdBlobs = [];
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() !== 'a') return realCreateElement(tagName as never);
    const el = realCreateElement('div') as unknown as Record<string, unknown>;
    el['click'] = clickSpy;
    return el as unknown as HTMLAnchorElement;
  }) as unknown as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(((b: Blob | MediaSource) => {
    createdBlobs.push(b as Blob);
    return 'blob:mock';
  }) as unknown as typeof URL.createObjectURL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 读 blob 为 ArrayBuffer(jsdom 的 text() 会剥开头 BOM,须按字节断言) */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((ab) => new Uint8Array(ab));
}

describe('downloadCsv', () => {
  it('blob 内容前置 UTF-8 BOM 且 MIME 为 text/csv', async () => {
    downloadCsv('converted.csv', '名称,数量\r\n中文,1');

    expect(createdBlobs).toHaveLength(1);
    const blob = createdBlobs[0]!;
    expect(blob.type).toContain('text/csv');
    const bytes = await blobBytes(blob);
    // 头三字节即 UTF-8 BOM EF BB BF,其后为原文的 UTF-8 编码
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('名称,数量\r\n中文,1');
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('downloadTsv', () => {
  it('blob 内容前置 UTF-8 BOM 且 MIME 为 tab-separated-values', async () => {
    downloadTsv('table.tsv', '名称\t数量\r\n中文\t1');

    const blob = createdBlobs[0]!;
    expect(blob.type).toContain('text/tab-separated-values');
    const bytes = await blobBytes(blob);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('名称\t数量\r\n中文\t1');
  });
});

describe('downloadText', () => {
  it('普通文本下载不掺 BOM', async () => {
    downloadText('a.txt', 'hello', 'text/plain');

    const bytes = await blobBytes(createdBlobs[0]!);
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(clickSpy).toHaveBeenCalled();
  });
});
