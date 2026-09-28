/**
 * clipboard-files 单元测试:拖放取 files 原样列表;粘贴从 files + items
 * 收集命中 accept 的文件(截图/浏览器复制图片走 items,文本项跳过)。
 */
import { describe, it, expect } from 'vitest';
import { clipboardMediaFiles, isImageFile, isVideoFile, transferFiles } from './clipboard-files';

function png(name = 'a.png'): File {
  return new File([new Uint8Array([1])], name, { type: 'image/png' });
}

function txt(name = 'a.txt'): File {
  return new File(['x'], name, { type: 'text/plain' });
}

function asTransfer(partial: {
  files?: File[];
  items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
}): DataTransfer {
  return partial as unknown as DataTransfer;
}

describe('clipboard-files', () => {
  it('transferFiles 原样返回 files,空输入返回空数组', () => {
    const f = png();
    expect(transferFiles(asTransfer({ files: [f] }))).toEqual([f]);
    expect(transferFiles(null)).toEqual([]);
    expect(transferFiles(undefined)).toEqual([]);
  });

  it('isImageFile / isVideoFile 按 MIME 前缀判定', () => {
    expect(isImageFile(png())).toBe(true);
    expect(isImageFile(txt())).toBe(false);
    const mp4 = new File([new Uint8Array([1])], 'v.mp4', { type: 'video/mp4' });
    expect(isVideoFile(mp4)).toBe(true);
    expect(isVideoFile(png())).toBe(false);
  });

  it('粘贴 files 路径:只收集命中 accept 的', () => {
    const hit = clipboardMediaFiles(asTransfer({ files: [txt(), png()] }), isImageFile);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.name).toBe('a.png');
  });

  it('粘贴 items 路径(getAsFile):截图类位图可取,文本项跳过', () => {
    const shot = png('shot.png');
    const hit = clipboardMediaFiles(
      asTransfer({
        files: [],
        items: [
          { kind: 'string', type: 'text/plain', getAsFile: () => null },
          { kind: 'file', type: 'image/png', getAsFile: () => shot },
          { kind: 'file', type: 'image/png', getAsFile: () => null },
        ],
      }),
      isImageFile,
    );
    expect(hit).toEqual([shot]);
  });

  it('同一 File 在 files 与 items 各出现一次时去重', () => {
    const f = png();
    const hit = clipboardMediaFiles(
      asTransfer({
        files: [f],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => f }],
      }),
      isImageFile,
    );
    expect(hit).toEqual([f]);
  });

  it('空剪贴板返回空数组,调用方可直接放行', () => {
    expect(clipboardMediaFiles(null, isImageFile)).toEqual([]);
    expect(clipboardMediaFiles(asTransfer({ files: [], items: [] }), isImageFile)).toEqual([]);
  });
});
