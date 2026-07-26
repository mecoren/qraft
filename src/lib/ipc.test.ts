import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  safeInvoke,
  unwrapResponse,
  listen,
  AppError,
} from './ipc';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('unwrapResponse', () => {
  it('returns ok with data when success is true', () => {
    const resp: CommandResponse<string> = { success: true, data: 'hello' };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello');
  });

  it('returns error when success is false', () => {
    const resp: CommandResponse<string> = {
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad' },
    };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_PARSE_FAILED');
  });

  it('returns ERR_INTERNAL when success true but data missing', () => {
    const resp: CommandResponse<string> = { success: true };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_INTERNAL');
  });
});

describe('safeInvoke', () => {
  it('returns value when invoke resolves with success response', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 42 });
    const r = await safeInvoke<number>('config_get', { key: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
    expect(invokeMock).toHaveBeenCalledWith('config_get', { key: 'x' });
  });

  it('returns error when response.success is false', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_TOOL_NOT_FOUND', message: 'no such tool' },
    });
    const r = await safeInvoke<unknown>('tool_metadata', { toolId: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('no such tool');
  });

  it('returns ERR_INTERNAL when invoke throws', async () => {
    invokeMock.mockRejectedValueOnce(new Error('network down'));
    const r = await safeInvoke<unknown>('tool_list');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_INTERNAL');
      expect(r.error.message).toContain('network down');
    }
  });
});

describe('AppError', () => {
  it('is instance of Error with code', () => {
    const e = new AppError('ERR_X', 'msg');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('ERR_X');
    expect(e.message).toBe('msg');
    expect(e.name).toBe('AppError');
  });
});

describe('listen', () => {
  it('delegates to @tauri-apps/api/event listen', async () => {
    const { listen: apiListen } = await import('@tauri-apps/api/event');
    const spy = apiListen as unknown as ReturnType<typeof vi.fn>;
    spy.mockResolvedValueOnce(() => {});
    const handler = () => {};
    await listen('config_changed', handler);
    // 实现会包装 handler 以提取 payload,故只校验事件名与函数类型
    expect(spy).toHaveBeenCalledWith('config_changed', expect.any(Function));
  });
});
