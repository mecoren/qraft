import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { safeInvoke, unwrapResponse, listen, invokeCommand, CommandError, AppError } from './ipc';
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

  it('normalizes Rust payload (kind/detail) into code/details', () => {
    // Rust 端 ErrorInfo 序列化为 { kind, detail, message },字段名与前端不同
    const resp: CommandResponse<string> = {
      success: false,
      error: { kind: 'ERR_PARSE_FAILED', detail: 'bad json', message: 'parse failed: bad json' },
    };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_PARSE_FAILED');
      expect(r.error.details).toBe('bad json');
      expect(r.error.message).toBe('parse failed: bad json');
    }
  });

  it('prefers kind over code when both present', () => {
    const resp: CommandResponse<string> = {
      success: false,
      error: { kind: 'ERR_KIND', code: 'ERR_CODE', message: 'm' },
    };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_KIND');
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

  it('normalizes AppError rejection payload (kind/detail) with real code preserved', async () => {
    // 命令返回 Err(AppError) 时,Tauri 以序列化错误对象 reject(非 CommandResponse 包络)
    invokeMock.mockRejectedValueOnce({
      kind: 'ERR_FILE_UNSUPPORTED',
      detail: 'binary content',
    });
    const r = await safeInvoke<unknown>('fs_read_text_file_checked', { path: 'a.lnk' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_FILE_UNSUPPORTED');
      // 消息不得是 "[object Object]":detail 字符串应回填为 message
      expect(r.error.message).toBe('binary content');
      expect(r.error.details).toBe('binary content');
    }
  });

  it('unwraps nested ToolError detail object in rejection payload', async () => {
    // AppError::Tool 序列化为 { kind, detail: <ToolError> },而 ToolError 自身
    // 又是 { kind, detail } tag/content 形态 —— 真实消息在最内层 detail 字符串里
    invokeMock.mockRejectedValueOnce({
      kind: 'ERR_INVALID_INPUT',
      detail: {
        kind: 'invalid_input',
        detail: "from_format must be 'hex', 'rgb' or 'hsl', got 'auto'",
      },
    });
    const r = await safeInvoke<unknown>('tool_execute');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_INVALID_INPUT');
      expect(r.error.message).toBe("from_format must be 'hex', 'rgb' or 'hsl', got 'auto'");
      expect(r.error.message).not.toBe('Unexpected IPC response');
    }
  });

  it('nested detail without string payload still falls back to internal message', async () => {
    // InputTooLarge 的 detail 是 { size, max } 结构对象,无字符串可提取
    invokeMock.mockRejectedValueOnce({
      kind: 'ERR_INPUT_TOO_LARGE',
      detail: { kind: 'input_too_large', detail: { size: 300, max: 256 } },
    });
    const r = await safeInvoke<unknown>('tool_execute');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_INPUT_TOO_LARGE');
      expect(r.error.message).toBe('Unexpected IPC response');
    }
  });

  it('prefers explicit message over string detail in rejection payload', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'ERR_CONFIG_IO',
      detail: 'disk io failed',
      message: '配置写入失败',
    });
    const r = await safeInvoke<unknown>('config_set');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_CONFIG_IO');
      expect(r.error.message).toBe('配置写入失败');
      expect(r.error.details).toBe('disk io failed');
    }
  });

  it('falls back to internal message (never "[object Object]") for unknown object rejection', async () => {
    invokeMock.mockRejectedValueOnce({ foo: 'bar' });
    const r = await safeInvoke<unknown>('x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_INTERNAL');
      expect(r.error.message).not.toContain('[object');
    }
  });

  it('string rejection is used as message directly', async () => {
    invokeMock.mockRejectedValueOnce('boom');
    const r = await safeInvoke<unknown>('x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('boom');
  });
});

describe('invokeCommand 错误传递', () => {
  it('throws CommandError with real code/message from Err(AppError) rejection', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'ERR_PERMISSION_DENIED',
      detail: 'path not authorized, must be selected via dialog: C:\\x',
    });
    const err = await invokeCommand('fs_read_dir', { path: 'C:\\x' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).code).toBe('ERR_PERMISSION_DENIED');
    expect((err as CommandError).message).toBe(
      'path not authorized, must be selected via dialog: C:\\x',
    );
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
