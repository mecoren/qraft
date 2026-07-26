import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { UserConfig } from '@/types/config';
import type { ConfigChangedPayload, ErrorInfo } from '@/types/ipc';

interface ConfigState {
  config: UserConfig | null;
  loading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<{ ok: true } | { ok: false; error: ErrorInfo }>;
  resetConfig: (key: string) => Promise<{ ok: true } | { ok: false; error: ErrorInfo }>;
  applyConfigChanged: (payload: ConfigChangedPayload) => void;
}

/**
 * 通过点分路径设置嵌套字段,例如 "theme.mode" → config.theme.mode = value
 * 仅支持对象层级,不支持数组索引。
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cursor[k];
    cursor[k] = { ...(next as object) };
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true, error: null });
    const r = await safeInvoke<UserConfig>('config_get_all');
    if (r.ok) {
      set({ config: r.value, loading: false });
    } else {
      set({ loading: false, error: r.error.message });
    }
  },

  setConfig: async (key, value) => {
    // 乐观更新:先改本地,再持久化
    const current = get().config;
    if (current) {
      const next: UserConfig = {
        ...current,
        general: { ...current.general },
        theme: { ...current.theme },
        shortcuts: { ...current.shortcuts },
        toolPrefs: { ...current.toolPrefs },
        favorites: [...current.favorites],
      };
      setByPath(next as unknown as Record<string, unknown>, key, value);
      set({ config: next });
    }
    const r = await safeInvoke<boolean>('config_set', { key, value });
    return r;
  },

  resetConfig: async (key) => {
    const r = await safeInvoke<boolean>('config_reset', { key });
    if (r.ok) {
      // 重置后重新拉取全量配置,避免本地与默认值不一致
      await get().loadConfig();
    }
    return r;
  },

  applyConfigChanged: (payload) => {
    const current = get().config;
    if (!current) return;
    const next: UserConfig = {
      ...current,
      general: { ...current.general },
      theme: { ...current.theme },
      shortcuts: { ...current.shortcuts },
      toolPrefs: { ...current.toolPrefs },
      favorites: [...current.favorites],
    };
    setByPath(next as unknown as Record<string, unknown>, payload.key, payload.newValue);
    set({ config: next });
  },
}));
