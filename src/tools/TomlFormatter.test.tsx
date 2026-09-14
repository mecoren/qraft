import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TomlFormatter } from './TomlFormatter';

// CodeEditor → textarea shim(对齐 YamlFormatter 测试;Monaco jsdom 加载不可行)
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
    actions?: React.ReactNode;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
      <textarea
        aria-label="input"
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.actions}
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// 整模块 mock ipc:invokeCommand 换 vi.fn(),CommandError 保留类形态
// (组件 catch 后 instanceof CommandError 判断依赖类标识)
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

/** 拿到被 mock 的 invokeCommand 与 CommandError 类 */
async function mockIpc() {
  const { invokeCommand, CommandError } = await import('@/lib/ipc');
  return {
    invokeCommand: invokeCommand as unknown as ReturnType<typeof vi.fn>,
    CommandError: CommandError as unknown as new (
      code: string,
      message: string,
      details?: unknown,
    ) => Error,
  };
}

describe('TomlFormatter 组件', () => {
  it('输入后防抖调用 tool_execute 传 indent 与格式化参数', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockResolvedValue({
      text: 'a = 1\n',
      meta: { duration_ms: 1, input_bytes: 4, output_bytes: 6 },
    });

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a=1\n' },
    });

    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
          toolId: 'toml_formatter',
          input: {
            text: 'a=1\n',
            params: { indent: 2, align_entries: false, reorder_keys: false },
          },
        });
      },
      { timeout: 3000 },
    );
    expect(await screen.findByTestId('tomlfmt-output-text')).toHaveTextContent('a = 1');
  });

  it('成功时输出统计 meta', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockResolvedValue({
      text: 'a = 1\n',
      meta: { duration_ms: 2, input_bytes: 4, output_bytes: 6 },
    });

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a=1\n' },
    });

    const stats = await screen.findByTestId('tomlfmt-stats', {}, { timeout: 3000 });
    expect(stats).toHaveTextContent('2 ms');
    expect(stats).toHaveTextContent('4 B');
  });

  it('非法输入显示错误消息与定位 chip(L:C 按 offset 换算)', async () => {
    const { invokeCommand, CommandError } = await mockIpc();
    // Rust 侧 ParseFailed 消息形如 [offset=10] L2:C1 expected ","(CommandError 才带定位)
    invokeCommand.mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', '[offset=10] L2:C1 expected ","'),
    );

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a = [1, 2\nb = 3\n' },
    });

    // findByTestId 只等挂载(防抖未完),错误文案须 waitFor 内容断言
    await waitFor(
      () => {
        expect(screen.getByTestId('tomlfmt-output-text')).toHaveTextContent('格式化失败');
      },
      { timeout: 3000 },
    );
    // offset=10 → 输入第 2 行行首(前 10 字节含换行)
    expect(screen.getByTestId('tomlfmt-error-loc')).toHaveTextContent('L2:C1');
  });

  it('错误无 offset 标记时不渲染定位 chip', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockRejectedValue(new Error('some other failure'));

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a=1\n' },
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('tomlfmt-output-text')).toHaveTextContent('格式化失败');
      },
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('tomlfmt-error-loc')).not.toBeInTheDocument();
  });

  it('切换缩进为 4 空格后参数随请求下发', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockResolvedValue({ text: 'a = 1\n' });

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a=1\n' },
    });
    // 等首次防抖请求落地
    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    // Select 交互:Radix SelectTrigger 点击展开后选择 4 空格项
    fireEvent.click(screen.getByTestId('toml-indent'));
    const option = await screen.findByRole('option', { name: '4 个空格' }, { timeout: 3000 });
    fireEvent.click(option);

    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
          toolId: 'toml_formatter',
          input: {
            text: 'a=1\n',
            params: { indent: 4, align_entries: false, reorder_keys: false },
          },
        });
      },
      { timeout: 3000 },
    );
  });

  it('开启键值对齐开关后参数下发 align_entries=true', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockResolvedValue({ text: 'a = 1\n' });

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'a=1\n' },
    });
    fireEvent.click(screen.getByTestId('toml-align-entries'));

    await waitFor(
      () => {
        expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
          toolId: 'toml_formatter',
          input: {
            text: 'a=1\n',
            params: { indent: 2, align_entries: true, reorder_keys: false },
          },
        });
      },
      { timeout: 3000 },
    );
  });

  it('空输入清空输出与统计', async () => {
    const { invokeCommand } = await mockIpc();
    invokeCommand.mockResolvedValue({ text: 'a = 1\n' });

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    // 先输入等输出落地
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), { target: { value: 'a=1\n' } });
    await waitFor(
      () => {
        expect(screen.getByTestId('tomlfmt-output-text')).toHaveTextContent('a = 1');
      },
      { timeout: 3000 },
    );

    // 清空输入:防抖回调置空输出
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), { target: { value: '' } });
    await waitFor(
      () => {
        expect(screen.getByTestId('tomlfmt-output-text')).toHaveTextContent('');
      },
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('tomlfmt-stats')).not.toBeInTheDocument();
  });
});

describe('offsetToLineColumn / extractErrorOffset 纯逻辑', () => {
  // 组件导出未单独暴露,经组件行为断言覆盖;此处补边界换算的行为断言
  it('错误 chip 换算多行输入的行列', async () => {
    const { invokeCommand, CommandError } = await mockIpc();
    invokeCommand.mockRejectedValue(new CommandError('ERR_PARSE_FAILED', '[offset=0] L1:C1 boom'));

    render(<TomlFormatter toolId="toml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('tomlfmt-input-textarea'), {
      target: { value: 'line1\nline2\n' },
    });

    const chip = await screen.findByTestId('tomlfmt-error-loc', {}, { timeout: 3000 });
    expect(chip).toHaveTextContent('L1:C1');
  });
});
