/**
 * editor-search-registry —— 文本编辑器工作区「tabId → Monaco 实例」注册表。
 *
 * EditorWorkbench 只有一个 Monaco 实例,切换 tab 时 key 变化导致重挂载。
 * 全局搜索文本跳转需要按 tab 拿到对应编辑器实例以应用 decorations 高亮。
 */
import type { editor } from 'monaco-editor';

const registry = new Map<string, editor.IStandaloneCodeEditor>();

/** 编辑器挂载时按 tabId 注册实例 */
export function registerTabEditor(tabId: string, ed: editor.IStandaloneCodeEditor): void {
  registry.set(tabId, ed);
}

/** 编辑器卸载时注销(仅当仍是对应 tab 的实例时) */
export function unregisterTabEditor(tabId: string, ed: editor.IStandaloneCodeEditor): void {
  if (registry.get(tabId) === ed) registry.delete(tabId);
}

/** 按 tabId 取编辑器实例(未挂载 / 已销毁返回 null) */
export function getTabEditor(tabId: string): editor.IStandaloneCodeEditor | null {
  return registry.get(tabId) ?? null;
}

/** 清空全部注册(测试 / 工作区重置用) */
export function clearTabEditors(): void {
  registry.clear();
}
