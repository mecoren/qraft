/**
 * Markdown 图片资产模块测试
 *
 * resolveAssetImages:mdasset: 引用 → data URL 替换(命中缓存 / 读取失败占位 /
 * 无引用快路径);savePastedImage:IPC 保存 / 失败回退 data URL。
 * IPC 经 setup 的 mock invoke 注入。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savePastedImage, resolveAssetImages, bytesToBase64 } from './markdown-image-assets';

// mock @/lib/ipc 的 safeInvoke(测试 setup 已 mock @tauri-apps/api/core,
// 但 safeInvoke 的返回形状在此自控)
vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(),
}));

const { safeInvoke } = await import('@/lib/ipc');
const invokeMock = vi.mocked(safeInvoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('bytesToBase64', () => {
  it('编码字节数组(含多字节内容)', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(bytesToBase64(new Uint8Array([0xe4, 0xb8, 0xad]))).toBe('5Lit');
  });
});

describe('resolveAssetImages', () => {
  it('无 mdasset 引用时原样返回(零开销路径)', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: '' });
    const html = '<p>hello <img src="data:image/png;base64,xxx"></p>';
    await expect(resolveAssetImages(html)).resolves.toBe(html);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('mdasset 引用替换为 data URL 并缓存(第二次不再读盘)', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, value: 'QUJD' });
    const html = '<img src="mdasset:img-abc.png">';
    const first = await resolveAssetImages(html);
    expect(first).toBe('<img src="data:image/png;base64,QUJD">');

    // 第二次调用(缓存命中)不应再发 IPC
    const second = await resolveAssetImages(html);
    expect(second).toBe(first);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('资产读取失败时替换为占位(不阻塞渲染)', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'boom' } });
    const out = await resolveAssetImages('<img src="mdasset:img-missing.png">');
    expect(out).toContain('data-md-blocked-src="mdasset:img-missing.png"');
  });
});

describe('savePastedImage', () => {
  it('IPC 保存成功时返回 mdasset 引用', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, value: 'img-new.png' });
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    const result = await savePastedImage(file);
    expect(result?.persisted).toBe(true);
    expect(result?.markdown).toBe('![image](mdasset:img-new.png)');
  });

  it('IPC 失败时回退 data URL 内联(persisted=false)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('no ipc'));
    const file = new File([new Uint8Array([104, 105])], 'shot.png', { type: 'image/png' });
    const result = await savePastedImage(file);
    expect(result?.persisted).toBe(false);
    expect(result?.markdown).toContain('![image](data:image/png;base64,');
  });

  it('非白名单类型返回 null', async () => {
    const file = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });
    await expect(savePastedImage(file)).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
