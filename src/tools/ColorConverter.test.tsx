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

/** 模拟后端返回的 extra(与 color_converter.rs 输出对齐) */
const okExtra = {
  hex: '#ff5733',
  rgb: 'rgb(255, 87, 51)',
  hsl: 'hsl(11, 100%, 60%)',
  hsv: 'hsv(11, 80%, 100%)',
  cmyk: 'cmyk(0%, 66%, 80%, 0%)',
  alpha: 1,
  nearest_name: 'tomato',
};

function type(text: string): void {
  fireEvent.change(screen.getByTestId('input'), { target: { value: text } });
}

describe('ColorConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染输入、取色器、格式选择器与预览区;无「转换」按钮', () => {
    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('color-picker')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^转换$/ })).not.toBeInTheDocument();
  });

  it('默认 auto 格式:输入后防抖自动调用 tool_execute(from_format=auto)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'HEX: #ff5733',
      extra: okExtra,
    });

    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    type('#ff5733');

    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
          toolId: 'color_converter',
          input: { text: '#ff5733', params: { from_format: 'auto' } },
        });
      },
      { timeout: 3000 },
    );
  });

  it('结果渲染 HEX/RGB/HSL/HSV/CMYK/色名行与明暗梯度', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'HEX: #ff5733',
      extra: okExtra,
    });

    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    type('#ff5733');

    await waitFor(
      () => {
        expect(screen.getByTestId('color-hsv')).toHaveTextContent('hsv(11, 80%, 100%)');
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId('color-cmyk')).toHaveTextContent('cmyk');
    expect(screen.getByTestId('color-name')).toHaveTextContent('tomato');
    expect(screen.getByTestId('color-shades')).toBeInTheDocument();
  });

  it('解析失败时显示错误 alert', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "invalid hex characters in 'xyz'"),
    );

    render(<ColorConverter toolId="color_converter" metadata={null as never} />);
    type('#xyz');

    await waitFor(
      () => {
        expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
