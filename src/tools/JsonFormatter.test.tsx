import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock @/lib/ipc:invokeCommand 用 vi.fn(),CommandError 在 mock 中定义,
// 使组件与测试共用同一个 CommandError 类,instanceof 检查可生效
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

// 导入必须在 mock 声明之后,确保组件拿到的是 mocked 模块
import { JsonFormatter } from './JsonFormatter';

describe('JsonFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input textarea, indent select and format button', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByPlaceholderText(/paste json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /format/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with indent=2 by default on format click', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{\n  "a": 1\n}',
      meta: { input_bytes: 9, output_bytes: 13, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /format/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: '{"a":1}', params: { indent: 2, sort_keys: false } },
      });
    });
  });

  it('displays error message when invoke fails with ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'unexpected token at position 1')
    );

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{invalid}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /format/i }));

    await waitFor(() => {
      // 组件显示 "ERR_PARSE_FAILED: ...",正则匹配下划线形式
      expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
      expect(screen.getByText(/unexpected token/i)).toBeInTheDocument();
    });
  });
});
