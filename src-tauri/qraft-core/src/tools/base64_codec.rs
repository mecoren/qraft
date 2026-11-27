use async_trait::async_trait;
use base64::Engine;
use base64::alphabet::{STANDARD as STANDARD_ALPHABET, URL_SAFE as URL_SAFE_ALPHABET};
use base64::engine::DecodePaddingMode;
use base64::engine::GeneralPurposeConfig;
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

/// 剥离可选 Basic 认证前缀(`Basic `,scheme 大小写不敏感,RFC 7617),其余部分返回。
fn strip_basic_prefix(input: &str) -> &str {
    let trimmed = input.trim();
    // get(..6) 在非字符边界(如多字节字符开头)返回 None,天然规避切片 panic
    match trimmed.get(..6) {
        Some(head) if head.eq_ignore_ascii_case("Basic ") => &trimmed[6..],
        _ => trimmed,
    }
}

/// 宽松解码引擎:padding 可有可无(Indifferent)+ 容忍非零尾随位(forgiving-base64),
/// 覆盖 PEM/MIME 换行折叠、unpadded JWT、宽松编码器输出的常见粘贴输入。
/// 标准与 URL-safe 字母表各一份,按嗅探结果选用。
static LENIENT_STANDARD: GeneralPurpose = GeneralPurpose::new(
    &STANDARD_ALPHABET,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);
