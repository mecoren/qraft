import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import { DEFAULT_EDITOR_CONFIG, DEFAULT_USER_CONFIG, type UserConfig } from '@/types/config';
import type { ConfigChangedPayload, ErrorInfo } from '@/types/ipc';
import { changeLocale } from '@/i18n';
import { rebuildSearchIndex } from '@/lib/search-index';

/**
 * 用默认值回填持久化配置中缺失的字段。
 *
 * 旧版本保存的配置可能缺少新增字段(如 toolPrefs),
 * 直接读取其 undefined 子字段会触发
 * "Cannot read properties of undefined (reading 'xxx')" 崩溃。
 * 这里与默认配置做一次深合并做兜底。
 */
function normalizeConfig(raw: UserConfig): UserConfig {
  // 迁移:旧版把「切换字符命名风格」绑定到 Shift+Alt+C,
  // 在 Windows 上 Alt 会被系统/菜单拦截导致快捷键失效,统一升级为 Ctrl+Shift+U。
  // 仅当用户仍停留在旧默认值时替换,用户自定义过其它组合则保留。
  const rawShortcuts = raw.shortcuts ?? {};
  const shortcuts: UserConfig['shortcuts'] = {
    ...DEFAULT_USER_CONFIG.shortcuts,
    ...rawShortcuts,
  };
  if (rawShortcuts.cycle_naming_case === 'Shift+Alt+C') {
    shortcuts.cycle_naming_case = DEFAULT_USER_CONFIG.shortcuts.cycle_naming_case;
  }

  return {
    ...DEFAULT_USER_CONFIG,
    ...raw,
    general: { ...DEFAULT_USER_CONFIG.general, ...raw.general },
    theme: { ...DEFAULT_USER_CONFIG.theme, ...raw.theme },
    shortcuts,
    toolPrefs: { ...DEFAULT_USER_CONFIG.toolPrefs, ...(raw.toolPrefs ?? {}) },
    favorites: raw.favorites ?? DEFAULT_USER_CONFIG.favorites,
    editor: {
      ...DEFAULT_EDITOR_CONFIG,
      ...(raw.editor ?? {}),
      namingConvention: {
        ...DEFAULT_EDITOR_CONFIG.namingConvention,
        ...(raw.editor?.namingConvention ?? {}),
        enabled: raw.editor?.namingConvention?.enabled?.length
          ? raw.editor.namingConvention.enabled
          : DEFAULT_EDITOR_CONFIG.namingConvention.enabled,
        order: raw.editor?.namingConvention?.order?.length
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
      const normalized = normalizeConfig(r.value);
      set({ config: normalized, loading: false });
      // 启动同步:配置中的界面语言驱动 i18n(缺省/非法值保持 zh-CN 不变)
      const lang = normalized.general?.language;
      if (lang === 'en-US' || lang === 'zh-CN') {
        changeLocale(lang);
        rebuildSearchIndex();
      }
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
      // 语言切换即时生效(i18n + 搜索索引重建),持久化紧随其后
      if (key === 'general.language' && (value === 'en-US' || value === 'zh-CN')) {
        changeLocale(value);
        rebuildSearchIndex();
      }
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
    // 后端 reset 后 emit 的 new_value 为 Null,表示恢复默认值。
    // 直接 setByPath 为 null 会让配置对象出现空值导致渲染异常,因此改走全量刷新。
    if (payload.newValue === null || payload.newValue === undefined) {
      void get().loadConfig();
      return;
    }
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
