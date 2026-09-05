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

/** 模拟后端返回的 extra(与 timestamp_converter.rs 输出对齐) */
const okExtra = {
  unix_seconds: 1690272000,
  unix_millis: 1690272000000,
  iso8601: '2023-07-25T08:00:00+00:00',
  local: '2023-07-25T08:00:00+00:00',
  relative: '2 days ago',
  relative_seconds: -172800,
  weekday_index: 2,
  day_of_year: 206,
  iso_week: 30,
  utc_offset: '+00:00',
};

function type(text: string): void {
  fireEvent.change(screen.getByTestId('input'), { target: { value: text } });
}

describe('TimestampConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染当前时间横幅、输入、现在按钮与时区选择器', () => {
    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    expect(screen.getByText(/当前时间/)).toBeInTheDocument();
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('ts-now-btn')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // 无「转换」按钮:输入即转换
    expect(screen.queryByRole('button', { name: /^转换$/ })).not.toBeInTheDocument();
  });

  it('输入后防抖自动调用 tool_execute 并渲染结果行', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Unix (seconds): 1690272000',
      extra: okExtra,
    });

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    type('1690272000');
    // 防抖 300ms 后自动触发(真实定时器);local 伪时区解析为真实 IANA 名称
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
          toolId: 'timestamp_converter',
          input: { text: '1690272000', params: { timezone: localTz } },
        });
      },
      { timeout: 3000 },
    );
    await waitFor(() => {
      expect(screen.getAllByText('1690272000').length).toBeGreaterThan(0);
    });
    // 新增字段渲染
    expect(screen.getByText(/UTC 偏移/)).toBeInTheDocument();
    expect(screen.getByText(/年内天/)).toBeInTheDocument();
    expect(screen.getByText(/ISO 周号/)).toBeInTheDocument();
  });

  it('「现在」按钮填入当前毫秒时间戳', async () => {
    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('ts-now-btn'));
    const value = (screen.getByTestId('input') as HTMLInputElement).value;
    expect(value).toMatch(/^\d{13}$/);
    expect(Number(value)).toBeGreaterThanOrEqual(Date.now() - 60_000);
  });

  it('解析失败时显示错误 alert', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "cannot parse 'hello' as timestamp"),
    );

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    type('hello');
    await waitFor(
      () => {
        expect(screen.getByText(/PARSE_FAILED/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('空输入不发请求并回到空态', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: okExtra,
    });
    render(<TimestampConverter toolId="timestamp_converter" metadata={null as never} />);
    type('1690272000');
    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    type('');
    // 清空后回到空态(不再有结果行;空态文案在 output 容器内)
    await waitFor(
      () => {
        expect(screen.getByTestId('output')).toHaveTextContent(/自动转换/);
      },
      { timeout: 3000 },
    );
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });
});
