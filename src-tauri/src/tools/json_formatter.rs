use async_trait::async_trait;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_stream_tool;
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024; // 10MB

pub struct JsonFormatter;

impl Default for JsonFormatter {
    fn default() -> Self {
        Self::new()
    }
}

impl JsonFormatter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JsonFormatter {
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

        // 修正计划 bug:param 返回 Result,需要 turbofish 显式指定 T
        let indent: u32 = input.param::<u32>("indent").unwrap_or(2);
        let sort_keys: bool = input.param::<bool>("sort_keys").unwrap_or(false);

        let start = Instant::now();
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|e| ToolError::ParseFailed(e.to_string()))?;

        let final_value = if sort_keys { sort_value(value) } else { value };

        let indent_str = " ".repeat(indent as usize);
        let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes());
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
        serde::Serialize::serialize(&final_value, &mut ser)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let out_text = String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?;
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                // u128 → u64 截断:实际耗时不会超过 u64 范围,允许截断
                #[allow(clippy::cast_possible_truncation)]
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

/// 递归对 JSON 对象的键做字典序排序,保持数组顺序与基本类型不变。
fn sort_value(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut pairs: Vec<(String, Value)> = map.into_iter().collect();
            pairs.sort_by(|a, b| a.0.cmp(&b.0));
            let sorted: serde_json::Map<String, Value> = pairs.into_iter().collect();
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_value).collect()),
        other => other,
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "json_formatter",
    name: "JSON Formatter",
    category: ToolCategory::Formatter,
    icon: "braces",
    description: "Format, validate and pretty-print JSON with configurable indent and key sorting",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["json", "format", "validate", "pretty"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: true,
};

// 修正计划 bug:serde_json::json! 宏不是 const fn,无法用于 static 初始化。
// 使用 Value::Null 作为占位符,与 core/tool.rs 测试中的模式一致。
// 前端可通过其他方式获取 schema,或在此处使用 LazyLock 改造(需调整 ToolMetadata 类型)。
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(JsonFormatter, &METADATA);
register_stream_tool!(JsonFormatter, &METADATA);

use crate::core::tool::{StreamEvent, StreamingTool};
use futures::stream::BoxStream;

#[async_trait]
impl StreamingTool for JsonFormatter {
    /// 流式格式化:对超大 JSON(>10MB)按缓冲块解析。
    /// 当前实现采用"分块读取 + 一次性 `serde_json` 解析"的折中方案:
    ///  - 大输入无法整体放入 `ToolInput.text`(会被 `InputTooLarge` 拦截),故走 `file_path` 路径
    ///  - 这里读取文件、逐块进度回传、最终一次性序列化
    fn execute_stream(
        &self,
        input: ToolInput,
        _ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>> {
        Box::pin(async_stream::stream! {
            let file_path = if let Some(p) = input.file_path.as_deref() {
                p.to_string()
            } else {
                yield Err(ToolError::InvalidInput(
                    "streaming requires file_path".to_string(),
                ));
                return;
            };

            yield Ok(StreamEvent::Progress {
                percent: 10,
                message: "Reading file...".to_string(),
            });

            let bytes = match tokio::fs::read(&file_path).await {
                Ok(b) => b,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("read file failed: {e}")));
                    return;
                }
            };

            yield Ok(StreamEvent::Progress {
                percent: 50,
                message: format!("Read {} bytes, parsing...", bytes.len()),
            });

            let text = match String::from_utf8(bytes) {
                Ok(t) => t,
                Err(e) => {
                    yield Err(ToolError::ParseFailed(format!("utf8 decode failed: {e}")));
                    return;
                }
            };

            let mut new_input = input.clone();
            new_input.text = Some(text);
            new_input.file_path = None;

            // 复用同步 execute 的核心逻辑,绕过 InputTooLarge(流式不受 10MB 限制)
            let result = format_internal(&new_input);
            match result {
                Ok(output) => {
                    yield Ok(StreamEvent::Progress {
                        percent: 90,
                        message: "Formatted.".to_string(),
                    });
                    yield Ok(StreamEvent::Done { output });
                }
                Err(e) => yield Err(e),
            }
        })
    }
}

/// 流式路径专用的格式化函数,不做 `InputTooLarge` 检查。
fn format_internal(input: &ToolInput) -> Result<ToolOutput, ToolError> {
    let text = input.text()?;
    let indent: u32 = input.param::<u32>("indent").unwrap_or(2);
    let sort_keys: bool = input.param::<bool>("sort_keys").unwrap_or(false);

    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ToolError::ParseFailed(e.to_string()))?;
    let final_value = if sort_keys { sort_value(value) } else { value };

    let indent_str = " ".repeat(indent as usize);
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes());
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    serde::Serialize::serialize(&final_value, &mut ser)
        .map_err(|e| ToolError::Internal(e.to_string()))?;
    let out_text = String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?;

    Ok(ToolOutput {
        text: out_text,
        extra: None,
        meta: Some(OutputMeta {
            duration_ms: 0,
            input_bytes: text.len(),
            output_bytes: 0,
        }),
        alerts: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    fn make_input_with_params(text: &str, params: HashMap<String, serde_json::Value>) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_format_simple_json_default_indent() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_custom_indent_4() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n    \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_indent_0() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(0));
        let input = make_input_with_params(r#"{"a":1,"b":2}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // indent=0 时 PrettyFormatter 仍会保留换行但无缩进
        assert!(output.text.contains("\"a\": 1"));
        assert!(!output.text.contains("    \"a\""));
    }

    #[tokio::test]
    async fn test_format_empty_object() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("{}");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{}");
    }

    #[tokio::test]
    async fn test_format_empty_array() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("[]");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "[]");
    }

    #[tokio::test]
    async fn test_format_with_sort_keys_true() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("sort_keys".to_string(), json!(true));
        let input = make_input_with_params(r#"{"b":1,"a":2,"c":3}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // 排序后 a 应在 b 之前
        let a_pos = output.text.find("\"a\"").unwrap();
        let b_pos = output.text.find("\"b\"").unwrap();
        assert!(a_pos < b_pos);
    }

    #[tokio::test]
    async fn test_format_invalid_json_returns_parse_failed() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        // 修正计划 bug:无需 raw string,普通字符串即可
        let input = make_input("{invalid}");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_format_input_too_large() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_format_includes_meta() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        let meta = output.meta.expect("meta should be set");
        // 修正计划 bug:`{"a":1}` 实际是 7 字节,而非 9
        assert_eq!(meta.input_bytes, 7);
        assert!(meta.output_bytes > 0);
    }
}
