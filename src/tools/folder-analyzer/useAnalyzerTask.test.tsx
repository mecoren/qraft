import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeInvoke = vi.fn();
vi.mock('@/lib/ipc', () => ({ safeInvoke: (...a: unknown[]) => safeInvoke(...a) }));

let emitted: Array<(e: unknown) => void> = [];
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_ev: string, cb: (e: unknown) => void) => {
    emitted.push(cb);
    return () => {
      emitted = emitted.filter((f) => f !== cb);
    };
  }),
}));

import { useAnalyzerTask } from './useAnalyzerTask';

function fire(payload: Record<string, unknown>) {
  for (const cb of emitted) cb({ payload });
}

describe('useAnalyzerTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitted = [];
  });

  it('transitions idle→running→done', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 'task-1' });
    const { result } = renderHook(() => useAnalyzerTask());

    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    expect(result.current.state.status).toBe('running');

    act(() => fire({ taskId: 'task-1', output: { extra: { total_files: 3 } } }));
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect((result.current.state.result as { total_files: number }).total_files).toBe(3);
  });

  it('runs file mode via sync tool_execute and lands done directly', async () => {
    // 回归:file 模式曾被发往流式端点,而 Rust 端流式仅支持 scan/search
    safeInvoke.mockResolvedValue({ ok: true, value: { text: 'a.md:文本', extra: { is_text: true } } });
    const { result } = renderHook(() => useAnalyzerTask());

    await act(async () => {
      await result.current.run({ filePath: 'C:/a.md', mode: 'file' });
    });

    expect(safeInvoke).toHaveBeenCalledWith('tool_execute', {
      toolId: 'folder_analyzer',
      input: { file_path: 'C:/a.md', params: { mode: 'file' } },
    });
    expect(result.current.state.status).toBe('done');
    expect((result.current.state.result as { is_text: boolean }).is_text).toBe(true);
  });

  it('surfaces file mode sync failure', async () => {
    safeInvoke.mockResolvedValue({ ok: false, error: { code: 'ERR_FILE_IO', message: 'too large' } });
    const { result } = renderHook(() => useAnalyzerTask());
    await act(async () => {
      await result.current.run({ filePath: 'C:/big.bin', mode: 'file' });
    });
    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toContain('too large');
  });

  it('ignores stale task events', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 'task-a' });
    const { result } = renderHook(() => useAnalyzerTask());
    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    act(() => fire({ taskId: 'task-stale', error: { message: 'boom' } }));
    expect(result.current.state.status).toBe('running');
  });

  it('surfaces start failure without running', async () => {
    safeInvoke.mockResolvedValue({ ok: false, error: { code: 'ERR_X', message: 'denied' } });
    const { result } = renderHook(() => useAnalyzerTask());
    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toContain('denied');
  });
});
