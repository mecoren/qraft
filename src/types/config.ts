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

/**
 * 编辑器展示配置(Monaco options 的持久化映射)。
 *
 * 全部字段可选 + 前端 normalize 兜底默认值:旧版本持久化数据无这些字段,
 * 缺省时消费方回退到 DEFAULT_EDITOR_CONFIG(保持与历史行为一致的观感)。
 * 白名单同步:Rust store/config.rs EditorConfig(serde rename_all=camelCase),
 * 新增键必须两端同步,否则 config_set 反序列化时被静默丢弃。
 */
export interface EditorDisplayConfig {
  /** 括号配对着色,默认 true */
  bracketPairColorization?: boolean;
  /** 吸顶滚动(sticky scroll),默认 true */
  stickyScroll?: boolean;
  /** 缩进参考线,默认 true */
  indentationGuides?: boolean;
  /** 新建 Tab 默认自动换行(已开 Tab 的右键切换不受影响),默认 true */
  wordWrap?: boolean;
  /** 编辑器缩略图(minimap),默认 true(超大内容 Tab 由工作台强制关闭) */
  minimap?: boolean;
  /** 编辑器字号(px,Monaco 绝对 px 布局不随 rem 缩放),默认 13 */
  fontSize?: number;
  /** 缩进宽度(tabSize),默认 2 */
  tabSize?: number;
}

export interface EditorConfig {
  namingConvention: NamingConventionConfig;
  /** 常量里恒有值;类型上可选是历史 config.json 无此字段的兼容 */
  display?: EditorDisplayConfig;
}

/** 默认展示配置的字面量(DEFAULT_EDITOR_CONFIG.display 的 Non-null 视图) */
export const DEFAULT_EDITOR_DISPLAY: Required<EditorDisplayConfig> = {
  bracketPairColorization: true,
  stickyScroll: true,
  indentationGuides: true,
  wordWrap: true,
  minimap: true,
  fontSize: 13,
  tabSize: 2,
};

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
  /** 文本编辑器：新建空白 Tab */
  new_file: string;
  /** 文本编辑器：打开文件对话框 */
  open_file: string;
  /** 文本编辑器：全部保存 */
  save_all: string;
  /** 文本编辑器：关闭当前 Tab */
  close_editor: string;
  /** 文本编辑器：全部关闭(保留固定 Tab) */
  close_all_editors: string;
  /** 文本编辑器：切换「打开的编辑器」左栏显隐 */
  toggle_editor_sidebar: string;
  /** 文本编辑器：切换到下一个 Tab(循环) */
  next_tab: string;
  /** 文本编辑器：切换到上一个 Tab(循环) */
  previous_tab: string;
  /** 文本编辑器：恢复最近关闭的 Tab */
  reopen_closed_tab: string;
  /** 文本编辑器：返回上一个编辑位置(跨 Tab,含行/列恢复) */
  navigate_edit_back: string;
  /** 文本编辑器：前进到下一个编辑位置(配合返回使用) */
  navigate_edit_forward: string;
  /** 文本比较：跳到上一处差异(仅并排模式生效) */
  diff_prev_change: string;
  /** 文本比较：跳到下一处差异(仅并排模式生效) */
  diff_next_change: string;
}

export interface ToolPref {
  layout?: 'split' | 'stack' | 'full-input' | 'full-output';
  values?: Record<string, unknown>;
}

/** ShortcutBinding 的键名集合(useShortcut / 菜单标签同源取绑定用) */
export type ShortcutKey = keyof ShortcutBinding;

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
  new_file: 'Ctrl+N',
  open_file: 'Ctrl+O',
  save_all: 'Ctrl+Shift+S',
  close_editor: 'Ctrl+W',
  close_all_editors: 'Ctrl+Shift+W',
  toggle_editor_sidebar: 'Ctrl+B',
  // Alt+1..9 直达 Tab 为固定映射:Alt+数字在 ShortcutInput 录制与
  // parseShortcut 中需逐键声明,九个键位挤占设置页收益有限,
  // 沿用 VSCode/浏览器默认不做用户配置项
  next_tab: 'Ctrl+Tab',
  previous_tab: 'Ctrl+Shift+Tab',
  reopen_closed_tab: 'Ctrl+Shift+T',
  // 位置历史与浏览器后退/前进同款心智(Alt+Left / Alt+Right),
  // VSCode「后退」默认同为 Alt+Left
  navigate_edit_back: 'Alt+Left',
  navigate_edit_forward: 'Alt+Right',
  // F7/Shift+F7 与 VSCode Diff Editor 原生「上一处/下一处差异」一致
  diff_prev_change: 'F7',
  diff_next_change: 'Shift+F7',
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
  // 展示项默认值与 CodeEditor 历史硬编码值一致:升级后无配置数据时观感不变
  display: DEFAULT_EDITOR_DISPLAY,
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  version: 1,
  general: {
    // 现状为中文优先应用;早期 PRD「MVP 仅英文」口径已演进,见 docs/i18n 计划
    language: 'zh-CN',
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
