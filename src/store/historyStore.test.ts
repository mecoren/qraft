import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useHistoryStore } from './historyStore';
import type { HistoryEntry } from '@/types/history';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const sampleEntry: HistoryEntry = {
  id: 'h1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T08:00:00Z',
  inputSummary: { textPreview: '{}', textBytes: 2, params: {}, redacted: false },
  outputSummary: { textPreview: '{}', textBytes: 2, redacted: false },
  success: true,
  durationMs: 5,
};

beforeEach(() => {
  invokeMock.mockReset();
  useHistoryStore.setState({ entries: [], loading: false, error: null });
});

describe('historyStore.loadHistory', () => {
  it('loads entries with default limit 100', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: [sampleEntry],
    } satisfies CommandResponse<HistoryEntry[]>);
    await useHistoryStore.getState().loadHistory();
    expect(invokeMock).toHaveBeenCalledWith('history_list', { limit: 100 });
    expect(useHistoryStore.getState().entries).toHaveLength(1);
  });

  it('respects custom limit argument', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: [] });
    await useHistoryStore.getState().loadHistory(20);
    expect(invokeMock).toHaveBeenCalledWith('history_list', { limit: 20 });
  });

  it('sets error when invoke fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await useHistoryStore.getState().loadHistory();
    expect(useHistoryStore.getState().error).toContain('boom');
    expect(useHistoryStore.getState().entries).toEqual([]);
  });
});

describe('historyStore.clearHistory', () => {
  it('calls history_clear and empties entries on success', async () => {
    useHistoryStore.setState({ entries: [sampleEntry] });
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useHistoryStore.getState().clearHistory();
    expect(invokeMock).toHaveBeenCalledWith('history_clear', {});
    expect(useHistoryStore.getState().entries).toEqual([]);
  });

  it('keeps entries on failure and sets error', async () => {
    useHistoryStore.setState({ entries: [sampleEntry] });
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_HISTORY_IO', message: 'locked' },
    });
    await useHistoryStore.getState().clearHistory();
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useHistoryStore.getState().error).toBe('locked');
  });
});

describe('historyStore.applyHistoryAdded', () => {
  it('prepends new entry and trims to max 200', () => {
    const many: HistoryEntry[] = Array.from({ length: 200 }, (_, i) => ({
      ...sampleEntry,
      id: `old-${i}`,
    }));
    useHistoryStore.setState({ entries: many });
    useHistoryStore.getState().applyHistoryAdded(sampleEntry);
    const s = useHistoryStore.getState();
    expect(s.entries[0].id).toBe('h1');
    expect(s.entries).toHaveLength(200);
  });
});

describe('historyStore 前后端结构适配(normalizeHistoryEntry)', () => {
  // 与 Rust 端 HistoryEntry 序列化一致(snake_case 简化字段,见 core/context.rs)
  const backendEntry = {
    tool_id: 'base64_codec',
    input_summary: 'hello',
    output_summary: 'aGVsbG8=',
    timestamp: 1756100000000,
    duration_ms: 3,
  };

  it('loadHistory 将后端 snake_case 条目归一化为前端富结构', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: [backendEntry] });
    await useHistoryStore.getState().loadHistory();
    const [entry] = useHistoryStore.getState().entries;
    expect(entry.id).toBe('1756100000000-base64_codec');
    expect(entry.toolId).toBe('base64_codec');
    expect(entry.timestamp).toBe(new Date(1756100000000).toISOString());
    expect(entry.inputSummary.textPreview).toBe('hello');
    expect(entry.inputSummary.redacted).toBe(false);
    expect(entry.outputSummary.textPreview).toBe('aGVsbG8=');
    expect(entry.success).toBe(true);
    expect(entry.durationMs).toBe(3);
  });

  it('applyHistoryAdded 接受 history_added 事件通道的后端结构 payload', () => {
    useHistoryStore.getState().applyHistoryAdded(backendEntry);
    const [entry] = useHistoryStore.getState().entries;
    expect(entry.toolId).toBe('base64_codec');
    expect(entry.id).toBe('1756100000000-base64_codec');
    expect(entry.inputSummary.textPreview).toBe('hello');
  });

  it('已是前端结构的条目原样保留(mock/未来后端对齐场景)', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: [sampleEntry] });
    await useHistoryStore.getState().loadHistory();
    expect(useHistoryStore.getState().entries[0]).toEqual(sampleEntry);
  });
});
