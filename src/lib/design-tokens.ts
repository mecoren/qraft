/**
 * 设计令牌（Design Tokens）—— Qraft 主题 Layer 1
 *
 * 职责:
 * - 定义 ColorPalette 语义化接口
 * - 提供 5 套预设主题(4 深色 + 1 亮色)
 * - 提供 deriveCustomPalette(accent) 工厂:由 accent 色派生完整主题
 * - 提供 getPaletteById(id, customAccent) 查找
 *
 * 设计说明:
 * - 色彩空间使用 OKLCH(感知均匀,Tauri WebView2 Chromium 111+ 支持)
 * - 默认主题为 daylight(亮色),与 wait-home 的 system 默认不同
 * - 自定义主题采用固定深色基底 + accent 派生关键交互色,避免用户配置 25+ 字段
 *
 * 命名约定:
 * - 用户可见文案统一使用"主题"(如"黑曜石主题")
 * - 代码内部保留 palette/PaletteId/ColorPalette 等标识符,以区分 ThemeMode(light/dark/system)
 */

export type PaletteMode = 'dark' | 'light';

/**
 * 主题语义化字段
 *
 * 每个字段对应一个 CSS 变量(--background / --foreground 等),
 * 由 Layer 2 (globals.css) 的 [data-palette="..."] 块注入。
 */
export interface ColorPalette {
  id: string;
  displayName: string;
  mode: PaletteMode;
  accent: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  /** hover/accent 背景(对应 shadcn/ui 的 --accent) */
  accentBg: string;
  accentFg: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
}

// ============================================================
// 5 套预设主题(4 深色 + 1 亮色)
// ============================================================

/** 黑曜石 - 默认深色(DevToys Fluent 风格,azure 蓝调) */
const obsidian: ColorPalette = {
  id: 'obsidian',
  displayName: '黑曜石',
  mode: 'dark',
  accent: 'oklch(0.62 0.19 250)',
  background: 'oklch(0.16 0.01 264)',
  foreground: 'oklch(0.96 0.01 264)',
  card: 'oklch(0.21 0.01 264)',
  cardForeground: 'oklch(0.96 0.01 264)',
  popover: 'oklch(0.21 0.01 264)',
  popoverForeground: 'oklch(0.96 0.01 264)',
  primary: 'oklch(0.62 0.19 250)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.27 0.01 264)',
  secondaryForeground: 'oklch(0.96 0.01 264)',
  muted: 'oklch(0.24 0.01 264)',
  mutedForeground: 'oklch(0.68 0.02 264)',
  accentBg: 'oklch(0.28 0.05 250)',
  accentFg: 'oklch(0.96 0.01 264)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.62 0.19 250)',
  sidebar: 'oklch(0.18 0.01 264)',
  sidebarForeground: 'oklch(0.96 0.01 264)',
  sidebarPrimary: 'oklch(0.62 0.19 250)',
  sidebarPrimaryForeground: 'oklch(0.99 0 0)',
  sidebarAccent: 'oklch(0.25 0.05 250)',
  sidebarAccentForeground: 'oklch(0.96 0.01 264)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.62 0.19 250)',
};

/** 深海 - 青蓝调 */
const deepSea: ColorPalette = {
  id: 'deep-sea',
  displayName: '深海',
  mode: 'dark',
  accent: 'oklch(0.62 0.16 220)',
  background: 'oklch(0.16 0.01 220)',
  foreground: 'oklch(0.96 0.01 220)',
  card: 'oklch(0.21 0.01 220)',
  cardForeground: 'oklch(0.96 0.01 220)',
  popover: 'oklch(0.21 0.01 220)',
  popoverForeground: 'oklch(0.96 0.01 220)',
  primary: 'oklch(0.62 0.16 220)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.27 0.01 220)',
  secondaryForeground: 'oklch(0.96 0.01 220)',
  muted: 'oklch(0.24 0.01 220)',
  mutedForeground: 'oklch(0.68 0.02 220)',
  accentBg: 'oklch(0.27 0.02 220)',
  accentFg: 'oklch(0.96 0.01 220)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.62 0.16 220)',
  sidebar: 'oklch(0.18 0.01 220)',
  sidebarForeground: 'oklch(0.96 0.01 220)',
  sidebarPrimary: 'oklch(0.62 0.16 220)',
  sidebarPrimaryForeground: 'oklch(0.99 0 0)',
  sidebarAccent: 'oklch(0.24 0.02 220)',
  sidebarAccentForeground: 'oklch(0.96 0.01 220)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.62 0.16 220)',
};

