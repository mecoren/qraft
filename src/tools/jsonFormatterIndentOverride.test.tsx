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
import { normalizeDocs, useJsonFormatterStore } from './jsonFormatterStore';
import { FRONTEND_FORMAT_LIMIT, normalizeJsonIndentStyle } from './json-utils';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

describe('Task4 RED: 每文档缩进覆盖 + 解析链', () => {
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

  it('normalizeDocs: 旧 docs(无 indentOverride)→ undefined 不抛错', () => {
    const w = normalizeDocs({
      docs: [{ id: 'd1', title: 't', pinned: false, content: '{}' }],
      activeDocId: 'd1',
    });
    expect(w.docs).toHaveLength(1);
    expect(w.docs[0].indentOverride).toBeUndefined();
  });

  it('sanitize round-trip: 合法 {useTabs:true,size:4} 保留', () => {
    const w = normalizeDocs({
      docs: [
        {
          id: 'd1',
          title: 't',
          pinned: false,
          content: '{}',
          indentOverride: { useTabs: true, size: 4 },
        },
      ],
      activeDocId: 'd1',
    });
    expect(w.docs[0].indentOverride).toEqual({ useTabs: true, size: 4 });
  });

  it.each([
    [{ useTabs: true, size: 0 }],
    [{ useTabs: true, size: 9 }],
    [{ useTabs: true, size: 1.5 }],
    [{ useTabs: true, size: '4' }],
    [{ useTabs: 'yes', size: 4 }],
    [{ useTabs: 1, size: 4 }],
    ['tab'],
    [4],
  ])('sanitize: 非法 indentOverride %j 丢弃回 undefined', (bad) => {
    const w = normalizeDocs({
      docs: [{ id: 'd1', title: 't', pinned: false, content: '{}', indentOverride: bad }],
      activeDocId: 'd1',
    });
    expect(w.docs[0].indentOverride).toBeUndefined();
  });

  it('resolve 语义: 覆盖后全局变更不影响它', () => {
    const s0 = useJsonFormatterStore.getState();
    // setDocIndent / resetDocIndent 尚不存在时此处即抛错(RED)
    s0.setDocIndent('default', { useTabs: true, size: 4 });
    s0.newDoc('{"b":2}');
    const s = useJsonFormatterStore.getState();
    const docA = s.docs.find((d) => d.id === 'default')!;
    const docB = s.docs.find((d) => d.id !== 'default')!;
    expect(docA.indentOverride).toEqual({ useTabs: true, size: 4 });
    expect(docB.indentOverride).toBeUndefined();

    // 全局 {spaces,2} → A 为 Tab4、B 为 spaces2
    let globalIndent = normalizeJsonIndentStyle({ useTabs: false, size: 2 });
    const resolvedA1 = docA.indentOverride ?? globalIndent;
    const resolvedB1 = docB.indentOverride ?? globalIndent;
    expect(resolvedA1).toEqual({ useTabs: true, size: 4 });
    expect(resolvedB1).toEqual({ useTabs: false, size: 2 });

    // 全局改 spaces4 后 A 不变 B 变
    globalIndent = normalizeJsonIndentStyle({ useTabs: false, size: 4 });
    const resolvedA2 = docA.indentOverride ?? globalIndent;
    const resolvedB2 = docB.indentOverride ?? globalIndent;
    expect(resolvedA2).toEqual({ useTabs: true, size: 4 });
    expect(resolvedB2).toEqual({ useTabs: false, size: 4 });

    // reset 回跟随
    useJsonFormatterStore.getState().resetDocIndent('default');
    const docA2 = useJsonFormatterStore.getState().docs.find((d) => d.id === 'default')!;
    expect(docA2.indentOverride).toBeUndefined();
    expect(docA2.indentOverride ?? globalIndent).toEqual({ useTabs: false, size: 4 });
  });

  it('解析链: 小文档覆盖 Tab4 用 "\\t"(全局 spaces2 不影响它)', async () => {
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: { useTabs: false, size: 2 } } } },
      },
    });
    useJsonFormatterStore.setState({
      docs: [
        {
          id: 'default',
          title: 'json-1',
          autoTitle: 'json-1',
          pinned: false,
          content: '',
          indentOverride: { useTabs: true, size: 4 },
        },
      ],
      activeDocId: 'default',
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n\t"a": 1\n}');
    });
  });

  it('解析链: 小文档无覆盖时跟随全局 Tab 对象', async () => {
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: { useTabs: true, size: 4 } } } },
      },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByTestId('btn-format'));

    await waitFor(() => {
      expect(getOutputValue()).toBe('{\n\t"a": 1\n}');
    });
  });

  it('解析链: 大文档 tool_execute params 含 {indent:size,use_tabs:bool}', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: { json_formatter: { values: { indent: { useTabs: false, size: 2 } } } },
      },
    });
    useJsonFormatterStore.setState({
      docs: [
        {
          id: 'default',
          title: 'json-1',
          autoTitle: 'json-1',
          pinned: false,
          content: '',
          indentOverride: { useTabs: true, size: 4 },
        },
      ],
      activeDocId: 'default',
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
        input: { text: largeJson, params: { indent: 4, use_tabs: true } },
      });
    });
  });

  it('解析链: minify 仍不带 indent', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    const largeJson = `{"data":"${'a'.repeat(FRONTEND_FORMAT_LIMIT + 1)}"}`;
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{"data":"x"}',
      meta: { input_bytes: largeJson.length, output_bytes: 10, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    fireEvent.change(getInputEditor(), { target: { value: largeJson } });
    fireEvent.click(screen.getByTestId('btn-minify'));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: largeJson, params: { minify: true } },
      });
    });
    // minify 的 params 不得携带 indent / use_tabs
    const call = (invokeCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      input: { params: Record<string, unknown> };
    };
    expect(call.input.params).not.toHaveProperty('indent');
    expect(call.input.params).not.toHaveProperty('use_tabs');
  });
});
