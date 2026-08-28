import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeLineDiff } from './diff-utils';
import type { LineDiffResult } from './diff-utils';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff.worker';

// 捕获型 FakeWorker:记录构造参数与 postMessage 内容,测试里手工派发 onmessage
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: DiffWorkerResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  sent: DiffWorkerRequest[] = [];
  constructor(
    public url: URL | string,
    public opts?: { type?: string },
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: DiffWorkerRequest): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('diff-service', () => {
  // 只保存/恢复 Worker 这一个 stub:vi.unstubAllGlobals() 会连 setup.ts 注入的
  // 内存 localStorage/sessionStorage 一起撤掉,导致全局 afterEach 崩溃
  const originalWorker = globalThis.Worker;
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.stubGlobal('Worker', originalWorker);
  });

  it('小输入走同步快路径,不创建 Worker,结果与 computeLineDiff 一致', async () => {
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const result = await service.compute('a\nb\nc\n', 'a\nX\nc\n', true);
    expect(result.stats).toEqual(computeLineDiff('a\nb\nc\n', 'a\nX\nc\n', { includeWordDiff: true }).stats);
    expect(FakeWorker.instances).toHaveLength(0);
    service.dispose();
  });

  it('大输入经 Worker 计算:请求带单调 id,响应按 id 路由解析', async () => {
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const bigA = `${'x'.repeat(40_000)}\nend`;
    const bigB = `${'y'.repeat(40_000)}\nend`;
    const expected = computeLineDiff(bigA, bigB, { includeWordDiff: false });
    const pending = service.compute(bigA, bigB, false);
    // Worker 惰性创建,首个大请求触发
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.opts?.type).toBe('module');
    expect(worker.sent).toHaveLength(1);
    const req = worker.sent[0];
    expect(req.id).toBe(1);
    worker.onmessage!({ data: { id: req.id, result: expected } });
    await expect(pending).resolves.toBe(expected);
    service.dispose();
  });

  it('乱序响应按各自 id 正确解析,不串包', async () => {
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const bigA = `${'x'.repeat(40_000)}\nend`;
    const bigB = `${'y'.repeat(40_000)}\nend`;
    const p1 = service.compute(bigA, bigB, false);
    const p2 = service.compute(bigB, bigA, false);
    const worker = FakeWorker.instances[0];
    expect(worker.sent.map((m) => m.id)).toEqual([1, 2]);
    const r2 = computeLineDiff(bigB, bigA, { includeWordDiff: false });
    const r1 = computeLineDiff(bigA, bigB, { includeWordDiff: false });
    // 先回 2 再回 1
    worker.onmessage!({ data: { id: 2, result: r2 } });
    worker.onmessage!({ data: { id: 1, result: r1 } });
    await expect(p1).resolves.toBe(r1);
    await expect(p2).resolves.toBe(r2);
    service.dispose();
  });

  it('dispose 终止 Worker,后续 compute 可重建', async () => {
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const big = 'z'.repeat(40_000);
    const p1 = service.compute(big, `${big}!`, false);
    const worker = FakeWorker.instances[0];
    service.dispose();
    expect(worker.terminated).toBe(true);
    // dispose 后新请求重建 Worker(jsdiff 兜底解析前先验证重建)
    const p2 = service.compute(big, `${big}?`, false);
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].onmessage!({
      data: { id: FakeWorker.instances[1].sent[0].id, result: computeLineDiff(big, `${big}?`, { includeWordDiff: false }) },
    });
    await expect(p2).resolves.toBeDefined();
    void p1;
  });

  it('Worker 构造失败(如资源加载失败)时同步降级,功能不缺失', async () => {
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error('worker unavailable');
      }
    });
    const { createDiffService } = await import('./diff-service');
    const service = createDiffService();
    const bigA = 'x'.repeat(40_000);
    const result = await service.compute(bigA, `${bigA}!`, false);
    expect(result.stats).toEqual(computeLineDiff(bigA, `${bigA}!`, { includeWordDiff: false }).stats);
    service.dispose();
  });
});

describe('isSmallDiff 阈值', () => {
  it('任一侧超过阈值即为大输入', async () => {
    const { isSmallDiff, DIFF_SYNC_MAX_CHARS } = await import('./diff-service');
    expect(DIFF_SYNC_MAX_CHARS).toBeGreaterThan(0);
    expect(isSmallDiff('', '')).toBe(true);
    expect(isSmallDiff('a'.repeat(DIFF_SYNC_MAX_CHARS), '')).toBe(true);
    expect(isSmallDiff('a'.repeat(DIFF_SYNC_MAX_CHARS + 1), '')).toBe(false);
  });
});

// 类型层面引用,防止 LineDiffResult 结构漂移导致 worker 协议失配
export type { LineDiffResult };