/** 暮光 - 橙红暖调 */
const twilight: ColorPalette = {
  id: 'twilight',
  displayName: '暮光',
  mode: 'dark',
  accent: 'oklch(0.62 0.20 25)',
  background: 'oklch(0.16 0.01 25)',
  foreground: 'oklch(0.96 0.01 25)',
  card: 'oklch(0.21 0.01 25)',
  cardForeground: 'oklch(0.96 0.01 25)',
  popover: 'oklch(0.21 0.01 25)',
  popoverForeground: 'oklch(0.96 0.01 25)',
  primary: 'oklch(0.62 0.20 25)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.27 0.01 25)',
  secondaryForeground: 'oklch(0.96 0.01 25)',
  muted: 'oklch(0.24 0.01 25)',
  mutedForeground: 'oklch(0.68 0.02 25)',
  accentBg: 'oklch(0.27 0.02 25)',
  accentFg: 'oklch(0.96 0.01 25)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.62 0.20 25)',
  sidebar: 'oklch(0.18 0.01 25)',
  sidebarForeground: 'oklch(0.96 0.01 25)',
  sidebarPrimary: 'oklch(0.62 0.20 25)',
  sidebarPrimaryForeground: 'oklch(0.99 0 0)',
  sidebarAccent: 'oklch(0.24 0.02 25)',
  sidebarAccentForeground: 'oklch(0.96 0.01 25)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.62 0.20 25)',
};

/** 翡翠夜 - 翠绿护眼 */
const emeraldNight: ColorPalette = {
  id: 'emerald-night',
  displayName: '翡翠夜',
  mode: 'dark',
  accent: 'oklch(0.62 0.16 162)',
  background: 'oklch(0.16 0.01 162)',
  foreground: 'oklch(0.96 0.01 162)',
  card: 'oklch(0.21 0.01 162)',
  cardForeground: 'oklch(0.96 0.01 162)',
  popover: 'oklch(0.21 0.01 162)',
  popoverForeground: 'oklch(0.96 0.01 162)',
  primary: 'oklch(0.62 0.16 162)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.27 0.01 162)',
  secondaryForeground: 'oklch(0.96 0.01 162)',
  muted: 'oklch(0.24 0.01 162)',
  mutedForeground: 'oklch(0.68 0.02 162)',
  accentBg: 'oklch(0.27 0.02 162)',
  accentFg: 'oklch(0.96 0.01 162)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.62 0.16 162)',
  sidebar: 'oklch(0.18 0.01 162)',
  sidebarForeground: 'oklch(0.96 0.01 162)',
  sidebarPrimary: 'oklch(0.62 0.16 162)',
  sidebarPrimaryForeground: 'oklch(0.99 0 0)',
  sidebarAccent: 'oklch(0.24 0.02 162)',
  sidebarAccentForeground: 'oklch(0.96 0.01 162)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.62 0.16 162)',
};

