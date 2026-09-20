import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock @/lib/ipc,与 JsonFormatter.test.tsx 同款:safeInvoke 默认失败,
// invokeCommand 为 vi.fn 由用例按需注值
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

import { JsonFormatter } from './JsonFormatter';
import { useJsonFormatterStore } from './jsonFormatterStore';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

/**
 * Task5 RED:文档级缩进选择器 UI。
 *
 * 选择器行 testid 口径(doc-indent-*):
 * - doc-indent-row:ConfigRow 行根
 * - doc-indent-spaces/doc-indent-tabs:空格/Tab 分段触发器
 * - doc-indent-width:宽度 Select(选项 1/2/4/8)
 * - doc-indent-following:跟随态徽标(仅无覆盖时出现)
 * - doc-indent-reset:「跟随设置」重置按钮(仅有覆盖时出现)
 */
describe('Task5 RED: 文档级缩进选择器 UI', () => {
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
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
  });

  const getInputEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('input').querySelector('textarea')!;
  const getOutputValue = (): string =>
    screen.getByTestId('output').querySelector('textarea')!.value;
  const formatNow = (): void => {
    fireEvent.click(screen.getByTestId('btn-format'));
  };
  /** radix Tabs 在 onMouseDown 时激活 tab,需用 mouseDown 而非 click(Base64Codec.test.tsx 同款) */
  const clickIndentTab = (testId: 'doc-indent-spaces' | 'doc-indent-tabs'): void => {
    fireEvent.mouseDown(screen.getByTestId(testId));
  };
  const selectWidth = async (width: string): Promise<void> => {
    fireEvent.click(screen.getByTestId('doc-indent-width'));
    fireEvent.click(await screen.findByRole('option', { name: width }));
  };

  it('选择器存在:切空格/Tab+宽度后对应 Doc 输出变化,且只影响当前 Doc', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 选择器行存在;跟随态显示徽标,重置按钮隐藏
    expect(screen.getByTestId('doc-indent-row')).toBeInTheDocument();
    expect(screen.getByTestId('doc-indent-following')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-indent-reset')).not.toBeInTheDocument();

    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });

    // 切 Tab → 输出变 Tab 缩进,覆盖落到当前 Doc
    clickIndentTab('doc-indent-tabs');
    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: true,
      size: 2,
    });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n\t"a": 1\n}');
    });
    // Tab 时宽度禁用(宽度仅对空格缩进有效)
    expect(screen.getByTestId('doc-indent-width')).toBeDisabled();

    // 切回空格 + 宽度 4 → 输出变 4 空格
    clickIndentTab('doc-indent-spaces');
    await selectWidth('4');
    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: false,
      size: 4,
    });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n    "a": 1\n}');
    });

    // 只影响当前 Doc:新 Doc 仍跟随全局(2 空格),且选择器回到跟随态
    fireEvent.click(screen.getByTestId('doc-add'));
    expect(screen.getByTestId('doc-indent-following')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-indent-reset')).not.toBeInTheDocument();
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
  });

  it('「跟随设置」重置:覆盖后点重置→回全局值;未覆盖时重置按钮隐藏', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.queryByTestId('doc-indent-reset')).not.toBeInTheDocument();

    clickIndentTab('doc-indent-tabs');
    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: true,
      size: 2,
    });
    // 覆盖态:重置按钮出现,跟随徽标消失
    expect(screen.getByTestId('doc-indent-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-indent-following')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('doc-indent-reset'));
    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toBeUndefined();
    expect(screen.getByTestId('doc-indent-following')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-indent-reset')).not.toBeInTheDocument();

    // 输出回到全局 2 空格
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
  });

  it('改选择器不写全局配置:只调 setDocIndent/resetDocIndent,不调 config_set;未覆盖 Doc 跟随全局变更', async () => {
    const { safeInvoke } = await import('@/lib/ipc');
    const safeInvokeMock = safeInvoke as unknown as ReturnType<typeof vi.fn>;

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 同步连续操作后立即断言:与防抖 persist(≥500ms)无竞态,
    // 定时器不可能在同步执行段内触发
    clickIndentTab('doc-indent-tabs');
    fireEvent.click(screen.getByTestId('doc-indent-reset'));
    expect(safeInvokeMock).not.toHaveBeenCalledWith('config_set', expect.anything());
    // 前端 config 侧的 indent 偏好未被触碰
    expect(useConfigStore.getState().config?.tool_prefs?.['json_formatter']).toBeUndefined();

    // 未覆盖 Doc 跟随全局变更:先按全局默认格式化,再改全局为 4 空格
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: { useTabs: false, size: 4 } } } },
      },
    });
    await waitFor(
      () => {
        expect(getOutputValue()).toBe('{\n    "a": 1\n}');
      },
      { timeout: 3000 },
    );
  });
});

/**
 * 输入编辑器缩进接线:状态栏缩进与格式化输出同源(resolved),
 * 默认取全局设置、本文档覆盖优先,菜单变更只写当前 Doc。
 * jsdom 下 Monaco 是 textarea 垫片,只断言徽章文本与 store 写入。
 */
describe('输入编辑器缩进接线', () => {
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
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
  });

  it('默认取全局设置:改设置后未覆盖的 Doc 徽章跟随', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:2');

    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: { useTabs: false, size: 4 } } } },
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:4');
    });
  });

  it('菜单切 Tab 落为当前 Doc 覆盖,新 Doc 仍跟随全局', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);

    fireEvent.click(screen.getByTestId('input-status-indent'));
    fireEvent.click(await screen.findByTestId('input-indent-picker-use-tabs'));

    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: true,
      size: 2,
    });
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('制表符');

    useJsonFormatterStore.getState().newDoc('{"a":1}');
    await waitFor(() => {
      expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:2');
    });
  });
});
