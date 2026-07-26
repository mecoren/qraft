use async_trait::async_trait;
use blake3::Hasher as Blake3Hasher;
use md5::Md5;
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_stream_tool;
use crate::register_tool;

const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

pub struct HashCalculator;

impl HashCalculator {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for HashCalculator {
    fn default() -> Self {
        Self::new()
    }
}

/// 计算给定数据的哈希,返回小写 hex 字符串。
/// 算法选择通过字符串匹配,新增算法在此扩展即可。
fn hash_bytes(algorithm: &str, data: &[u8]) -> Result<String, ToolError> {
    use sha2::Digest;
    let hex_str = match algorithm {
        "md5" => {
            let mut h = Md5::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha1" => {
            let mut h = Sha1::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha256" => {
            let mut h = Sha256::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha512" => {
            let mut h = Sha512::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "blake3" => {
            let mut h = Blake3Hasher::new();
            h.update(data);
            h.finalize().to_hex().to_string()
        }
        other => {
            return Err(ToolError::InvalidInput(format!(
                "algorithm must be one of md5/sha1/sha256/sha512/blake3, got '{other}'"
            )));
        }
    };
    Ok(hex_str)
}

#[async_trait]
impl Tool for HashCalculator {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let algorithm: String = input
            .param("algorithm")
            .unwrap_or_else(|_| "sha256".to_string());

        let start = Instant::now();
        let (data, input_bytes) = if let Some(text) = input.text.as_deref() {
            let bytes = text.len();
            if bytes > MAX_TEXT_BYTES {
                return Err(ToolError::InputTooLarge {
                    size: bytes,
                    max: MAX_TEXT_BYTES,
                });
            }
            (text.as_bytes().to_vec(), bytes)
        } else if let Some(path) = input.file_path.as_deref() {
            let bytes = tokio::fs::read(path)
                .await
                .map_err(|e| ToolError::Internal(format!("read file failed: {e}")))?;
            let n = bytes.len();
            (bytes, n)
        } else {
            return Err(ToolError::InvalidInput(
                "either 'text' or 'file_path' must be provided".to_string(),
            ));
        };

        let hex_str = hash_bytes(&algorithm, &data)?;
        let output_bytes = hex_str.len();

        Ok(ToolOutput {
            text: hex_str,
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
    id: "hash_calculator",
    name: "Hash Calculator",
    category: ToolCategory::Encoder,
    icon: "hash",
    description: "Compute MD5/SHA1/SHA256/SHA512/BLAKE3 hashes of text or files",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["hash", "md5", "sha256", "blake3", "checksum"],
    version: "1.0.0",
    timeout_secs: Some(60),
    streaming_supported: true,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(HashCalculator, &METADATA);
register_stream_tool!(HashCalculator, &METADATA);

use crate::core::tool::{StreamEvent, StreamingTool};
use futures::stream::BoxStream;
use tokio::io::AsyncReadExt;

#[async_trait]
impl StreamingTool for HashCalculator {
    /// 流式哈希:按 64KB 块读取文件,增量更新哈希状态,逐块回传进度。
    /// 适合超大文件(GB 级),内存占用恒定。
    fn execute_stream(
        &self,
        input: ToolInput,
        _ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>> {
        let algorithm: String = input
            .param("algorithm")
            .unwrap_or_else(|_| "sha256".to_string());
        let file_path = input.file_path;

        Box::pin(async_stream::stream! {
            let path = if let Some(p) = file_path.as_deref() { p.to_string() } else {
                yield Err(ToolError::InvalidInput(
                    "streaming requires file_path".to_string(),
                ));
                return;
            };

            let meta = match tokio::fs::metadata(&path).await {
                Ok(m) => m,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("stat file failed: {e}")));
                    return;
                }
            };
            let total = meta.len();
            if total == 0 {
                yield Err(ToolError::InvalidInput("file is empty".to_string()));
                return;
            }

            yield Ok(StreamEvent::Progress {
                percent: 0,
                message: format!("Hashing {total} bytes with {algorithm}..."),
            });

            let mut file = match tokio::fs::File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("open file failed: {e}")));
                    return;
                }
            };

            // 增量哈希:每个算法维护独立的状态机
            use sha2::Digest;
            let mut md5_state = if algorithm == "md5" { Some(Md5::new()) } else { None };
            let mut sha1_state = if algorithm == "sha1" { Some(Sha1::new()) } else { None };
            let mut sha256_state = if algorithm == "sha256" { Some(Sha256::new()) } else { None };
            let mut sha512_state = if algorithm == "sha512" { Some(Sha512::new()) } else { None };
            let mut blake3_state = if algorithm == "blake3" { Some(Blake3Hasher::new()) } else { None };

            if md5_state.is_none()
                && sha1_state.is_none()
                && sha256_state.is_none()
                && sha512_state.is_none()
                && blake3_state.is_none()
            {
                yield Err(ToolError::InvalidInput(format!(
                    "unknown algorithm: {algorithm}"
                )));
                return;
            }

            let mut buf = vec![0u8; 64 * 1024];
            let mut read_total: u64 = 0;
            loop {
                let n = match file.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) => {
                        yield Err(ToolError::Internal(format!("read failed: {e}")));
                        return;
                    }
                };
                let chunk = &buf[..n];
                if let Some(s) = md5_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha1_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha256_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha512_state.as_mut() { s.update(chunk); }
                if let Some(s) = blake3_state.as_mut() { s.update(chunk); }
                read_total += n as u64;
                // u64→f64 精度损失对百分比展示无影响(0-100 整数);
                // 最终 `* 100.0` 后值在 0.0..=100.0,截断为 u8 安全
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]
                let percent = ((read_total as f64 / total as f64) * 100.0) as u8;
                yield Ok(StreamEvent::Progress {
                    percent,
                    message: format!("{read_total}/{total} bytes"),
                });
            }

            // if-else if 链比 clippy 建议的嵌套 map_or_else 更直观可读,
            // 且每个分支调用的 finalize 实现不同,无法简单合并
            #[allow(clippy::option_if_let_else)]
            let hex_str = if let Some(s) = md5_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha1_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha256_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha512_state { hex::encode(s.finalize()) }
                else if let Some(s) = blake3_state { s.finalize().to_hex().to_string() }
                else { unreachable!() };

            yield Ok(StreamEvent::Done {
                output: ToolOutput {
                    text: hex_str,
                    extra: None,
                    meta: Some(OutputMeta {
                        duration_ms: 0,
                        // u64→usize:文件大小远小于 64 位 usize 上限,32 位平台
                        // 也几乎不可能超过 4GB 单文件
                        #[allow(clippy::cast_possible_truncation)]
                        input_bytes: total as usize,
                        output_bytes: 0,
                    }),
                    alerts: Vec::new(),
                },
            });
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_text_input(text: &str, algorithm: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!(algorithm));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    fn make_file_input(path: &str, algorithm: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!(algorithm));
        ToolInput {
            text: None,
            file_path: Some(path.to_string()),
            params,
        }
    }

    #[tokio::test]
    async fn test_hash_md5_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "md5");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "5d41402abc4b2a76b9719d911017c592");
    }

    #[tokio::test]
    async fn test_hash_sha256_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(
            output.text,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[tokio::test]
    async fn test_hash_blake3_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "blake3");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text.len(), 64); // 32 bytes → 64 hex chars
        assert!(output.text.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_hash_empty_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("", "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        // SHA-256 of empty string
        assert_eq!(
            output.text,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn test_hash_text_too_large() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_TEXT_BYTES + 1);
        let input = make_text_input(&large, "sha256");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_hash_file_path_not_found_returns_internal() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_file_input("/nonexistent/file/path/xyz", "sha256");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::Internal(_))));
    }

    #[tokio::test]
    async fn test_hash_invalid_algorithm_returns_invalid_input() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "crc32");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_hash_no_input_returns_invalid_input() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!("sha256"));
        let input = ToolInput {
            text: None,
            file_path: None,
            params,
        };

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_hash_file_reads_content() {
        // 写一个临时文件,验证 hash 与相同内容的 text 路径一致
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let temp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(temp.path(), "hello").unwrap();
        let input = make_file_input(temp.path().to_str().unwrap(), "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(
            output.text,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
