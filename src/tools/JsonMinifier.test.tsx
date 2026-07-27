import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/ipc', () => {
  class CommandError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'CommandError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    invokeCommand: vi.fn(),
    CommandError,
  };
});

import { JsonMinifier } from './JsonMinifier';

describe('JsonMinifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input editor and minify button', () => {
    render(<JsonMinifier toolId="json_minifier" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /压缩/ })).toBeInTheDocument();
  });

  it('calls tool_execute with text on minify click', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{"a":1,"b":2}',
      meta: { input_bytes: 20, output_bytes: 13, duration_ms: 0 },
    });

    render(<JsonMinifier toolId="json_minifier" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: '{\n  "a": 1,\n  "b": 2\n}' } });
    fireEvent.click(screen.getByRole('button', { name: /压缩/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_minifier',
        input: { text: '{\n  "a": 1,\n  "b": 2\n}', params: {} },
      });
    });
  });

  it('shows error alert on ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'trailing characters'),
    );

    render(<JsonMinifier toolId="json_minifier" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: '{bad}' } });
    fireEvent.click(screen.getByRole('button', { name: /压缩/ }));

    await waitFor(() => {
      // 组件显示 "ERR_PARSE_FAILED: ..."
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
