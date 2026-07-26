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

import { HashCalculator } from './HashCalculator';

describe('HashCalculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders algorithm select, text input and compute button', () => {
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/enter text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compute/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text + algorithm=sha256 by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /compute/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'hash_calculator',
        input: { text: 'hello', params: { algorithm: 'sha256' } },
      });
    });
  });

  it('shows error alert when invalid algorithm is used', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_INVALID_INPUT', "algorithm must be one of md5/sha1/sha256/sha512/blake3, got 'crc32'")
    );

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /compute/i }));

    await waitFor(() => {
      expect(screen.getByText(/INVALID_INPUT/i)).toBeInTheDocument();
    });
  });
});
