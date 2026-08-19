import type { editor } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_EDITOR_CONFIG } from '@/types/config';
import {
  cycleNamingCase,
  type NamingConventionId,
} from '@/lib/naming-convention';

/**
 * 将 "Ctrl+Shift+C" / "Shift+Alt+N" 等快捷键字符串解析为 Monaco keybinding。
 *
 * 支持修饰符：Ctrl/CtrlCmd、Shift、Alt、Meta；支持字母键（A-Z）。
 * 解析失败返回 null。
 */
export function parseShortcutToMonacoKeybinding(
  combo: string,
  monaco: Monaco,
): number | null {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  let mod = 0;
  let keyCode: number | null = null;

  for (const part of parts) {
    if (!part) continue;
    if (part === 'ctrl' || part === 'ctrlcmd') {
      mod |= monaco.KeyMod.CtrlCmd;
    } else if (part === 'shift') {
      mod |= monaco.KeyMod.Shift;
    } else if (part === 'alt') {
      mod |= monaco.KeyMod.Alt;
    } else if (part === 'meta') {
      mod |= monaco.KeyMod.WinCtrl;
    } else if (part.startsWith('key') && part.length === 4) {
      const code = monaco.KeyCode[part.toUpperCase() as keyof typeof monaco.KeyCode];
      if (typeof code === 'number') keyCode = code;
    } else if (part.length === 1) {
      const upper = part.toUpperCase();
      if (upper >= 'a' && upper <= 'z') {
        const code = monaco.KeyCode[`Key${upper.toUpperCase()}` as keyof typeof monaco.KeyCode];
        if (typeof code === 'number') keyCode = code;
      }
    }
  }

  if (keyCode === null) return null;
  return mod | keyCode;
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
  const selection = editorInstance.getSelection();
  if (!selection || selection.isEmpty()) return;
  const model = editorInstance.getModel();
  if (!model) return;

  const selectedText = model.getValueInRange(selection);
  const { enabled, order } = getNamingConfig();
  const nextText = cycleNamingCase(selectedText, enabled, order);

  editorInstance.executeEdits('cycle-naming-case', [
    {
      range: selection,
      text: nextText,
    },
  ]);
}

/**
 * 为 Monaco 编辑器注册「循环切换命名风格」命令。
 *
 * @returns 一个 disposable，调用 dispose() 可撤销命令与快捷键。
 */
export function registerNamingCaseCommand(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: Monaco,
  shortcut: string,
): { dispose: () => void } {
  const keybinding = parseShortcutToMonacoKeybinding(shortcut, monaco);
  if (keybinding === null) {
    return { dispose: () => {} };
  }

  const action = editorInstance.addAction({
    id: 'qraft.editor.cycleNamingCase',
    label: 'Cycle Naming Case',
    keybindings: [keybinding],
    run: () => executeCycleNamingCase(editorInstance),
  });

  return {
    dispose: () => {
      action.dispose();
    },
  };
}
