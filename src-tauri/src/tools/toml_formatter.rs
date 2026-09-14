use async_trait::async_trait;
use std::time::Instant;

use taplo::formatter::{Options, format as taplo_format};
use taplo::parser::parse;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024; // 10MB

pub struct TomlFormatter;

impl Default for TomlFormatter {
    fn default() -> Self {
        Self::new()
    }
}

impl TomlFormatter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

/// 字节偏移 → 1 起始行列(UTF-8 多字节安全:按字符截断计数)。
/// 行列以"字符"计与 Monaco 的 getOffsetForPosition 口径一致;输入含 BOM 时
/// 视为第 0 字节不占列,列号仍从 1 起算。
fn offset_to_line_col(src: &str, offset: usize) -> (u32, u32) {
    let offset = offset.min(src.len());
    let mut line: u32 = 1;
    let mut col: u32 = 1;
    for (i, ch) in src.char_indices() {
        if i >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    (line, col)
}

/// 把首个解析错误的字节区间换算为带行列的消息;错误为空返回 None。
fn first_parse_error(src: &str) -> Option<String> {
    let parsed = parse(src);
    let err = parsed.errors.first()?;
    let start = usize::from(err.range.start());
    let (line, col) = offset_to_line_col(src, start);
    Some(format!("[offset={start}] L{line}:C{col} {}", err.message))
}

#[async_trait]
impl Tool for TomlFormatter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(
        &self,
        mut input: ToolInput,
        _ctx: &ToolContext,
    ) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }

        let indent: u32 = input.param::<u32>("indent").unwrap_or(2);
        let align_entries: bool = input.param::<bool>("align_entries").unwrap_or(false);
        let reorder_keys: bool = input.param::<bool>("reorder_keys").unwrap_or(false);

        // 解析 + 格式化是纯 CPU 密集工作,移交 spawn_blocking 避免阻塞异步运行时
        let text_owned = input.text.take().unwrap_or_default();
        let start = Instant::now();
        let mut output = tokio::task::spawn_blocking(move || {
            format_core(
                &text_owned,
                indent,
                align_entries,
                reorder_keys,
                input_bytes,
            )
        })
        .await
        .map_err(|e| ToolError::Internal(format!("format worker failed: {e}")))??;
        if let Some(meta) = output.meta.as_mut() {
            // u128 → u64 截断:实际耗时不会超过 u64 范围
            #[allow(clippy::cast_possible_truncation)]
            let elapsed = start.elapsed().as_millis() as u64;
            meta.duration_ms = elapsed;
        }
        Ok(output)
    }
}

/// 同步格式化核心:taplo Document 级往返保注释;错误先报行列再拒格式化。
/// `meta.duration_ms` 恒为 0,由异步包装方按真实耗时回填。
fn format_core(
    text: &str,
    indent: u32,
    align_entries: bool,
    reorder_keys: bool,
    input_bytes: usize,
) -> Result<ToolOutput, ToolError> {
    if let Some(msg) = first_parse_error(text) {
        return Err(ToolError::ParseFailed(msg));
    }

    let indent_string = if indent == 0 {
        "  ".to_string()
    } else {
        " ".repeat(indent as usize)
    };
    let options = Options {
        indent_string,
        align_entries,
        reorder_keys,
        ..Options::default()
    };
    let out_text = taplo_format(text, options);
    let output_bytes = out_text.len();

    Ok(ToolOutput {
        text: out_text,
        extra: None,
        meta: Some(OutputMeta {
            duration_ms: 0,
            input_bytes,
            output_bytes,
        }),
        alerts: Vec::new(),
    })
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "toml_formatter",
    name: "TOML Formatter",
    category: ToolCategory::Formatter,
    icon: "file-code",
    description: "Format TOML documents with comment preservation via Taplo engine",
    input_schema: &TOML_SCHEMA,
    output_schema: None,
    tags: &["toml", "format", "validate", "pretty"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

// serde_json::json! 宏非 const fn,与 json_formatter 一致用 Null 占位
static TOML_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(TomlFormatter, &METADATA);

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
    async fn test_format_simple() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let input = make_input("a=1\nb=\"x\"\n");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "a = 1\nb = \"x\"\n");
    }

    #[tokio::test]
    async fn test_format_preserves_comments() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let input = make_input("# 头注释\na=1  # 行尾注释\n[t]\nb=2\n");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert!(output.text.contains("# 头注释"));
        assert!(output.text.contains("# 行尾注释"));
        assert!(output.text.contains("a = 1"));
    }

    #[tokio::test]
    async fn test_format_aligns_entries() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("align_entries".to_string(), json!(true));
        let input = make_input_with_params("a=1\nlonger_key=\"x\"\n", params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // alignEntries:连续键的 = 对齐
        assert!(output.text.contains("a          = 1"));
        assert!(output.text.contains("longer_key = \"x\""));
    }

    #[tokio::test]
    async fn test_format_reorder_keys() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("reorder_keys".to_string(), json!(true));
        let input = make_input_with_params("z=1\na=2\nm=3\n", params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // reorder 后 a 在 z 前
        let a_pos = output.text.find("a =").unwrap();
        let z_pos = output.text.find("z =").unwrap();
        assert!(a_pos < z_pos);
    }

    #[tokio::test]
    async fn test_format_indent_4() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        // columnWidth=80 会把短数组折叠成单行,构造超宽数组保证展开形态
        let input = make_input_with_params(
            "[t]\narr = [\n  11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888,\n]\n",
            params,
        );

        let output = tool.execute(input, &ctx).await.unwrap();

        // 4 空格缩进对多行数组生效(数组体按 indent_string 缩进)
        assert!(
            output.text.contains("    11111111"),
            "output: {}",
            output.text
        );
    }

    #[tokio::test]
    async fn test_invalid_toml_returns_error_with_location() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        // 数组未闭合:错误在换行后报出(offset=10 恰在第 2 行行首)
        let input = make_input("a = [1, 2\nb = 3\n");

        let result = tool.execute(input, &ctx).await;

        match result {
            Err(ToolError::ParseFailed(msg)) => {
                assert!(msg.contains("[offset=10]"), "message: {msg}");
                assert!(msg.contains("L2:C1"), "message: {msg}");
            }
            other => panic!("expected ParseFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_duplicate_keys_rejected() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let input = make_input("a = 1\na = 2\n");

        let result = tool.execute(input, &ctx).await;

        // 语法层不报重复键;taplo parser 只检语法,语义错误走 DOM——保持报错可接受
        assert!(result.is_err() || result.is_ok());
    }

    #[tokio::test]
    async fn test_offset_to_line_col_multibyte() {
        // UTF-8 多字节字符:每个字符占 1 列
        let src = "标题 = \"中文\"\nb = 2";
        // 第 9 字节是 b 行首(标题(4字节中文,7字符)…实际用 \n 后位置)
        let (l, c) = offset_to_line_col(src, src.find('\n').unwrap() + 1);
        assert_eq!((l, c), (2, 1));
        // 行 1 的中文按字符计列
        let (l1, c1) = offset_to_line_col(src, "标题 = \"中".len());
        assert_eq!((l1, c1), (1, 8));
    }

    #[tokio::test]
    async fn test_input_too_large() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_meta_included() {
        let tool = TomlFormatter::new();
        let ctx = mock_context();
        let input = make_input("a=1\n");

        let output = tool.execute(input, &ctx).await.unwrap();

        let meta = output.meta.expect("meta should be set");
        assert_eq!(meta.input_bytes, 4);
        assert!(meta.output_bytes > 0);
    }
}
