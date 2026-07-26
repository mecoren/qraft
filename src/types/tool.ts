// 工具相关类型定义,镜像 Rust 端数据结构
//
// 重要约定:Rust 侧 serde 默认将字段名转为 snake_case(除非显式 rename_all),
// 因此 TypeScript 类型也采用 snake_case,保持前后端契约一致。
// 见 PRD 08-data-model.md §3.1 与 05-rust-core-engine.md 的 ToolMetadata。

/** 工具分类,与 Rust 侧 ToolCategory enum 对齐(serde rename_all = "snake_case") */
export type ToolCategory =
  | 'formatter'
  | 'encoder'
  | 'generator'
  | 'parser'
  | 'converter'
  | 'comparator';

/** 工具元数据,UI 只读视角。镜像 Rust `ToolMetadata`。 */
export interface ToolMetadata {
  id: string;
  name: string;
  category: ToolCategory;
  /** lucide-react 图标名 */
  icon: string;
  description: string;
  /** 输入参数 JSON Schema,用于动态渲染表单 */
  input_schema: unknown;
  /** 输出参数 JSON Schema(可选) */
  output_schema?: unknown | null;
  /** 工具标签,用于搜索 */
  tags: string[];
  version: string;
  /** 执行超时(秒),null 表示使用默认值 */
  timeout_secs: number | null;
  /** 是否支持流式执行 */
  streaming_supported: boolean;
}

/** 工具输入,镜像 Rust `ToolInput`(`skip_serializing_if` 不影响反序列化) */
export interface ToolInput {
  text?: string;
  file_path?: string;
  params?: Record<string, unknown>;
}

/** 工具输出元信息,镜像 Rust `OutputMeta` */
export interface OutputMeta {
  duration_ms: number;
  input_bytes: number;
  output_bytes: number;
}

/** 警告级别,镜像 Rust `AlertLevel`(serde rename_all = "snake_case") */
export type AlertLevel = 'info' | 'warning' | 'error';

export interface Alert {
  level: AlertLevel;
  message: string;
}

/** 工具输出,镜像 Rust `ToolOutput` */
export interface ToolOutput {
  text: string;
  extra?: unknown;
  meta?: OutputMeta;
  alerts?: Alert[];
}

/**
 * 工具错误,前端视角。
 *
 * Rust 侧 `ToolError` 通过 `#[serde(tag = "kind", content = "detail")]` 序列化,
 * 但跨 IPC 边界后已被 `CommandResponse.ErrorInfo` 包装为 `{ kind, detail, message }`。
 * 这里以前端最终看到的扁平结构为准。
 */
export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * 流式事件类型,镜像 Rust `StreamEvent`(`#[serde(tag = "type", rename_all = "snake_case")]`)。
 *
 * Rust 端 4 个变体:
 * - `Progress { percent, message }`
 * - `Chunk { text }`
 * - `Done { output }`
 * - `Error { error }`
 *
 * 注意:taskId 不在事件本身,而是由 Tauri 事件 payload 外层携带。
 */
export type StreamEvent =
  | { type: 'progress'; percent: number; message: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; output: ToolOutput }
  | { type: 'error'; error: ToolError };

/** 工具运行时上下文(UI 视角,仅暴露给 UI 需要的字段) */
export interface ToolContext {
  tool_id: string;
  /** 是否已取消 */
  cancelled: boolean;
}
