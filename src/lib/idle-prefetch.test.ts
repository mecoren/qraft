import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 模块级 `scheduled` 幂等标志需要每个用例拿到全新模块实例,
 * 故统一经 vi.resetModules + 动态 import 获取被测对象。
 */
async function freshModule(): Promise<typeof import('./idle-prefetch')> {
  vi.resetModules();
  return import('./idle-prefetch');
}

describe('scheduleIdlePrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('延迟到期后执行一次 loader', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const mod = await freshModule();
    mod.scheduleIdlePrefetch({ dev: false, delayMs: 1000, loaders: [loader] });
    expect(loader).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    // 兜底路径:requestIdleCallback 不可用时走 200ms setTimeout
    await vi.advanceTimersByTimeAsync(300);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('重复调度幂等(只跑一次)', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const mod = await freshModule();
    mod.scheduleIdlePrefetch({ dev: false, delayMs: 0, loaders: [loader] });
    mod.scheduleIdlePrefetch({ dev: false, delayMs: 0, loaders: [loader] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('dev 模式直接短路,不注册任何定时器', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const mod = await freshModule();
    mod.scheduleIdlePrefetch({ dev: true, delayMs: 0, loaders: [loader] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loader).not.toHaveBeenCalled();
  });

  it('loader 抛错不冒泡(rejected promise 被吞掉)', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('boom'));
    const mod = await freshModule();
    mod.scheduleIdlePrefetch({ dev: false, delayMs: 0, loaders: [loader] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(loader).toHaveBeenCalled();
  });
});
