// 跨文本文件内容搜索(同步阻塞实现;只读)

use std::path::{Path, PathBuf};

use regex::RegexBuilder;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::classify::{bytes_look_binary, extension_of, is_text_extension};
use super::scanner::ProgressFn;
use super::text_metrics::decode_best_effort;
use crate::core::error::ToolError;

const PREVIEW_CHARS: usize = 240;

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub pattern: String,
    pub is_regex: bool,
    pub case_insensitive: bool,
    pub extensions: Vec<String>,
    pub include_hidden: bool,
    pub max_file_bytes: u64,
    pub max_matches_per_file: u32,
    pub max_matches_total: u64,
    pub max_entries: u64,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            pattern: String::new(),
            is_regex: false,
            case_insensitive: false,
            extensions: Vec::new(),
            include_hidden: false,
            max_file_bytes: 4 * 1024 * 1024,
            max_matches_per_file: 200,
            max_matches_total: 5_000,
            max_entries: 200_000,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub line_number: u64,
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub ext: String,
    pub match_count: u64,
    pub matches: Vec<SearchMatch>,
}

/// 序列化报告;`truncated`/`cancelled` 为独立语义标志位。
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Serialize)]
pub struct SearchReport {
    pub pattern: String,
    pub is_regex: bool,
    pub case_insensitive: bool,
    pub total_matches: u64,
    pub files_with_matches: u64,
    pub results: Vec<FileSearchResult>,
    pub files_scanned: u64,
    pub files_skipped_large: u64,
    pub truncated: bool,
    pub cancelled: bool,
}

/// 普通串 → 转义;正则 → 原样编译;统一挂 `case_insensitive` flag。
///
/// # Errors
///
/// 非法正则表达式返回 `ToolError::InvalidInput`(`ERR_INVALID_INPUT`)。
pub fn build_matcher(opts: &SearchOptions) -> Result<regex::Regex, ToolError> {
    let source = if opts.is_regex {
        opts.pattern.clone()
    } else {
        regex::escape(&opts.pattern)
    };
    RegexBuilder::new(&source)
        .case_insensitive(opts.case_insensitive)
        .build()
        .map_err(|e| ToolError::InvalidInput(format!("invalid pattern '{}': {e}", opts.pattern)))
}

fn ext_selected(ext: &str, opts: &SearchOptions) -> bool {
    if opts.extensions.is_empty() {
        is_text_extension(ext)
    } else {
        is_text_extension(ext) && opts.extensions.iter().any(|e| e == ext)
    }
}

fn truncate_preview(line: &str) -> String {
    if line.chars().count() <= PREVIEW_CHARS {
        return line.to_string();
    }
    let mut s: String = line.chars().take(PREVIEW_CHARS - 1).collect();
    s.push('…');
    s
}

/// 收集待搜索文件(与 scanner 相同的隐藏/上限/取消语义,复用其常量节奏)
fn collect_candidates(
    root: &Path,
    include_hidden: bool,
    max_entries: u64,
    cancel: Option<&CancellationToken>,
) -> (Vec<PathBuf>, bool, bool) {
    let mut out = Vec::new();
    let mut truncated = false;
    let mut cancelled = false;
    let mut visited = 0u64;
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    'outer: while let Some(dir) = stack.pop() {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            cancelled = true;
            break;
        }
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            visited += 1;
            if visited > max_entries {
                truncated = true;
                break 'outer;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let visible = include_hidden || !name.starts_with('.');
            if ft.is_dir() {
                if visible {
                    stack.push(entry.path());
                }
                continue;
            }
            if ft.is_file() && visible {
                out.push(entry.path());
            }
        }
    }
    (out, truncated, cancelled)
}

