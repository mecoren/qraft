use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::DateTime;
use chrono::Utc;
use serde_json::Value;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct JwtParser;

impl Default for JwtParser {
    fn default() -> Self {
        Self::new()
    }
}

impl JwtParser {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JwtParser {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        let start = Instant::now();

        // JWT 形如 header.payload.signature,以 '.' 分隔
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 3 {
            return Err(ToolError::InvalidInput(format!(
                "JWT must have 3 segments separated by '.', got {}",
                parts.len()
            )));
        }

        let header_bytes = URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|e| ToolError::ParseFailed(format!("header base64 decode failed: {e}")))?;
        let payload_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|e| ToolError::ParseFailed(format!("payload base64 decode failed: {e}")))?;

        let header: Value = serde_json::from_slice(&header_bytes)
            .map_err(|e| ToolError::ParseFailed(format!("header is not valid JSON: {e}")))?;
        let payload: Value = serde_json::from_slice(&payload_bytes)
            .map_err(|e| ToolError::ParseFailed(format!("payload is not valid JSON: {e}")))?;

        // 计算 expires_at(若 payload 含 'exp' 标准 claim)
        let expires_at = payload
            .get("exp")
            .and_then(|v| v.as_i64())
            .and_then(|ts| {
                // JWT exp 是秒级时间戳,超出范围时返回 None
                DateTime::<Utc>::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
            });

        // text:格式化展示 header 与 payload
        let header_pretty = serde_json::to_string_pretty(&header)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let payload_pretty = serde_json::to_string_pretty(&payload)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let out_text = format!(
            "Header:\n{}\n\nPayload:\n{}\n\nSignature:\n{}",
            header_pretty, payload_pretty, parts[2]
        );

        let mut extra = serde_json::Map::new();
        extra.insert("header".to_string(), header);
        extra.insert("payload".to_string(), payload);
        extra.insert(
            "signature".to_string(),
            Value::String(parts[2].to_string()),
        );
        if let Some(exp) = expires_at {
            extra.insert("expires_at".to_string(), Value::String(exp));
        }

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(Value::Object(extra)),
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
    id: "jwt_parser",
    name: "JWT Parser",
    category: ToolCategory::Parser,
    icon: "key-round",
    description: "Decode JWT header, payload and signature without verifying",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["jwt", "token", "auth", "decode"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(JwtParser, &METADATA);

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

    // 一个真实的 HS256 JWT(header={"alg":"HS256","typ":"JWT"}, payload={"sub":"1234567890","name":"John Doe","iat":1516239022})
    // 通过 https://jwt.io 生成的 token,签名不经验证
    const VALID_JWT: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    #[tokio::test]
    async fn test_parse_valid_jwt_header() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["header"]["alg"], "HS256");
        assert_eq!(extra["header"]["typ"], "JWT");
    }

    #[tokio::test]
    async fn test_parse_valid_jwt_payload() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["payload"]["sub"], "1234567890");
        assert_eq!(extra["payload"]["name"], "John Doe");
        assert_eq!(extra["payload"]["iat"], 1516239022);
    }

    #[tokio::test]
    async fn test_parse_valid_jwt_signature() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(
            extra["signature"],
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        );
    }

    #[tokio::test]
    async fn test_parse_jwt_with_exp_returns_expires_at() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        // 构造 exp=1516242622 的 JWT
        // header: eyJhbGciOiJIUzI1NiJ9  -> {"alg":"HS256"}
        // payload: eyJleHAiOjE1MTYyNDI2MjJ9  -> {"exp":1516242622}
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE1MTYyNDI2MjJ9.fakesignature";
        let input = make_input(jwt);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        // exp=1516242622 → 2018-01-18T...
        let exp = extra["expires_at"].as_str().unwrap();
        assert!(exp.starts_with("2018-"));
    }

    #[tokio::test]
    async fn test_parse_jwt_with_two_segments_returns_invalid_input() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input("only.two");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_parse_jwt_with_invalid_base64_returns_parse_failed() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        // 3 段,第一段含非法 base64 字符 '!'
        let input = make_input("!!!.bb.cc");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_parse_jwt_payload_not_json_returns_parse_failed() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        // payload base64 of "not json"
        let not_json_b64 = URL_SAFE_NO_PAD.encode(b"not json");
        let jwt = format!("eyJhbGciOiJIUzI1NiJ9.{not_json_b64}.sig");
        let input = make_input(&jwt);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }
}
