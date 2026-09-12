import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { UuidGenerator } from './UuidGenerator';
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

describe('UuidGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders version select, count input, switches and generate button', () => {
    render(<UuidGenerator toolId="uuid_generator" metadata={null as never} />);
    expect(screen.getByRole('button', { name: /生成/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /大写/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /连字符/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /数量/ })).toBeInTheDocument();
  });

  it('calls tool_execute with default v4 + count=1', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '550e8400-e29b-41d4-a716-446655440000',
    });

    render(<UuidGenerator toolId="uuid_generator" metadata={null as never} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'uuid_generator',
        input: {
          text: undefined,
          params: { version: 'v4', count: 1, uppercase: false, hyphens: true },
        },
      });
    });
  });

  it('displays generated UUIDs in output area', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'uuid1\nuuid2\nuuid3',
    });

    render(<UuidGenerator toolId="uuid_generator" metadata={null as never} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /数量/ }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    await waitFor(() => {
      // 新代布局:结果在 CodeEditor(测试 mock 为受控 textarea)中展示
      const output = screen.getByTestId('output').querySelector('textarea')!;
      expect(output.value).toContain('uuid1');
      expect(output.value).toContain('uuid2');
      expect(output.value).toContain('uuid3');
    });
  });

  it('清空数量输入后兜底为 1,不再把 0 发给后端报错', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'u' });

    render(<UuidGenerator toolId="uuid_generator" metadata={null as never} />);
    // 清空输入框:Number('')=NaN,旧实现把 NaN/0 直接发给后端触发 ERR_INVALID_INPUT
    fireEvent.change(screen.getByRole('spinbutton', { name: /数量/ }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'uuid_generator',
        input: {
          text: undefined,
          params: { version: 'v4', count: 1, uppercase: false, hyphens: true },
        },
      });
    });
  });

  it('Ctrl+Enter 快捷键触发生成(接线回归)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'u' });

    useToolStateStore.setState({ currentToolId: 'uuid_generator' });
    render(
      <>
        <ShortcutHarness />
        <UuidGenerator toolId="uuid_generator" metadata={null as never} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'uuid_generator',
        input: {
          text: undefined,
          params: { version: 'v4', count: 1, uppercase: false, hyphens: true },
        },
      });
    });
  });
});
