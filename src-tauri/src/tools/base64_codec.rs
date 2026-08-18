use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::GeneralPurpose;
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

/// 剥离可选 data URL 前缀:`data:<mime>;base64,` 之后的部分原样返回;
/// 无前缀时返回去除首尾空白后的原字符串。
fn strip_data_url_prefix(input: &str) -> &str {
    let trimmed = input.trim();
    let Some(comma) = trimmed.find(',') else {
        return trimmed;
    };
    let head = &trimmed[..comma];
    if head.starts_with("data:") && head.ends_with(";base64") {
        trimmed[comma + 1..].trim()
    } else {
        trimmed
    }
}

/// 剥离可选 Basic 认证前缀(`Basic `,大小写不敏感),其余部分返回。
fn strip_basic_prefix(input: &str) -> &str {
    let trimmed = input.trim();
    trimmed
        .strip_prefix("Basic ")
        .or_else(|| trimmed.strip_prefix("basic "))
        .unwrap_or(trimmed)
}

/// 解码 base64 为字节,错误统一映射为 `ParseFailed`。
fn decode_base64(engine: &GeneralPurpose, input: &str) -> Result<Vec<u8>, ToolError> {
    engine
        .decode(input.as_bytes())
        .map_err(|e| ToolError::ParseFailed(e.to_string()))
}

/// 依据 magic bytes 嗅探 MIME 类型;无法识别时回退为 `application/octet-stream`。
/// 支持:`PNG` / `JPEG` / `GIF` / `WebP` / `BMP` / `ICO` / `SVG` / `PDF` / `MP3` / `WAV` / `OGG` / `MP4` / `WebM`。
fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        "image/x-icon"
    } else if bytes.starts_with(b"%PDF") {
        "application/pdf"
    } else if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
    {
        "audio/mpeg"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        "audio/wav"
    } else if bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        "video/mp4"
    } else if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        "video/webm"
    } else {
        // SVG 为文本格式,嗅探开头标记
        let head = String::from_utf8_lossy(bytes).trim_start().to_lowercase();
        if head.starts_with("<svg") || head.starts_with("<?xml") {
            "image/svg+xml"
        } else {
            "application/octet-stream"
        }
    }
}

/// 编码:将文本或 hex 字符串转为 base64。
fn encode(text: &str, mode: &str, engine: &GeneralPurpose) -> Result<String, ToolError> {
    match mode {
        "text" => Ok(engine.encode(text.as_bytes())),
        "hex" => {
            let cleaned = text.split_whitespace().collect::<String>();
            let bytes = hex::decode(&cleaned)
                .map_err(|e| ToolError::ParseFailed(format!("invalid hex: {e}")))?;
            Ok(engine.encode(bytes))
        }
        other => Err(ToolError::InvalidInput(format!(
            "mode '{other}' is not supported for encode, use 'text' or 'hex'"
        ))),
    }
}

