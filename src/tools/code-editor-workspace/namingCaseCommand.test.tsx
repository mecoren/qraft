import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { useShortcut } from '@/hooks/useShortcut';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import {
  registerActiveEditor,
  unregisterActiveEditor,
  cycleNamingCaseShortcutHandler,
  toggleCaseShortcutHandler,
} from './namingCaseCommand';
import type { editor } from 'monaco-editor';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/** 可控假编辑器:模拟 Monaco 实例,记录 executeEdits 写入的文本 */
function createFakeEditor(text: string) {
  let current = text;
  const writes: string[] = [];
  const editor = {
    isDisposed: () => false,
    getModel: () => ({
      // 无选区时命中光标所在单词,返回单词范围
      getWordAtPosition: () => ({
        word: current,
        startColumn: 1,
        endColumn: current.length + 1,
      }),
      getValueInRange: () => current,
    }),
    getSelection: () => null,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    executeEdits: (_id: string, edits: Array<{ text: string }>) => {
      for (const e of edits) {
        writes.push(e.text);
        current = e.text;
      }
    },
    focus: vi.fn(),
    current: () => current,
    writes,
  };
  return editor as unknown as editor.IStandaloneCodeEditor & {
    current: () => string;
    writes: string[];
  };
}

function Harness({ onFire }: { onFire: () => void }) {
  useShortcut('cycle_naming_case', onFire, []);
  return <div>harness</div>;
}

beforeEach(() => {
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
});

afterEach(() => {
  // 清空全局激活编辑器,避免测试间泄漏
  const fake = {} as editor.IStandaloneCodeEditor;
  try {
    unregisterActiveEditor(fake);
  } catch {
    // no-op
  }
});

describe('cycle_naming_case global shortcut', () => {
  it('fires handler via useShortcut on Ctrl+Shift+U', async () => {
    const user = userEvent.setup();
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}');
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('handler switches the active editor word casing', () => {
    const ed = createFakeEditor('hello_world');
    registerActiveEditor(ed);
    cycleNamingCaseShortcutHandler();
    // 默认顺序下 snake_case → 下一个启用风格(应为非 hello_world)
    expect(ed.writes.length).toBeGreaterThan(0);
    expect(ed.writes[0]).not.toBe('hello_world');
    unregisterActiveEditor(ed as unknown as editor.IStandaloneCodeEditor);
  });

  it('shows info toast when no active editor', () => {
    const infoMock = toast.info as unknown as ReturnType<typeof vi.fn>;
    // 确保没有注册任何编辑器
    const stale = createFakeEditor('x');
    registerActiveEditor(stale);
    unregisterActiveEditor(stale as unknown as editor.IStandaloneCodeEditor);
    cycleNamingCaseShortcutHandler();
    expect(infoMock).toHaveBeenCalled();
  });
});

describe('toggle_case global shortcut', () => {
  it('handler toggles word casing on the active editor', () => {
    const ed = createFakeEditor('hello');
    registerActiveEditor(ed);
    toggleCaseShortcutHandler();
    // 小写 → 大写
    expect(ed.writes).toEqual(['HELLO']);
    // 再次触发:大写 → 小写
    toggleCaseShortcutHandler();
    expect(ed.writes[ed.writes.length - 1]).toBe('hello');
    unregisterActiveEditor(ed as unknown as editor.IStandaloneCodeEditor);
  });

  it('shows info toast when no active editor', () => {
    const infoMock = toast.info as unknown as ReturnType<typeof vi.fn>;
    const stale = createFakeEditor('x');
    registerActiveEditor(stale);
    unregisterActiveEditor(stale as unknown as editor.IStandaloneCodeEditor);
    toggleCaseShortcutHandler();
    expect(infoMock).toHaveBeenCalled();
  });
});
