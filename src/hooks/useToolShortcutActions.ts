/**
 * 把工具实例的动作注册进 lib/tool-actions 全局注册表,
 * 供 Ctrl+Enter / Ctrl+L / Ctrl+Shift+C 触达当前激活工具。
 *
 * actions 经 latest-ref 转发:回调始终读取最新渲染的闭包,
 * 因此调用方无需把 input/output 等 state 列入任何依赖数组。
 */
import { useEffect, useRef } from 'react';
import { setToolActions, type ToolShortcutActions } from '@/lib/tool-actions';

export function useToolShortcutActions(toolId: string, actions: ToolShortcutActions): void {
  const latestRef = useRef<ToolShortcutActions>(actions);

  useEffect(() => {
    latestRef.current = actions;
  });

  useEffect(() => {
    setToolActions(toolId, {
      execute: () => latestRef.current.execute?.(),
      clearInput: () => latestRef.current.clearInput?.(),
      copyOutput: () => latestRef.current.copyOutput?.(),
    });
    return () => setToolActions(toolId, null);
  }, [toolId]);
}