/** 日光 - 亮色模式默认(应用启动默认主题,DevToys Fluent 风格 azure) */
const daylight: ColorPalette = {
  id: 'daylight',
  displayName: '日光',
  mode: 'light',
  accent: 'oklch(0.54 0.18 256)',
  background: 'oklch(0.99 0.005 264)',
  foreground: 'oklch(0.18 0.01 264)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.18 0.01 264)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.18 0.01 264)',
  primary: 'oklch(0.54 0.18 256)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.96 0.01 264)',
  secondaryForeground: 'oklch(0.20 0.01 264)',
  muted: 'oklch(0.96 0.01 264)',
  mutedForeground: 'oklch(0.52 0.01 264)',
  accentBg: 'oklch(0.95 0.03 256)',
  accentFg: 'oklch(0.20 0.01 264)',
  destructive: 'oklch(0.577 0.245 27.325)',
  border: 'oklch(0.92 0.005 264)',
  input: 'oklch(0.92 0.005 264)',
  ring: 'oklch(0.54 0.18 256)',
  sidebar: 'oklch(0.97 0.005 264)',
  sidebarForeground: 'oklch(0.18 0.01 264)',
  sidebarPrimary: 'oklch(0.54 0.18 256)',
  sidebarPrimaryForeground: 'oklch(0.99 0 0)',
  sidebarAccent: 'oklch(0.93 0.04 256)',
  sidebarAccentForeground: 'oklch(0.20 0.01 264)',
  sidebarBorder: 'oklch(0.92 0.005 264)',
  sidebarRing: 'oklch(0.54 0.18 256)',
};

/** 所有预设主题(只读常量) */
export const PRESET_PALETTES: readonly ColorPalette[] = [
  obsidian,
  deepSea,
  twilight,
  emeraldNight,
  daylight,
] as const;

/** 应用启动默认主题 ID(亮色 daylight,符合用户预期) */
export const DEFAULT_PALETTE_ID = 'daylight';

/**
 * 由 accent 色派生自定义主题
 *
 * 策略:固定深色基底 + accent 派生关键交互色(primary/ring/sidebar-primary 等),
 * 避免用户手动配置 25+ 字段。
 *
 * 派生规则:
 * - primary = accent(直接使用)
 * - ring = accent(直接使用)
 * - sidebarPrimary = accent
 * - sidebarAccent = color-mix(accent 20% transparent)(半透明高亮)
 * - accentBg = color-mix(accent 15% transparent)(hover 背景)
 * - 其余字段使用与 obsidian 一致的深色基底
 *
 * 注意:返回的字符串中包含 color-mix() CSS 函数,
 * 由 color-theme.ts 注入到 <html> 的 inline style 中生效。
 */
export function deriveCustomPalette(accent: string): ColorPalette {
  return {
    id: 'custom',
    displayName: '自定义',
    mode: 'dark',
    accent,
    background: 'oklch(0.16 0 0)',
    foreground: 'oklch(0.96 0 0)',
    card: 'oklch(0.21 0 0)',
    cardForeground: 'oklch(0.96 0 0)',
    popover: 'oklch(0.21 0 0)',
    popoverForeground: 'oklch(0.96 0 0)',
    primary: accent,
    primaryForeground: 'oklch(0.99 0 0)',
    secondary: 'oklch(0.27 0 0)',
    secondaryForeground: 'oklch(0.96 0 0)',
    muted: 'oklch(0.24 0 0)',
    mutedForeground: 'oklch(0.68 0 0)',
    // 使用 color-mix 派生半透明高亮色
    accentBg: `color-mix(in srgb, ${accent} 15%, transparent)`,
    accentFg: 'oklch(0.96 0 0)',
    destructive: 'oklch(0.704 0.191 22.216)',
    border: 'oklch(1 0 0 / 10%)',
    input: 'oklch(1 0 0 / 15%)',
    ring: accent,
    sidebar: 'oklch(0.18 0 0)',
    sidebarForeground: 'oklch(0.96 0 0)',
    sidebarPrimary: accent,
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: `color-mix(in srgb, ${accent} 20%, transparent)`,
    sidebarAccentForeground: 'oklch(0.96 0 0)',
    sidebarBorder: 'oklch(1 0 0 / 10%)',
    sidebarRing: accent,
  };
}

/**
 * 根据 ID 查找主题
 *
 * - id === 'custom' 且提供 customAccent:返回派生的自定义主题
 * - id 为预设之一:返回对应预设
 * - 找不到:回退到默认 daylight
 */
export function getPaletteById(
  id: string,
  customAccent?: string | null,
): ColorPalette {
  if (id === 'custom' && customAccent) {
    return deriveCustomPalette(customAccent);
  }
  return PRESET_PALETTES.find((p) => p.id === id) ?? PRESET_PALETTES[4];
}
