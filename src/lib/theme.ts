/**
 * 主题管理共享模块
 *
 * 职责:
 * - initThemeOnStartup:应用启动时初始化颜色主题(迁移旧 key + 调用 color-theme)
 * - 字体设置:字体族 / 字号 / 字重 的应用与读取
 *
 * 设计说明:
 * - 颜色主题(主题)逻辑已迁移至 color-theme.ts(三层架构 Layer 3)
 * - 本文件保留字体相关逻辑和启动入口,供 main.tsx 调用
 * - Tailwind v4 通过 @custom-variant dark (&:is(.dark *)) 启用类策略,
 *   color-theme.ts 在 document.documentElement 上切换 .dark 类
 * - 持久化使用 localStorage,重启应用自动恢复
 */

import { initColorThemeOnStartup, type PaletteId, PALETTE_STORAGE_KEY } from './color-theme';
import { DEFAULT_MONO_FONT_FAMILY } from './fontFamilies';

// ============================================================
// 颜色主题:启动初始化(迁移旧 key + 调用 color-theme)
// ============================================================

/** 旧主题存储 key(仅用于迁移,迁移后删除) */
export const THEME_STORAGE_KEY = 'theme';

/**
 * 应用启动时初始化颜色主题
 *
 * 在 React 渲染前调用,避免主题闪烁(FOUC):
 * 1. 检测旧 THEME_STORAGE_KEY(light/dark/system),迁移到新 PALETTE_STORAGE_KEY
 *    - dark → obsidian
 *    - light → daylight
 *    - system → system
 * 2. 调用 initColorThemeOnStartup 应用主题
 *
 * 返回清理函数(应用生命周期内通常不需要清理)。
 */
export function initThemeOnStartup(): () => void {
  // 一次性迁移:旧 theme key → 新 color_palette key
  const oldTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (oldTheme && !localStorage.getItem(PALETTE_STORAGE_KEY)) {
    const migrated: PaletteId =
      oldTheme === 'dark' ? 'obsidian' : oldTheme === 'light' ? 'daylight' : 'system';
    localStorage.setItem(PALETTE_STORAGE_KEY, migrated);
    localStorage.removeItem(THEME_STORAGE_KEY);
  }

  return initColorThemeOnStartup();
}

// ============================================================
// 字体设置:字体族 / 字号 / 字重
// ============================================================

// ── 字体族(UI) ──

export const FONT_FAMILY_STORAGE_KEY = 'font_family';

/**
 * 将 UI 字体族应用到 <html> 根元素
 *
 * - 非空:设置 style.fontFamily 和 CSS 变量 --app-font-family
 * - null:清除自定义字体,回退到 CSS 默认(system-ui)
 */
export function applyFontFamily(fontFamily: string | null) {
  const root = document.documentElement;
  if (fontFamily) {
    const stack = `'${fontFamily}', system-ui, -apple-system, sans-serif`;
    root.style.setProperty('--app-font-family', stack);
    root.style.fontFamily = stack;
  } else {
    root.style.removeProperty('--app-font-family');
    root.style.fontFamily = '';
  }
}

/**
 * 读取持久化的 UI 字体族,未设置返回 null(系统默认)
 */
export function getStoredFontFamily(): string | null {
  return localStorage.getItem(FONT_FAMILY_STORAGE_KEY);
}

// ── 字体族(代码/Mono) ──

export const MONO_FONT_FAMILY_STORAGE_KEY = 'mono_font_family';

/**
 * 将代码字体族应用到 <html> 根元素
 *
 * - 非空:设置 CSS 变量 --app-mono-font-family(含 fallback 栈)
 * - null:清除自定义字体,回退到 CSS 默认(JetBrains Mono 栈)
 *
 * 应用范围:code/pre/.font-mono、Monaco 编辑器、行号编辑器、日志、
 * DDL、数据表等宽内容(见 globals.css 与 code-editor.tsx)。
 */
