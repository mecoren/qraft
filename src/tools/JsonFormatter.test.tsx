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
import { JsonFormatter, looksLikeEscapedJson } from './JsonFormatter';
import { useJsonFormatterStore } from './jsonFormatterStore';
import { FRONTEND_FORMAT_LIMIT, JSON_BACKEND_MAX_INPUT_BYTES } from './json-utils';
import { useUiStore } from '@/store/uiStore';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

describe('JsonFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 智能检测默认关闭:剪贴板填充提示须显式开启才出现,复位防跨用例污染
    useUiStore.setState({ smartDetectionEnabled: false, detectedText: '' });
    // zustand 模块级单例:每个用例重置为「单个空白文档」初始态,避免跨用例污染
    useJsonFormatterStore.setState({
      docs: [{ id: 'default', title: 'json-1', autoTitle: 'json-1', pinned: false, content: '' }],
      activeDocId: 'default',
      history: [],
      ready: false,
      userTouched: false,
      error: null,
    });
    // 配置复位为默认值(indent 偏好缺省 → 2 空格),单用例改写后不跨用例泄漏
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
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
    // 缩进选择器已从标题栏移除(输出缩进读「设置 → 工具偏好」的 indent,
    // 编辑器状态栏「空格:N」仅控制编辑显示)
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

  it('shows the stats badge with object/array/key/depth counts after formatting', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"a":1,"b":{"c":[2,3]}}' },
    });

    const badge = await screen.findByTestId('stats-badge');
    // 统计:对象 2(root+b)· 数组 1 · 键 3(a,b,c)· 深度 4
    expect(badge.textContent).toContain('对象 2');
    expect(badge.textContent).toContain('数组 1');
    expect(badge.textContent).toContain('键 3');
    expect(badge.textContent).toContain('深度 4');
    // 前端路径的 meta 也已回填(不再恒为空)
    expect(badge.textContent).toContain('字节');
    // 徽标与右侧按钮组留距(CodeEditor actions 插槽无 gap,靠 ml-2 手动隔开)
    expect(badge.nextElementSibling).toHaveClass('ml-2');
  });

  it('warns about large numbers that lose precision during parsing', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"id": 9123372036854000123}' },
    });

    // 格式化成功,同时出现精度警示条
    await waitFor(() => {
      expect(getOutputValue()).toContain('912337203685400000');
    });
    const warning = await screen.findByTestId('precision-warning');
    expect(warning.textContent).toContain('9123372036854000123');
    expect(warning.textContent).toContain('丢精度');

    // 安全数字文档不出警示
    fireEvent.change(getInputEditor(), { target: { value: '{"a": 1}' } });
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    expect(screen.queryByTestId('precision-warning')).not.toBeInTheDocument();
  });

  it('clears the stats badge when the input becomes empty or invalid', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    await screen.findByTestId('stats-badge');

    // 非法输入:统计与 meta 一并清除
    fireEvent.change(getInputEditor(), { target: { value: '{invalid}' } });
    await waitFor(() => {
      expect(getOutputValue()).toMatch(/格式化失败/);
    });
    expect(screen.queryByTestId('stats-badge')).not.toBeInTheDocument();
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

  it('展开嵌套:字符串里的 JSON 原地展开并写回输入', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    const raw = '{"address":"{\\"city\\":\\"杭州\\"}","n":1}';
    fireEvent.change(getInputEditor(), { target: { value: raw } });
    fireEvent.click(screen.getByTestId('btn-expand-nested'));
    expect(getInputEditor().value).toBe('{\n  "address": {\n    "city": "杭州"\n  },\n  "n": 1\n}');
    expect(screen.getByTestId('repair-report')).toHaveTextContent('1');
  });

  it('展开嵌套:无嵌套时如实报告且输入不动', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-expand-nested'));
    expect(getInputEditor().value).toBe('{"a":1}');
    expect(screen.getByTestId('repair-report')).toHaveTextContent('无需展开');
  });

  it('时间戳互转:时间戳批量转为可读时间并写回输入', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"finish":1496937600,"id":42}' } });
    screen.getByTestId('btn-timestamp').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('ts-to-date'));
    // 时间戳转了,普通小数字不动
    expect(getInputEditor().value).toContain('"id": 42');
    expect(getInputEditor().value).toMatch(/"finish": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
    expect(screen.getByTestId('repair-report')).toHaveTextContent('1');
  });

  it('时间戳互转:可读时间批量转为毫秒时间戳', async () => {
    const user = userEvent.setup();
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"finish":"2017-06-09 00:00:00"}' } });
    screen.getByTestId('btn-timestamp').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('ts-to-timestamp'));
    const next = getInputEditor().value;
    expect(next).toMatch(/"finish": \d{13}/);
    expect(screen.getByTestId('repair-report')).toHaveTextContent('1');
  });

  it('转义提示:输入为转义文本时出现一键去除入口', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.queryByTestId('escaped-hint')).not.toBeInTheDocument();
    fireEvent.change(getInputEditor(), { target: { value: '"{\\"a\\":1}"' } });
    fireEvent.click(screen.getByTestId('escaped-hint'));
    expect(getOutputValue()).toBe('{"a":1}');
  });

  it('looksLikeEscapedJson:仅首尾引号+转义序列的字符串字面量才命中', () => {
    expect(looksLikeEscapedJson('"{\\"a\\":1}\\n"')).toBe(true);
    expect(looksLikeEscapedJson('{"a":1}')).toBe(false);
    expect(looksLikeEscapedJson('{\\"a\\":1}')).toBe(false);
    expect(looksLikeEscapedJson('"plain"')).toBe(false);
    expect(looksLikeEscapedJson('')).toBe(false);
    expect(looksLikeEscapedJson('"unclosed')).toBe(false);
  });

  it('剪贴板填充:开关关闭时默认不提示', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
  });

  it('剪贴板填充:开启+剪贴板 JSON+空文档时确认后填入', () => {
    useUiStore.setState({ smartDetectionEnabled: true, detectedText: '{"a":1}' });
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('clipboard-fill-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('clipboard-fill-ok'));
    expect(getInputEditor().value).toBe('{"a":1}');
    // 填入后文档非空,提示条消失
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
  });

  it('剪贴板填充:忽略后同内容不再提示,新内容重新提示', async () => {
    useUiStore.setState({ smartDetectionEnabled: true, detectedText: '{"a":1}' });
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('clipboard-fill-dismiss'));
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
    // 同内容更新(聚焦再次读到相同剪贴板)仍不提示
    act(() => {
      useUiStore.setState({ detectedText: '{"a":1}' });
    });
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
    // 新内容重新提示(外部 store 更新需等 React 刷新,用 findBy 等待)
    act(() => {
      useUiStore.setState({ detectedText: '{"b":2}' });
    });
    expect(await screen.findByTestId('clipboard-fill-bar')).toBeInTheDocument();
  });

  it('剪贴板填充:纯文本标量或文档非空时不提示', () => {
    // 纯文本经 YAML 回退只是标量字符串,填入格式化器无意义,不提示
    useUiStore.setState({ smartDetectionEnabled: true, detectedText: 'just some text' });
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
    fireEvent.change(getInputEditor(), { target: { value: '{"x":1}' } });
    act(() => {
      useUiStore.setState({ detectedText: '{"a":1}' });
    });
    expect(screen.queryByTestId('clipboard-fill-bar')).not.toBeInTheDocument();
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
    // 构造刚超过分流阈值的输入,触发后端路径(字节数由常量推导,阈值调整后用例如常生效)
    const largeJson = `{"data":"${'a'.repeat(FRONTEND_FORMAT_LIMIT + 1)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: largeJson,
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

  it('uses the indent tool preference on the frontend path', async () => {
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: 4 } } },
      },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n    "a": 1\n}');
    });
  });

  it('sends the indent tool preference to the backend', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: 4 } } },
      },
    });
    const largeJson = `{"data":"${'a'.repeat(FRONTEND_FORMAT_LIMIT + 1)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: largeJson,
      meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: largeJson, params: { indent: 4 } },
      });
    });
  });

  it('takes the structure stats from the backend extra payload', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    const largeJson = `{"data":"${'a'.repeat(FRONTEND_FORMAT_LIMIT + 1)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: largeJson,
      meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
      // 与本地解析结果刻意不同:该输出实际只有 1 个对象、深度 2
      extra: {
        stats: {
          objects: 7,
          arrays: 3,
          keys: 11,
          leaves: 5,
          maxDepth: 9,
          topLevelKeys: ['data'],
        },
      },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });
    fireEvent.click(screen.getByTestId('btn-format'));

    const badge = await screen.findByTestId('stats-badge');
    expect(badge.textContent).toContain('对象 7');
    expect(badge.textContent).toContain('深度 9');
  });

  it('recomputes the structure stats locally when the backend sends no extra', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    const largeJson = `{"data":"${'a'.repeat(FRONTEND_FORMAT_LIMIT + 1)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: largeJson,
      meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });
    fireEvent.click(screen.getByTestId('btn-format'));

    const badge = await screen.findByTestId('stats-badge');
    expect(badge.textContent).toContain('对象 1');
  });

  it('normalizes an out-of-range indent preference back to 2 spaces', async () => {
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        // 设置页允许 0(意即「跟随默认」),与后端同规则归一化为 2
        tool_prefs: { json_formatter: { values: { indent: 0 } } },
      },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
  });

  it('blocks input beyond the backend hard cap instead of sending it over IPC', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    // 后端上限按 UTF-8 字节计,4 字节一个码位的表情可用最短字符串越过该上限
    const overCapJson = `{"data":"${'🙂'.repeat(JSON_BACKEND_MAX_INPUT_BYTES / 4 + 1)}"}`;

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: overCapJson } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(screen.getByTestId('repair-report')).toBeInTheDocument();
    });
    expect(screen.getByTestId('repair-report').textContent).toContain('输入过大');
    // 超大输入不跨 IPC,输出框不被错误文本冒充
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(getOutputValue()).toBe('');
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
        history: [{ id: 'h1', title: 'json', content: '{}', timestamp: Date.now(), pinned: false }],
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
        history: [{ id: 'h1', title: 'json', content: '{}', timestamp: Date.now(), pinned: false }],
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

  it('pins a history entry: pinned sorts first and survives clearing', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    const now = Date.now();
    act(() => {
      useJsonFormatterStore.setState({
        history: [
          { id: 'h-new', title: 'new', content: '{"b":2}', timestamp: now, pinned: false },
          { id: 'h-old', title: 'old', content: '{"a":1}', timestamp: now - 1000, pinned: false },
        ],
        userTouched: true,
        ready: true,
      });
    });
    fireEvent.click(screen.getByTestId('btn-history'));
    await screen.findByTestId('history-list');
    // 默认最新在前
    expect(screen.getAllByTestId('history-item')[0]).toHaveTextContent('new');
    // 固定旧条目 → 排到最前
    fireEvent.click(screen.getAllByTestId('history-item-pin')[1]);
    expect(useJsonFormatterStore.getState().history.find((h) => h.id === 'h-old')?.pinned).toBe(
      true,
    );
    expect(screen.getAllByTestId('history-item')[0]).toHaveTextContent('old');
    // 清空仅移除未固定条目
    fireEvent.click(screen.getByTestId('history-clear'));
    fireEvent.click(await screen.findByTestId('history-clear-confirm-ok'));
    expect(useJsonFormatterStore.getState().history.map((h) => h.id)).toEqual(['h-old']);
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

  it('shows an error location chip with line/column and jumps to it on click', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 第 2 行键 a 后缺逗号:错误定位应指向第 3 行的 "b"
    fireEvent.change(getInputEditor(), {
      target: { value: '{\n  "a": 1\n  "b": 2\n}' },
    });
    fireEvent.click(screen.getByTestId('btn-format'));

    const chip = await screen.findByTestId('error-location');
    // chip 文案含紧凑行列(L3:C3)与错误类别(缺逗号);类别可截断,title 悬浮完整阅读
    expect(chip.textContent).toContain('L3:C3');
    expect(chip.textContent).toContain('缺少逗号');

    // 点击 chip 触发编辑器跳转(编辑器实例记录跳转目标行列)
    fireEvent.click(chip);
    const inputEditor = screen
      .getByTestId('input')
      .querySelector('textarea')! as HTMLTextAreaElement & {
      __lastGoto?: { line: number; column: number };
    };
    expect(inputEditor.__lastGoto).toEqual({ line: 3, column: 3 });
  });

  it('does not show the error location chip for valid or non-JSON inputs', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    expect(screen.queryByTestId('error-location')).not.toBeInTheDocument();
  });

  it('repairs the input via the explicit repair button and auto-formats the result', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 多处问题:裸键 + 单引号 + 尾逗号
    fireEvent.change(getInputEditor(), {
      target: { value: "{ name: 'qraft', tags: ['a', 'b',], }" },
    });
    fireEvent.click(screen.getByTestId('btn-repair'));

    // 修复后的文本写回输入编辑器
    await waitFor(() => {
      expect(getInputEditor().value).toContain('"name"');
      expect(getInputEditor().value).toContain('"qraft"');
    });
    // 修复后自动格式化生效:输出是合法美化 JSON
    await waitFor(() => {
      expect(getOutputValue()).toBe(
        '{\n  "name": "qraft",\n  "tags": [\n    "a",\n    "b"\n  ]\n}',
      );
    });
    // 修复动作如实记录在输出框顶部的修复报告
    expect(screen.getByTestId('repair-report')).toBeInTheDocument();
    // 修复成功后错误定位 chip 随之消失(输入已合法,残留的报错会误导用户)
    await waitFor(() => {
      expect(screen.queryByTestId('error-location')).not.toBeInTheDocument();
    });
  });

  it('reports unrepairable input honestly without changing the document', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 字符串被裸换行截断:无确定修法,修复器拒绝猜测
    const raw = '{"a": "line1\nline2"}';
    fireEvent.change(getInputEditor(), { target: { value: raw } });
    fireEvent.click(screen.getByTestId('btn-repair'));

    await waitFor(() => {
      expect(screen.getByTestId('repair-report')).toBeInTheDocument();
    });
    expect(getInputEditor().value).toBe(raw);
    expect(screen.getByTestId('repair-report').textContent).toContain('未能修复');
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

  it('routes oversized minify and alpha sort through the Rust backend', async () => {
    const user = userEvent.setup();
    const { invokeCommand } = await import('@/lib/ipc');
    const largeJson = `{"b":${'1'.repeat(FRONTEND_FORMAT_LIMIT + 1)},"a":2}`;
    // minify 的后端返回与 sort 的后端返回按调用次序依次生效
    (invokeCommand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: largeJson,
        meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
      })
      .mockResolvedValueOnce({
        text: largeJson,
        meta: { input_bytes: largeJson.length, output_bytes: largeJson.length, duration_ms: 1 },
      });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });

    // 压缩:超过阈值走后端 minify 参数
    fireEvent.click(screen.getByTestId('btn-minify'));
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: largeJson, params: { minify: true } },
      });
    });

    // 字典序升序:超过阈值走后端 sort_keys,并带上缩进偏好
    // (Radix 触发器用键盘激活最可靠,同既有排序用例)
    screen.getByTestId('btn-sort').focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByTestId('sort-alpha-asc'));
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: largeJson, params: { sort_keys: true, indent: 2 } },
      });
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

  it('queries with JMESPath after switching the engine', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), {
      target: { value: '{"store":{"book":[{"price":10},{"price":20}]}}' },
    });
    fireEvent.click(screen.getByTestId('view-jsonpath'));
    fireEvent.click(screen.getByTestId('engine-jmespath'));
    fireEvent.change(screen.getByTestId('jsonpath-expr'), {
      target: { value: 'store.book[?price > `15`].price' },
    });
    await waitFor(() => {
      expect(getJsonPathResult()).toBe('[\n  20\n]');
    });
  });

  it('shows a JMESPath error message for an invalid expression', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('view-jsonpath'));
    fireEvent.click(screen.getByTestId('engine-jmespath'));
    fireEvent.change(screen.getByTestId('jsonpath-expr'), {
      target: { value: 'a..[' },
    });
    await waitFor(() => {
      expect(getJsonPathResult()).toMatch(/JMESPath 表达式错误/);
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
