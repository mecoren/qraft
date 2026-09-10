/**
 * fileOps 文件本地历史三包装的 IPC 契约测试
 *
 * 锁定 `listFileHistory` / `readFileHistorySnapshot` / `clearFileHistory`
 * 与 Rust 侧 `fs_file_history_list/get/clear` 的契约(参数名经
 * `invokeCommand` 透传、返回值口径):
 * - list:参数 `{ path }`,返回元数据数组直通(新→旧由后端排序)
 * - get:参数 `{ path, snapshotId }`(camelCase,由 `invokeCommand`
 *   统一转 snake_case),base64 返回值经 UTF-8 解码为文本
 * - clear:参数 `{ path }`,resolve 即成功(后端返回 void)
 *
 * mock 的是 `@/lib/ipc` 的 `invokeCommand`,因此参数名断言即前端→后端
 * 的真实命名契约(IPC 参数白名单在 Rust 命令签名,拼写漂移在运行期
 * 才暴露——本测试让它在 CI 就红)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  safeInvoke: vi.fn(),
}));

import { invokeCommand } from '@/lib/ipc';
import { clearFileHistory, listFileHistory, readFileHistorySnapshot } from './fileOps';

const invokeCommandMock = invokeCommand as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeCommandMock.mockReset();
});

describe('listFileHistory', () => {
  it('经 fs_file_history_list 传 { path } 并直通元数据数组', async () => {
    const meta = [
      { id: '4000', savedAtMs: 4_000, originalBytes: 10 },
      { id: '2000', savedAtMs: 2_000, originalBytes: 5 },
    ];
    invokeCommandMock.mockResolvedValueOnce(meta);

    await expect(listFileHistory('C:/dev/a.ts')).resolves.toEqual(meta);

    expect(invokeCommandMock).toHaveBeenCalledWith('fs_file_history_list', {
      path: 'C:/dev/a.ts',
    });
  });

  it('无历史时后端返回空数组,包装原样透传', async () => {
    invokeCommandMock.mockResolvedValueOnce([]);

    await expect(listFileHistory('C:/dev/b.ts')).resolves.toEqual([]);

    expect(invokeCommandMock).toHaveBeenCalledWith('fs_file_history_list', {
      path: 'C:/dev/b.ts',
    });
  });
});

describe('readFileHistorySnapshot', () => {
  it('经 fs_file_history_get 传 { path, snapshotId },base64 解码为 UTF-8 文本', async () => {
    // "旧内容 v1"(含中文)的 UTF-8 base64,锁定「字节级往返」口径
    invokeCommandMock.mockResolvedValueOnce('5pen5YaF5a65IHYx');

    await expect(readFileHistorySnapshot('C:/dev/a.ts', '4000')).resolves.toBe('旧内容 v1');

    expect(invokeCommandMock).toHaveBeenCalledWith('fs_file_history_get', {
      path: 'C:/dev/a.ts',
      snapshotId: '4000',
    });
  });
});

describe('clearFileHistory', () => {
  it('经 fs_file_history_clear 传 { path },resolve 即成功', async () => {
    invokeCommandMock.mockResolvedValueOnce(null);

    await expect(clearFileHistory('C:/dev/a.ts')).resolves.toBeUndefined();

    expect(invokeCommandMock).toHaveBeenCalledWith('fs_file_history_clear', {
      path: 'C:/dev/a.ts',
    });
  });
});
