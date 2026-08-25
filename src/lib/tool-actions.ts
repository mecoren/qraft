/**
 * 工具操作类全局快捷键(Ctrl+Enter 执行 / Ctrl+L 清空输入 / Ctrl+Shift+C 复制输出)的
 * 「激活工具动作」注册表。
 *
 * 范式与 tools/code-editor-workspace/namingCaseCommand.ts 一致:模块级注册表 +
 * 导出的全局 handler,由 App.tsx 的 useShortcut 调用。
 *
 * keepalive 架构下多个工具实例同时挂载,按 toolId 区分注册项;
 * 只有 toolStateStore.currentToolId 指向的工具会被触发。
 * 工具未注册或未提供某个动作时,降级为 toast 提示而非静默失败。
 */
import { toast } from 'sonner';
import { useToolStateStore } from '@/store/toolStateStore';

/** 工具可暴露给全局快捷键的动作集合,缺省项表示该工具不支持此动作 */
export interface ToolShortcutActions {
  execute?: () => void;
  clearInput?: () => void;
  copyOutput?: () => void;
}

const registered = new Map<string, ToolShortcutActions>();

/** 工具挂载时注册动作;传 null 注销(卸载清理路径) */
export function setToolActions(toolId: string, actions: ToolShortcutActions | null): void {
  if (actions === null) {
    registered.delete(toolId);
  } else {
    registered.set(toolId, actions);
  }
}

/** 清空全部注册项,仅供测试隔离使用 */
export function resetToolActions(): void {
  registered.clear();
}

function resolveActive(): ToolShortcutActions | undefined {
  const id = useToolStateStore.getState().currentToolId;
  return id ? registered.get(id) : undefined;
}

/** Ctrl+Enter:执行当前工具 */
export function executeToolAction(): void {
  const action = resolveActive()?.execute;
  if (!action) {
    toast.info('当前工具不支持快捷键执行');
    return;
  }
  action();
}

/** Ctrl+L:清空当前工具输入 */
export function clearInputAction(): void {
  const action = resolveActive()?.clearInput;
  if (!action) {
    toast.info('当前工具不支持快捷键清空输入');
    return;
  }
  action();
}

/** Ctrl+Shift+C:复制当前工具输出 */
export function copyOutputAction(): void {
  const action = resolveActive()?.copyOutput;
  if (!action) {
    toast.info('当前工具暂无可复制的输出');
    return;
  }
  action();
}
