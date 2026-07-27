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

import { TimestampConverter } from './TimestampConverter';

describe('TimestampConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, timezone select and convert button', () => {
    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/输入时间戳或日期字符串/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /转换/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text and default UTC timezone', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Unix (seconds): 1690272000',
      extra: {
        unix_seconds: 1690272000,
        unix_millis: 1690272000000,
        iso8601: '2023-07-25T08:00:00+00:00',
        local: '2023-07-25T08:00:00+00:00',
        relative: '2 days ago',
      },
    });

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/输入时间戳或日期字符串/), {
      target: { value: '1690272000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /转换/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'timestamp_converter',
        input: { text: '1690272000', params: { timezone: 'UTC' } },
      });
    });
  });

  it('shows error alert when input is unparseable', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "cannot parse 'hello' as timestamp"),
    );

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/输入时间戳或日期字符串/), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /转换/ }));

    await waitFor(() => {
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
    });
  });
});
