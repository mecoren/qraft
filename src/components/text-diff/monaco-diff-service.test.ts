/**
 * monaco-diff-service 环境门控单测 —— 真实模块,不 mock。
 *
 * jsdom 下无真实 Monaco(isMonacoDiffUsable 同步短路),compute 必须快速
 * reject(混合调度随即回退 jsdiff);本文件只锁定该契约,不测原生算法
 * (见 monaco-diff-mapper.test.ts)。
 */
import { describe, expect, it } from 'vitest';
import { createMonacoDiffService, isMonacoDiffUsable } from './monaco-diff-service';

describe('monaco-diff-service 环境门控', () => {
  it('jsdom 下判定为不可用(避免 loader.init 空等拖慢单测)', () => {
    expect(isMonacoDiffUsable()).toBe(false);
  });

  it('不可用时 compute 直接 reject,不挂起', async () => {
    const service = createMonacoDiffService();
    await expect(service.compute('a\n', 'b\n', {})).rejects.toThrow();
    service.dispose();
  });
});
