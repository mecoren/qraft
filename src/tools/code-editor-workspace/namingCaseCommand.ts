import type { editor, IRange, Position } from 'monaco-editor';
import { Range } from 'monaco-editor';
import { toast } from 'sonner';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_EDITOR_CONFIG } from '@/types/config';
import {
  cycleNamingCase,
  type NamingConventionId,
} from '@/lib/naming-convention';

/**
 * 全局「当前激活的编辑器实例」注册表。
 *
 * 由 EditorWorkbench 在编辑器挂载时注册、卸载时注销。
 * 用途:切换字符命名风格改用全局 useShortcut 监听,不再依赖 Monaco
 * 自身的 keybinding——Monaco keybinding 只在编辑器聚焦时生效、且在
 * WebView 中部分组合键(如 Alt+Shift,可能被输入法/系统占用)不可靠,
 * 并且快捷键变更后依赖 `window.monaco` 的重新注册逻辑会静默失败
 * (该全局变量从未被赋值)。改为 window 级监听后,无论焦点在编辑器内
 * 还是外部,快捷键都能稳定触发。
 */
let activeEditor: editor.IStandaloneCodeEditor | null = null;

/** EditorWorkbench 编辑器挂载时注册为全局激活实例 */
export function registerActiveEditor(ed: editor.IStandaloneCodeEditor): void {
  activeEditor = ed;
}

/** EditorWorkbench 卸载 / 编辑器销毁时注销(仅当仍是该实例时) */
export function unregisterActiveEditor(ed: editor.IStandaloneCodeEditor): void {
  if (activeEditor === ed) activeEditor = null;
}

function getNamingConfig() {
  const config = useConfigStore.getState().config;
  const enabled =
    config?.editor?.namingConvention?.enabled?.length
      ? config.editor.namingConvention.enabled
      : DEFAULT_EDITOR_CONFIG.namingConvention.enabled;
  const order =
    config?.editor?.namingConvention?.order?.length
      ? config.editor.namingConvention.order
      : DEFAULT_EDITOR_CONFIG.namingConvention.order;
  return {
    enabled: enabled as NamingConventionId[],
    order: order as NamingConventionId[],
  };
}

/** 执行一次命名风格循环切换。 */
function executeCycleNamingCase(editorInstance: editor.IStandaloneCodeEditor): void {
  // 防御:编辑器可能已销毁(如切换到对比视图/工具后未注销),此时 model 为 null
  const model = editorInstance.getModel();
  if (!model) return;

  const selection = editorInstance.getSelection();
  const { enabled, order } = getNamingConfig();

  // 无选区时,作用于光标所在的「单词」范围,让快捷键在任意光标位置都可用
  if (!selection || selection.isEmpty()) {
    // selection 可能为 null;若空选区则用光标位置;getPosition() 在编辑器存活时不会返回 null
    const pos: Position | null = selection
      ? selection.getPosition()
      : editorInstance.getPosition();
    if (!pos) return;
    const word = model.getWordAtPosition(pos);
    if (!word) return;
    const range: IRange = {
      startLineNumber: pos.lineNumber,
      endLineNumber: pos.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    const text = model.getValueInRange(Range.lift(range));
    const nextText = cycleNamingCase(text, enabled, order);
    editorInstance.executeEdits('cycle-naming-case', [{ range, text: nextText }]);
    return;
  }

  const selectedText = model.getValueInRange(selection);
  const nextText = cycleNamingCase(selectedText, enabled, order);

  editorInstance.executeEdits('cycle-naming-case', [
    {
      range: selection,
      text: nextText,
    },
  ]);
}

/**
 * 全局快捷键回调:对当前激活的编辑器执行命名风格切换。
 * 无激活编辑器(编辑器工具未打开/未打开文件)时提示用户。
 */
export function cycleNamingCaseShortcutHandler(): void {
  if (!activeEditor) {
    toast.info('请在文本编辑器中选中文字后使用该快捷键');
    return;
  }
  executeCycleNamingCase(activeEditor);
  activeEditor.focus();
}
