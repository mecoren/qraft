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

import { UrlCodec } from './UrlCodec';

describe('UrlCodec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, output, action select and component switch', () => {
    render(<UrlCodec toolId="url_codec" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/enter text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /component/i })).toBeInTheDocument();
  });

  it('calls tool_execute with action=encode, component=false by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello%20world',
    });

    render(<UrlCodec toolId="url_codec" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'url_codec',
        input: { text: 'hello world', params: { action: 'encode', component: false } },
      });
    });
  });

  it('shows error alert when invoke fails with ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid percent encoding'),
    );

    render(<UrlCodec toolId="url_codec" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: '%ZZ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
