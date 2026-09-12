import { describe, expect, it, vi } from 'vitest';
import { batchSummary, makeBatchItems, runBatch, type BatchItem } from './image-batch';

/** jsdom File 桩(makeBatchItems 只读 name/size) */
function fakeFile(name: string, size: number): File {
  return { name, size } as unknown as File;
}

describe('makeBatchItems', () => {
  it('按传入顺序生成 pending 项', () => {
    const items = makeBatchItems([fakeFile('a.png', 10), fakeFile('b.png', 20)]);
    expect(items).toHaveLength(2);
    expect(items[0].file.name).toBe('a.png');
    expect(items.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(items[1].inputBytes).toBe(20);
    expect(items[0].id).not.toBe(items[1].id);
  });
});

describe('runBatch', () => {
  it('串行推进 pending→running→done;失败项标 error 不中断', async () => {
    const items = makeBatchItems([
      fakeFile('a.png', 100),
      fakeFile('b.png', 50),
      fakeFile('c.png', 10),
    ]);
    const run = vi.fn(async (item: BatchItem) => {
      if (item.file.name === 'b.png') throw new Error('boom');
      return { outputBytes: 10, download: () => {}, result: null };
    });
    const out = await runBatch(items, { run, onUpdate: () => {}, shouldStop: () => false });

    expect(out[0].status).toBe('done');
    expect(out[0].outputBytes).toBe(10);
    expect(out[1].status).toBe('error');
    expect(out[1].error).toBe('boom');
    expect(out[2].status).toBe('done');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('shouldStop 中止:剩余项保持 pending', async () => {
    const items = makeBatchItems([fakeFile('a.png', 1), fakeFile('b.png', 1)]);
    let executed = 0;
    const out = await runBatch(items, {
      run: async () => {
        executed++;
        return { outputBytes: 1, download: () => {}, result: null };
      },
      onUpdate: () => {},
      // 已执行过 1 项后即要求停止(第二项开始前探针返回 true)
      shouldStop: () => executed >= 1,
    });
    expect(out[0].status).toBe('done');
    expect(out[1].status).toBe('pending');
    expect(executed).toBe(1);
  });

  it('onUpdate 每项推进两次(running 与终态)', async () => {
    const items = makeBatchItems([fakeFile('a.png', 1)]);
    const updates: number[] = [];
    await runBatch(items, {
      run: async () => ({ outputBytes: 1, download: () => {}, result: null }),
      onUpdate: (cur) => updates.push(cur.length),
      shouldStop: () => false,
    });
    expect(updates).toEqual([1, 1]);
  });
});

describe('batchSummary', () => {
  it('分桶统计与累计节省', () => {
    const items = [
      { status: 'done', inputBytes: 100, outputBytes: 40 } as unknown as BatchItem,
      { status: 'done', inputBytes: 50, outputBytes: 60 } as unknown as BatchItem, // 变大
      { status: 'error', inputBytes: 10, outputBytes: null } as unknown as BatchItem,
      { status: 'pending', inputBytes: 5, outputBytes: null } as unknown as BatchItem,
    ];
    const s = batchSummary(items);
    expect(s.done).toBe(2);
    expect(s.error).toBe(1);
    expect(s.pending).toBe(1);
    // 100-40 + 50-60 = 50
    expect(s.totalSaved).toBe(50);
  });
});
