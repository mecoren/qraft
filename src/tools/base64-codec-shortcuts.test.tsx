import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  CommandError: class CommandError extends Error {},
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { Base64Codec } from './Base64Codec';
import { clearInputAction, executeToolAction } from '@/lib/tool-actions';
import { useShortcut } from '@/hooks/useShortcut';
import { useToolStateStore } from '@/store/toolStateStore';

/** 镜像 App.tsx 的快捷键接线(单测不挂载整个 App) */
function ShortcutHarness(): null {
  useShortcut('execute_tool', () => executeToolAction(), []);
  useShortcut('clear_input', () => clearInputAction(), []);
  return null;
}

function textboxes(): HTMLTextAreaElement[] {
  return screen.getAllByRole('textbox') as unknown as HTMLTextAreaElement[];
}

describe('Base64Codec 全局快捷键', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
  });

  it('Ctrl+Enter 立即解码(decode 默认方向,text 模式)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello',
      meta: { input_bytes: 8, output_bytes: 5, duration_ms: 1 },
    });
    render(
      <>
        <ShortcutHarness />
        <Base64Codec toolId="base64_codec" metadata={null as never} />
      </>,
    );
    fireEvent.change(textboxes()[0]!, { target: { value: 'aGVsbG8=' } });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith(
          'tool_execute',
          expect.objectContaining({ toolId: 'base64_codec' }),
        );
        expect(textboxes().some((t) => t.value === 'hello')).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('Ctrl+L 清空输入并复位工作区', async () => {
    render(
      <>
        <ShortcutHarness />
        <Base64Codec toolId="base64_codec" metadata={null as never} />
      </>,
    );
    fireEvent.change(textboxes()[0]!, { target: { value: 'aGVsbG8=' } });
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes()[0]!.value).toBe('');
    });
  });
});
