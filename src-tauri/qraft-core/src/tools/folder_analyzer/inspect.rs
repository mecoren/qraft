// 单文件解析:类型/编码/行字数/哈希/预览(只读)

use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::classify::{
    FileCategory, bytes_look_binary, category_for_extension, extension_of, sniff_magic,
};
use super::text_metrics::{TextMetrics, count_metrics, decode_best_effort};
use crate::core::error::ToolError;

/// 单次解析读取上限
pub(crate) const MAX_INSPECT_BYTES: u64 = 64 * 1024 * 1024;
const PREVIEW_LINES: usize = 30;

#[derive(Debug, Serialize)]
pub struct FileInspectReport {
    pub path: String,
    pub file_name: String,
    pub ext: String,
    pub category: FileCategory,
    pub magic: Option<String>,
    pub size_bytes: u64,
    pub is_text: bool,
    pub encoding: Option<String>,
    pub lines: Option<u64>,
    pub words: Option<u64>,
    pub chars: Option<u64>,
    pub sha256: String,
    pub preview: Vec<String>,
    pub duration_ms: u64,
}

/// # Errors
///
/// - stat/读取失败 → `ToolError::Internal`
/// - 超过 64 MiB → `ToolError::InputTooLarge`
pub fn inspect_file(path: &Path) -> Result<FileInspectReport, ToolError> {
    let start = Instant::now();
    let meta =
        std::fs::metadata(path).map_err(|e| ToolError::Internal(format!("stat failed: {e}")))?;
    let size = meta.len();
    if size > MAX_INSPECT_BYTES {
        return Err(ToolError::InputTooLarge {
            size: usize::try_from(size).unwrap_or(usize::MAX),
            max: usize::try_from(MAX_INSPECT_BYTES).unwrap_or(usize::MAX),
        });
    }
    let bytes =
        std::fs::read(path).map_err(|e| ToolError::Internal(format!("read failed: {e}")))?;

    let magic = sniff_magic(&bytes).map(str::to_string);
    let is_text = magic.is_none() && !bytes_look_binary(&bytes);

    let (encoding, metrics, preview) = if is_text {
        let (text, label) = decode_best_effort(&bytes);
        let preview: Vec<String> = text
            .lines()
            .take(PREVIEW_LINES)
            .map(str::to_string)
            .collect();
        (Some(label.to_string()), Some(count_metrics(&text)), preview)
    } else {
        (None, None, Vec::new())
    };

    let digest = Sha256::digest(&bytes);

    Ok(FileInspectReport {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
        ext: extension_of(path),
        category: category_for_extension(&extension_of(path)),
        magic,
        size_bytes: size,
        is_text,
        encoding,
        lines: metrics.map(|m: TextMetrics| m.lines),
        words: metrics.map(|m| m.words),
        chars: metrics.map(|m| m.chars),
        sha256: hex::encode(digest),
        preview,
        duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_text_file() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("hello.rs");
        std::fs::write(&p, "fn main() {}\nprintln!(\"hi\");\n").unwrap();
        let r = inspect_file(&p).unwrap();
        assert_eq!(r.file_name, "hello.rs");
        assert_eq!(r.ext, "rs");
        assert_eq!(r.category, FileCategory::Code);
        assert_eq!(r.magic, None);
        assert!(r.is_text);
        assert_eq!(r.encoding.as_deref(), Some("UTF-8"));
        assert_eq!(r.lines, Some(2));
        // Task 2 口径:连续非空白序列计 1 词,换行(空白)重置分词
        // 第 1 行:fn(1) main()(2) {}(3);第 2 行:println!("hi"); 无空白 = 1 词(4)
        assert_eq!(r.words, Some(4));
        assert_eq!(r.preview.len(), 2);
        assert_eq!(r.sha256.len(), 64);
        assert!(r.sha256.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_empty_file_known_sha256() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("empty.txt");
        std::fs::write(&p, b"").unwrap();
        let r = inspect_file(&p).unwrap();
        // SHA-256("") 官方标准向量
        assert_eq!(
            r.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(r.lines, Some(0));
    }

    #[test]
    fn test_png_detected_not_text() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("pic.png");
        std::fs::write(&p, b"\x89PNG\r\n\x1a\n\x00\x01\x02").unwrap();
        let r = inspect_file(&p).unwrap();
        assert_eq!(r.magic.as_deref(), Some("png"));
        assert_eq!(r.category, FileCategory::Image);
        assert!(!r.is_text);
        assert_eq!(r.encoding, None);
        assert_eq!(r.lines, None);
        assert!(r.preview.is_empty());
    }

    #[test]
    fn test_max_inspect_bytes_constant() {
        assert_eq!(MAX_INSPECT_BYTES, 67_108_864);
    }

    #[test]
    fn test_missing_file_errors_internal() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("ghost.txt");
        assert!(matches!(inspect_file(&p), Err(ToolError::Internal(_))));
    }
}
