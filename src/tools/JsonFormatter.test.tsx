import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('renders editors and all action buttons in the title bar', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('output')).toBeInTheDocument();
    expect(screen.getByTestId('btn-format')).toBeInTheDocument();
    expect(screen.getByTestId('btn-minify')).toBeInTheDocument();
    // 转义 / 去除转义(互为反操作,写入输出框)
    expect(screen.getByTestId('btn-escape')).toBeInTheDocument();
    expect(screen.getByTestId('btn-unescape')).toBeInTheDocument();
    // 排序 / 转换为 下拉菜单按钮(取代原键升序/键降序/生成实体类)
    expect(screen.getByTestId('btn-sort')).toBeInTheDocument();
    expect(screen.getByTestId('btn-convert')).toBeInTheDocument();
    // 缩进选择器已从标题栏移除(输出缩进固定 2 空格,编辑器状态栏「空格:N」仅控制编辑显示)
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

  it('escape writes the input as a JSON string literal to the output', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    const raw = '{"a":"x\ny"}';
    fireEvent.change(getInputEditor(), { target: { value: raw } });
    fireEvent.click(screen.getByTestId('btn-escape'));
    expect(getInputEditor().value).toBe(raw);
    expect(getOutputValue()).toBe(JSON.stringify(raw));
  });

  it('unescape decodes a quoted string literal back to the raw text', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    const escaped = '"{\\"a\\":1}\\n"';
    fireEvent.change(getInputEditor(), { target: { value: escaped } });
    fireEvent.click(screen.getByTestId('btn-unescape'));
    expect(getInputEditor().value).toBe(escaped);
    expect(getOutputValue()).toBe('{"a":1}\n');
  });

  it('unescape decodes bare escaped text without surrounding quotes', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{\\"a\\":1}' } });
    fireEvent.click(screen.getByTestId('btn-unescape'));
    expect(getOutputValue()).toBe('{"a":1}');
  });

  it('unescape writes an error to the output when the input is not escaped text', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 普通未转义 JSON 补引号后无法解析:错误信息写入输出框
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-unescape'));
    expect(getOutputValue()).not.toBe('');
    expect(getOutputValue()).toContain('去除转义失败');
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

  it('opens a local file into the input editor via the toolbar open button', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 打开文件按钮由 CodeEditor 的 showOpenFile 提供(testId = `${dataTestId}-open`)
    fireEvent.click(screen.getByTestId('input-open'));
    const fileInput = screen.getByTestId('input').querySelector('input[type="file"]')!;
    expect(fileInput).not.toBeNull();
    // 模拟选择文件:readFileAsText 走 FileReader,jsdom 原生支持
    const file = new File(['{"a":1}'], 'data.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(getInputEditor().value).toBe('{"a":1}');
    });
  });

  it('clears all history only after confirming in the anchored popover', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    act(() => {
      useJsonFormatterStore.setState({
        history: [{ id: 'h1', title: 'json', content: '{}', timestamp: Date.now() }],
        userTouched: true,
        ready: true,
      });
    });
    // 历史按钮组在历史面板(Popover 内容)内,先打开面板
    fireEvent.click(screen.getByTestId('btn-history'));
    await screen.findByTestId('history-popover');
    fireEvent.click(screen.getByTestId('history-clear'));
    // 确认框为锚定 Popover(非居中 modal)
    const confirm = await screen.findByTestId('history-clear-confirm');
    expect(confirm).toBeInTheDocument();
    // 取消:历史保留
    fireEvent.click(screen.getByTestId('history-clear-confirm-cancel'));
    expect(useJsonFormatterStore.getState().history).toHaveLength(1);
    // 确认:清空
    fireEvent.click(screen.getByTestId('history-clear'));
    fireEvent.click(await screen.findByTestId('history-clear-confirm-ok'));
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });

  it('removes a single history entry only after confirming in the anchored popover', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    act(() => {
      useJsonFormatterStore.setState({
        history: [{ id: 'h1', title: 'json', content: '{}', timestamp: Date.now() }],
        userTouched: true,
        ready: true,
      });
    });
    fireEvent.click(screen.getByTestId('btn-history'));
    await screen.findByTestId('history-popover');
    fireEvent.click(screen.getByTestId('history-item-remove'));
    const confirm = await screen.findByTestId('history-remove-confirm');
    expect(confirm).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('history-remove-confirm-ok'));
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });

  it('opens history popover without auto-focusing save-current (no instant tooltip)', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('btn-history'));
    await screen.findByTestId('history-popover');
    // Radix Tooltip 对 focus 走即时打开路径(不施加 hover 延迟):若 FocusScope
    // 默认聚焦弹层首个 tabbable(保存当前按钮),其悬浮提示会在打开瞬间直接弹出
    expect(screen.getByTestId('history-save-current')).not.toHaveFocus();
    expect(screen.queryByText('把当前输入保存为一条历史记录')).not.toBeInTheDocument();
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

  it('auto-formats YAML input to JSON after input changes', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: 'name: qraft\ncount: 3' } });

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "name": "qraft",\n  "count": 3\n}');
    });
  });

  it('auto-formats TOML input to JSON after input changes', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: 'title = "demo"\n[owner]\nname = "qraft"' },
    });

    await waitFor(() => {
      expect(getOutputValue()).toContain('"title": "demo"');
      expect(getOutputValue()).toContain('"owner": {\n    "name": "qraft"\n  }');
    });
  });

  it('auto-formats Properties and URL params input to JSON for quick actions', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: 'db.host=localhost\ndb.port=5432' },
    });
    fireEvent.click(screen.getByTestId('btn-minify'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{"db":{"host":"localhost","port":"5432"}}');
    });

    fireEvent.change(getInputEditor(), { target: { value: 'page=1&q=hello' } });
    fireEvent.click(screen.getByTestId('btn-minify'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{"page":"1","q":"hello"}');
    });
  });

  it('auto-formats JSON5 input (unquoted keys) to JSON', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{ a: 1, b: [1, 2,], }' } });

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
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

  it('snapshots non-empty content into local history when its tab is closed after confirmation', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"snap":true}' } });
    // 非空内容文档:先弹关闭确认框
    fireEvent.click(screen.getAllByTestId('doc-tab-close')[0]);
    expect(await screen.findByTestId('doc-close-dialog')).toBeInTheDocument();
    // 确认后才真正关闭并快照进历史
    fireEvent.click(screen.getByTestId('doc-close-dialog-confirm'));

    await waitFor(() => {
      const { history } = useJsonFormatterStore.getState();
      expect(history.map((h) => h.content)).toContain('{"snap":true}');
    });
  });

  it('prompts even when an empty tab is closed, and closes after confirmation', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    // 空文档同样弹关闭确认
    fireEvent.click(screen.getAllByTestId('doc-tab-close')[0]);
    expect(await screen.findByTestId('doc-close-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('doc-close-dialog-confirm'));

    await waitFor(() => {
      expect(useJsonFormatterStore.getState().docs).toHaveLength(0);
    });
    // 空内容不产生历史快照
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });

  it('keeps the tab when the close confirmation is cancelled', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"keep":1}' } });
    fireEvent.click(screen.getAllByTestId('doc-tab-close')[0]);
    fireEvent.click(await screen.findByTestId('doc-close-dialog-cancel'));

    expect(screen.queryByTestId('doc-close-dialog')).not.toBeInTheDocument();
    expect(useJsonFormatterStore.getState().docs).toHaveLength(1);
  });

  it('renames a tab via the context menu and keeps the custom title on further edits', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));

    // 右键 Tab → 重命名
    fireEvent.contextMenu(screen.getAllByTestId('doc-tab')[0]);
    fireEvent.click(await screen.findByTestId('ctx-doc-rename'));
    const input = await screen.findByTestId('doc-rename-dialog-input');
    expect(input).toHaveValue('json-1');
    fireEvent.change(input, { target: { value: '  用户接口  ' } });
    fireEvent.click(screen.getByTestId('doc-rename-dialog-confirm'));

    await waitFor(() => {
      expect(screen.getAllByTestId('doc-tab')[0]).toHaveTextContent('用户接口');
    });
    const s = useJsonFormatterStore.getState();
    expect(s.docs[0].title).toBe('用户接口');
    expect(s.docs[0].autoTitle).toBeUndefined();

    // 改名后输入内容:标题不再被内容派生覆盖
    fireEvent.change(getInputEditor(), { target: { value: '{"typed":1}' } });
    await waitFor(() => {
      expect(useJsonFormatterStore.getState().docs[0].title).toBe('用户接口');
    });
  });

  it('pins a tab via the context menu and sorts it first', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    // 新建第二个 Tab
    fireEvent.click(screen.getByTestId('doc-add'));
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(2));
    const secondId = useJsonFormatterStore.getState().docs[1].id;

    // 右键第二个 Tab → 固定
    const tabs = screen.getAllByTestId('doc-tab');
    fireEvent.contextMenu(tabs[1]);
    fireEvent.click(await screen.findByTestId('ctx-doc-toggle-pin'));

    await waitFor(() => {
      expect(useJsonFormatterStore.getState().docs[1].pinned).toBe(true);
    });
    // 固定 Tab 恒排最前,并显示 Pin 图标
    await waitFor(() => {
      expect(screen.getAllByTestId('doc-tab')[0].getAttribute('data-doc-id')).toBe(secondId);
    });
    expect(
      screen.getAllByTestId('doc-tab')[0].querySelector('[data-testid="doc-tab-pin"]'),
    ).toBeInTheDocument();

    // 再次点击取消固定(菜单项带 ✓ 勾选态)
    fireEvent.contextMenu(screen.getAllByTestId('doc-tab')[0]);
    expect(await screen.findByTestId('ctx-doc-pin-check')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ctx-doc-toggle-pin'));
    await waitFor(() => {
      expect(useJsonFormatterStore.getState().docs[1].pinned).toBe(false);
    });
  });

  it('closes a tab via the context menu with confirmation', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"ctx":1}' } });
    fireEvent.contextMenu(screen.getAllByTestId('doc-tab')[0]);
    fireEvent.click(await screen.findByTestId('ctx-doc-close'));
    fireEvent.click(await screen.findByTestId('doc-close-dialog-confirm'));

    await waitFor(() => {
      const s = useJsonFormatterStore.getState();
      expect(s.docs).toHaveLength(0);
      expect(s.history.map((h) => h.content)).toContain('{"ctx":1}');
    });
  });

  it('closes a tab via middle click after snapshotting content into history', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await waitFor(() => expect(screen.getAllByTestId('doc-tab')).toHaveLength(1));
    fireEvent.change(getInputEditor(), { target: { value: '{"middle":1}' } });
    // 中键(button=1)点击 Tab 本体 → 弹确认 → 确认关闭
    fireEvent.mouseDown(screen.getAllByTestId('doc-tab')[0], { button: 1 });
    fireEvent.click(await screen.findByTestId('doc-close-dialog-confirm'));

    await waitFor(() => {
      const s = useJsonFormatterStore.getState();
      expect(s.docs).toHaveLength(0);
      expect(s.history.map((h) => h.content)).toContain('{"middle":1}');
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

  // —— JSONPath 查询视图(原独立 JSONPath 测试器并入)——
  const getJsonPathResult = (): string =>
    screen.getByTestId('jsonpath-result').querySelector('textarea')!.value;

  it('queries the input document live in the JSONPath view', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"store":{"book":[{"author":"Nigel"},{"author":"Erik"}]}}' },
    });
    fireEvent.click(screen.getByTestId('view-jsonpath'));
    expect(screen.getByTestId('jsonpath-expr')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('jsonpath-expr'), {
      target: { value: '$.store.book[*].author' },
    });
    await waitFor(() => {
      expect(getJsonPathResult()).toBe('[\n  "Nigel",\n  "Erik"\n]');
    });
  });

  it('shows an error message in the JSONPath result for an invalid expression', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('view-jsonpath'));
    fireEvent.change(screen.getByTestId('jsonpath-expr'), {
      target: { value: '$[?(@.a > )]' },
    });
    await waitFor(() => {
      expect(getJsonPathResult()).toMatch(/JSONPath 表达式错误/);
    });
  });

  it('shows a parse error in the JSONPath result when the input is not valid JSON', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{bad json}' } });
    fireEvent.click(screen.getByTestId('view-jsonpath'));
    fireEvent.change(screen.getByTestId('jsonpath-expr'), { target: { value: '$.a' } });
    await waitFor(() => {
      expect(getJsonPathResult()).toMatch(/解析失败/);
    });
  });
});