/// 解码:base64 转为文本 / ascii / hex / basic auth,或(二进制)返回 { base64, mime, bytes }。
fn decode(
    text: &str,
    mode: &str,
    engine: &GeneralPurpose,
    hex_case: &str,
) -> Result<(String, Option<serde_json::Value>), ToolError> {
    match mode {
        "text" => {
            let bytes = decode_base64(engine, text)?;
            let decoded = String::from_utf8(bytes)
                .map_err(|e| ToolError::ParseFailed(format!("decoded bytes are not utf8: {e}")))?;
            Ok((decoded, None))
        }
        "ascii" => {
            // 逐字节映射为 Latin-1,容忍任意字节序列
            let bytes = decode_base64(engine, text)?;
            Ok((bytes.iter().map(|&b| char::from(b)).collect(), None))
        }
        "hex" => {
            let bytes = decode_base64(engine, text)?;
            let decoded = if hex_case == "upper" {
                hex::encode_upper(&bytes)
            } else {
                hex::encode(&bytes)
            };
            Ok((decoded, None))
        }
        "basic_auth" => {
            let cleaned = strip_basic_prefix(text);
            let bytes = decode_base64(engine, cleaned)?;
            let decoded = String::from_utf8(bytes).map_err(|e| {
                ToolError::ParseFailed(format!("decoded basic auth credentials are not utf8: {e}"))
            })?;
            Ok((decoded, None))
        }
        "binary" => {
            let cleaned = strip_data_url_prefix(text);
            let bytes = decode_base64(engine, cleaned)?;
            let mime = sniff_mime(&bytes);
            let normalized = engine.encode(&bytes);
            let extra = serde_json::json!({
                "base64": normalized,
                "mime": mime,
                "bytes": bytes.len(),
            });
            Ok((String::new(), Some(extra)))
        }
        other => Err(ToolError::InvalidInput(format!("unknown mode '{other}'"))),
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
        let mode: String = input
            .param::<String>("mode")
            .unwrap_or_else(|_| "text".to_string());
        let url_safe: bool = input.param::<bool>("url_safe").unwrap_or(false);
        let hex_case: String = input
            .param::<String>("hex_case")
            .unwrap_or_else(|_| "lower".to_string());

        let start = Instant::now();
        let input_bytes = text.len();
        let engine: &GeneralPurpose = if url_safe { &URL_SAFE } else { &STANDARD };

        let (out_text, extra) = match action.as_str() {
            "encode" => (encode(text, &mode, engine)?, None),
            "decode" => decode(text, &mode, engine, &hex_case)?,
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "action must be 'encode' or 'decode', got '{other}'"
                )));
            }
        };

        let output_bytes =
            extra
                .as_ref()
                .and_then(|e| e["bytes"].as_u64())
                .map_or(out_text.len(), |bytes| {
                    #[allow(clippy::cast_possible_truncation)]
                    let size = bytes as usize;
                    size
                });

        Ok(ToolOutput {
            text: out_text,
            extra,
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
    description: "Encode or decode Base64 with text / ascii / hex / basic auth / binary modes",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &[
        "base64",
        "encode",
        "decode",
        "url-safe",
        "hex",
        "ascii",
        "basic-auth",
        "binary",
    ],
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

    fn make_input_with_mode(
        text: &str,
        action: &str,
        mode: &str,
        extra: &[(&str, serde_json::Value)],
    ) -> ToolInput {
        let mut params = HashMap::from([
            ("action".to_string(), json!(action)),
            ("mode".to_string(), json!(mode)),
        ]);
        for (k, v) in extra {
            params.insert((*k).to_string(), v.clone());
        }
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

    // —— 多模式测试 ——

    #[tokio::test]
    async fn test_encode_hex() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // "Hello" 的十六进制字节序列 → 编码为其 base64
        let input = make_input_with_mode("48656c6c6f", "encode", "hex", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "SGVsbG8=");
    }

    #[tokio::test]
    async fn test_encode_hex_with_spaces() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("48 65 6c 6c 6f", "encode", "hex", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "SGVsbG8=");
    }

    #[tokio::test]
    async fn test_encode_hex_invalid_returns_parse_failed() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("zz", "encode", "hex", &[]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_decode_hex_lower() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("SGVsbG8=", "decode", "hex", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "48656c6c6f");
    }

    #[tokio::test]
    async fn test_decode_hex_upper() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input =
            make_input_with_mode("SGVsbG8=", "decode", "hex", &[("hex_case", json!("upper"))]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "48656C6C6F");
    }

    #[tokio::test]
    async fn test_decode_ascii_maps_bytes_to_latin1() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // "6Q==" 解码为单字节 0xE9(Latin-1 é),非 UTF-8,ascii 模式应逐字节映射为 é
        let input = make_input_with_mode("6Q==", "decode", "ascii", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "\u{00E9}");
    }

    #[tokio::test]
    async fn test_decode_text_rejects_non_utf8() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 0xE9 不是合法 UTF-8,text 模式应报 ParseFailed
        let input = make_input_with_mode("6Q==", "decode", "text", &[]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_decode_basic_auth_with_prefix() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("Basic YWRtaW46c2VjcmV0", "decode", "basic_auth", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "admin:secret");
    }

    #[tokio::test]
    async fn test_decode_basic_auth_without_prefix() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("YWRtaW46c2VjcmV0", "decode", "basic_auth", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "admin:secret");
    }

    #[tokio::test]
    async fn test_decode_binary_sniffs_png() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // PNG 文件头(8 字节)的 base64
        let input = make_input_with_mode("iVBORw0KGgo=", "decode", "binary", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.expect("binary 解码应返回 extra");
        assert_eq!(extra["base64"], "iVBORw0KGgo=");
        assert_eq!(extra["mime"], "image/png");
        assert_eq!(extra["bytes"], 8);
        assert!(output.text.is_empty());
    }

    #[tokio::test]
    async fn test_decode_binary_strips_data_url_prefix() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode(
            "data:image/png;base64,iVBORw0KGgo=",
            "decode",
            "binary",
            &[],
        );

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.expect("binary 解码应返回 extra");
        assert_eq!(extra["base64"], "iVBORw0KGgo=");
        assert_eq!(extra["mime"], "image/png");
    }

    #[tokio::test]
    async fn test_decode_binary_unknown_mime_is_octet_stream() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // "hello" 的 base64,无已知 magic bytes
        let input = make_input_with_mode("aGVsbG8=", "decode", "binary", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.expect("binary 解码应返回 extra");
        assert_eq!(extra["mime"], "application/octet-stream");
        assert_eq!(extra["bytes"], 5);
    }

    #[tokio::test]
    async fn test_decode_binary_invalid_returns_parse_failed() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("!!!not-base64!!!", "decode", "binary", &[]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_encode_binary_mode_is_invalid() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // binary 模式仅支持 decode 方向,encode 方向应报 InvalidInput
        let input = make_input_with_mode("hello", "encode", "binary", &[]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
