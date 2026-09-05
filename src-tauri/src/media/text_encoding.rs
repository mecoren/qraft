// 文本编码探测与转换(纯逻辑,不依赖 Tauri 运行时)
//
// 供编辑器「文件编码」功能使用:
// - 打开文件时探测编码(BOM → 严格 UTF-8 → GB18030/Big5/Shift-JIS/EUC-KR → 兜底 Windows-1252)
// - 保存时按所选编码写回(utf-8-bom 自动补 BOM)
//
// 编码标识即 encoding_rs 的 whatwg label 小写形式,另加 `utf-8-bom`
// (标识 UTF-8 带 BOM 变体);与前端 lib/text-encodings.ts 对齐。

use crate::shell::AppError;

/// 编码标识与显示名的映射(与前端 `TEXT_ENCODINGS` 对齐)
pub const ENCODING_IDS: &[(&str, &str)] = &[
    ("utf-8", "UTF-8"),
    ("utf-8-bom", "UTF-8 BOM"),
    ("gb18030", "GB18030"),
    ("big5", "Big5"),
    ("shift_jis", "Shift-JIS"),
    ("euc-kr", "EUC-KR"),
    ("windows-1252", "Windows-1252"),
    ("utf-16le", "UTF-16 LE"),
    ("utf-16be", "UTF-16 BE"),
];

/// 按编码标识解析 `encoding_rs` Encoding(`utf-8-bom` 按 `UTF_8` 处理)
fn encoding_by_id(id: &str) -> Option<&'static encoding_rs::Encoding> {
    let base = if id == "utf-8-bom" { "utf-8" } else { id };
    encoding_rs::Encoding::for_label(base.as_bytes())
}

/// 头部 BOM 识别:返回 (方向, BOM 字节长度);无 BOM 返回 None
///
/// 供纯逻辑层(`large_file`)做「带 BOM 恒为文本」的快速分流,
/// 规则与 `encoding_rs::Encoding::for_bom` 一致
#[must_use]
pub fn bom_of(bytes: &[u8]) -> Option<(&'static str, usize)> {
    encoding_rs::Encoding::for_bom(bytes).map(|(enc, bom_len)| {
        let id = match enc.name() {
            "UTF-16LE" => "utf-16le",
            "UTF-16BE" => "utf-16be",
            _ => "utf-8-bom",
        };
        (id, bom_len)
    })
}

/// 校验编码标识是否受支持
#[must_use]
pub fn is_supported_encoding(id: &str) -> bool {
    ENCODING_IDS.iter().any(|(known, _)| *known == id)
}

/// 由字节流探测编码:
/// 1. BOM 优先(UTF-8 BOM / UTF-16 LE / UTF-16 BE)
/// 2. 严格 UTF-8
/// 3. GB18030 / Big5 / Shift-JIS / EUC-KR 逐个无错解码
/// 4. 兜底 Windows-1252(恒可解码)
#[must_use]
pub fn detect_encoding(bytes: &[u8]) -> &'static str {
    if let Some((enc, _bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        return match enc.name() {
            "UTF-16LE" => "utf-16le",
            "UTF-16BE" => "utf-16be",
            // UTF-8 BOM 单独区分,便于保存时保留 BOM
            _ => "utf-8-bom",
        };
    }
    if std::str::from_utf8(bytes).is_ok() {
        return "utf-8";
    }
    for (id, enc) in [
        ("gb18030", encoding_rs::GB18030),
        ("big5", encoding_rs::BIG5),
        ("shift_jis", encoding_rs::SHIFT_JIS),
        ("euc-kr", encoding_rs::EUC_KR),
    ] {
        let (_, _, had_errors) = enc.decode(bytes);
        if !had_errors {
            return id;
        }
    }
    "windows-1252"
}

/// 解码字节为字符串(BOM 剥离;未知编码回退 windows-1252 有损解码)
#[must_use]
pub fn decode_text(bytes: &[u8], encoding_id: &str) -> String {
    let enc = encoding_by_id(encoding_id).unwrap_or(encoding_rs::WINDOWS_1252);
    let bytes = if encoding_id == "utf-8-bom" {
        bytes
            .strip_prefix([0xEF_u8, 0xBB, 0xBF].as_slice())
            .unwrap_or(bytes)
    } else {
        bytes
    };
    let (cow, _actual, _) = enc.decode(bytes);
    cow.into_owned()
}

