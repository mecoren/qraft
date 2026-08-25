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
  /** 状态语义色:成功(绿),对应 CSS 变量 --success */
  success: string;
  /** 状态语义色:警告(琥珀),对应 CSS 变量 --warning */
  warning: string;
  /** 状态语义色:信息(蓝),对应 CSS 变量 --info */
  info: string;
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
  success: 'oklch(0.72 0.15 155)',
  warning: 'oklch(0.80 0.13 75)',
  info: 'oklch(0.70 0.12 240)',
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
  success: 'oklch(0.72 0.15 155)',
  warning: 'oklch(0.80 0.13 75)',
  info: 'oklch(0.70 0.12 240)',
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
  success: 'oklch(0.72 0.15 155)',
  warning: 'oklch(0.80 0.13 75)',
  info: 'oklch(0.70 0.12 240)',
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
  success: 'oklch(0.72 0.15 155)',
  warning: 'oklch(0.80 0.13 75)',
  info: 'oklch(0.70 0.12 240)',
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
  success: 'oklch(0.50 0.12 155)',
  warning: 'oklch(0.55 0.14 75)',
  info: 'oklch(0.50 0.12 240)',
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

/** 解析 #RGB/#RRGGBB 十六进制颜色为 [r,g,b](0-255);非法返回 null */
export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1];
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** sRGB 通道 → 线性值(WCAG 2.x 相对亮度公式) */
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 近白前景 oklch(0.99 0 0) ≈ #fbfbfb 的相对亮度 */
const FG_LIGHT_LUM = 0.961;

/**
 * 按 WCAG 对比度选择 accent 色之上的可读前景色。
 *
 * 背景:自定义主题的 primaryForeground 原为恒白,用户选浅色 accent(如黄色)时
 * 主按钮「白字浅底」不可读。阈值取 3:1(WCAG 1.4.11 非文本/UI 组件下限):
 * 白字对比不足 3:1 即切换近黑,否则维持近白以保持现有按钮视觉习惯。
 * 非法输入回退近白(与历史行为一致;上游 SettingsPanel 负责格式校验提示)。
 */
export function pickAccentForeground(accentHex: string): string {
  const rgb = parseHexColor(accentHex);
  if (!rgb) return 'oklch(0.99 0 0)';
  const lum =
    0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
  // 近黑前景的对比度必然随亮度升高而下降,白字不足 3:1 时近黑必然更优,无需再算
  const contrastOnLight = (FG_LIGHT_LUM + 0.05) / (lum + 0.05);
  return contrastOnLight >= 3 ? 'oklch(0.99 0 0)' : 'oklch(0.15 0 0)';
}

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
 * - primaryForeground / sidebarPrimaryForeground = 按 accent 亮度自动选近白/近黑
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
    primaryForeground: pickAccentForeground(accent),
    secondary: 'oklch(0.27 0 0)',
    secondaryForeground: 'oklch(0.96 0 0)',
    muted: 'oklch(0.24 0 0)',
    mutedForeground: 'oklch(0.68 0 0)',
    // 使用 color-mix 派生半透明高亮色
    accentBg: `color-mix(in srgb, ${accent} 15%, transparent)`,
    accentFg: 'oklch(0.96 0 0)',
    destructive: 'oklch(0.704 0.191 22.216)',
    success: 'oklch(0.72 0.15 155)',
    warning: 'oklch(0.80 0.13 75)',
    info: 'oklch(0.70 0.12 240)',
    border: 'oklch(1 0 0 / 10%)',
    input: 'oklch(1 0 0 / 15%)',
    ring: accent,
    sidebar: 'oklch(0.18 0 0)',
    sidebarForeground: 'oklch(0.96 0 0)',
    sidebarPrimary: accent,
    sidebarPrimaryForeground: pickAccentForeground(accent),
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
export function getPaletteById(id: string, customAccent?: string | null): ColorPalette {
  if (id === 'custom' && customAccent) {
    return deriveCustomPalette(customAccent);
  }
  return PRESET_PALETTES.find((p) => p.id === id) ?? PRESET_PALETTES[4];
}
