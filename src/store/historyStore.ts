import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { HistoryEntry } from '@/types/history';

/** 内存中保留的最大条目,超过则丢弃最旧 */
const MAX_IN_MEMORY = 200;

/**
 * 后端 HistoryEntry 的实际序列化结构(snake_case 简化字段,
 * 见 src-tauri/src/core/context.rs 的 HistoryEntry 与 commands/tool.rs 的写入点)。
 * types/history.ts 的富结构是前端展示层契约,两者在本文件内做唯一适配。
 */
export interface BackendHistoryEntry {
  tool_id: string;
  input_summary: string;
  output_summary: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  duration_ms: number;
}

function isBackendEntry(raw: HistoryEntry | BackendHistoryEntry): raw is BackendHistoryEntry {
  return 'tool_id' in raw && 'input_summary' in raw;
}

/** 后端简化结构 → 前端富结构;输入已是前端结构时原样返回(单测 mock/未来后端对齐场景) */
export function normalizeHistoryEntry(raw: HistoryEntry | BackendHistoryEntry): HistoryEntry {
  if (!isBackendEntry(raw)) return raw;
  // 后端仅在执行成功后落历史(失败直接走错误通道),故 success 恒为 true
  return {
    id: `${raw.timestamp}-${raw.tool_id}`,
    toolId: raw.tool_id,
    timestamp: new Date(raw.timestamp).toISOString(),
    inputSummary: {
      textPreview: raw.input_summary,
      textBytes: raw.input_summary.length,
      params: null,
      redacted: false,
    },
    outputSummary: {
      textPreview: raw.output_summary,
      textBytes: raw.output_summary.length,
      redacted: false,
    },
    success: true,
    durationMs: raw.duration_ms,
  };
}

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;

  loadHistory: (limit?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  applyHistoryAdded: (entry: HistoryEntry | BackendHistoryEntry) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  error: null,

  loadHistory: async (limit = 100) => {
    set({ loading: true, error: null });
    const r = await safeInvoke<(HistoryEntry | BackendHistoryEntry)[]>('history_list', { limit });
    if (r.ok) {
      set({ entries: r.value.map(normalizeHistoryEntry), loading: false });
    } else {
      set({ loading: false, error: r.error.message });
    }
  },

  clearHistory: async () => {
    const r = await safeInvoke<boolean>('history_clear', {});
    if (r.ok) {
      set({ entries: [], error: null });
    } else {
      set({ error: r.error.message });
    }
  },

  applyHistoryAdded: (entry) => {
    const normalized = normalizeHistoryEntry(entry);
    set((s) => ({
      // 新条目置顶,超出上限丢弃末尾
      entries: [normalized, ...s.entries].slice(0, MAX_IN_MEMORY),
    }));
  },
}));
