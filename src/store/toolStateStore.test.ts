import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useToolStateStore } from './toolStateStore';
import { DEFAULT_TOOL_ID } from '@/lib/tool-catalog';
import type { ToolMetadata, ToolOutput } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const sampleMeta: ToolMetadata = {
  id: 'json_formatter',
  name: 'JSON Formatter',
  description: 'Format JSON',
  category: 'formatter',
  icon: 'Braces',
  version: '0.1.0',
  input_schema: {},
  timeout_secs: null,
  streaming_supported: false,
  tags: ['json'],
};

beforeEach(() => {
  invokeMock.mockReset();
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('toolStateStore.loadTools', () => {
  it('stores availableTools on success', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: [sampleMeta],
    } satisfies CommandResponse<ToolMetadata[]>);
    await useToolStateStore.getState().loadTools();
    expect(useToolStateStore.getState().availableTools).toHaveLength(1);
  });

  it('leaves availableTools empty on failure', async () => {
    invokeMock.mockRejectedValueOnce(new Error('ipc'));
    await useToolStateStore.getState().loadTools();
    expect(useToolStateStore.getState().availableTools).toEqual([]);
  });
});

describe('toolStateStore initial state', () => {
  it('默认启动工具为文本编辑器', () => {
    expect(useToolStateStore.getInitialState().currentToolId).toBe(DEFAULT_TOOL_ID);
  });
});

describe('toolStateStore.selectTool', () => {
  it('sets currentToolId', () => {
    useToolStateStore.getState().selectTool('json_formatter');
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
  });

  it('can clear by passing null', () => {
    useToolStateStore.getState().selectTool('json_formatter');
    useToolStateStore.getState().selectTool(null);
    expect(useToolStateStore.getState().currentToolId).toBeNull();
  });
});

describe('toolStateStore.executeTool', () => {
  it('sets running true then false, stores output', async () => {
    const out: ToolOutput = { text: 'formatted' };
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: out,
    } satisfies CommandResponse<ToolOutput>);

    const promise = useToolStateStore.getState().executeTool({
      toolId: 'json_formatter',
      input: { text: '{}' },
    });

    expect(useToolStateStore.getState().running).toBe(true);
    const r = await promise;
    expect(useToolStateStore.getState().running).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('formatted');
  });

  it('returns error info on failure', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad json' },
    });
    const r = await useToolStateStore.getState().executeTool({
      toolId: 'json_formatter',
      input: { text: '{' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_PARSE_FAILED');
  });
});

describe('streaming task lifecycle', () => {
  it('applyToolProgress updates task progress', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 5,
      total: 10,
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.processed).toBe(5);
    expect(t?.total).toBe(10);
    expect(t?.status).toBe('running');
  });

  it('applyToolChunk appends text and keeps running', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolChunk({ taskId: 't1', text: 'a' });
    useToolStateStore.getState().applyToolChunk({ taskId: 't1', text: 'b' });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.chunks).toBe('ab');
  });

  it('applyToolCompleted sets status completed with output', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolCompleted({
      taskId: 't1',
      output: { text: 'done' },
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.status).toBe('completed');
    expect(t?.output?.text).toBe('done');
  });

  it('applyToolFailed sets status failed with error', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolFailed({
      taskId: 't1',
      error: { code: 'ERR_INTERNAL', message: 'panic' },
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.status).toBe('failed');
    expect(t?.error?.code).toBe('ERR_INTERNAL');
  });
});
