/**
 * 颜色主题 Layer 3:无闪烁切换器
 *
 * 职责:
 * - applyPalette:将主题应用到 <html> 根元素(data-palette 属性 + .dark 类 + inline style)
 * - initColorThemeOnStartup:应用启动时在 React 渲染前应用主题,避免 FOUC
 * - setPalette:运行时切换主题并持久化
 *
 * 设计说明:
 * - 预设主题:仅设置 data-palette 属性,由 CSS [data-palette="..."] 选择器接管
 * - 自定义主题:设置 data-palette="custom" + 注入 inline style 覆盖关键变量
 * - system 模式:根据 prefers-color-scheme 选择 obsidian(深色)或 daylight(亮色)
 * - 同步切换 .dark 类以兼容依赖它的第三方组件(shadcn/ui Dialog/Sheet 等)
 *
 * 与 wait-home 的差异:
 * - getStoredThemeMode() 默认返回 'light'(wait-home 为 'system')
 * - getStoredPaletteId() 默认返回 'daylight'(wait-home 为 'system')
 * - 用户要求:应用启动默认浅色主题
 */

import { getPaletteById, type ColorPalette } from './design-tokens';

export type PaletteId =
  'obsidian' | 'deep-sea' | 'twilight' | 'emerald-night' | 'daylight' | 'custom' | 'system';

export const PALETTE_STORAGE_KEY = 'color_palette';
export const CUSTOM_ACCENT_STORAGE_KEY = 'custom_palette_accent';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODE_STORAGE_KEY = 'theme_mode';

const THEME_MODE_TO_PALETTE: Record<ThemeMode, PaletteId> = {
  light: 'daylight',
  dark: 'obsidian',
  system: 'system',
};

/**
 * 从 localStorage 读取主题 ID
 *
 * 未设置时回退为 'daylight'(浅色默认主题)。
 */
export function getStoredPaletteId(): PaletteId {
  const stored = localStorage.getItem(PALETTE_STORAGE_KEY) as PaletteId | null;
  return stored ?? 'daylight';
}

/**
 * 从 localStorage 读取主题模式
 *
 * 未设置或值非法时回退为 'light'(用户要求:启动默认浅色)。
 */
export function getStoredThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY) as ThemeMode | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'light';
}

/**
 * 从 localStorage 读取自定义 accent 色
 *
 * 未设置时返回 null。
 */
export function getStoredCustomAccent(): string | null {
  return localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY);
}

/**
 * 解析 system 模式为具体深/浅色主题
 *
 * 深色 → obsidian,亮色 → daylight。
 */
function resolveSystemPalette(): ColorPalette {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return getPaletteById(isDark ? 'obsidian' : 'daylight');
}

/**
 * 将主题应用到 <html> 根元素
 *
 * 策略:
 * 1. 预设主题:设置 data-palette 属性,清除 inline style
 * 2. 自定义主题:设置 data-palette="custom" + 注入 inline style 覆盖关键变量
 * 3. 同步切换 .dark 类(深色主题添加,亮色移除)
 *
 * 注意:切换 data-palette 属性后,CSS [data-palette="..."] 选择器
 * 立即应用新的 CSS 变量值,Tailwind utility class 通过 var() 引用,
 * 整页颜色瞬时切换,无 React 重渲染。
 */
export function applyPalette(paletteId: PaletteId, customAccent?: string | null): void {
  const root = document.documentElement;
  const palette =
    paletteId === 'system' ? resolveSystemPalette() : getPaletteById(paletteId, customAccent);

  root.setAttribute('data-palette', palette.id);
  root.classList.toggle('dark', palette.mode === 'dark');

  // 自定义主题:注入派生变量覆盖 [data-palette="custom"] 的默认值
  if (palette.id === 'custom') {
    root.style.setProperty('--primary', palette.primary);
    root.style.setProperty('--ring', palette.ring);
    root.style.setProperty('--sidebar-primary', palette.sidebarPrimary);
    root.style.setProperty('--sidebar-ring', palette.sidebarRing);
    root.style.setProperty('--accent', palette.accentBg);
    root.style.setProperty('--sidebar-accent', palette.sidebarAccent);
  } else {
    // 预设主题:清除 inline style,让 [data-palette="..."] 选择器接管
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
    root.style.removeProperty('--sidebar-primary');
    root.style.removeProperty('--sidebar-ring');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--sidebar-accent');
  }
}

/**
 * 应用启动时初始化主题(无闪烁)
 *
 * 必须在 React 渲染前调用(main.tsx 入口处)。
 * 若为 system 模式,注册 prefers-color-scheme 监听器实时切换。
 *
 * 返回清理函数(应用生命周期内通常不需要清理)。
 */
export function initColorThemeOnStartup(): () => void {
  const mode = getStoredThemeMode();
  const paletteId = THEME_MODE_TO_PALETTE[mode];
  const customAccent = getStoredCustomAccent();
  applyPalette(paletteId, customAccent);

  if (mode === 'system') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyPalette('system', getStoredCustomAccent());
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }

  return () => {};
}

/**
 * 运行时切换主题(无闪烁)
 *
 * 同时持久化到 localStorage。
 *
 * @param paletteId 目标主题 ID
 * @param customAccent 自定义 accent 色(仅 paletteId === 'custom' 时使用)
 */
export function setPalette(paletteId: PaletteId, customAccent?: string): void {
  localStorage.setItem(PALETTE_STORAGE_KEY, paletteId);
  if (customAccent !== undefined) {
    localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, customAccent);
  }
  applyPalette(paletteId, customAccent ?? getStoredCustomAccent());
}

/**
 * 运行时切换主题模式(无闪烁)
 *
 * 同时持久化 theme_mode 并映射到对应主题。
 */
export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  setPalette(THEME_MODE_TO_PALETTE[mode]);
}