static LENIENT_URL_SAFE: GeneralPurpose = GeneralPurpose::new(
    &URL_SAFE_ALPHABET,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// 宽松清洗结果:剔除空白后的字节序列 + 每个字节在原始输入中的偏移(等长,索引同步)。
/// 偏移表用于把引擎错误(清洗后下标)映射回原始输入位置,供前端错误定位。
struct CleanedBase64 {
    bytes: Vec<u8>,
    offsets: Vec<usize>,
}

/// 宽松清洗:剔除全部 ASCII 空白(空格/制表/换行),逐字节保留原始偏移。
/// 多字节 UTF-8 字节原样收集(随后被字母表校验拒绝并精确定位),偏移不失准。
fn clean_base64(input: &str) -> CleanedBase64 {
    let mut bytes = Vec::with_capacity(input.len());
    let mut offsets = Vec::with_capacity(input.len());
    for (i, b) in input.as_bytes().iter().enumerate() {
        if b.is_ascii_whitespace() {
            continue;
        }
        bytes.push(*b);
        offsets.push(i);
    }
    CleanedBase64 { bytes, offsets }
}

/// 嗅探字母表:仅出现 URL-safe 特有符号(`-`/`_`)时自动切 URL-safe 引擎;
/// 与标准特有符号(`+`/`/`)同时出现视为歧义,保持标准字母表让引擎如实报错
/// 在先出现的符号上(标准字母表不含 `-`/`_`,单边判定无歧义)。
fn smells_url_safe(input: &str) -> bool {
    let has_url_safe = input.contains('-') || input.contains('_');
    has_url_safe && !input.contains('+') && !input.contains('/')
}

/// 解码 base64 为字节;错误统一映射为 `ParseFailed`,消息尾部附 `[offset=N]`
/// (N 为**原始输入**中的字节偏移:严格模式引擎偏移即原始偏移,宽松模式经偏移表回映;
/// 长度/padding 类错误无法定位到具体字符,不附标记)。前端用该标记画定位 chip。
fn decode_base64(engine: &GeneralPurpose, input: &str, strict: bool) -> Result<Vec<u8>, ToolError> {
    if strict {
        return engine.decode(input.as_bytes()).map_err(|e| {
            // 严格模式不做清洗,引擎偏移即原始输入偏移,直接透传定位
            ToolError::ParseFailed(format_decode_error(&e, error_index(&e)))
        });
    }

    let cleaned = clean_base64(input);
    // 4n+1 长度无论怎么补 padding 都不可能是有效输入(连 forgiving-base64 都拒绝),如实报错
    if cleaned.bytes.len() % 4 == 1 {
        let off = cleaned.offsets.last().copied().unwrap_or(0);
        return Err(ToolError::ParseFailed(format!(
            "invalid base64 length (4n+1 after removing whitespace) [offset={off}]"
        )));
    }
    engine.decode(cleaned.bytes.as_slice()).map_err(|e| {
        // 引擎偏移是清洗后序列内的下标,回映到原始输入偏移;末尾类错误(如
        // InvalidPadding)下标可达 offsets.len(),按最后一个保留字符处理
        let orig = error_index(&e).map(|i| {
            cleaned
                .offsets
                .get(i)
                .or_else(|| cleaned.offsets.last())
                .copied()
                .unwrap_or(0)
        });
        ToolError::ParseFailed(format_decode_error(&e, orig))
    })
}

/// 提取引擎错误中的符号下标;长度/padding 类错误返回 None(无法定位到具体字符)
const fn error_index(e: &base64::DecodeError) -> Option<usize> {
    match e {
        base64::DecodeError::InvalidByte(i, _) | base64::DecodeError::InvalidLastSymbol(i, _) => {
            Some(*i)
        }
        base64::DecodeError::InvalidLength(_) | base64::DecodeError::InvalidPadding => None,
    }
}

/// 生成可读错误消息;offset 为原始输入偏移,有定位时附 `[offset=N]` 标记
fn format_decode_error(e: &base64::DecodeError, offset: Option<usize>) -> String {
    let base_msg = match e {
        base64::DecodeError::InvalidByte(i, byte) => {
            format!("invalid base64 symbol 0x{byte:02X} at index {i}")
        }
        base64::DecodeError::InvalidLength(len) => format!("invalid base64 length {len}"),
        base64::DecodeError::InvalidLastSymbol(i, byte) => {
            format!("invalid base64 last symbol 0x{byte:02X} at index {i}")
        }
        base64::DecodeError::InvalidPadding => "invalid base64 padding".to_string(),
    };
    match offset {
        Some(off) => format!("{base_msg} [offset={off}]"),
        None => base_msg,
    }
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
/// 宽松模式(默认)剥前缀 → 剔空白 → 嗅探字母表 → Indifferent padding 解码;
/// 严格模式原样喂给 `STANDARD`/`URL_SAFE` 引擎,保持 RFC 4648 校验语义。
/// 非严格 text 模式对非 UTF-8 字节回退 Latin-1 展示,并返回 warning alert 告知。
fn decode(
    text: &str,
    mode: &str,
    engine: &GeneralPurpose,
    hex_case: &str,
    strict: bool,
) -> Result<DecodeOutcome, ToolError> {
    match mode {
        "text" => {
            let bytes = decode_base64(engine, text, strict)?;
            match String::from_utf8(bytes) {
                Ok(decoded) => Ok(DecodeOutcome::of(decoded)),
                Err(original) if strict => Err(ToolError::ParseFailed(format!(
                    "decoded bytes are not utf8: {}",
                    original.utf8_error()
                ))),
                // 宽松回退:UTF-8 失败按 Latin-1 逐字节映射展示,附 alert 如实告知
                // (DevUtils 同策略;避免二进制输入只能拿到一句晦涩报错)
                Err(original) => {
                    let bytes = original.into_bytes();
                    let decoded = bytes.iter().map(|&b| char::from(b)).collect();
                    Ok(DecodeOutcome::with_alert(
                        decoded,
                        "decoded bytes are not valid utf8; displayed as latin-1".to_string(),
                    ))
                }
            }
        }
        "ascii" => {
            // 逐字节映射为 Latin-1,容忍任意字节序列
            let bytes = decode_base64(engine, text, strict)?;
            Ok(DecodeOutcome::of(
                bytes.iter().map(|&b| char::from(b)).collect(),
            ))
        }
        "hex" => {
            let bytes = decode_base64(engine, text, strict)?;
            let decoded = if hex_case == "upper" {
                hex::encode_upper(&bytes)
            } else {
                hex::encode(&bytes)
            };
            Ok(DecodeOutcome::of(decoded))
        }
        "basic_auth" => {
            let cleaned = strip_basic_prefix(text);
            let bytes = decode_base64(engine, cleaned, strict)?;
            let decoded = String::from_utf8(bytes).map_err(|e| {
                ToolError::ParseFailed(format!("decoded basic auth credentials are not utf8: {e}"))
            })?;
            Ok(DecodeOutcome::of(decoded))
        }
        "binary" => {
            let cleaned = strip_data_url_prefix(text);
            let bytes = decode_base64(engine, cleaned, strict)?;
            let mime = sniff_mime(&bytes);
            let normalized = engine.encode(&bytes);
            let extra = serde_json::json!({
                "base64": normalized,
                "mime": mime,
                "bytes": bytes.len(),
            });
            Ok(DecodeOutcome::of_extra(String::new(), Some(extra)))
        }
        other => Err(ToolError::InvalidInput(format!("unknown mode '{other}'"))),
    }
}

/// decode 的产物:输出文本/extra + 可能的 warning alert
struct DecodeOutcome {
    text: String,
    extra: Option<serde_json::Value>,
    alert: Option<String>,
}

impl DecodeOutcome {
    const fn of(text: String) -> Self {
        Self {
            text,
            extra: None,
            alert: None,
        }
    }

    const fn with_alert(text: String, alert: String) -> Self {
        Self {
            text,
            extra: None,
            alert: Some(alert),
        }
    }

    const fn of_extra(text: String, extra: Option<serde_json::Value>) -> Self {
        Self {
            text,
            extra,
            alert: None,
        }
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
        let strict: bool = input.param::<bool>("strict").unwrap_or(false);
        let hex_case: String = input
            .param::<String>("hex_case")
            .unwrap_or_else(|_| "lower".to_string());

        let start = Instant::now();
        let input_bytes = text.len();
        // 引擎选择:
        // - 严格模式:url_safe 开关显式决定 STANDARD / URL_SAFE,保持 RFC 4648 语义
        // - 宽松模式(默认):url_safe 开关仍是显式覆盖(用户明示意图优先),
        //   未开时按内容嗅探(仅出现 -/_ 且无 +// 时自动切 URL-safe,如 unpadded JWT)
        let engine: &GeneralPurpose = if strict || url_safe {
            if url_safe { &URL_SAFE } else { &STANDARD }
        } else if action == "decode" && smells_url_safe(text) {
            &LENIENT_URL_SAFE
        } else {
            &LENIENT_STANDARD
        };

        let (out_text, extra, alert) = match action.as_str() {
            "encode" => (encode(text, &mode, engine)?, None, None),
            "decode" => {
                let outcome = decode(text, &mode, engine, &hex_case, strict)?;
                (outcome.text, outcome.extra, outcome.alert)
            }
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

        let alerts = alert.map_or_else(Vec::new, |message| {
            vec![crate::core::output::Alert {
                level: crate::core::output::AlertLevel::Warning,
                message,
            }]
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
            alerts,
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

    // —— 宽松解码(默认)测试 ——

    #[tokio::test]
    async fn test_lenient_decode_strips_newlines() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // MIME/PEM 式折叠换行输入,宽松模式应剔除空白后成功解码
        let input = make_input("aGVs\nbG8=\r\n", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello");
    }

    #[tokio::test]
    async fn test_lenient_decode_unpadded_input() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // "hello" 编码去掉 padding = "aGVsbG8"(4n+2),宽松模式应自动容忍
        let input = make_input("aGVsbG8", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello");
    }

    #[tokio::test]
    async fn test_lenient_decode_sniffs_url_safe_alphabet() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // ">>>" 的 URL-safe base64 = "Pj4-"(含 '-' 特有符号,无 '+'/'/');
        // 未开 url_safe 开关也应嗅探切到 URL-safe 引擎成功解码
        let input = make_input("Pj4-", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, ">>>");
    }

    #[tokio::test]
    async fn test_lenient_decode_sniffs_unpadded_jwt_fragment() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // unpadded base64url 的 JWT payload 段:eyJhbGciOiJIUzI1NiJ9 → {"alg":"HS256"}
        let input = make_input_with_mode("eyJhbGciOiJIUzI1NiJ9", "decode", "text", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\"alg\":\"HS256\"}");
    }

    #[tokio::test]
    async fn test_lenient_decode_mixed_alphabets_stays_standard_and_fails() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 同时含 '-'(URL-safe)与 '+'(标准)属歧义输入:保持标准字母表,
        // 引擎在先出现的 '-' 上如实报错
        let input = make_input("Pj4-+abc", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_lenient_decode_rejects_4n_plus_1_length() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 5 个字符(4n+1),宽松模式也无法挽救,如实报错
        let input = make_input("aGVsb", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_lenient_decode_error_maps_offset_back_to_original_input() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 前置 8 个空白字符,非法符号 '!' 在原始输入偏移 8 处;
        // 错误消息应携带清洗后偏移回映出的 [offset=8]
        let input = make_input("        !abc", "decode", false);

        let result = tool.execute(input, &ctx).await;

        let msg = match result {
            Err(ToolError::ParseFailed(m)) => m,
            other => panic!("expected ParseFailed, got {other:?}"),
        };
        assert!(
            msg.contains("[offset=8]"),
            "error message should carry original-input offset, got: {msg}"
        );
    }

    #[tokio::test]
    async fn test_strict_decode_rejects_whitespace() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input =
            make_input_with_mode("aGVs\nbG8=", "decode", "text", &[("strict", json!(true))]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_strict_decode_rejects_unpadded() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("aGVsbG8", "decode", "text", &[("strict", json!(true))]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_strict_decode_error_carries_engine_offset() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 严格模式下引擎偏移即原始偏移;'!' 在下标 3 处
        let input = make_input_with_mode("abc!defg", "decode", "text", &[("strict", json!(true))]);

        let result = tool.execute(input, &ctx).await;

        let msg = match result {
            Err(ToolError::ParseFailed(m)) => m,
            other => panic!("expected ParseFailed, got {other:?}"),
        };
        assert!(
            msg.contains("[offset=3]"),
            "strict error should carry engine offset, got: {msg}"
        );
    }

    #[tokio::test]
    async fn test_lenient_decode_text_falls_back_to_latin1_with_alert() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 0xE9 非 UTF-8:宽松 text 模式回退 Latin-1 逐字节映射并附 warning alert
        let input = make_input_with_mode("6Q==", "decode", "text", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "\u{00E9}");
        assert_eq!(output.alerts.len(), 1);
        assert!(output.alerts[0].message.contains("utf8"));
    }

    #[tokio::test]
    async fn test_strict_decode_text_rejects_non_utf8() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input_with_mode("6Q==", "decode", "text", &[("strict", json!(true))]);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_decode_basic_auth_prefix_case_insensitive() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // RFC 7617 scheme 大小写不敏感:BASIC 前缀也应被剥离
        let input = make_input_with_mode("BASIC YWRtaW46c2VjcmV0", "decode", "basic_auth", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "admin:secret");
    }

    #[tokio::test]
    async fn test_decode_binary_lenient_accepts_data_url_with_newlines() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // data URL 前缀 + 换行折叠的 base64:宽松模式剥前缀、剔空白后正常解码
        let input = make_input_with_mode(
            "data:image/png;base64,iVBOR\nw0KGgo=",
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
        // 0xE9 不是合法 UTF-8;宽松 text 模式回退 Latin-1 并附 warning alert
        let input = make_input_with_mode("6Q==", "decode", "text", &[]);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "\u{00E9}");
        assert_eq!(output.alerts.len(), 1);
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
