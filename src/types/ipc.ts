/** 错误信息,镜像 Rust CommandError */
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
  error?: ErrorInfo;
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
