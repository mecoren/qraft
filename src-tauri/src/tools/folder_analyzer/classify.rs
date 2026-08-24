// 扩展名分类 / 魔数嗅探 / 二进制判定(纯函数,只读,无 IO)

use serde::Serialize;

/// 文件大类(按扩展名归类)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileCategory {
    Code,
    Document,
    Image,
    Video,
    Audio,
    Archive,
    Binary,
    Other,
}

const CODE_EXTS: &[&str] = &[
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "rs", "py", "go", "java", "kt", "kts", "swift", "c",
    "h", "cpp", "hpp", "cc", "hh", "cs", "rb", "php", "sh", "bash", "zsh", "fish", "ps1", "bat",
    "cmd", "sql", "css", "scss", "less", "html", "htm", "vue", "svelte", "json", "json5", "yaml",
    "yml", "toml", "xml", "proto", "graphql", "ini", "cfg", "conf", "env", "gradle", "cmake",
    "makefile", "dockerfile", "lock",
];
const DOC_TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "rst", "adoc", "log", "csv", "tsv", "tex", "gitignore",
    "editorconfig",
];
const IMAGE_EXTS: &[&str] =
    &["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "avif"];
const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"];
const AUDIO_EXTS: &[&str] = &["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"];
const ARCHIVE_EXTS: &[&str] = &["zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "zst", "jar"];
const BINARY_EXTS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "wasm", "class", "pyc", "pdb",
];
const DOC_BINARY_EXTS: &[&str] =
    &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "epub"];

/// 取小写扩展名(不含点;无扩展名返回空串)
#[must_use]
pub fn extension_of(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// 扩展名 → 大类;未知归 Other
#[must_use]
pub fn category_for_extension(ext: &str) -> FileCategory {
    if CODE_EXTS.contains(&ext) {
        FileCategory::Code
    } else if DOC_TEXT_EXTS.contains(&ext) || DOC_BINARY_EXTS.contains(&ext) {
        FileCategory::Document
    } else if IMAGE_EXTS.contains(&ext) {
        FileCategory::Image
    } else if VIDEO_EXTS.contains(&ext) {
        FileCategory::Video
    } else if AUDIO_EXTS.contains(&ext) {
        FileCategory::Audio
    } else if ARCHIVE_EXTS.contains(&ext) {
        FileCategory::Archive
    } else if BINARY_EXTS.contains(&ext) {
        FileCategory::Binary
    } else {
        FileCategory::Other
    }
}

/// 是否按"文本"统计行数/字数(代码类 + 纯文本文档类)
#[must_use]
pub fn is_text_extension(ext: &str) -> bool {
    CODE_EXTS.contains(&ext) || DOC_TEXT_EXTS.contains(&ext)
}

/// 魔数嗅探,返回格式标签;无法识别返回 None
#[must_use]
pub fn sniff_magic(bytes: &[u8]) -> Option<&'static str> {
    const SIGNS: &[(&[u8], &str)] = &[
        (b"\x89PNG\r\n\x1a\n", "png"),
        (b"\xff\xd8\xff", "jpeg"),
        (b"GIF87a", "gif"),
        (b"GIF89a", "gif"),
        (b"%PDF-", "pdf"),
        (b"PK\x03\x04", "zip"),
        (b"\x1f\x8b", "gzip"),
        (b"\x7fELF", "elf"),
        (b"MZ", "pe"),
        (b"\xca\xfe\xba\xbe", "java-class"),
        (b"OggS", "ogg"),
        (b"RIFF", "riff"),
        (b"SQLite format 3\x00", "sqlite"),
    ];
    SIGNS
        .iter()
        .find(|(sig, _)| bytes.starts_with(sig))
        .map(|(_, name)| *name)
}

/// 含 NUL 字节视为二进制(调用方已按大小上限读入内容)
#[must_use]
pub fn bytes_look_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_extension_of() {
        assert_eq!(extension_of(Path::new("a/b/c.TXT")), "txt");
        assert_eq!(extension_of(Path::new("noext")), "");
        assert_eq!(extension_of(Path::new("x.tar.gz")), "gz");
        #[cfg(windows)]
        assert_eq!(extension_of(Path::new(r"C:\dir\File.RS")), "rs");
    }

    #[test]
    fn test_category_for_extension() {
        assert_eq!(category_for_extension("rs"), FileCategory::Code);
        assert_eq!(category_for_extension("tsx"), FileCategory::Code);
        assert_eq!(category_for_extension("md"), FileCategory::Document);
        assert_eq!(category_for_extension("pdf"), FileCategory::Document);
        assert_eq!(category_for_extension("png"), FileCategory::Image);
        assert_eq!(category_for_extension("mp4"), FileCategory::Video);
        assert_eq!(category_for_extension("flac"), FileCategory::Audio);
        assert_eq!(category_for_extension("zip"), FileCategory::Archive);
        assert_eq!(category_for_extension("dll"), FileCategory::Binary);
        assert_eq!(category_for_extension("xyzabc"), FileCategory::Other);
        assert_eq!(category_for_extension(""), FileCategory::Other);
    }

    #[test]
    fn test_is_text_extension() {
        assert!(is_text_extension("json"));
        assert!(is_text_extension("log"));
        assert!(!is_text_extension("png"));
        assert!(!is_text_extension(""));
    }

    #[test]
    fn test_sniff_magic() {
        assert_eq!(sniff_magic(b"\x89PNG\r\n\x1a\n...."), Some("png"));
        assert_eq!(sniff_magic(b"\xff\xd8\xff\xe0"), Some("jpeg"));
        assert_eq!(sniff_magic(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(sniff_magic(b"PK\x03\x04rest"), Some("zip"));
        assert_eq!(sniff_magic(b"plain text"), None);
        assert_eq!(sniff_magic(b""), None);
    }

    #[test]
    fn test_bytes_look_binary() {
        assert!(!bytes_look_binary(b"hello world"));
        assert!(bytes_look_binary(b"ab\x00cd"));
        let mut late_nul = vec![b'a'; 9000];
        late_nul[8500] = 0;
        assert!(bytes_look_binary(&late_nul));
    }

    #[test]
    fn test_category_serde_snake_case() {
        let v = serde_json::to_value(FileCategory::Document).unwrap();
        assert_eq!(v, serde_json::json!("document"));
    }
}