/// 把字符串按指定编码编码为字节
///
/// - utf-8 / utf-8-bom:直接输出(后者补 BOM)
/// - utf-16le / utf-16be:手工编码并补 BOM(`encoding_rs` 遵循 WHATWG encode
///   算法,会把 UTF-16 方向的 encode 重定向为 UTF-8,故不能走 enc.encode)
/// - 其余走 `encoding_rs`
///
/// # Errors
///
/// 编码标识不受支持时返回 `AppError::Unsupported`
pub fn encode_text(content: &str, encoding_id: &str) -> Result<Vec<u8>, AppError> {
    if !is_supported_encoding(encoding_id) {
        return Err(AppError::Unsupported(format!(
            "unsupported encoding: {encoding_id}"
        )));
    }
    match encoding_id {
        "utf-8" => return Ok(content.as_bytes().to_vec()),
        "utf-8-bom" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(content.as_bytes());
            return Ok(out);
        }
        // 与 VSCode 行为一致:保存为 UTF-16 时写入带 BOM 的字节流,
        // 保证再次打开时能被 BOM 探测正确识别
        "utf-16le" => {
            let mut out = Vec::with_capacity(content.len() * 2 + 2);
            out.extend_from_slice(&[0xFF, 0xFE]);
            for unit in content.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            return Ok(out);
        }
        "utf-16be" => {
            let mut out = Vec::with_capacity(content.len() * 2 + 2);
            out.extend_from_slice(&[0xFE, 0xFF]);
            for unit in content.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            return Ok(out);
        }
        _ => {}
    }
    let Some(enc) = encoding_by_id(encoding_id) else {
        return Err(AppError::Unsupported(format!(
            "unsupported encoding: {encoding_id}"
        )));
    };
    let (cow, _, _had_unmappable) = enc.encode(content);
    Ok(cow.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_encoding_utf8_variants() {
        // 纯 UTF-8(无 BOM)
        assert_eq!(detect_encoding("hello 世界".as_bytes()), "utf-8");
        // UTF-8 BOM
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(b"hello");
        assert_eq!(detect_encoding(&bom), "utf-8-bom");
        // UTF-16 LE BOM
        assert_eq!(detect_encoding(&[0xFF, 0xFE, 0x68, 0x00]), "utf-16le");
        // UTF-16 BE BOM
        assert_eq!(detect_encoding(&[0xFE, 0xFF, 0x00, 0x68]), "utf-16be");
    }

    #[test]
    fn test_detect_encoding_gb18030() {
        // 「中文」的 GBK/GB18030 编码:D6 D0 CE C4(非合法 UTF-8)
        let bytes = [0xD6_u8, 0xD0, 0xCE, 0xC4];
        assert_eq!(detect_encoding(&bytes), "gb18030");
    }

    #[test]
    fn test_detect_encoding_windows_1252_fallback() {
        // 0x81 在 GB18030/Big5/Shift-JIS/EUC-KR 中均为待续导字节 → 兜底
        assert_eq!(detect_encoding(&[0x81]), "windows-1252");
    }

    #[test]
    fn test_decode_encode_round_trip_gb18030() {
        let content = "你好,世界!Qraft 编辑器";
        let bytes = encode_text(content, "gb18030").unwrap();
        assert_eq!(detect_encoding(&bytes), "gb18030");
        assert_eq!(decode_text(&bytes, "gb18030"), content);
    }

    #[test]
    fn test_encode_utf8_bom_prepends_bom() {
        let bytes = encode_text("abc", "utf-8-bom").unwrap();
        assert_eq!(bytes, vec![0xEF, 0xBB, 0xBF, b'a', b'b', b'c']);
        // 解码时 BOM 被剥离
        assert_eq!(decode_text(&bytes, "utf-8-bom"), "abc");
    }

    #[test]
    fn test_encode_unsupported_encoding_errors() {
        assert!(encode_text("abc", "iso-2022-jp").is_err());
        assert!(!is_supported_encoding("iso-2022-jp"));
        assert!(is_supported_encoding("utf-8"));
        assert!(is_supported_encoding("utf-8-bom"));
        assert!(is_supported_encoding("gb18030"));
    }

    #[test]
    fn test_encode_utf16_round_trip_with_bom() {
        // UTF-16 写入带 BOM,再次打开可被探测正确识别
        for id in ["utf-16le", "utf-16be"] {
            let content = "UTF-16 round trip 中文";
            let bytes = encode_text(content, id).unwrap();
            assert_eq!(detect_encoding(&bytes), id, "detect {id}");
            assert_eq!(decode_text(&bytes, id), content);
        }
    }
}