export function applyMonoFontFamily(fontFamily: string | null) {
  const root = document.documentElement;
  if (fontFamily) {
    // 自定义字体在前,fallback 链保留默认 Mono 栈兜底
    const stack = `'${fontFamily}', ${DEFAULT_MONO_FONT_FAMILY}`;
    root.style.setProperty('--app-mono-font-family', stack);
  } else {
    root.style.removeProperty('--app-mono-font-family');
  }
}

/**
 * 读取持久化的代码字体族,未设置返回 null(默认 JetBrains Mono)
 */
export function getStoredMonoFontFamily(): string | null {
  return localStorage.getItem(MONO_FONT_FAMILY_STORAGE_KEY);
}

// ── 字号级别 ──

/** 字号级别定义:0=小, 1=标准, 2=大, 3=特大, 4=超大 */
export const FONT_SIZE_LEVELS = [
  { label: '小', scale: 0.875 },
  { label: '标准', scale: 1.0 },
  { label: '大', scale: 1.125 },
  { label: '特大', scale: 1.25 },
  { label: '超大', scale: 1.375 },
] as const;

export const FONT_SIZE_STORAGE_KEY = 'font_size_level';
export const DEFAULT_FONT_SIZE_LEVEL = 1;

/**
 * 将字号级别应用到 <html> 根元素
 *
 * 通过设置 root font-size 实现 rem 单位缩放。
 */
export function applyFontSizeLevel(level: number) {
  const clamped = Math.max(0, Math.min(FONT_SIZE_LEVELS.length - 1, level));
  const scale = FONT_SIZE_LEVELS[clamped].scale;
  document.documentElement.style.fontSize = `${16 * scale}px`;
}

/**
 * 读取持久化的字号级别
 */
export function getStoredFontSizeLevel(): number {
  const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (stored === null) return DEFAULT_FONT_SIZE_LEVEL;
  const n = parseInt(stored, 10);
  return Number.isNaN(n) ? DEFAULT_FONT_SIZE_LEVEL : n;
}

// ── 字重级别 ──

/** 字重级别定义:0=细, 1=常规, 2=中等, 3=半粗, 4=粗体 */
export const FONT_WEIGHT_LEVELS = [
  { label: '细', weight: 300 },
  { label: '常规', weight: 400 },
  { label: '中等', weight: 500 },
  { label: '半粗', weight: 600 },
  { label: '粗体', weight: 700 },
] as const;

export const FONT_WEIGHT_STORAGE_KEY = 'font_weight_level';
export const DEFAULT_FONT_WEIGHT_LEVEL = 1;

/**
 * 将字重级别应用到 <html> 根元素
 *
 * 通过 CSS 变量 --app-font-weight 和 root style.fontWeight 注入。
 * 未显式指定 font-weight 的元素将继承此值。
 */
export function applyFontWeightLevel(level: number) {
  const clamped = Math.max(0, Math.min(FONT_WEIGHT_LEVELS.length - 1, level));
  const weight = FONT_WEIGHT_LEVELS[clamped].weight;
  const root = document.documentElement;
  root.style.setProperty('--app-font-weight', String(weight));
  root.style.fontWeight = String(weight);
}

/**
 * 读取持久化的字重级别
 */
export function getStoredFontWeightLevel(): number {
  const stored = localStorage.getItem(FONT_WEIGHT_STORAGE_KEY);
  if (stored === null) return DEFAULT_FONT_WEIGHT_LEVEL;
  const n = parseInt(stored, 10);
  return Number.isNaN(n) ? DEFAULT_FONT_WEIGHT_LEVEL : n;
}

// ── 启动初始化 ──

/**
 * 应用启动时恢复字体设置(UI 字体族 + 代码字体族 + 字号 + 字重)
 *
 * 在 React 渲染前调用,避免字体闪烁。
 * 与 initThemeOnStartup 并列使用。
 */
export function initFontSettingsOnStartup() {
  applyFontFamily(getStoredFontFamily());
  applyMonoFontFamily(getStoredMonoFontFamily());
  applyFontSizeLevel(getStoredFontSizeLevel());
  applyFontWeightLevel(getStoredFontWeightLevel());
}
