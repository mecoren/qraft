import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandResponse, ErrorInfo } from '@/types/ipc';

/** Result 类型,用 ok 字段区分成功/失败以避免 throw */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** 应用错误,继承 Error 便于在需要时 throw;字段与 ErrorInfo 一致 */
export class AppError extends Error implements ErrorInfo {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 命令错误,工具组件使用的错误类型。
 * 与 AppError 字段一致,但名称独立,便于组件用 instanceof 精准捕获 IPC 失败。
 */
export class CommandError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.details = details;
  }
}

/** 内部默认错误,用于响应包络异常时 */
const INTERNAL_ERROR: ErrorInfo = {
  code: 'ERR_INTERNAL',
  message: 'Unexpected IPC response',
};

/**
 * 解包 CommandResponse,失败返回归一化后的 ErrorInfo。
 * 当 success=true 但 data 缺失时视为 ERR_INTERNAL。
 *
 * Rust 端 ErrorInfo 序列化为 `{ kind, detail, message }`,前端类型为
 * `{ code, message, details }`,这里统一映射,确保上层 `code` / `details` 有值。
 */
export function unwrapResponse<T>(resp: CommandResponse<T>): Result<T, ErrorInfo> {
  if (resp.success && resp.data !== undefined) {
    return { ok: true, value: resp.data };
  }
  const err = resp.error;
  if (!err) return { ok: false, error: INTERNAL_ERROR };
  return {
    ok: false,
    error: {
      code: err.kind ?? err.code ?? INTERNAL_ERROR.code,
      message: err.message ?? INTERNAL_ERROR.message,
      details: err.detail !== undefined ? err.detail : err.details,
    },
  };
}

/** 原始 invoke 透传,不做解包,供特殊场景使用 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/**
 * 安全 invoke,自动解包 CommandResponse。
 * 任何异常(包括 IPC 抛错、响应缺失 error 字段)统一转 ErrorInfo。
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<Result<T, ErrorInfo>> {
  try {
    const resp = await tauriInvoke<CommandResponse<T>>(cmd, args);
    return unwrapResponse(resp);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'ERR_INTERNAL',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/** listen 透传,统一类型签名 */
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => handler(e.payload));
}

/**
 * 命令式 invoke:自动解包 CommandResponse,失败时抛出 CommandError。
 *
 * 工具组件使用此函数配合 try/catch + instanceof CommandError 进行错误处理。
 * 成功时返回 data,失败时 throw CommandError(code, message)。
 */
export async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(cmd, args);
  if (!result.ok) {
    throw new CommandError(result.error.code, result.error.message, result.error.details);
  }
  return result.value;
}
