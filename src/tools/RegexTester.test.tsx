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

  it('renders pattern input, flags input, test editor and test button', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/输入正则表达式/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/标志位/)).toBeInTheDocument();
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /测试/ })).toBeInTheDocument();
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
    fireEvent.change(screen.getByPlaceholderText(/输入正则表达式/), {
      target: { value: 'world' },
    });
    fireEvent.change(screen.getByPlaceholderText(/标志位/), {
      target: { value: 'g' },
    });
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /测试/ }));

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
    fireEvent.change(screen.getByPlaceholderText(/输入正则表达式/), {
      target: { value: '(unclosed' },
    });
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /测试/ }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
