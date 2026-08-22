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
 * 归一化 Tauri 命令的 reject 载荷为 ErrorInfo。
 *
 * 命令签名 `Result<CommandResponse<T>, AppError>` 失败时,Tauri 会以
 * 序列化后的 AppError 对象 reject(自定义 Serialize 形态:
 * `{ kind: "ERR_XXX", detail: ... }`),而非 CommandResponse 包络 ——
 * 若不映射,上层会拿到 `[object Object]` 消息且错误码丢失(恒为
 * ERR_INTERNAL)。这里做与 unwrapResponse 同构的归一化:
 * - Error 实例 → 保留 message(插件/网络层异常)
 * - `{ kind | code, detail | details, message? }` → 还原错误码与消息
 * - 字符串 → 直接作为消息;其余原样字符串化兜底
 */
export function normalizeIpcError(e: unknown): ErrorInfo {
  if (e instanceof Error) {
    return { code: INTERNAL_ERROR.code, message: e.message };
  }
  if (typeof e === 'string') {
    return { code: INTERNAL_ERROR.code, message: e };
  }
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    const detail = obj.detail !== undefined ? obj.detail : obj.details;
    const kind = typeof obj.kind === 'string' && obj.kind ? obj.kind : undefined;
    const code = typeof obj.code === 'string' && obj.code ? obj.code : undefined;
    const rawMessage = typeof obj.message === 'string' && obj.message ? obj.message : undefined;
    return {
      code: kind ?? code ?? INTERNAL_ERROR.code,
      message:
        rawMessage ?? (typeof detail === 'string' && detail ? detail : undefined) ?? INTERNAL_ERROR.message,
      ...(detail !== undefined ? { details: detail } : {}),
    };
  }
  return { code: INTERNAL_ERROR.code, message: String(e) };
}

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
 * 命令以 Err(AppError) reject 时,载荷经 normalizeRejection 归一化,
 * 保留真实错误码与消息(避免 `[object Object]` / 错误码丢失)。
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<Result<T, ErrorInfo>> {
  try {
    const resp = await tauriInvoke<CommandResponse<T>>(cmd, args);
    return unwrapResponse(resp);
  } catch (e) {
    return { ok: false, error: normalizeIpcError(e) };
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
