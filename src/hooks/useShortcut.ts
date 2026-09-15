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
import { useToolStateStore } from '@/store/toolStateStore';
import { isPopoutWindow } from '@/lib/popout-window';
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
 * 快捷键 handler:匹配时执行。
 * 返回 false 表示不消费该事件(不 preventDefault/不 stopPropagation),
 * 让按键继续传递给深层组件处理 —— 典型场景:无面板可关时把 Esc 还给
 * Monaco 查找部件(原生 Esc 关闭)。其余返回值/void 均视为已消费。
 */
export type ShortcutHandler = (e: KeyboardEvent) => void | false;

/**
 * 判断某工具的工具级快捷键当前是否应响应。
 *
 * 页面/工具均 keepalive 常驻挂载,`useShortcut` 监听在 window 捕获阶段,
 * 两个常驻工具的同类绑定会同时触发且 stopPropagation 拦不住(同元素
 * 多监听器互相独立执行)。因此工具级快捷键(保存/打开等编辑类动作)必须
 * 由归属工具声明,仅当「当前激活工具 === 归属工具」时响应;
 * 弹窗窗口单工具独占视口且无 currentToolId 概念,视同激活。
 */
export function isToolShortcutActive(toolId: string): boolean {
  if (isPopoutWindow()) return true;
  return useToolStateStore.getState().currentToolId === toolId;
}

/**
 * 注册带归属工具守卫的工具级快捷键。
 *
 * 与 `useShortcut` 的差别:非激活时 handler 不执行并**放行**事件(返回
 * false 语义),让激活侧的同名绑定(若有)接管消费;激活时行为与
 * `useShortcut` 完全一致(消费并阻止默认动作)。应用级快捷键(设置/
 * 命令面板等)仍用 `useShortcut`。
 */
export function useToolShortcut(
  toolId: string,
  key: ShortcutKey,
  handler: ShortcutHandler,
  deps: readonly unknown[],
): void {
  useShortcut(key, (e) => (isToolShortcutActive(toolId) ? handler(e) : false), [toolId, ...deps]);
}

/**
 * 注册全局快捷键。
 *
 * @param key ShortcutBinding 中的键名(如 'toggle_settings')
 * @param handler 匹配时执行的回调;返回 false 放行事件(见 ShortcutHandler 说明)
 * @param deps 依赖数组(与 useEffect deps 语义一致),handler 中引用的外部变量需列入
 */
export function useShortcut(
  key: ShortcutKey,
  handler: ShortcutHandler,
  deps: readonly unknown[],
): void {
  // 仅订阅该快捷键对应的单个字符串(而非整个 config 对象),
  // 避免切换主题/字体等无关配置变更时触发本 hook 重渲染并重建监听器。
  const combo = useConfigStore((s) => s.config?.shortcuts[key] ?? DEFAULT_SHORTCUTS[key]);

  useEffect(() => {
    const parsed = parseShortcut(combo);
    if (!parsed) return;

    const onKey = (e: KeyboardEvent) => {
      // 长按产生的自动重复事件全部忽略:现有绑定均为离散动作(开关面板/执行/复制),
      // 连发只会造成误触。若未来出现需要长按连发的绑定,应单独豁免。
      if (e.repeat) return;
      if (!matchesShortcut(e, parsed)) return;
      // 先执行 handler 再决定是否吞事件:若在捕获阶段先 stopPropagation,
      // Monaco 等深层 DOM 将永远收不到按键,handler 无从"放行"。
      if (handler(e) === false) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // 使用捕获阶段监听:保证在事件到达 Monaco 等深层 DOM 元素之前触发。
    // 冒泡阶段监听可能被编辑器(如 Monaco)在内部 stopPropagation 拦截,
    // 导致快捷键在编辑器聚焦时失效。
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, ...deps]);
}
