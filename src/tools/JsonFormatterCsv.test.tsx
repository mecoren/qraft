import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/ipc', () => {
  class CommandError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    invokeCommand: vi.fn(),
    CommandError,
    safeInvoke: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'mock', message: 'mocked' } }),
    ),
  };
});

import { JsonFormatter } from './JsonFormatter';
import { useJsonFormatterStore } from './jsonFormatterStore';

describe('JsonFormatter CSV 转换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useJsonFormatterStore.setState({
      docs: [{ id: 'default', title: 'json-1', autoTitle: 'json-1', pinned: false, content: '' }],
      activeDocId: 'default',
      history: [],
      ready: false,
      userTouched: false,
      error: null,
    });
  });

  const getInputEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('input').querySelector('textarea')!;

  const getOutputValue = (): string =>
    screen.getByTestId('output').querySelector('textarea')!.value;

  it('converts an object array to CSV via the convert dropdown', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '[{"name":"a","ok":true},{"name":"b","ok":false}]' },
    });
    screen.getByTestId('btn-convert').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('convert-csv'));

    // RFC 4180:CRLF 行尾;列取键并集。
    // jsdom textarea 会把 \r 规格化为 \n(HTML 规范的 API 差异),断言按 LF 比对;
    // 复制按钮拿到的仍是原始 CRLF 文本(getOutputText 走 state 而非 textarea value)。
    await waitFor(() => {
      expect(getOutputValue()).toBe('name,ok\na,true\nb,false');
    });
  });

  it('quotes CSV fields containing delimiters, quotes or newlines', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '[{"msg":"a,b","quote":"say \\"hi\\""}]' },
    });
    screen.getByTestId('btn-convert').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('convert-csv'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('msg,quote\n"a,b","say ""hi"""');
    });
  });

  it('reports honestly when the root is not an object array for CSV conversion', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    screen.getByTestId('btn-convert').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('convert-csv'));

    // 根是对象但不是「对象数组」:如实报错,不静默输出错误结构
    await waitFor(() => {
      expect(getOutputValue()).toMatch(/无法生成 CSV|不是对象数组/);
    });
  });
});
