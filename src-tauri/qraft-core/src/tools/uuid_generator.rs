use async_trait::async_trait;
use std::time::Instant;
use uuid::Uuid;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct UuidGenerator;

impl UuidGenerator {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for UuidGenerator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for UuidGenerator {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let version: String = input.param("version").unwrap_or_else(|_| "v4".to_string());
        let count: i64 = input.param("count").unwrap_or(1);
        let uppercase: bool = input.param("uppercase").unwrap_or(false);
        let hyphens: bool = input.param("hyphens").unwrap_or(true);

        if count < 1 {
            return Err(ToolError::InvalidInput(format!(
                "count must be >= 1, got {count}"
            )));
        }
        if count > 1000 {
            return Err(ToolError::InvalidInput(format!(
                "count must be <= 1000, got {count}"
            )));
        }

        let start = Instant::now();
        // count 已校验在 1..=1000,转 usize 不会截断/丢符号;转 i64 仅用于循环边界
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let mut uuids: Vec<String> = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let uuid = match version.as_str() {
                "v4" => Uuid::new_v4(),
                "v7" => Uuid::now_v7(),
                other => {
                    return Err(ToolError::InvalidInput(format!(
                        "version must be 'v4' or 'v7', got '{other}'"
                    )));
                }
            };
            let mut s = if hyphens {
                uuid.hyphenated().to_string()
            } else {
                uuid.simple().to_string()
            };
            if uppercase {
                s = s.to_uppercase();
            }
            uuids.push(s);
        }
        let out_text = uuids.join("\n");
        let output_bytes = out_text.len();
        let input_bytes = 0; // 无文本输入

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                // u128 → u64:工具执行耗时远小于 u64 上限,截断不可能发生
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
    id: "uuid_generator",
    name: "UUID Generator",
    category: ToolCategory::Generator,
    icon: "fingerprint",
    description: "Generate v4 or v7 UUIDs in bulk with format options",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["uuid", "guid", "generate", "v4", "v7"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(UuidGenerator, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_params_input(params: HashMap<String, serde_json::Value>) -> ToolInput {
        ToolInput {
            text: None,
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_generate_v4_single() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v4"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text.lines().count(), 1);
        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 36); // hyphenated form
        assert!(uuid.contains('-'));
    }

    #[tokio::test]
    async fn test_generate_v7_single() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v7"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 36);
        // v7 第一段前 3 字节是 unix_ts_ms,应是十六进制
        assert!(uuid.starts_with('0') || uuid.chars().next().unwrap().is_ascii_hexdigit());
    }

    #[tokio::test]
    async fn test_generate_count_10() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(10));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let lines: Vec<&str> = output.text.lines().collect();
        assert_eq!(lines.len(), 10);
        // 全部唯一
        let mut deduped = lines.clone();
        deduped.sort_unstable();
        deduped.dedup();
        assert_eq!(deduped.len(), 10);
    }

    #[tokio::test]
    async fn test_generate_uppercase() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1));
        params.insert("uppercase".to_string(), json!(true));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert!(uuid.chars().any(|c| c.is_ascii_uppercase()));
        assert!(!uuid.chars().any(|c| c.is_ascii_lowercase() && c != '-'));
    }

    #[tokio::test]
    async fn test_generate_no_hyphens() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1));
        params.insert("hyphens".to_string(), json!(false));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 32);
        assert!(!uuid.contains('-'));
    }

    #[tokio::test]
    async fn test_count_zero_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(0));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_count_above_1000_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1001));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_invalid_version_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v8"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
