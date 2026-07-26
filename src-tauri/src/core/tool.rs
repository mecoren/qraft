use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;

/// 所有工具必须实现的核心 trait
///
/// 实现要点:
/// 1. `metadata()` 返回静态描述,在编译期通过 inventory 注册
/// 2. `execute()` 是纯函数式:相同输入 + 相同 context 配置 → 相同输出
/// 3. 禁止在 execute 中调用 Tauri API,所有外部能力通过 `ToolContext` 注入
#[async_trait]
pub trait Tool: Send + Sync {
    fn metadata(&self) -> &'static ToolMetadata;

    async fn execute(&self, input: ToolInput, ctx: &ToolContext) -> Result<ToolOutput, ToolError>;
}

/// 工具的静态元数据
#[derive(Debug, Clone, Serialize)]
pub struct ToolMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub category: ToolCategory,
    pub icon: &'static str,
    pub description: &'static str,
    pub input_schema: &'static serde_json::Value,
    pub output_schema: Option<&'static serde_json::Value>,
    pub tags: &'static [&'static str],
    pub version: &'static str,
    pub timeout_secs: Option<u32>,
    pub streaming_supported: bool,
}

/// 工具分类
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    Formatter,
    Encoder,
    Generator,
    Parser,
    Converter,
    Comparator,
}

/// 流式工具 trait(可选)
///
/// 仅当 `ToolMetadata.streaming_supported` == true 时实现。
/// `execute_stream` 返回异步流,每个 Item 是一个流式事件。
#[async_trait]
pub trait StreamingTool: Send + Sync {
    fn execute_stream(
        &self,
        input: ToolInput,
        ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>>;
}

/// 流式事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Progress { percent: u8, message: String },
    Chunk { text: String },
    Done { output: ToolOutput },
    Error { error: ToolError },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_category_formatter_serde() {
        let v = serde_json::to_value(ToolCategory::Formatter).unwrap();
        assert_eq!(v, "formatter");
    }

    #[test]
    fn test_category_encoder_serde() {
        let v = serde_json::to_value(ToolCategory::Encoder).unwrap();
        assert_eq!(v, "encoder");
    }

    #[test]
    fn test_category_generator_serde() {
        let v = serde_json::to_value(ToolCategory::Generator).unwrap();
        assert_eq!(v, "generator");
    }

    #[test]
    fn test_category_parser_serde() {
        let v = serde_json::to_value(ToolCategory::Parser).unwrap();
        assert_eq!(v, "parser");
    }

    #[test]
    fn test_category_converter_serde() {
        let v = serde_json::to_value(ToolCategory::Converter).unwrap();
        assert_eq!(v, "converter");
    }

    #[test]
    fn test_category_comparator_serde() {
        let v = serde_json::to_value(ToolCategory::Comparator).unwrap();
        assert_eq!(v, "comparator");
    }

    #[test]
    fn test_metadata_static_construction() {
        static SCHEMA: serde_json::Value = serde_json::Value::Null;
        static META: ToolMetadata = ToolMetadata {
            id: "test_tool",
            name: "Test Tool",
            category: ToolCategory::Formatter,
            icon: "circle",
            description: "test",
            input_schema: &SCHEMA,
            output_schema: None,
            tags: &["test"],
            version: "0.1.0",
            timeout_secs: Some(5),
            streaming_supported: false,
        };
        assert_eq!(META.id, "test_tool");
        assert_eq!(META.timeout_secs, Some(5));
        assert!(!META.streaming_supported);
    }

    #[test]
    fn test_stream_event_progress_serde() {
        let ev = StreamEvent::Progress {
            percent: 50,
            message: "half done".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "progress");
        assert_eq!(v["percent"], 50);
        assert_eq!(v["message"], "half done");
    }

    #[test]
    fn test_stream_event_chunk_serde() {
        let ev = StreamEvent::Chunk {
            text: "partial".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "chunk");
        assert_eq!(v["text"], "partial");
    }

    #[test]
    fn test_stream_event_done_serde() {
        let ev = StreamEvent::Done {
            output: ToolOutput {
                text: "final".into(),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "done");
        assert_eq!(v["output"]["text"], "final");
    }

    #[test]
    fn test_stream_event_error_serde() {
        let ev = StreamEvent::Error {
            error: ToolError::Internal("oops".into()),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["error"]["kind"], "internal");
    }
}
