//! Qraft 工具引擎（与 Tauri 解耦）。
//!
//! 只包含纯 Rust 的工具执行核心：`Tool` / `StreamingTool` trait、`inventory`
//! 注册表、执行器、错误体系与全部后端工具实现。不依赖 Tauri 或任何 `WebView`
//! 运行时，可被 Tauri 壳、CLI 或原生 GUI（如 GPUI）直接复用。
//!
//! 约束沿用 PRD 05：`execute` 必须无状态、纯函数式，外部能力经
//! [`ToolContext`](crate::core::context::ToolContext) 注入。

// 测试代码允许使用 unwrap/expect/panic:这些是测试中惯用的失败快速触发方式,
// 在生产代码中仍按 Cargo.toml 中 lints.clippy 配置保持 warn 级别。
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod core;
pub mod tools;

// 重导出核心类型,应用层（Tauri / CLI / GUI）只需依赖本 crate 即可拿到全部契约。
pub use crate::core::context::{HistoryEntry, HistorySink, ToolContext};
pub use crate::core::error::{AppError, EngineError, ToolError};
pub use crate::core::executor::ToolExecutor;
pub use crate::core::input::ToolInput;
pub use crate::core::output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use crate::core::registry::{StreamingEntry, ToolEntry, ToolRegistry};
pub use crate::core::tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};
