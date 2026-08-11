/**
 * IPC 线上传输的错误字段。
 *
 * Rust 端 `shell::response::ErrorInfo` 经 serde 序列化为 `{ kind, detail, message }`
 * (camelCase),字段名与前端归一化后的 `ErrorInfo` 不同;历史/测试 mock 可能
 * 使用 `code` / `details`。统一由 `unwrapResponse` 归一化为 `ErrorInfo`。
 */
export interface WireErrorInfo {
  code?: string;
  message?: string;
  details?: unknown;
  /** Rust 端字段 */
  kind?: string;
  detail?: string;
}

/** 错误信息(前端视角,经 unwrapResponse 归一化后 code 必有值) */
export interface ErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

/** 响应元信息 */
export interface ResponseMeta {
  durationMs: number;
  version: string;
}

/** 统一响应包络,镜像 Rust CommandResponse<T> */
export interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: WireErrorInfo;
  meta?: ResponseMeta;
}

/** 事件 payload 类型 */
export interface ConfigChangedPayload {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ToolProgressPayload {
  taskId: string;
  processed: number;
  total: number;
}

export interface ToolChunkPayload {
  taskId: string;
  text: string;
}

export interface ToolCompletedPayload {
  taskId: string;
  output: import('./tool').ToolOutput;
}

export interface ToolFailedPayload {
  taskId: string;
  error: import('./tool').ToolError;
}
