pub mod context;
pub mod error;
pub mod executor;
pub mod input;
pub mod output;
pub mod registry;
pub mod test_utils;
pub mod tool;

// 重导出 Core 层关键类型,方便外部使用
pub use context::{HistoryEntry, HistorySink, ToolContext};
pub use error::{AppError, EngineError, ToolError};
pub use executor::ToolExecutor;
pub use input::ToolInput;
pub use output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use registry::{StreamingEntry, ToolEntry, ToolRegistry};
pub use tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};
