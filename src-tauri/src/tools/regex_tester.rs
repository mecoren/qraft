use async_trait::async_trait;
use regex::RegexBuilder;
use serde_json::Value;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 1024 * 1024; // 1MB

pub struct RegexTester;

impl RegexTester {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RegexTester {
    fn default() -> Self {
        Self::new()
    }
}

/// 解析 JS 风格的 flags 字符串(g/i/m/s/x),应用到 RegexBuilder。
/// Rust regex 不支持 'g'(总是返回所有匹配),因此 'g' 被识别但不映射到 builder。
fn apply_flags(builder: &mut RegexBuilder, flags: &str) {
    for ch in flags.chars() {
        match ch {
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            'x' => {
                builder.ignore_whitespace(true);
            }
            'g' | 'u' | 'y' => {
                // JS 特有 flag,Rust 端语义不同,接受但忽略
            }
            _ => {} // 未知 flag 忽略,不报错(宽容策略)
        }
    }
}

#[async_trait]
impl Tool for RegexTester {
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
        let pattern: String = input.param("pattern")?;
        if pattern.is_empty() {
            return Err(ToolError::InvalidInput("pattern must not be empty".to_string()));
        }
        let flags: String = input.param("flags").unwrap_or_default();

        let start = Instant::now();
        let mut builder = RegexBuilder::new(&pattern);
        apply_flags(&mut builder, &flags);
        let re = builder
            .build()
            .map_err(|e| ToolError::ParseFailed(format!("regex compile error: {}", e)))?;

        // 始终返回所有匹配(等同于 JS 中带 g flag 的行为)
        let mut matches_arr: Vec<Value> = Vec::new();
        for caps in re.captures_iter(text) {
            // caps[0] 是整体匹配
            let full = caps.get(0).unwrap();
            let mut groups: Vec<Value> = Vec::new();
            for i in 1..caps.len() {
                if let Some(m) = caps.get(i) {
                    groups.push(Value::String(m.as_str().to_string()));
                } else {
                    groups.push(Value::Null);
                }
            }
            matches_arr.push(serde_json::json!({
                "match": full.as_str().to_string(),
                "index": full.start(),
                "groups": groups,
            }));
        }
        let match_count = matches_arr.len() as u64;

        let out_text = format!(
            "Pattern: /{}/{}\nMatches: {}\n\n{}",
            pattern,
            flags,
            match_count,
            matches_arr
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    let s = m["match"].as_str().unwrap_or("");
                    let idx = m["index"].as_u64().unwrap_or(0);
                    format!("#{} @{}: \"{}\"", i + 1, idx, s)
                })
                .collect::<Vec<_>>()
                .join("\n")
        );

        let mut extra = serde_json::Map::new();
        extra.insert("matches".into(), Value::Array(matches_arr));
        extra.insert("match_count".into(), serde_json::json!(match_count));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(Value::Object(extra)),
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "regex_tester",
    name: "Regex Tester",
    category: ToolCategory::Parser,
    icon: "regex",
    description: "Test regex patterns against input text with capture groups",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["regex", "pattern", "match", "test"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(RegexTester, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str, pattern: &str, flags: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("pattern".to_string(), json!(pattern));
        params.insert("flags".to_string(), json!(flags));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_simple_match() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello world", "world", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 1);
        let m = &extra["matches"][0];
        assert_eq!(m["match"], "world");
        assert_eq!(m["index"], 6);
    }

    #[tokio::test]
    async fn test_global_flag_finds_all() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("foo bar foo baz foo", "foo", "g");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 3);
    }

    #[tokio::test]
    async fn test_case_insensitive_flag() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("Hello HELLO hello", "hello", "gi");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 3);
    }

    #[tokio::test]
    async fn test_capture_groups() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // (\w+)\s+(\w+) 匹配 word pair
        let input = make_input("hello world", r"(\w+)\s+(\w+)", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let m = &extra["matches"][0];
        assert_eq!(m["match"], "hello world");
        assert_eq!(m["groups"][0], "hello");
        assert_eq!(m["groups"][1], "world");
    }

    #[tokio::test]
    async fn test_multiline_flag() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // 默认 ^ 匹配整个输入开头;开启 m 后 ^ 匹配每行开头
        let input = make_input("line1\nline2", "^line", "gm");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 2);
    }

    #[tokio::test]
    async fn test_no_matches_returns_empty_array() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello world", "xyz", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 0);
        assert_eq!(extra["matches"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_invalid_pattern_returns_parse_failed() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // 未闭合的分组
        let input = make_input("hello", "(unclosed", "");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_empty_pattern_returns_invalid_input() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello", "", "");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_pattern_missing_returns_invalid_input() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = ToolInput {
            text: Some("hello".to_string()),
            file_path: None,
            params: HashMap::new(),
        };

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
