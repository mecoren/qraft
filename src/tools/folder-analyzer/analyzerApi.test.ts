import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
const safeInvoke = vi.fn();
const listeners = new Map<string, Array<(p: unknown) => void>>();

vi.mock('@/lib/ipc', () => ({
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
  safeInvoke: (...a: unknown[]) => safeInvoke(...a),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (p: unknown) => void) => {
    const arr = listeners.get(event) ?? [];
    arr.push(cb);
    listeners.set(event, arr);
    return () => {
      const cur = listeners.get(event) ?? [];
      cur.splice(cur.indexOf(cb), 1);
    };
  }),
}));

import { authorizeDropped, startAnalyzerTask, subscribeTaskEvents } from './analyzerApi';

function emit(event: string, payload: unknown) {
  for (const cb of listeners.get(event) ?? []) cb(payload);
}

describe('analyzerApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('authorizeDropped returns kinds from backend', async () => {
    invokeCommand.mockResolvedValue([
      { path: 'C:/x', kind: 'dir' },
      { path: 'C:/x/a.txt', kind: 'file' },
    ]);
    const out = await authorizeDropped(['C:/x']);
    expect(invokeCommand).toHaveBeenCalledWith('fs_authorize_dropped_paths', { paths: ['C:/x'] });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('dir');
  });

  it('startAnalyzerTask passes mode into params', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 't' });
    await startAnalyzerTask({ filePath: 'C:/x', mode: 'search', options: { pattern: 'p' } });
    expect(safeInvoke).toHaveBeenCalledWith('tool_execute_stream', {
      toolId: 'folder_analyzer',
      filePath: 'C:/x',
      text: undefined,
      params: { mode: 'search', pattern: 'p' },
    });
  });

  it('subscribeTaskEvents routes only matching taskId and unsubscribes all', async () => {
    const done = vi.fn();
    const un = await subscribeTaskEvents('t1', { onDone: done });
    emit('tool_completed', { payload: { taskId: 'other', output: {} } });
    expect(done).not.toHaveBeenCalled();
    emit('tool_completed', { payload: { taskId: 't1', output: { ok: 1 } } });
    expect(done).toHaveBeenCalledWith({ ok: 1 });
    await un();
    expect(listeners.get('tool_completed')).toHaveLength(0);
  });

  it('forwards progress numbers', async () => {
    const onProgress = vi.fn();
    await subscribeTaskEvents('t2', { onProgress });
    emit('tool_progress', {
      payload: { taskId: 't2', percent: 0, message: '已扫描 12 文件', processed: 12, total: 0 },
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ processed: 12 }));
  });
});
