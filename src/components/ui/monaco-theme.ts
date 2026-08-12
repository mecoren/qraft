/**
 * Monaco 主题工具 —— 跟随应用调色板(data-palette)动态生成 Monaco 主题
 *
 * 供 CodeEditor / DiffEditor 等组件复用:
 * - getThemeName():根据当前 data-palette 返回主题名(qraft-<palette>)
 * - defineThemeFor():基于当前 CSS 变量定义一套与界面一体的 Monaco 主题
 * - useMonacoTheme():监听 data-palette 变化,返回主题名(变化时需重新定义并切换)
 *
 * 颜色转换说明:
 * 本应用的调色板变量大量使用 oklch(),而 Monaco 主题只接受 hex
 * (#rgb / #rgba / #rrggbb / #rrggbbaa)。resolveColor 借助浏览器把变量值解析为
 * rgb(),再转回 hex,保证任意颜色函数都能得到 Monaco 兼容的 hex。
 */

import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';

/** 深色调色板集合,其余视为亮色 */
const DARK_PALETTES = new Set([
  'obsidian',
  'deep-sea',
  'twilight',
  'emerald-night',
  'custom',
]);

/**
 * 读取 :root 上的 CSS 变量,并将其规范化为 Monaco 可接受的 hex 颜色。
 *
 * 重要:Monaco 主题(无论 colors 还是语法高亮 token)只接受 hex
 * (#rgb / #rgba / #rrggbb / #rrggbbaa),不接受 oklch()/oklab()/hsl()/rgb()
 * 等格式。本应用的调色板变量大量使用 oklch(),若直接传入会导致
 * "Illegal value for token color" 错误。
 *
 * 因此这里借助浏览器把变量值解析为 rgb():把变量作为临时元素的 color,
 * 再读取 getComputedStyle(...).color(始终返回 rgb()/rgba()),最后转回 hex。
 * 这样无论变量采用何种颜色函数,最终都能得到 Monaco 兼容的 hex。
 *
 * @param name CSS 变量名(含前导 --)
 * @param fallback 变量缺失或解析失败时的回退 hex
 */
function resolveColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 已是 hex 直接返回
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
    return raw;
  }
  // 借助浏览器把任意格式解析为 rgb()
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.color = raw || fallback;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  return rgbToHex(computed) ?? fallback;
}

/** 把 'rgb()' / 'rgba()' 转为 '#rrggbb' 或 '#rrggbbaa' */
function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return null;
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  const a = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : 255;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a === 255 ? '' : toHex(a)}`;
}

/** 根据当前 data-palette 返回 Monaco 主题名 */
export function getThemeName(): string {
  const palette = document.documentElement.dataset.palette ?? 'daylight';
  return `qraft-${palette}`;
}

/**
 * 根据当前调色板的 CSS 变量,定义一套与界面一体的 Monaco 主题。
 * 语法高亮配色继承 vs / vs-dark 基线,仅覆盖背景、前景、行号、光标等。
 */
export function defineThemeFor(monaco: Monaco, name: string): void {
  const palette = name.replace(/^qraft-/, '') || 'daylight';
  const isDark = DARK_PALETTES.has(palette);

  monaco.editor.defineTheme(name, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editor.foreground': resolveColor('--card-foreground', isDark ? '#e8e8ea' : '#1a1a1e'),
      'editorLineNumber.foreground': resolveColor('--editor-gutter-fg', isDark ? '#888888' : '#888888'),
      'editorLineNumber.activeForeground': resolveColor(
        '--card-foreground',
        isDark ? '#ffffff' : '#1a1a1e',
      ),
      'editorGutter.background': resolveColor('--editor-gutter-bg', isDark ? '#1a1a1e' : '#f5f5f5'),
      // 编辑器选择/高亮/滚动条色读取专用 token,主题切换时自动同步
      // 选中文本背景:柔和淡蓝色(VS Code 同款),硬编码 hex 避免 OKLCH alpha 解析异常
      // - 浅色:#add6ff(淡蓝,VS Code vs 主题默认 selection 背景)
      // - 深色:#264f78(深蓝,VS Code vs-dark 主题默认)
      'editor.selectionBackground': isDark ? '#264f78' : '#add6ff',
      'editor.inactiveSelectionBackground': isDark ? '#1e3a5c' : '#c8dcf2',
      // 当前行高亮：使用 VS Code 同款的柔和浅灰背景(纯 hex,避免 OKLCH alpha
      // 在 Monaco 渲染管线中被解释成刺眼的暖/红色覆盖层)。
      // 浅色主题:#f3f3f3(非常淡的灰,VS Code 默认行高亮背景)
      // 深色主题:#2f2f2f(与 --card 接近的深灰)
      // 边框用 8 位全透明 hex(#00000000),不用 'transparent' 字符串,
      // 避免 Monaco 颜色解析差异导致边框渲染出异常颜色。
      'editor.lineHighlightBackground': isDark ? '#2f2f2f' : '#f3f3f3',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': resolveColor('--primary', isDark ? '#4f7cff' : '#4f7cff'),
      'editorIndentGuide.background': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorIndentGuide.activeBackground': resolveColor('--primary', isDark ? '#4f7cff' : '#4f7cff'),
      'editorWidget.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editorWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorSuggestWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      'editorSuggestWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorHoverWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      'editorBracketMatch.background': resolveColor('--editor-bracket-match-bg', '#4f7cff22'),
      'editorBracketMatch.border': 'transparent',
      'scrollbarSlider.background': resolveColor('--scrollbar-slider-bg', isDark ? '#ffffff1f' : '#0000001f'),
      'scrollbarSlider.hoverBackground': resolveColor('--scrollbar-slider-hover-bg', isDark ? '#ffffff33' : '#00000033'),
      'scrollbarSlider.activeBackground': resolveColor('--scrollbar-slider-active-bg', isDark ? '#ffffff44' : '#00000044'),
      'editorError.foreground': resolveColor('--destructive', isDark ? '#ff6b6b' : '#d11'),
      'editorWarning.foreground': resolveColor('--chart-1', isDark ? '#ffa64d' : '#b9770e'),
      // diff 编辑器差异底色:读取 --diff-add-line / --diff-remove-line(oklch 带 alpha,
      // 经 resolveColor 转为 Monaco 兼容的 hex rgba),让差异高亮贴合应用调色板。
      // 普通 Editor 不使用这些 key,故对其它工具无影响。
      'diffEditor.insertedLineBackground': resolveColor(
        '--diff-add-line',
        isDark ? '#264f7870' : '#d9f2e2',
      ),
      'diffEditor.removedLineBackground': resolveColor(
        '--diff-remove-line',
        isDark ? '#5c323270' : '#fbe4e4',
      ),
      'diffEditor.diagonalFill': '#00000000',
    },
  });
}

/**
 * 监听 <html> 的 data-palette 变化,返回与当前调色板匹配的 Monaco 主题名。
 * 供 Editor / DiffEditor 等组件在主题切换时重新定义并应用主题。
 */
export function useMonacoTheme(): string {
  const [themeName, setThemeName] = useState<string>(() => getThemeName());

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeName(getThemeName()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
    return () => observer.disconnect();
  }, []);

  return themeName;
}
