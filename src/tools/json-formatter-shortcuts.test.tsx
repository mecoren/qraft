import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { JsonFormatter } from './JsonFormatter';
import { clearInputAction, copyOutputAction, executeToolAction } from '@/lib/tool-actions';
import { useShortcut } from '@/hooks/useShortcut';
import { useToolStateStore } from '@/store/toolStateStore';

/** 镜像 App.tsx 的快捷键接线(单测不挂载整个 App) */
function ShortcutHarness(): null {
  useShortcut('execute_tool', () => executeToolAction(), []);
  useShortcut('clear_input', () => clearInputAction(), []);
  useShortcut('copy_output', () => copyOutputAction(), []);
  return null;
}

function textboxes(): HTMLTextAreaElement[] {
  return screen.getAllByRole('textbox') as unknown as HTMLTextAreaElement[];
}

async function type(input: string): Promise<void> {
  const box = textboxes()[0]!;
  fireEvent.change(box, { target: { value: input } });
  await waitFor(() => {
    expect((textboxes()[0] as HTMLTextAreaElement).value).toBe(input);
  });
}

describe('JsonFormatter 全局快捷键', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStateStore.setState({ currentToolId: 'json_formatter' });
  });

  it('Ctrl+Enter 立即格式化(不等防抖)', async () => {
    render(
      <>
        <ShortcutHarness />
        <JsonFormatter toolId="json_formatter" metadata={null as never} />
      </>,
    );
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(
      () => {
        expect(textboxes().some((t) => t.value.includes('"a": 1'))).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('Ctrl+L 清空当前文档输入', async () => {
    render(
      <>
        <ShortcutHarness />
        <JsonFormatter toolId="json_formatter" metadata={null as never} />
      </>,
    );
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes()[0]!.value).toBe('');
    });
  });

  it('Ctrl+Shift+C 复制输出', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <>
        <ShortcutHarness />
        <JsonFormatter toolId="json_formatter" metadata={null as never} />
      </>,
    );
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(
      () => {
        expect(textboxes().some((t) => t.value.includes('"a": 1'))).toBe(true);
      },
      { timeout: 3000 },
    );
    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"a": 1'));
    });
  });
});