/// # Errors
///
/// 仅在 IO 层面失败时静默跳过;本函数本身不返回 Err。
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn search_folder(
    root: &Path,
    opts: &SearchOptions,
    matcher: &regex::Regex,
    cancel: Option<&CancellationToken>,
    on_progress: &ProgressFn,
) -> SearchReport {
    let (candidates, walk_truncated, walk_cancelled) =
        collect_candidates(root, opts.include_hidden, opts.max_entries, cancel);
    let mut report = SearchReport {
        pattern: opts.pattern.clone(),
        is_regex: opts.is_regex,
        case_insensitive: opts.case_insensitive,
        total_matches: 0,
        files_with_matches: 0,
        results: Vec::new(),
        files_scanned: 0,
        files_skipped_large: 0,
        truncated: walk_truncated,
        cancelled: walk_cancelled,
    };

    for path in candidates {
        if report.total_matches >= opts.max_matches_total {
            report.truncated = true;
            break;
        }
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            report.cancelled = true;
            break;
        }
        let ext = extension_of(&path);
        if !ext_selected(&ext, opts) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() > opts.max_file_bytes {
            report.files_skipped_large += 1;
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if bytes_look_binary(&bytes[..bytes.len().min(8192)]) {
            continue;
        }
        let (text, _) = decode_best_effort(&bytes);
        report.files_scanned += 1;
        on_progress(report.files_scanned, 0);

        let mut file_result = FileSearchResult {
            path: path.to_string_lossy().into_owned(),
            ext,
            match_count: 0,
            matches: Vec::new(),
        };
        for (idx, raw_line) in text.split('\n').enumerate() {
            if file_result.match_count >= u64::from(opts.max_matches_per_file) {
                break;
            }
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
            for m in matcher.find_iter(line) {
                let column = u32::try_from(line[..m.start()].chars().count())
                    .map_or(u32::MAX, |v| v.saturating_sub(0));
                file_result.matches.push(SearchMatch {
                    line_number: u64::try_from(idx + 1).unwrap_or(u64::MAX),
                    column,
                    preview: truncate_preview(line),
                });
                file_result.match_count += 1;
                report.total_matches += 1;
                if report.total_matches >= opts.max_matches_total {
                    report.truncated = true;
                    break;
                }
            }
            if report.truncated || file_result.match_count >= u64::from(opts.max_matches_per_file) {
                break;
            }
        }
        if !file_result.matches.is_empty() {
            report.files_with_matches += 1;
            report.results.push(file_result);
        }
    }
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        report.cancelled = true;
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn noop() -> impl Fn(u64, u64) {
        |_f, _d| {}
    }

    fn base_opts(pattern: &str) -> SearchOptions {
        SearchOptions {
            pattern: pattern.to_string(),
            ..SearchOptions::default()
        }
    }

    fn setup(dir: &std::path::Path) {
        fs::write(dir.join("a.rs"), "fn main() {}\nlet x = FOO;\nfoo bar\n").unwrap();
        fs::write(dir.join("b.md"), "# Foo\nsome foo here\n").unwrap();
        fs::write(dir.join("skip.bin"), b"\x00\x01foo\x00").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.txt"), "FOO at line one\n").unwrap();
    }

    #[test]
    fn test_plain_search_case_sensitive_default() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = base_opts("foo");
        let matcher = build_matcher(&opts).unwrap();
        let r = search_folder(tmp.path(), &opts, &matcher, None, &noop());
        // 命中:a.rs 第3行 + b.md 第2行("some foo here");FOO 大写不命中;skip.bin 二进制跳过
        assert_eq!(r.total_matches, 2);
        assert_eq!(r.files_with_matches, 2);
        assert_eq!(r.files_scanned, 3);
        assert_eq!(r.files_skipped_large, 0);
        let a = r.results.iter().find(|f| f.path.ends_with("a.rs")).unwrap();
        assert_eq!(a.match_count, 1);
        assert_eq!(a.matches[0].line_number, 3);
        assert_eq!(a.matches[0].column, 0);
        assert_eq!(a.matches[0].preview, "foo bar");
    }

    #[test]
    fn test_case_insensitive_hits_uppercase() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = SearchOptions {
            case_insensitive: true,
            ..base_opts("foo")
        };
        let matcher = build_matcher(&opts).unwrap();
        let r = search_folder(tmp.path(), &opts, &matcher, None, &noop());
        // a.rs:2(FOO、foo)+ b.md:2(Foo、foo)+ c.txt:1(FOO)= 5
        assert_eq!(r.total_matches, 5);
        assert_eq!(r.files_with_matches, 3);
    }

    #[test]
    fn test_regex_vs_literal() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("x.txt"), "abc a.c axc\n").unwrap();

        let lit = SearchOptions {
            is_regex: false,
            ..base_opts("a.c")
        };
        let r1 = search_folder(
            tmp.path(),
            &lit,
            &build_matcher(&lit).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r1.total_matches, 1); // 仅字面 "a.c"

        let rex = SearchOptions {
            is_regex: true,
            ..base_opts("a.c")
        };
        let r2 = search_folder(
            tmp.path(),
            &rex,
            &build_matcher(&rex).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r2.total_matches, 3); // abc/a.c/axc
    }

    #[test]
    fn test_extension_filter() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = SearchOptions {
            case_insensitive: true,
            extensions: vec!["md".to_string()],
            ..base_opts("foo")
        };
        let r = search_folder(
            tmp.path(),
            &opts,
            &build_matcher(&opts).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r.files_with_matches, 1);
        assert!(r.results.iter().all(|f| f.ext == "md"));
    }

    #[test]
    fn test_per_file_cap() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("many.txt"), "foo\nfoo\nfoo\nfoo\n").unwrap();
        let opts = SearchOptions {
            max_matches_per_file: 2,
            ..base_opts("foo")
        };
        let r = search_folder(
            tmp.path(),
            &opts,
            &build_matcher(&opts).unwrap(),
            None,
            &noop(),
        );
        let f = &r.results[0];
        assert_eq!(f.matches.len(), 2);
        assert_eq!(f.match_count, 2);
        assert!(!r.truncated);
    }

    #[test]
    fn test_total_cap_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..3 {
            fs::write(tmp.path().join(format!("{i}.txt")), "foo\n").unwrap();
        }
        let opts = SearchOptions {
            max_matches_total: 2,
            ..base_opts("foo")
        };
        let r = search_folder(
            tmp.path(),
            &opts,
            &build_matcher(&opts).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r.total_matches, 2);
        assert!(r.truncated);
    }

    #[test]
    fn test_invalid_regex_is_input_error() {
        // is_regex=false 时 pattern 会被 escape 成字面量,永远合法;须显式开启正则
        let opts = SearchOptions {
            is_regex: true,
            ..base_opts("([unclosed")
        };
        assert!(matches!(
            build_matcher(&opts),
            Err(ToolError::InvalidInput(_))
        ));
    }

    #[test]
    fn test_preview_truncated_at_240_chars() {
        let long_line = "x".repeat(500) + "needle";
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("long.txt"), long_line + "\n").unwrap();
        let opts = base_opts("needle");
        let r = search_folder(
            tmp.path(),
            &opts,
            &build_matcher(&opts).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r.results[0].matches[0].preview.chars().count(), 240);
        assert!(r.results[0].matches[0].preview.ends_with('…'));
    }

    #[test]
    fn test_column_is_char_index() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("cjk.txt"), "中文 needle\n").unwrap();
        let opts = base_opts("needle");
        let r = search_folder(
            tmp.path(),
            &opts,
            &build_matcher(&opts).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r.results[0].matches[0].column, 3);
    }

    #[test]
    fn test_hidden_respects_option() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".dot.md"), "needle\n").unwrap();
        let r1 = search_folder(
            tmp.path(),
            &base_opts("needle"),
            &build_matcher(&base_opts("needle")).unwrap(),
            None,
            &noop(),
        );
        assert_eq!(r1.files_with_matches, 0);
        let o2 = SearchOptions {
            include_hidden: true,
            ..base_opts("needle")
        };
        let r2 = search_folder(tmp.path(), &o2, &build_matcher(&o2).unwrap(), None, &noop());
        assert_eq!(r2.files_with_matches, 1);
    }
}
