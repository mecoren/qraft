/**
 * 编辑器 model 池注册表 —— 按 tabId 管理 Monaco model 的生命周期
 *
 * 背景:EditorWorkbench 原先用 `key={activeTab.id}` 让每个 Tab 独占一个
 * CodeEditor(内含 Monaco editor 实例),切 Tab = 销毁重建,Monaco 的
 * undo 栈挂在 model 上随实例一起 dispose——用户改一半切走再切回,Ctrl+Z
 * 就失效了(VSCode/Zed 的每文件 undo 栈是跨切换存活的)。
 *
 * 池化方案(本模块 + CodeEditor 的 modelKey prop):
 * - CodeEditor 收到 `modelKey` 时把它传给 @monaco-editor/react 的
 *   `<Editor path>`;该库对 path 做 `getModel(uri) ?? createModel(...)`
 *   缓存——path 变化即 `setModel` 切换(编辑器实例不重挂载,undo 栈随
 *   model 常驻),还自动保存/恢复各 path 的 viewState(滚动位置/选区)。
 * - 本模块补齐「释放」一侧:Tab 关闭时按 tabId dispose 对应 model
 *   (undo 栈随 model 释放,避免内存无界增长)。
 *
 * monaco 实例来源:@monaco-editor/react 的 `useMonaco()` 在编辑器未挂载
 * 时是 undefined,异步 loader 完成后才有值;因此 disposeModel 做成
 * best-effort——monaco 未就绪时静默跳过(此时也必然没有 model 可释放)。
 */
import type { editor } from 'monaco-editor';

/** 当前已加载的 monaco 命名空间(由 EditorWorkbench 挂载后注入) */
let monacoInstance: typeof import('monaco-editor') | null = null;

/** modelKey → Monaco model URI 的稳定映射约定(tabId 直接作为 URI path) */
function uriFor(key: string): unknown {
  return monacoInstance?.Uri.parse(`inmemory://tab/${key}`);
}

/** EditorWorkbench 编辑器挂载后注入 monaco 实例(onMount 回调里调用) */
export function registerMonacoInstance(monaco: typeof import('monaco-editor')): void {
  monacoInstance = monaco;
}

/**
 * 释放指定 tabId 的 model(Tab 关闭时调用)。
 * best-effort:monaco 未就绪或 model 不存在时静默 no-op。
 */
export function disposeModel(tabId: string): void {
  if (!monacoInstance) return;
  const uri = uriFor(tabId);
  if (!uri) return;
  const model = monacoInstance.editor.getModel(uri as never);
  model?.dispose();
}

/**
 * 释放池中的全部 model(工作台整体卸载时调用)。
 *
 * @monaco-editor/react 卸载只 dispose **当前** model,非激活 Tab 的池化
 * model(整份文本 + undo 栈)会残留在全局 ModelServices 注册表;反复
 * 进出编辑器工具即单调泄漏。uriFor 的 `inmemory://tab/` 前缀是本模块与
 * 库 `path` prop 的共用约定,按同一约定反查清理,不误伤其它来源的 model。
 */
export function disposePooledModels(): void {
  if (!monacoInstance) return;
  for (const model of monacoInstance.editor.getModels()) {
    if (model.uri.toString().startsWith('inmemory://tab/')) model.dispose();
  }
}

/** 供测试诊断:当前 monaco 实例是否已注册 */
export function isMonacoRegistered(): boolean {
  return monacoInstance !== null;
}

/** 类型再导出:调用方持有 editor 实例类型时的便利 */
export type { editor };
