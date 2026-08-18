import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useToolStateStore } from '@/store/toolStateStore';
import { useTool } from './useTool';
import type { ToolMetadata } from '@/types/tool';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const meta: ToolMetadata = {
  id: 'base64_codec',
  name: 'Base64 Codec',
  description: 'encode/decode',
  category: 'encoder',
  icon: 'Binary',
  version: '0.1.0',
  input_schema: {},
  timeout_secs: null,
  streaming_supported: false,
  tags: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  const byId = new Map<string, ToolMetadata>();
  byId.set(meta.id, meta);
  useToolStateStore.setState({
    availableTools: [meta],
    toolMetadataById: byId,
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTool', () => {
  it('returns metadata from store by toolId', () => {
    const { result } = renderHook(() => useTool('base64_codec'));
    expect(result.current.metadata?.id).toBe('base64_codec');
  });

  it('execute invokes tool_execute and stores result', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: { text: 'ZW5jb2RlZA==' },
    });
    const { result } = renderHook(() => useTool('base64_codec'));
    await act(async () => {
      await result.current.execute({ text: 'encoded' });
    });
    expect(result.current.result?.text).toBe('ZW5jb2RlZA==');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('execute sets error when response fails', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad input' },
    });
    const { result } = renderHook(() => useTool('base64_codec'));
    await act(async () => {
      await result.current.execute({ text: '???' });
    });
    expect(result.current.error?.code).toBe('ERR_PARSE_FAILED');
    expect(result.current.result).toBeNull();
  });

  it('cancels running task on unmount', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 'task-1' });
    const { result, unmount } = renderHook(() => useTool('base64_codec'));
    // 启动流式执行并等待 task ID 返回,模拟真实场景下任务已启动
    await act(async () => {
      await result.current.executeStream('/tmp/a.json');
    });
    unmount();
    // 取消任务应被调用
    const calls = invokeMock.mock.calls.filter((c) => c[0] === 'tool_cancel');
    expect(calls.length).toBeGreaterThan(0);
  });
});
