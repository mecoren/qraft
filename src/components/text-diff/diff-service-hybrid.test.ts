/**
 * 混合调度单测 —— createDiffService 的 Monaco 优先 / jsdiff 兜底语义。
 *
 * monaco-diff-service 按模块 mock(成功/失败可控),不断言原生算法本身
 * (见 monaco-diff-mapper.test.ts),只验证路由:原生成功即采用,失败即
 * 回退且功能不缺失。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMonacoDiffService } from './monaco-diff-service';
import type { ComputeLineDiffOptions, LineDiffResult } from './diff-utils';

vi.mock('./monaco-diff-service', () => ({
  createMonacoDiffService: vi.fn(),
  // 强制走 Monaco 分支,验证成功采用 / 失败回退两条路由
  isMonacoDiffUsable: vi.fn().mockReturnValue(true),
}));

const mockedCreate = vi.mocked(createMonacoDiffService);

function fakeResult(marker: number): LineDiffResult {
  return {
    stats: { added: marker, removed: 0, modified: 0 },
    originalDecos: [],
    modifiedDecos: [{ line: marker, wordSpans: [] }],
    blocks: [{ origStart: null, origEnd: null, modStart: marker, modEnd: marker }],
    degraded: false,
    similarity: 0.5,
  };
}

describe('createDiffService 混合调度', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  it('Monaco 成功时直接采用原生结果', async () => {
    const expected = fakeResult(7);
    mockedCreate.mockReturnValue({
      compute: vi.fn().mockResolvedValue(expected),
      dispose: vi.fn(),
    });
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const options: ComputeLineDiffOptions = { includeWordDiff: true };
    await expect(service.compute('a\n', 'a\nb\n', options)).resolves.toBe(expected);
    expect(mockedCreate().compute).toHaveBeenCalledWith('a\n', 'a\nb\n', options);
    service.dispose();
  });

  it('Monaco 失败时回退 jsdiff,结果与 computeLineDiff 一致', async () => {
    mockedCreate.mockReturnValue({
      compute: vi.fn().mockRejectedValue(new Error('monaco unavailable')),
      dispose: vi.fn(),
    });
    const { createDiffService } = await import('./diff-service');
    const { computeLineDiff } = await import('./diff-utils');
    const service = createDiffService();
    const result = await service.compute('a\nb\nc\n', 'a\nX\nc\n', { includeWordDiff: true });
    expect(result.stats).toEqual(
      computeLineDiff('a\nb\nc\n', 'a\nX\nc\n', { includeWordDiff: true }).stats,
    );
    service.dispose();
  });

  it('dispose 会同时释放原生与兜底两侧资源', async () => {
    const monacoDispose = vi.fn();
    mockedCreate.mockReturnValue({
      compute: vi.fn().mockRejectedValue(new Error('nope')),
      dispose: monacoDispose,
    });
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    service.dispose();
    expect(monacoDispose).toHaveBeenCalledTimes(1);
  });
});
