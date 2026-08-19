import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_USER_CONFIG,
  type UserConfig,
} from '@/types/config';
import type { ConfigChangedPayload, ErrorInfo } from '@/types/ipc';

/**
 * 用默认值回填持久化配置中缺失的字段。
 *
 * 旧版本保存的配置可能缺少新增字段(如 toolPrefs),
 * 直接读取其 undefined 子字段会触发
 * "Cannot read properties of undefined (reading 'xxx')" 崩溃。
 * 这里与默认配置做一次深合并做兜底。
 */
function normalizeConfig(raw: UserConfig): UserConfig {
  return {
    ...DEFAULT_USER_CONFIG,
    ...raw,
    general: { ...DEFAULT_USER_CONFIG.general, ...raw.general },
    theme: { ...DEFAULT_USER_CONFIG.theme, ...raw.theme },
    shortcuts: { ...DEFAULT_USER_CONFIG.shortcuts, ...raw.shortcuts },
    toolPrefs: { ...DEFAULT_USER_CONFIG.toolPrefs, ...(raw.toolPrefs ?? {}) },
    favorites: raw.favorites ?? DEFAULT_USER_CONFIG.favorites,
    editor: {
      ...DEFAULT_EDITOR_CONFIG,
      ...(raw.editor ?? {}),
      namingConvention: {
        ...DEFAULT_EDITOR_CONFIG.namingConvention,
        ...(raw.editor?.namingConvention ?? {}),
        enabled:
          raw.editor?.namingConvention?.enabled?.length
            ? raw.editor.namingConvention.enabled
            : DEFAULT_EDITOR_CONFIG.namingConvention.enabled,
        order:
          raw.editor?.namingConvention?.order?.length
            ? raw.editor.namingConvention.order
            : DEFAULT_EDITOR_CONFIG.namingConvention.order,
      },
    },
  };
}

interface ConfigState {
  config: UserConfig | null;
  loading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  setConfig: (
    key: string,
    value: unknown,
  ) => Promise<{ ok: true } | { ok: false; error: ErrorInfo }>;
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
      set({ config: normalizeConfig(r.value), loading: false });
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
        toolPrefs: { ...(current.toolPrefs ?? {}) },
        favorites: [...(current.favorites ?? [])],
        editor: {
          ...current.editor,
          namingConvention: { ...current.editor?.namingConvention },
        },
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
      toolPrefs: { ...(current.toolPrefs ?? {}) },
      favorites: [...(current.favorites ?? [])],
      editor: {
        ...current.editor,
        namingConvention: { ...current.editor?.namingConvention },
      },
    };
    setByPath(next as unknown as Record<string, unknown>, payload.key, payload.newValue);
    set({ config: next });
  },
}));
