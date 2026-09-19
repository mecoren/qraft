/**
 * fileOps 写盘的「文件已消失」契约测试
 *
 * 锁定 `saveToPathEncoded` 与后端 `fs_write_file_encoded` 的错误码分工:
 * - `ERR_FILE_MODIFIED`(磁盘被外部改写)不重试——交给冲突三选对话框
 * - `ERR_FILE_NOT_FOUND`(文件打开后被外部删除)带基准必然存不上,去掉基准
 *   重试一次即由后端原子写在原路径重建,返回 `recreated` 供调用方换提示语
 * 不重试的那条同样要紧:无基准时写盘本就是创建语义,再失败就是真故障。
 *
 * mock 的是 `@/lib/ipc` 的 `invokeCommand`(保留 CommandError 真实类定义),
 * 故参数名断言即前端 → 后端的真实命名契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipc')>();
  return { ...actual, invokeCommand: vi.fn(), safeInvoke: vi.fn() };
});

import { CommandError, invokeCommand } from '@/lib/ipc';
import { saveToPathEncoded } from './fileOps';

const invokeMock = invokeCommand as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('saveToPathEncoded', () => {
  it('正常写盘:透传 expectedMtime 基准并返回 written', async () => {
    invokeMock.mockResolvedValueOnce(true);

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x', 'utf-8', 1000)).resolves.toBe('written');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('fs_write_file_encoded', {
      path: 'C:/dev/a.txt',
      content: 'x',
      encoding: 'utf-8',
      expectedMtime: 1000,
    });
  });

  it('缺省编码与无基准:encoding 落 utf-8、expectedMtime 落 null', async () => {
    invokeMock.mockResolvedValueOnce(true);

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x')).resolves.toBe('written');

    expect(invokeMock).toHaveBeenCalledWith('fs_write_file_encoded', {
      path: 'C:/dev/a.txt',
      content: 'x',
      encoding: 'utf-8',
      expectedMtime: null,
    });
  });

  it('文件已被外部删除:去掉基准重试一次并在原路径重建', async () => {
    invokeMock
      .mockRejectedValueOnce(new CommandError('ERR_FILE_NOT_FOUND', 'file not found'))
      .mockResolvedValueOnce(true);

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x', 'utf-8', 1000)).resolves.toBe('recreated');

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('fs_write_file_encoded', {
      path: 'C:/dev/a.txt',
      content: 'x',
      encoding: 'utf-8',
      expectedMtime: null,
    });
  });

  it('外部改写冲突(ERR_FILE_MODIFIED)不重试', async () => {
    invokeMock.mockRejectedValueOnce(
      new CommandError('ERR_FILE_MODIFIED', 'modified since opened', { mtimeMs: 9 }),
    );

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x', 'utf-8', 1000)).rejects.toThrow(
      'modified since opened',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('无基准时的失败一律直抛(写盘本就是创建语义)', async () => {
    invokeMock.mockRejectedValueOnce(new CommandError('ERR_FILE_NOT_FOUND', 'gone'));

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x', 'utf-8')).rejects.toThrow('gone');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('重建重试再失败:抛出重试的错误,不吞成成功', async () => {
    invokeMock
      .mockRejectedValueOnce(new CommandError('ERR_FILE_NOT_FOUND', 'gone'))
      .mockRejectedValueOnce(new CommandError('ERR_FILE_IO', 'parent dir missing'));

    await expect(saveToPathEncoded('C:/dev/a.txt', 'x', 'utf-8', 1000)).rejects.toThrow(
      'parent dir missing',
    );
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
