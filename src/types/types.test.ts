import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ToolCategory, ToolInput, ToolOutput } from './tool';
import type { ThemeMode, ShortcutBinding } from './config';
import type { CommandResponse } from './ipc';

describe('tool types', () => {
  it('ToolInput allows text-only payload', () => {
    const input: ToolInput = { text: 'hello' };
    expectTypeOf(input).toMatchTypeOf<ToolInput>();
    expect(input.text).toBe('hello');
  });

  it('ToolOutput alerts are optional', () => {
    const out: ToolOutput = { text: 'result' };
    expectTypeOf(out).toMatchTypeOf<ToolOutput>();
    expect(out.alerts).toBeUndefined();
  });

  it('ToolCategory includes formatter/encoder', () => {
    const c: ToolCategory = 'formatter';
    expect(['formatter', 'encoder', 'hash', 'generator', 'parser', 'converter']).toContain(c);
  });
});

describe('config types', () => {
  it('ThemeMode has dark/light/system', () => {
    const m: ThemeMode = 'dark';
    expect(m).toBe('dark');
  });

  it('ShortcutBinding has all 10 keys', () => {
    const s: ShortcutBinding = {
      open_command_palette: 'Ctrl+K',
      toggle_sidebar: 'Ctrl+B',
      execute_tool: 'Ctrl+Enter',
      clear_input: 'Ctrl+L',
      copy_output: 'Ctrl+Shift+C',
      toggle_settings: 'Ctrl+,',
      switch_tool: 'Ctrl+P',
      open_history: 'Ctrl+H',
      search: 'Ctrl+F',
      close_panel: 'Esc',
    };
    expect(Object.keys(s)).toHaveLength(10);
  });
});

describe('ipc types', () => {
  it('CommandResponse success carries data', () => {
    const r: CommandResponse<string> = { success: true, data: 'ok' };
    expect(r.data).toBe('ok');
  });

  it('CommandResponse failure carries error', () => {
    const r: CommandResponse<string> = {
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad' },
    };
    expect(r.error?.code).toBe('ERR_PARSE_FAILED');
  });
});
