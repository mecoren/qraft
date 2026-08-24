// 文本解码与 行数/字数 统计(纯函数,只读)
//
// 口径:
// - 行数:按 \n 计数,末尾无换行的最后一段也算一行,空文本 0 行,\r\n 视为一行
// - 字符数:Unicode 标量个数,不含 \r \n
// - 字数:CJK 字符逐字计词;连续非空白非 CJK 序列计 1 词

use encoding_rs::{Encoding, GBK};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TextMetrics {
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
}

/// 解码策略:BOM → 严格 UTF-8 → GBK → 有损兜底(unknown)
#[must_use]
#[allow(clippy::single_match_else, clippy::option_if_let_else)]
pub fn decode_best_effort(bytes: &[u8]) -> (String, &'static str) {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let label = match enc.name() {
            "UTF-16LE" => "UTF-16LE",
            "UTF-16BE" => "UTF-16BE",
            _ => "UTF-8",
        };
        let (cow, _, _) = enc.decode(&bytes[bom_len..]);
        return (cow.into_owned(), label);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_owned(), "UTF-8"),
        Err(_) => {
            let (cow, _, had_errors) = GBK.decode(bytes);
            if had_errors {
                (String::from_utf8_lossy(bytes).into_owned(), "unknown")
            } else {
                (cow.into_owned(), "GBK")
            }
        }
    }
}

fn is_cjk(c: char) -> bool {
    ('\u{3400}'..='\u{4DBF}').contains(&c)
        || ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{F900}'..='\u{FAFF}').contains(&c)
}

/// 按上述口径统计行数/字数/字符数
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn count_metrics(text: &str) -> TextMetrics {
    if text.is_empty() {
        return TextMetrics { lines: 0, words: 0, chars: 0 };
    }
    let mut lines = text.matches('\n').count() as u64;
    if !text.ends_with('\n') {
        lines += 1;
    }
    let body = text.strip_suffix('\n').unwrap_or(text);
    let mut chars = 0u64;
    let mut words = 0u64;
    for raw in body.split('\n') {
        // 换行是空白,必须重置分词状态,否则上一行末词会与下一行首词合并
        let mut in_word = false;
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        chars += line.chars().count() as u64;
        for ch in line.chars() {
            if is_cjk(ch) {
                words += 1;
                in_word = false;
            } else if ch.is_whitespace() {
                in_word = false;
            } else if !in_word {
                in_word = true;
                words += 1;
            }
        }
    }
    TextMetrics { lines, words, chars }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty() {
        let m = count_metrics("");
        assert_eq!((m.lines, m.words, m.chars), (0, 0, 0));
    }

    #[test]
    fn test_simple_english() {
        let m = count_metrics("hello world\n");
        assert_eq!((m.lines, m.words, m.chars), (1, 2, 11));
    }

    #[test]
    fn test_no_trailing_newline_counts_as_line() {
        assert_eq!(count_metrics("a\nb").lines, 2);
        assert_eq!(count_metrics("a\n").lines, 1);
        assert_eq!(count_metrics("a\nb\n").lines, 2);
    }

    #[test]
    fn test_crlf() {
        let m = count_metrics("aa\r\nbb\r\n");
        assert_eq!((m.lines, m.chars), (2, 4));
    }

    #[test]
    fn test_words_reset_across_lines() {
        // 回归:换行必须重置分词,两行各 1 词
        assert_eq!(count_metrics("a\nb").words, 2);
        assert_eq!(count_metrics("abc\ndef\n").words, 2);
        // 行尾非空白 + 下一行无空白:各自独立成词
        assert_eq!(count_metrics("x{\ny};").words, 2);
    }

    #[test]
    fn test_cjk_words_and_chars() {
        // 你好世界 = 4 词 4 字;"hello" 再 1 词 5 字(空格计入 chars)
        let m = count_metrics("你好世界 hello\n");
        assert_eq!((m.lines, m.words, m.chars), (1, 5, 10));
    }

    #[test]
    fn test_decode_utf8() {
        let (text, enc) = decode_best_effort("héllo\n".as_bytes());
        assert_eq!(enc, "UTF-8");
        assert_eq!(text, "héllo\n");
    }

    #[test]
    fn test_decode_utf16le_bom() {
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend("你A".encode_utf16().flat_map(|u| u.to_le_bytes()));
        let (text, enc) = decode_best_effort(&bytes);
        assert_eq!(enc, "UTF-16LE");
        assert_eq!(text, "你A");
    }

    #[test]
    fn test_decode_gbk_fallback() {
        // "你好" 的 GBK 编码
        let (text, enc) = decode_best_effort(&[0xC4, 0xE3, 0xBA, 0xC3]);
        assert_eq!(enc, "GBK");
        assert_eq!(text, "你好");
    }

    #[test]
    fn test_decode_unknown_lossy() {
        let (text, enc) = decode_best_effort(&[0x81, 0xFE, 0xFF]);
        assert_eq!(enc, "unknown");
        assert!(text.contains('\u{FFFD}'));
    }
}
