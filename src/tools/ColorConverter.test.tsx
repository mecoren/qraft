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

import { ColorConverter } from './ColorConverter';

describe('ColorConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, format select and convert button', () => {
    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/enter color/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text and from_format=hex by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'HEX: #ff5733\nRGB: rgb(255, 87, 51)\nHSL: hsl(11, 100%, 60%)',
      extra: {
        hex: '#ff5733',
        rgb: 'rgb(255, 87, 51)',
        hsl: 'hsl(11, 100%, 60%)',
      },
    });

    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter color/i), {
      target: { value: '#ff5733' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'color_converter',
        input: { text: '#ff5733', params: { from_format: 'hex' } },
      });
    });
  });

  it('shows error alert when input is invalid hex', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "invalid hex characters in 'xyz'")
    );

    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter color/i), {
      target: { value: '#xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
