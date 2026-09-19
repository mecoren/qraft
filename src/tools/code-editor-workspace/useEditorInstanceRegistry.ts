/**
 * Monaco 实例与 model 的生命周期登记
 *
 * 从 EditorWorkbench 拆出:编辑器实例只有一个(切 Tab 换 model 而非重挂载),
 * 因此「谁持有实例」「哪个 model 还活着」需要集中登记:
 * - onMount:把实例登记为全局激活编辑器(命名风格快捷键用)、注入 monaco 命名
 *   空间(model 释放用)、按 tabId 建索引(搜索跳转 / 位置历史恢复用),并开始
 *   记录光标位置历史;
 * - 切 Tab:实例不变,登记表跟着换 key,否则按 tabId 取实例的调用方拿不到;
 * - 关 Tab:释放对应 model(undo 栈随之回收);
 * - 卸载:注销实例并清空池化 model,避免反复进出工具单调泄漏。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { registerActiveEditor, unregisterActiveEditor } from './namingCaseCommand';
import { registerTabEditor, clearTabEditors } from '@/lib/editor-search-registry';
import { registerMonacoInstance, disposeModel, disposePooledModels } from './editorModelRegistry';
import { recordEditLocation } from './editLocationHistory';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import type { EditorTab } from './schema';

export function useEditorInstanceRegistry({
  tabs,
  activeTabId,
}: {
  /** 当前工作区 Tab 列表(store 订阅值,关闭 Tab 时据此释放 model) */
  tabs: EditorTab[];
  /** 当前激活 Tab id(实例唯一,登记表随它换 key) */
  activeTabId: string | null;
}): {
  /** CodeEditor 的 onMount 回调 */
  handleEditorMount: (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
} {
  const activeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  /** 上一帧已知的 Tab id 集合:Tab 关闭时对消失项释放 Monaco model(池化清理) */
  const knownTabIdsRef = useRef<string[]>([]);

  // 挂载时把编辑器实例注册到全局「激活编辑器」注册表,供 cycle_naming_case
  // 全局快捷键(useShortcut)使用;并按当前 tab 注册到 tabId→实例注册表,
  // 供全局搜索文本跳转定位高亮;卸载时同时注销。
  // 光标变化 → 记录位置历史(Alt+Left/Right 后退/前进的输入源)。
  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      activeEditorRef.current = editorInstance;
      registerActiveEditor(editorInstance);
      // model 池化配套:monaco 实例注入注册表,供 Tab 关闭时按 tabId 释放 model
      registerMonacoInstance(monaco as unknown as typeof import('monaco-editor'));
      const tabId = useEditorWorkspaceStore.getState().workspace.activeTabId;
      if (tabId) registerTabEditor(tabId, editorInstance);
      // 位置历史:光标/选区变化时记录(模块内部做时间与跳距合并节流)
      editorInstance.onDidChangeCursorPosition((e) => {
        const current = useEditorWorkspaceStore.getState().workspace.activeTabId;
        if (current) {
          recordEditLocation({
            tabId: current,
            line: e.position.lineNumber,
            column: e.position.column,
          });
        }
      });
    },
    [],
  );

  /**
   * Tab 关闭时释放对应 model(model 池化的清理侧):
   * 监听 tabs,对消失的 tabId 调 disposeModel——undo 栈随 model
   * 释放,防止已关闭 Tab 的 model 常驻内存。批量关闭(全部关闭/关闭其他)
   * 同样经此 effect 逐个释放。
   */
  useEffect(() => {
    const valid = new Set(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id));
    for (const tabId of knownTabIdsRef.current) {
      if (!valid.has(tabId)) disposeModel(tabId);
    }
    knownTabIdsRef.current = [...valid];
  }, [tabs]);

  /**
   * 激活 Tab 变化 → 同步 tabId→编辑器实例注册表(池化配套):
   * 切 Tab 不重挂编辑器(onMount 不再触发),注册表停留在挂载那一刻的
   * tabId——按 tabId 取实例的调用方(全局搜索跳转 / 位置历史恢复)在
   * 其它 Tab 上会拿到 null 而重试失败。这里随 activeTabId 把当前唯一
   * 实例重新注册到新 tabId(旧 tabId 条目保留无害:实例相同,getModel
   * 经 modelKey 切换恒命中当前 model)。
   */
  useEffect(() => {
    const ed = activeEditorRef.current;
    if (activeTabId && ed) {
      registerTabEditor(activeTabId, ed);
    }
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      const ed = activeEditorRef.current;
      if (ed) unregisterActiveEditor(ed);
      activeEditorRef.current = null;
      // 工作台卸载 = 全部 tab 的编辑器实例均已销毁,清空整个 tabId→实例注册表,
      // 避免残留已销毁实例引用(跳转重试时 getModel() 返回 null 会误判)。
      clearTabEditors();
      // 池化 model 的兜底清理:库卸载只 dispose 当前 model,非激活 Tab 的
      // model(全文 + undo 栈)会残留全局注册表,反复进出工具即单调泄漏
      disposePooledModels();
    };
  }, []);

  return { handleEditorMount };
}
