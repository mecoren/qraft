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

  const getInputEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('input').querySelector('textarea')!;
  const getOutputValue = (): string =>
    screen.getByTestId('output').querySelector('textarea')!.value;

  it('renders editors and all action buttons in the title bar', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('output')).toBeInTheDocument();
    expect(screen.getByTestId('btn-format')).toBeInTheDocument();
    expect(screen.getByTestId('btn-minify')).toBeInTheDocument();
    expect(screen.getByTestId('btn-sort-asc')).toBeInTheDocument();
    expect(screen.getByTestId('btn-sort-desc')).toBeInTheDocument();
    expect(screen.getByTestId('btn-entity')).toBeInTheDocument();
    // 缩进选择器保留在标题栏中
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('formats small JSON on the frontend without IPC, respecting the indent setting', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      meta: { input_bytes: 0, output_bytes: 0, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    // 中小数据走前端,不应触发 IPC
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it('auto-formats small JSON on the frontend after input changes', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      meta: { input_bytes: 0, output_bytes: 0, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it('falls back to the Rust backend for inputs exceeding the frontend format limit', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    // 构造超过 200KB 阈值的输入,触发后端路径
    const largeJson = `{"data":"${'a'.repeat(200 * 1024)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: `{"data":"${'a'.repeat(200 * 1024)}"}`,
      meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: largeJson, params: { indent: 2 } },
      });
    });
  });

  it('clears output when input becomes empty', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    const editor = getInputEditor();
    // 先输入有效 JSON,前端立即格式化出结果
    fireEvent.change(editor, { target: { value: '{"a":1}' } });
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    // 清空输入后输出随之清空
    fireEvent.change(editor, { target: { value: '' } });
    await waitFor(() => {
      expect(getOutputValue()).toBe('');
    });
  });

  it('shows a frontend parse error in the right-side output when the JSON is invalid', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{invalid}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      // 中小数据走前端 JSON.parse,错误直接写入右侧输出框
      expect(getOutputValue()).toMatch(/格式化失败/);
    });
  });

  it('minifies JSON on the frontend without IPC', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{\n  "a": 1,\n  "b": 2\n}' },
    });
    fireEvent.click(screen.getByTestId('btn-minify'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{"a":1,"b":2}');
    });
  });

  it('sorts keys ascending then descending on the frontend', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"b":1,"a":2,"c":3}' },
    });

    fireEvent.click(screen.getByTestId('btn-sort-asc'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 2,\n  "b": 1,\n  "c": 3\n}');
    });

    fireEvent.click(screen.getByTestId('btn-sort-desc'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "c": 3,\n  "b": 1,\n  "a": 2\n}');
    });
  });

  it('generates a TypeScript interface on the frontend', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"name":"qraft","count":2}' },
    });
    fireEvent.click(screen.getByTestId('btn-entity'));

    await waitFor(() => {
      expect(getOutputValue()).toContain('export interface Root');
      expect(getOutputValue()).toContain('name: string;');
      expect(getOutputValue()).toContain('count: number;');
    });
  });

  it('detects XML input and converts it to JSON for quick actions', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '<root><name>hi</name></root>' },
    });

    await waitFor(() => {
      expect(screen.getByText(/已识别 XML/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-minify'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{"root":{"name":"hi"}}');
    });
  });

  it('shows a frontend parse error in the right-side output when quick action input is invalid', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{bad json}' } });
    fireEvent.click(screen.getByTestId('btn-minify'));

    await waitFor(() => {
      expect(getOutputValue()).toMatch(/解析失败/);
    });
  });
});
