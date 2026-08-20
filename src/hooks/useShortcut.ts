/**
 * 全局快捷键 hook
 *
 * 从 configStore 读取用户配置的快捷键字符串(如 "Ctrl+Shift+C"),
 * 解析为修饰键 + 主键,在 window 上注册 keydown 监听器。
 *
 * 用法:
 *   useShortcut('toggle_settings', () => setView('settings'), []);
 *
 * 快捷键字符串格式:
 *   "Ctrl+K" / "Ctrl+Shift+C" / "Esc" / "Ctrl+," / "Ctrl+Enter"
 *   修饰键不区分大小写,主键不区分大小写(但 Enter/Escape 等特殊键需匹配 KeyEvent.key)。
 */

import { useEffect } from 'react';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_SHORTCUTS, type ShortcutBinding } from '@/types/config';

/** ShortcutBinding 的 key 集合 */
export type ShortcutKey = keyof ShortcutBinding;

/** 解析后的快捷键结构 */
interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** 标准化后的主键名(小写),如 'k' / ',' / 'enter' / 'escape' */
  key: string;
}

/**
 * 将 "Ctrl+Shift+C" 格式字符串解析为结构化对象。
 * 返回 null 表示格式无效。
 */
function parseShortcut(combo: string): ParsedShortcut | null {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  if (parts.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = '';

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        ctrl = true;
        break;
      case 'shift':
        shift = true;
        break;
      case 'alt':
        alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'super':
      case 'win':
        meta = true;
        break;
      default:
        if (key) return null; // 多个主键,格式无效
        key = part;
    }
  }

  if (!key) return null;

  // 特殊键名标准化:Enter/Escape/Space 等
  const keyMap: Record<string, string> = {
    esc: 'escape',
    enter: 'enter',
    space: ' ',
    tab: 'tab',
    backspace: 'backspace',
    del: 'delete',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
  };

  return { ctrl, shift, alt, meta, key: keyMap[key] ?? key };
}

/** 判断 KeyboardEvent 是否匹配解析后的快捷键 */
function matchesShortcut(e: KeyboardEvent, sc: ParsedShortcut): boolean {
  // Ctrl 与 Meta 在 macOS 上互换(Cmd 对应 Meta)
  const ctrlOrMeta = sc.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
  if (!ctrlOrMeta) return false;
  if (sc.shift !== e.shiftKey) return false;
  if (sc.alt !== e.altKey) return false;
  // sc.meta 已由 ctrlOrMeta 处理(macOS Cmd 场景)
  const eventKey = e.key.toLowerCase();
  return eventKey === sc.key;
}

/**
 * 注册全局快捷键。
 *
 * @param key ShortcutBinding 中的键名(如 'toggle_settings')
 * @param handler 匹配时执行的回调
 * @param deps 依赖数组(与 useEffect deps 语义一致),handler 中引用的外部变量需列入
 */
export function useShortcut(key: ShortcutKey, handler: () => void, deps: readonly unknown[]): void {
  // 仅订阅该快捷键对应的单个字符串(而非整个 config 对象),
  // 避免切换主题/字体等无关配置变更时触发本 hook 重渲染并重建监听器。
  const combo = useConfigStore((s) => s.config?.shortcuts[key] ?? DEFAULT_SHORTCUTS[key]);

  useEffect(() => {
    const parsed = parseShortcut(combo);
    if (!parsed) return;

    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, parsed)) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };
    // 使用捕获阶段监听:保证在事件到达 Monaco 等深层 DOM 元素之前触发。
    // 冒泡阶段监听可能被编辑器(如 Monaco)在内部 stopPropagation 拦截,
    // 导致快捷键在编辑器聚焦时失效。
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, ...deps]);
}
