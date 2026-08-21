import type { NamingConventionId } from '@/lib/naming-convention';

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

export interface NamingConventionConfig {
  enabled: NamingConventionId[];
  order: NamingConventionId[];
}

export interface EditorConfig {
  namingConvention: NamingConventionConfig;
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
  /** 保存当前编辑器(文本编辑器 Ctrl+S) */
  save_file: string;
  /** 打开全局搜索面板(Ctrl+Shift+F) */
  global_search: string;
  /** 文本编辑器：循环切换选中字符命名风格 */
  cycle_naming_case: string;
  /** 文本编辑器：切换选中文本大小写(大写 <-> 小写) */
  toggle_case: string;
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
  editor: EditorConfig;
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
  save_file: 'Ctrl+S',
  global_search: 'Ctrl+Shift+F',
  cycle_naming_case: 'Ctrl+Shift+U',
  toggle_case: 'Ctrl+Shift+L',
};

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  namingConvention: {
    enabled: ['SNAKE_CASE', 'CamelCase', 'camelCase', 'snake_case'],
    order: [
      'snake_case',
      'camelCase',
      'SNAKE_CASE',
      'CamelCase',
      'kebab-case',
      'space case',
      'Camel Case',
    ],
  },
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
  editor: DEFAULT_EDITOR_CONFIG,
};
