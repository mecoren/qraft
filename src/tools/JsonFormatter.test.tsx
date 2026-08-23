import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock @/lib/ipc:invokeCommand 用 vi.fn(),CommandError 在 mock 中定义,
// 使组件与测试共用同一个 CommandError 类,instanceof 检查可生效。
// safeInvoke(config_get/config_set)默认返回失败,让工作区 hydrate 走默认空态。
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
    safeInvoke: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'mock', message: 'mocked' } }),
    ),
  };
});

// 导入必须在 mock 声明之后,确保组件拿到的是 mocked 模块
import { JsonFormatter } from './JsonFormatter';
import { useJsonFormatterStore } from './jsonFormatterStore';

describe('JsonFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // zustand 模块级单例:每个用例重置为「单个空白文档」初始态,避免跨用例污染
    useJsonFormatterStore.setState({
      docs: [{ id: 'default', title: 'json-1', autoTitle: 'json-1', content: '' }],
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

  it('renders editors and all action buttons in the title bar', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('output')).toBeInTheDocument();
    expect(screen.getByTestId('btn-format')).toBeInTheDocument();
    expect(screen.getByTestId('btn-minify')).toBeInTheDocument();
    // 排序 / 转换为 下拉菜单按钮(取代原键升序/键降序/生成实体类)
    expect(screen.getByTestId('btn-sort')).toBeInTheDocument();
    expect(screen.getByTestId('btn-convert')).toBeInTheDocument();
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

  it('sorts keys ascending then descending via the sort dropdown', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"b":1,"a":2,"c":3}' },
    });

    // 打开排序菜单(Radix 触发器在 jsdom 下用键盘激活最可靠)
    screen.getByTestId('btn-sort').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('sort-alpha-asc'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 2,\n  "b": 1,\n  "c": 3\n}');
    });

    // 重新打开排序菜单,选择「大小写敏感逆序」(选择后 Radix 自动关闭)
    screen.getByTestId('btn-sort').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('sort-alpha-desc'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "c": 3,\n  "b": 1,\n  "a": 2\n}');
    });
  });

  it('generates a TypeScript interface via the convert dropdown', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"name":"qraft","count":2}' },
    });
    screen.getByTestId('btn-convert').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('convert-typescript'));

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

  it('creates a second tab via the + button and keeps per-tab content when switching', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 初始为单个空白文档(同步默认态,hydrate 异步完成不丢输入)
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"first":1}' } });
    await waitFor(() => expect(getOutputValue()).toBe('{\n  "first": 1\n}'));

    fireEvent.click(screen.getByTestId('doc-add'));
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(2));
    // 新 Tab 为空输入
    expect(getInputEditor().value).toBe('');
    fireEvent.change(getInputEditor(), { target: { value: '{"second":2}' } });

    // 切回第一个 Tab,内容与输出均保留
    fireEvent.click(screen.getAllByTestId('doc-tab')[0]);
    await waitFor(() => {
      expect(getInputEditor().value).toBe('{"first":1}');
      expect(getOutputValue()).toBe('{\n  "first": 1\n}');
    });
  });

  it('snapshots non-empty content into local history when its tab is closed', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"snap":true}' } });
    fireEvent.click(screen.getAllByTestId('doc-tab-close')[0]);

    await waitFor(() => {
      const { history } = useJsonFormatterStore.getState();
      expect(history.map((h) => h.content)).toContain('{"snap":true}');
    });
  });

  it('records history automatically from the debounced auto-format path', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    // 仅输入(不点击格式化按钮):自动防抖格式化成功后应已入历史
    fireEvent.change(getInputEditor(), { target: { value: '{"auto":true}' } });
    await waitFor(() => expect(getOutputValue()).toBe('{\n  "auto": true\n}'));
    await waitFor(() => {
      expect(useJsonFormatterStore.getState().history.map((h) => h.content)).toContain(
        '{"auto":true}',
      );
    });
  });

  it('does not record invalid input even when the user clicks format', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{bad json}' } });
    fireEvent.click(screen.getByTestId('btn-format'));
    await waitFor(() => expect(getOutputValue()).toMatch(/格式化失败/));
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });

  it('closes a tab via middle click after snapshotting content into history', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"middle":1}' } });
    // 中键(button=1)点击 Tab 本体关闭
    fireEvent.mouseDown(screen.getAllByTestId('doc-tab')[0], { button: 1 });

    await waitFor(() => {
      const s = useJsonFormatterStore.getState();
      expect(s.docs).toHaveLength(0);
      expect(s.history.map((h) => h.content)).toContain('{"middle":1}');
    });
  });

  it('records history on manual format and restores it from the history popover', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"hist":1}' } });
    await waitFor(() => expect(getOutputValue()).toBe('{\n  "hist": 1\n}'));
    // 手动点击「格式化」→ 记录历史(auto 防抖路径不记录)
    fireEvent.click(screen.getByTestId('btn-format'));
    await waitFor(() => {
      expect(useJsonFormatterStore.getState().history.map((h) => h.content)).toContain(
        '{"hist":1}',
      );
    });

    // 打开历史弹层并点击条目还原(当前文档非空 → 新开 Tab 承载)
    fireEvent.click(screen.getByTestId('btn-history'));
    await waitFor(() => expect(screen.getByTestId('history-list')).toBeInTheDocument());
    const items = screen.getAllByTestId('history-item');
    expect(items[0].textContent).toContain('"hist":1');
    fireEvent.click(items[0]);
    await waitFor(() => {
      const s = useJsonFormatterStore.getState();
      expect(s.docs).toHaveLength(2);
      const active = s.docs.find((d) => d.id === s.activeDocId);
      expect(active?.content ?? '').toMatch(/"hist"/);
    });
  });

  it('renders the tree structure view for valid JSON output with lazy expansion', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"user":{"name":"qraft","tags":["a","b"]},"n":1}' },
    });
    await waitFor(() => expect(getOutputValue()).not.toBe(''));

    fireEvent.click(screen.getByTestId('view-tree'));
    expect(screen.getByTestId('output-tree')).toBeInTheDocument();
    // 默认展开前两层:root 与 user 可见,name 叶子随之可见
    expect(screen.getAllByText('[object]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('"qraft"')).toBeInTheDocument();
    // tags 数组在第三层,默认折叠;点击行展开后叶子可见
    expect(screen.queryByText('"a"')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('tags'));
    await waitFor(() => expect(screen.getByText('"a"')).toBeInTheDocument());
  });

  it('shows a hint in tree view when the output is not JSON', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"name":"x","age":1}' } });
    await waitFor(() => expect(getOutputValue()).not.toBe(''));
    // 转换为 TypeScript 输出,树视图应显示回退提示
    screen.getByTestId('btn-convert').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('convert-typescript'));
    fireEvent.click(screen.getByTestId('view-tree'));
    expect(screen.getByText(/当前输出不是有效的 JSON \/ XML/)).toBeInTheDocument();
  });
});
