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
 * 输入编辑器缩进接线:缩进入口只有输入编辑器状态栏的缩进菜单
 * (testid 前缀 input-status-indent / input-indent-picker-*),
 * 与格式化输出同源(resolved)——默认取全局设置、本文档覆盖优先,
 * 菜单变更只写当前 Doc,不写全局配置。
 * jsdom 下 Monaco 是 textarea 垫片,只断言徽章文本、store 写入与输出结果。
 */
describe('输入编辑器状态栏缩进:文档级覆盖与跟随', () => {
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
  /** 打开状态栏缩进菜单并点选一项(快选弹窗按需挂载,需等待列表就绪) */
  const pickIndent = async (itemTestId: string): Promise<void> => {
    fireEvent.click(screen.getByTestId('input-status-indent'));
    fireEvent.click(await screen.findByTestId(itemTestId));
  };
  /** 把全局「设置 → JSON 缩进」偏好换成指定值 */
  const setGlobalIndent = (indent: { useTabs: boolean; size: number }): void => {
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent } } },
      },
    });
  };

  it('默认取全局设置:改设置后未覆盖的 Doc 徽章跟随', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:2');

    setGlobalIndent({ useTabs: false, size: 4 });
    await waitFor(() => {
      expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:4');
    });
  });

  it('菜单切 Tab 落为当前 Doc 覆盖,新 Doc 仍跟随全局', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);

    await pickIndent('input-indent-picker-use-tabs');

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

  it('菜单切宽度:覆盖只落当前 Doc,格式化输出同步变化', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });

    // 「使用空格」是二级列表入口:进入后选宽度 4
    fireEvent.click(screen.getByTestId('input-status-indent'));
    fireEvent.click(await screen.findByTestId('input-indent-picker-use-spaces'));
    fireEvent.click(await screen.findByTestId('input-indent-picker-width-4'));

    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: false,
      size: 4,
    });
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:4');

    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n    "a": 1\n}');
    });
  });

  it('「跟随设置」:覆盖态下菜单出现跟随项,点选后清除覆盖回全局', async () => {
    useJsonFormatterStore.setState({
      docs: [
        {
          id: 'default',
          title: 'json-1',
          autoTitle: 'json-1',
          pinned: false,
          content: '',
          indentOverride: { useTabs: true, size: 2 },
        },
      ],
      activeDocId: 'default',
    });
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('制表符');

    await pickIndent('input-indent-picker-follow');

    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toBeUndefined();
    expect(screen.getByTestId('input-status-indent')).toHaveTextContent('空格:2');

    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });
  });

  it('未覆盖时菜单无跟随项,且改缩进不写全局配置', async () => {
    const { safeInvoke } = await import('@/lib/ipc');
    const safeInvokeMock = safeInvoke as unknown as ReturnType<typeof vi.fn>;

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('input-status-indent'));
    expect(await screen.findByTestId('input-indent-picker-use-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('input-indent-picker-follow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('input-indent-picker-use-tabs'));
    expect(useJsonFormatterStore.getState().docs[0].indentOverride).toEqual({
      useTabs: true,
      size: 2,
    });
    // 只调 setDocIndent,不调 config_set;前端 config 侧的 indent 偏好未被触碰
    expect(safeInvokeMock).not.toHaveBeenCalledWith('config_set', expect.anything());
    expect(useConfigStore.getState().config?.tool_prefs?.['json_formatter']).toBeUndefined();
  });

  it('未覆盖 Doc 跟随全局设置变更并重新格式化输出', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    formatNow();
    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n  "a": 1\n}');
    });

    setGlobalIndent({ useTabs: false, size: 4 });
    await waitFor(
      () => {
        expect(getOutputValue()).toBe('{\n    "a": 1\n}');
      },
      { timeout: 3000 },
    );
  });
});
