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

import { Base64Codec } from './Base64Codec';

describe('Base64Codec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, output, action select and url_safe switch', () => {
    render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /执行/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /URL 安全/ })).toBeInTheDocument();
  });

  it('calls tool_execute with action=encode by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'aGVsbG8=' });

    render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /执行/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: { text: 'hello', params: { action: 'encode', url_safe: false } },
      });
    });
  });

  it('shows error alert when invoke fails with ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid base64'),
    );

    render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: '!!!' } });
    fireEvent.click(screen.getByRole('button', { name: /执行/ }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
