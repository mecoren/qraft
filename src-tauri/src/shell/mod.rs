// Shell 层:桥接 Rust Core 与 React UI
//
// - 通过 `#[tauri::command]` 暴露 IPC(具体命令在 `crate::commands` 模块)
// - 通过 `tauri::AppHandle::emit` 推送事件
// - 通过 `tauri::State<AppState>` 注入 Core 依赖
// - capabilities/ 目录配置细粒度权限(最小权限原则)

pub mod response;
pub mod state;

// AppError 在 core::error 中定义,Shell 层直接复用,避免类型割裂
pub use crate::core::error::AppError;
pub use response::{CommandResponse, ErrorInfo};
pub use state::{AppState, HistorySinkImpl, StreamingTaskRegistry};
