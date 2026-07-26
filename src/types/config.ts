export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
  mode: ThemeMode;
  accentColor: string;
}

export interface GeneralConfig {
  language: string;
  fontSize: number;
  maxHistory: number;
  confirmOnClear: boolean;
}

/** 快捷键绑定,与 15-ui-design-system.md §3.6 一一对应 */
export interface ShortcutBinding {
  open_command_palette: string;
  toggle_sidebar: string;
  execute_tool: string;
  clear_input: string;
  copy_output: string;
  toggle_settings: string;
  switch_tool: string;
  open_history: string;
  search: string;
  close_panel: string;
}

export interface ToolPref {
  layout?: 'split' | 'stack' | 'full-input' | 'full-output';
  values?: Record<string, unknown>;
}

export interface Favorite {
  toolId: string;
  group?: string;
  sortOrder: number;
}

export interface UserConfig {
  version: number;
  general: GeneralConfig;
  theme: ThemeConfig;
  shortcuts: ShortcutBinding;
  toolPrefs: Record<string, ToolPref>;
  favorites: Favorite[];
}

/** 快捷键默认值 */
export const DEFAULT_SHORTCUTS: ShortcutBinding = {
  open_command_palette: 'Ctrl+K',
  toggle_sidebar: 'Ctrl+B',
  execute_tool: 'Ctrl+Enter',
  clear_input: 'Ctrl+L',
  copy_output: 'Ctrl+Shift+C',
  toggle_settings: 'Ctrl+,',
  switch_tool: 'Ctrl+P',
  open_history: 'Ctrl+H',
  search: 'Ctrl+F',
  close_panel: 'Esc',
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  version: 1,
  general: {
    language: 'en',
    fontSize: 14,
    maxHistory: 100,
    confirmOnClear: true,
  },
  theme: {
    mode: 'dark',
    accentColor: '#3b82f6',
  },
  shortcuts: DEFAULT_SHORTCUTS,
  toolPrefs: {},
  favorites: [],
};
