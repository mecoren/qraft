use async_trait::async_trait;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

/// encodeURI 保留字符: A-Z a-z 0-9 - _ . ! ~ * ' ( ) ; , / ? : @ & = + $ #
/// 参考 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURI
const ENCODE_URI_RESERVED: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'#')
    .add(b'{')
    .add(b'}')
    .add(b'|')
    .add(b'\\')
    .add(b'^')
    .add(b'[')
    .add(b']')
    .add(b'`');

/// encodeURIComponent 保留字符: A-Z a-z 0-9 - _ . ! ~ * ' ( )
/// 参考 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
const ENCODE_URI_COMPONENT_RESERVED: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub struct UrlCodec;

impl Default for UrlCodec {
    fn default() -> Self {
        Self::new()
    }
}

impl UrlCodec {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for UrlCodec {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let action: String = input.param::<String>("action")?;
        let component: bool = input.param::<bool>("component").unwrap_or(false);

        let start = Instant::now();
        let input_bytes = text.len();
        let out_text = match action.as_str() {
            "encode" => {
                let set = if component {
                    ENCODE_URI_COMPONENT_RESERVED
                } else {
                    ENCODE_URI_RESERVED
                };
                utf8_percent_encode(text, set).to_string()
            }
            "decode" => {
                validate_percent_encoding(text)?;
                percent_encoding::percent_decode_str(text)
                    .decode_utf8()
                    .map_err(|e| ToolError::ParseFailed(format!("decode failed: {e}")))?
                    .to_string()
            }
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "action must be 'encode' or 'decode', got '{other}'"
                )))
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

/// 检查百分号编码的有效性:每个 `%` 后必须跟两个十六进制字符。
fn validate_percent_encoding(text: &str) -> Result<(), ToolError> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(ToolError::ParseFailed(format!(
                    "incomplete percent encoding at position {i}"
                )));
            }
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            if !hi.is_ascii_hexdigit() || !lo.is_ascii_hexdigit() {
                return Err(ToolError::ParseFailed(format!(
                    "invalid percent encoding at position {i}: %{}{}",
                    hi as char, lo as char
                )));
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    Ok(())
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "url_codec",
    name: "URL Encoder/Decoder",
    category: ToolCategory::Encoder,
    icon: "link",
    description: "Encode or decode URL (full URI or component)",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["url", "encode", "decode", "percent-encoding", "uri"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(UrlCodec, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str, action: &str, component: bool) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("action".to_string(), json!(action));
        params.insert("component".to_string(), json!(component));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_encode_uri_keeps_reserved() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("https://example.com/path?q=1&lang=zh", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        // encodeURI 不应编码 : / ? & = #
        assert_eq!(output.text, "https://example.com/path?q=1&lang=zh");
    }

    #[tokio::test]
    async fn test_encode_component_encodes_reserved() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("https://example.com", "encode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        // encodeURIComponent 应编码 : / .
        assert!(output.text.contains("%3A"));
        assert!(output.text.contains("%2F"));
    }

    #[tokio::test]
    async fn test_encode_space() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello world", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello%20world");
    }

    #[tokio::test]
    async fn test_decode_percent_encoded() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello%20world%21", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello world!");
    }

    #[tokio::test]
    async fn test_decode_utf8() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("%E4%B8%AD%E6%96%87", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "中文");
    }

    #[tokio::test]
    async fn test_decode_invalid_percent_returns_parse_failed() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("%ZZ", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_invalid_action_returns_invalid_input() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello", "escape", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
