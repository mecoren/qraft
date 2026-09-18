import { describe, expect, it } from 'vitest';
import { persistDelayFor } from './persist-debounce';

describe('persistDelayFor', () => {
  it('小载荷用短窗口尽快落盘', () => {
    expect(persistDelayFor(0)).toBe(500);
    expect(persistDelayFor(256 * 1024)).toBe(500);
  });

  it('百 KB 级拉到 2s,MB 级拉到 5s 以合并连续编辑', () => {
    expect(persistDelayFor(256 * 1024 + 1)).toBe(2000);
    expect(persistDelayFor(1024 * 1024)).toBe(2000);
    expect(persistDelayFor(1024 * 1024 + 1)).toBe(5000);
  });
});
