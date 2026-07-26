import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { HistoryEntry } from '@/types/history';

/** 内存中保留的最大条目,超过则丢弃最旧 */
const MAX_IN_MEMORY = 200;

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;

  loadHistory: (limit?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  applyHistoryAdded: (entry: HistoryEntry) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  error: null,

  loadHistory: async (limit = 100) => {
    set({ loading: true, error: null });
    const r = await safeInvoke<HistoryEntry[]>('history_list', { limit });
    if (r.ok) {
      set({ entries: r.value, loading: false });
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
    set((s) => ({
      // 新条目置顶,超出上限丢弃末尾
      entries: [entry, ...s.entries].slice(0, MAX_IN_MEMORY),
    }));
  },
}));
