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

import { JwtParser } from './JwtParser';

const VALID_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('JwtParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders JWT input textarea and parse button', () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/paste jwt token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /parse/i })).toBeInTheDocument();
  });

  it('displays header, payload, signature on successful parse', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Header:\n{\n  "alg": "HS256"\n}\n\nPayload:\n{\n  "sub": "123"\n}',
      extra: {
        header: { alg: 'HS256', typ: 'JWT' },
        payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
        signature: 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      },
    });

    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/paste jwt token/i), {
      target: { value: VALID_JWT },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await waitFor(() => {
      expect(screen.getByText(/Header/i)).toBeInTheDocument();
      expect(screen.getByText(/Payload/i)).toBeInTheDocument();
      expect(screen.getByText(/Signature/i)).toBeInTheDocument();
    });
  });

  it('shows error alert when JWT has only 2 segments', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_INVALID_INPUT', 'JWT must have 3 segments')
    );

    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/paste jwt token/i), {
      target: { value: 'only.two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await waitFor(() => {
      expect(screen.getByText(/INVALID_INPUT/i)).toBeInTheDocument();
    });
  });
});
