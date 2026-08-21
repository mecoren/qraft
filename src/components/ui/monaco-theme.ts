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
const DARK_PALETTES = new Set(['obsidian', 'deep-sea', 'twilight', 'emerald-night', 'custom']);

/**
 * 颜色解析缓存(按 CSS 变量名)。同一调色板下变量值不变,
 * 主题切换时由 defineThemeFor 清空。避免每次定义主题都对同一批变量
 * 重复创建/读取 DOM 元素(原实现每个变量各做一次建/删元素,主题切换
 * 按变量数量次 DOM 抖动)。
 */
const colorCache = new Map<string, string>();

/** 复用的单个隐藏元素,用于借助浏览器把任意颜色函数解析为 rgb() */
let probeEl: HTMLSpanElement | null = null;
function getProbe(): HTMLSpanElement {
  if (!probeEl) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    probeEl = el;
  }
  return probeEl;
}

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
  const cached = colorCache.get(name);
  if (cached) return cached;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 已是 hex 直接返回
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
    colorCache.set(name, raw);
    return raw;
  }
  // 借助浏览器把任意格式解析为 rgb()(复用单个隐藏元素,避免重复建/删 DOM)
  const el = getProbe();
  el.style.color = raw || fallback;
  const computed = getComputedStyle(el).color;
  const hex = rgbToHex(computed) ?? fallback;
  colorCache.set(name, hex);
  return hex;
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
  // 切换调色板后变量值变化,清空颜色缓存以重新解析
  colorCache.clear();
  const isDark = DARK_PALETTES.has(palette);

  monaco.editor.defineTheme(name, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editor.foreground': resolveColor('--card-foreground', isDark ? '#e8e8ea' : '#1a1a1e'),
      'editorLineNumber.foreground': resolveColor(
        '--editor-gutter-fg',
        isDark ? '#888888' : '#888888',
      ),
      'editorLineNumber.activeForeground': resolveColor(
        '--card-foreground',
        isDark ? '#ffffff' : '#1a1a1e',
      ),
      // 行号 gutter 背景与编辑器背景一致(都读 --card),避免行号栏出现色差;
      // VS Code 默认行为就是 gutter 与编辑区同底色。
      'editorGutter.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
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
      // 缩进参考线:默认线跟随边框色(低对比,几乎不可见);
      // 活动线用非常淡的灰蓝,仅在做弱提示,避免主色蓝高亮喧宾夺主。
      'editorIndentGuide.background': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorIndentGuide.activeBackground': isDark ? '#3a3a40' : '#d0d0d6',
      'editorWidget.background': resolveColor('--card', isDark ? '#1b1b1f' : '#ffffff'),
      'editorWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorSuggestWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      'editorSuggestWidget.border': resolveColor('--border', isDark ? '#333333' : '#e5e5e5'),
      'editorHoverWidget.background': resolveColor('--popover', isDark ? '#222222' : '#ffffff'),
      // 匹配括号高亮:背景使用与光标相同的主题主色(--primary),
      // 但带低透明度(约 15%)作为柔和提示,与光标的实色形成呼应而不刺眼。
      // 保留 `bracketPairColorization` 多色着色能力(它使用独立机制,不依赖此色块)。
      'editorBracketMatch.background': resolveColor('--primary', '#4f7cff') + '26',
      'editorBracketMatch.border': '#00000000',
      'scrollbarSlider.background': resolveColor(
        '--scrollbar-slider-bg',
        isDark ? '#ffffff1f' : '#0000001f',
      ),
      'scrollbarSlider.hoverBackground': resolveColor(
        '--scrollbar-slider-hover-bg',
        isDark ? '#ffffff33' : '#00000033',
      ),
      'scrollbarSlider.activeBackground': resolveColor(
        '--scrollbar-slider-active-bg',
        isDark ? '#ffffff44' : '#00000044',
      ),
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
      // DiffEditor 中间分隔条(sash):悬浮/拖拽高亮为主题主色,
      // 与工具区 ResizableHandle 的悬浮高亮视觉一致
      'sash.hoverBorder': resolveColor('--primary', isDark ? '#4f7cff' : '#4f7cff'),
      // 去除左右编辑器中间的常驻分隔线(diffEditor.border),
      // 让中间默认完全透明,仅在悬浮时显示高亮线,与 ResizableHandle 一致
      'diffEditor.border': '#00000000',
    },
  });
}

/** 固定 VSCode 深色(Visual Studio Dark)主题名,与 app 调色板完全解耦 */
export const VSCODE_THEME_NAME = 'qraft-vscode-dark';

/**
 * 定义一套硬编码的 VSCode vs-dark 配色主题。
 *
 * 与 defineThemeFor 不同,这里不读取任何 CSS 变量,全部使用 VSCode 原生
 * vs-dark 的 hex 值(背景 #1e1e1e、行号 #858585、当前行 #2f2f2f、光标
 * #aeafad、选区 #264f78 等),因此不随应用 data-palette 变化。
 * 语法高亮继承 vs-dark 基线(inherit: true, rules: []),与 VSCode 默认
 * 深色主题观感一致。供 CodeEditor 的 fixedTheme prop 使用。
 */
export function defineVsCodeTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(VSCODE_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorGutter.background': '#1e1e1e',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#1e3a5c',
      'editor.lineHighlightBackground': '#2f2f2f',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#aeafad',
      'editorIndentGuide.background': '#333333',
      'editorIndentGuide.activeBackground': '#4a4a4a',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#454545',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#454545',
      'editorHoverWidget.background': '#252526',
      'editorHoverWidget.border': '#454545',
      // 匹配括号高亮:VSCode 主题下使用与光标(#aeafad)相同的灰,
      // 约 15% 透明度作为柔和提示。
      'editorBracketMatch.background': '#aeafad26',
      'editorBracketMatch.border': '#00000000',
      'scrollbarSlider.background': '#ffffff1f',
      'scrollbarSlider.hoverBackground': '#ffffff33',
      'scrollbarSlider.activeBackground': '#ffffff44',
      'editorError.foreground': '#f48771',
      'editorWarning.foreground': '#cca700',
      'diffEditor.insertedLineBackground': '#264f7870',
      'diffEditor.removedLineBackground': '#5c323270',
      'diffEditor.diagonalFill': '#00000000',
      // DiffEditor 中间分隔条(sash):悬浮/拖拽高亮为主色
      'sash.hoverBorder': '#4f7cff',
      // 去除左右编辑器中间的常驻分隔线,默认透明,悬浮时显示高亮线
      'diffEditor.border': '#00000000',
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
