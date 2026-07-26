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

import { RegexTester } from './RegexTester';

describe('RegexTester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pattern input, flags input, test textarea and test button', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/enter regex pattern/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/flags/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter test text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test/i })).toBeInTheDocument();
  });

  it('calls tool_execute with pattern, flags and text', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Pattern: /world/g\nMatches: 1',
      extra: {
        matches: [{ match: 'world', index: 6, groups: [] }],
        match_count: 1,
      },
    });

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter regex pattern/i), {
      target: { value: 'world' },
    });
    fireEvent.change(screen.getByPlaceholderText(/flags/i), {
      target: { value: 'g' },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter test text/i), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'regex_tester',
        input: {
          text: 'hello world',
          params: { pattern: 'world', flags: 'g' },
        },
      });
    });
  });

  it('shows error alert when pattern is invalid', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'regex compile error: unclosed group'),
    );

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/enter regex pattern/i), {
      target: { value: '(unclosed' },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter test text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
