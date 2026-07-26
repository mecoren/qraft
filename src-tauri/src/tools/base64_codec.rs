use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct Base64Codec;

impl Default for Base64Codec {
    fn default() -> Self {
        Self::new()
    }
}

impl Base64Codec {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for Base64Codec {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let action: String = input.param::<String>("action")?;
        let url_safe: bool = input.param::<bool>("url_safe").unwrap_or(false);

        let start = Instant::now();
        let input_bytes = text.len();
        let out_text = match action.as_str() {
            "encode" => {
                let engine = if url_safe { &URL_SAFE } else { &STANDARD };
                engine.encode(text.as_bytes())
            }
            "decode" => {
                let engine = if url_safe { &URL_SAFE } else { &STANDARD };
                let bytes = engine
                    .decode(text.as_bytes())
                    .map_err(|e| ToolError::ParseFailed(e.to_string()))?;
                String::from_utf8(bytes).map_err(|e| {
                    ToolError::ParseFailed(format!("decoded bytes are not utf8: {e}"))
                })?
            }
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "action must be 'encode' or 'decode', got '{other}'"
                )));
            }
        };
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
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
    id: "base64_codec",
    name: "Base64 Codec",
    category: ToolCategory::Encoder,
    icon: "binary",
    description: "Encode or decode Base64 (standard or URL-safe)",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["base64", "encode", "decode", "url-safe"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(Base64Codec, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str, action: &str, url_safe: bool) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("action".to_string(), json!(action));
        params.insert("url_safe".to_string(), json!(url_safe));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_encode_standard() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("hello", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "aGVsbG8=");
    }

    #[tokio::test]
    async fn test_encode_url_safe() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // ">>>" 的 base64 编码在标准模式下含 '+',URL-safe 模式下含 '-'
        let input = make_input(">>>", "encode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert!(output.text.contains('-'));
        assert!(!output.text.contains('+'));
        assert!(!output.text.contains('/'));
    }

    #[tokio::test]
    async fn test_decode_standard() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("aGVsbG8=", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello");
    }

    #[tokio::test]
    async fn test_decode_url_safe() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // ">>>" 的 URL-safe base64 编码为 "Pj4-"
        let input = make_input("Pj4-", "decode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, ">>>");
    }

    #[tokio::test]
    async fn test_encode_empty_string() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "");
    }

    #[tokio::test]
    async fn test_decode_invalid_base64_returns_parse_failed() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("!!!not-base64!!!", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_invalid_action_returns_invalid_input() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("hello", "rot13", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
