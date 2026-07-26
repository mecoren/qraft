use async_trait::async_trait;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024; // 10MB

pub struct JsonMinifier;

impl Default for JsonMinifier {
    fn default() -> Self {
        Self::new()
    }
}

impl JsonMinifier {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JsonMinifier {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }

        let start = Instant::now();
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|e| ToolError::ParseFailed(e.to_string()))?;

        let out_text =
            serde_json::to_string(&value).map_err(|e| ToolError::Internal(e.to_string()))?;
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                // u128 → u64 截断:实际耗时不会超过 u64 范围
                #[allow(clippy::cast_possible_truncation)]
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "json_minifier",
    name: "JSON Minifier",
    category: ToolCategory::Formatter,
    icon: "minimize-2",
    description: "Minify JSON by removing whitespace",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["json", "minify", "compress"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位(与 json_formatter 一致)
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(JsonMinifier, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use std::collections::HashMap;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn test_minify_pretty_json() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("{\n  \"a\": 1,\n  \"b\": 2\n}");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, r#"{"a":1,"b":2}"#);
    }

    #[tokio::test]
    async fn test_minify_already_minified() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, r#"{"a":1}"#);
    }

    #[tokio::test]
    async fn test_minify_empty_object() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("{ }");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{}");
    }

    #[tokio::test]
    async fn test_minify_nested_array() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("[\n  1,\n  2,\n  [3, 4]\n]");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "[1,2,[3,4]]");
    }

    #[tokio::test]
    async fn test_minify_invalid_json_returns_parse_failed() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("{invalid}");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_minify_input_too_large() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let large = " ".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }
}
