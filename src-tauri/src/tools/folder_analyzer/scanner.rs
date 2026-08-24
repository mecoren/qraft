// 目录扫描统计(同步阻塞实现,调用方用 spawn_blocking 包装;只读)

use std::cmp::Reverse;
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::classify::{
    FileCategory, bytes_look_binary, category_for_extension, extension_of, is_text_extension,
};
use super::text_metrics::{count_metrics, decode_best_effort};

const PROGRESS_EVERY: u64 = 512;
const TOP_EXTENSIONS: usize = 100;
const TOP_LARGEST: usize = 20;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub include_hidden: bool,
    pub analyze_text_metrics: bool,
    pub max_text_file_bytes: u64,
    pub max_entries: u64,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            include_hidden: false,
            analyze_text_metrics: true,
            max_text_file_bytes: 8 * 1024 * 1024,
            max_entries: 200_000,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CategoryStat {
    pub category: FileCategory,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ExtStat {
    pub ext: String,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ExtTextStat {
    pub ext: String,
    pub files: u64,
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct TextMetricsSummary {
    pub files_analyzed: u64,
    pub files_skipped_large: u64,
    pub files_skipped_binary: u64,
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
    pub by_extension: Vec<ExtTextStat>,
}

#[derive(Debug, Serialize)]
pub struct FileStat {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ScanReport {
    pub root: String,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_bytes: u64,
    pub symlinks_skipped: u64,
    pub truncated: bool,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub by_category: Vec<CategoryStat>,
    pub by_extension: Vec<ExtStat>,
    pub text_metrics: Option<TextMetricsSummary>,
    pub largest_files: Vec<FileStat>,
}

pub type ProgressFn = dyn Fn(u64, u64) + Sync;

struct Acc {
    ext_files: HashMap<String, (u64, u64)>, // ext → (files, bytes)
    cat_stats: [(u64, u64); 8],             // cat_index → (files, bytes)
    metrics: TextMetricsSummary,
    ext_text: HashMap<String, (u64, u64, u64, u64)>, // ext → (files, lines, words, chars)
    largest: std::collections::BinaryHeap<(Reverse<u64>, String)>,
}

const fn cat_index(c: FileCategory) -> usize {
    match c {
        FileCategory::Code => 0,
        FileCategory::Document => 1,
        FileCategory::Image => 2,
        FileCategory::Video => 3,
        FileCategory::Audio => 4,
        FileCategory::Archive => 5,
        FileCategory::Binary => 6,
        FileCategory::Other => 7,
    }
}

const fn cat_from_index(i: usize) -> FileCategory {
    match i {
        0 => FileCategory::Code,
        1 => FileCategory::Document,
        2 => FileCategory::Image,
        3 => FileCategory::Video,
        4 => FileCategory::Audio,
        5 => FileCategory::Archive,
        6 => FileCategory::Binary,
        _ => FileCategory::Other,
    }
}

fn is_hidden(name: &str, opts: &ScanOptions) -> bool {
    !opts.include_hidden && name.starts_with('.')
}

/// 同步遍历目录并聚合统计;cancel 每 `PROGRESS_EVERY` 条检查一次。
/// 单个目录读取失败静默跳过,不让局部失败拖垮整体统计。
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn scan_folder(
    root: &Path,
    opts: &ScanOptions,
    cancel: Option<&CancellationToken>,
    on_progress: &ProgressFn,
) -> ScanReport {
    let start = Instant::now();
    let mut acc = Acc {
        ext_files: HashMap::new(),
        cat_stats: [(0, 0); 8],
        metrics: TextMetricsSummary::default(),
        ext_text: HashMap::new(),
        largest: std::collections::BinaryHeap::new(),
    };
    let mut total_files = 0u64;
    let mut total_dirs = 0u64;
    let mut total_bytes = 0u64;
    let mut symlinks_skipped = 0u64;
    let mut truncated = false;
    let mut cancelled = false;
    let mut visited = 0u64;

    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
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
            if visited > opts.max_entries {
                truncated = true;
                break 'outer;
            }
            if visited % PROGRESS_EVERY == 0 {
                if cancel.is_some_and(CancellationToken::is_cancelled) {
                    cancelled = true;
                    break 'outer;
                }
                on_progress(total_files, total_dirs);
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_symlink() {
                symlinks_skipped += 1;
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if !is_hidden(&name, opts) {
                    total_dirs += 1;
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() || is_hidden(&name, opts) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let size = meta.len();
            total_files += 1;
            total_bytes += size;

            let ext = extension_of(&path);
            let ci = cat_index(category_for_extension(&ext));
            acc.cat_stats[ci].0 += 1;
            acc.cat_stats[ci].1 += size;
            let e = acc.ext_files.entry(ext.clone()).or_insert((0, 0));
            e.0 += 1;
            e.1 += size;

            let top = (Reverse(size), path.to_string_lossy().into_owned());
            if acc.largest.len() < TOP_LARGEST {
                acc.largest.push(top);
            } else if let Some(mut inner) = acc.largest.peek_mut() {
                if top.0 < inner.0 {
                    *inner = top;
                }
            }

            if opts.analyze_text_metrics && is_text_extension(&ext) {
                if size > opts.max_text_file_bytes {
                    acc.metrics.files_skipped_large += 1;
                } else {
                    match std::fs::read(&path) {
                        Ok(bytes) => {
                            if bytes_look_binary(&bytes) {
                                acc.metrics.files_skipped_binary += 1;
                            } else {
                                let (text, _) = decode_best_effort(&bytes);
                                let m = count_metrics(&text);
                                acc.metrics.files_analyzed += 1;
                                acc.metrics.lines += m.lines;
                                acc.metrics.words += m.words;
                                acc.metrics.chars += m.chars;
                                let t = acc.ext_text.entry(ext.clone()).or_insert((0, 0, 0, 0));
                                t.0 += 1;
                                t.1 += m.lines;
                                t.2 += m.words;
                                t.3 += m.chars;
                            }
                        }
                        Err(_) => acc.metrics.files_skipped_binary += 1,
                    }
                }
            }
        }
    }

    let mut by_category: Vec<CategoryStat> = acc
        .cat_stats
        .iter()
        .enumerate()
        .filter(|(_, (files, _))| *files > 0)
        .map(|(i, (files, bytes))| CategoryStat {
            category: cat_from_index(i),
            files: *files,
            bytes: *bytes,
        })
        .collect();
    by_category.sort_unstable_by(|a, b| {
        b.files
            .cmp(&a.files)
            .then_with(|| a.category.cmp(&b.category))
    });

    let mut by_extension: Vec<ExtStat> = acc
        .ext_files
        .into_iter()
        .map(|(ext, (files, bytes))| ExtStat { ext, files, bytes })
        .collect();
    by_extension.sort_unstable_by(|a, b| b.files.cmp(&a.files).then_with(|| a.ext.cmp(&b.ext)));
    by_extension.truncate(TOP_EXTENSIONS);

    let mut metrics = acc.metrics;
    let mut by_ext_text: Vec<ExtTextStat> = acc
        .ext_text
        .into_iter()
        .map(|(ext, (files, lines, words, chars))| ExtTextStat {
            ext,
            files,
            lines,
            words,
            chars,
        })
        .collect();
    by_ext_text.sort_unstable_by(|a, b| b.files.cmp(&a.files).then_with(|| a.ext.cmp(&b.ext)));
    metrics.by_extension = by_ext_text;

    let mut largest_files: Vec<FileStat> = acc
        .largest
        .into_iter()
        .map(|(Reverse(bytes), path)| FileStat { path, bytes })
        .collect();
    largest_files.sort_unstable_by_key(|f| Reverse(f.bytes));

    ScanReport {
        root: root.to_string_lossy().into_owned(),
        total_files,
        total_bytes,
        total_dirs,
        symlinks_skipped,
        truncated,
        cancelled,
        elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        by_category,
        by_extension,
        text_metrics: if opts.analyze_text_metrics {
            Some(metrics)
        } else {
            None
        },
        largest_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn noop_progress() -> impl Fn(u64, u64) {
        |_f, _d| {}
    }

    /// 目录树:
    /// a.txt "hi\n"(3B) b.md "你好\n"(7B) sub/c.rs(13B)
    /// .hidden.txt(2B,默认跳过) img.png 10B 伪 PNG
    fn setup_tree(dir: &std::path::Path) {
        fs::write(dir.join("a.txt"), b"hi\n").unwrap();
        fs::write(dir.join("b.md"), "你好\n".as_bytes()).unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.rs"), b"fn main() {}\n").unwrap();
        fs::write(dir.join(".hidden.txt"), b"x\n").unwrap();
        let png: &[u8] = b"\x89PNG\r\n\x1a\nxx";
        fs::write(dir.join("img.png"), png).unwrap();
    }

    #[test]
    fn test_scan_totals_and_categories() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert_eq!(report.root, tmp.path().to_string_lossy());
        assert_eq!(report.total_files, 4);
        assert_eq!(report.total_dirs, 1);
        assert_eq!(report.total_bytes, 3 + 7 + 13 + 10);
        assert_eq!(report.symlinks_skipped, 0);
        assert!(!report.truncated && !report.cancelled);

        let code = report
            .by_category
            .iter()
            .find(|c| c.category == FileCategory::Code)
            .unwrap();
        assert_eq!((code.files, code.bytes), (1, 13));
        // txt 与 md 同属 Document(Task 1 的 DOC_TEXT_EXTS):a.txt(3B)+b.md(7B)=(2,10)
        let doc = report
            .by_category
            .iter()
            .find(|c| c.category == FileCategory::Document)
            .unwrap();
        assert_eq!((doc.files, doc.bytes), (2, 10));
    }

    #[test]
    fn test_by_extension_sorted_desc() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert!(report.by_extension.len() >= 3);
        assert!(
            report
                .by_extension
                .windows(2)
                .all(|w| w[0].files > w[1].files
                    || (w[0].files == w[1].files && w[0].ext < w[1].ext))
        );
    }

    #[test]
    fn test_hidden_excluded_by_default_included_when_opted() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let r1 = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert!(
            r1.by_extension
                .iter()
                .all(|e| e.ext != "txt" || e.files == 1)
        );

        let opts = ScanOptions {
            include_hidden: true,
            ..ScanOptions::default()
        };
        let r2 = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert_eq!(r2.total_files, 5);
        assert_eq!(r1.total_files, 4);
    }

    #[test]
    fn test_text_metrics_aggregated_per_ext() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        // a.txt:1行/1词/2字;b.md:1行/2词(CJK)/2字;c.rs:1行/3词(fn,main,{})/12字
        assert_eq!(tm.files_analyzed, 3);
        assert_eq!((tm.lines, tm.words, tm.chars), (3, 6, 16));

        let txt = tm.by_extension.iter().find(|e| e.ext == "txt").unwrap();
        assert_eq!((txt.files, txt.lines, txt.words, txt.chars), (1, 1, 1, 2));
        let md = tm.by_extension.iter().find(|e| e.ext == "md").unwrap();
        assert_eq!((md.files, md.words), (1, 2));
        // img.png 非文本扩展,不计入 metrics
        assert!(tm.by_extension.iter().all(|e| e.ext != "png"));
    }

    #[test]
    fn test_large_file_skipped_from_metrics_but_counted() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("big.log"), b"a\n").unwrap();
        fs::write(tmp.path().join("huge.log"), vec![b'x'; 32]).unwrap();
        let opts = ScanOptions {
            max_text_file_bytes: 16,
            ..ScanOptions::default()
        };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        assert_eq!(tm.files_analyzed, 1);
        assert_eq!(tm.files_skipped_large, 1);
        assert_eq!(report.total_files, 2);
    }

    #[test]
    fn test_binary_content_skipped_even_with_text_ext() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("fake.txt"), b"ok\x00binary").unwrap();
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        assert_eq!(tm.files_analyzed, 0);
        assert_eq!(tm.files_skipped_binary, 1);
    }

    #[test]
    fn test_max_entries_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..10 {
            fs::write(tmp.path().join(format!("f{i}.txt")), b"x\n").unwrap();
        }
        let opts = ScanOptions {
            max_entries: 3,
            ..ScanOptions::default()
        };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert!(report.truncated);
        assert!(!report.cancelled);
        assert_eq!(report.total_files, 3);
    }

    #[test]
    fn test_cancelled_token_stops_scan() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..50 {
            fs::write(tmp.path().join(format!("g{i}.txt")), b"x\n").unwrap();
        }
        let token = CancellationToken::new();
        token.cancel();
        let report = scan_folder(
            tmp.path(),
            &ScanOptions::default(),
            Some(&token),
            &noop_progress(),
        );
        assert!(report.cancelled);
        assert_eq!(report.total_files, 0);
    }

    #[test]
    fn test_largest_files_top_desc() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("s.txt"), b"x\n").unwrap();
        fs::write(tmp.path().join("m.txt"), b"xxxx\n").unwrap();
        fs::write(tmp.path().join("l.txt"), b"xxxxxxxx\n").unwrap();
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let sizes: Vec<u64> = report.largest_files.iter().map(|f| f.bytes).collect();
        let mut sorted = sizes.clone();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        assert_eq!(sizes, sorted);
        assert_eq!(report.largest_files.len(), 3);
    }

    #[test]
    fn test_progress_callback_invoked() {
        let tmp = tempfile::tempdir().unwrap();
        // 进度回调每 PROGRESS_EVERY(512)条触发一次,需生成足量条目
        for i in 0..520 {
            fs::write(tmp.path().join(format!("p{i}.txt")), b"x\n").unwrap();
        }
        let called = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        {
            let called = std::sync::Arc::clone(&called);
            let cb = move |_: u64, _: u64| {
                called.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            };
            let _ = scan_folder(tmp.path(), &ScanOptions::default(), None, &cb);
        }
        assert!(called.load(std::sync::atomic::Ordering::Relaxed) >= 1);
    }

    #[test]
    fn test_metrics_disabled_when_opted_out() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let opts = ScanOptions {
            analyze_text_metrics: false,
            ..ScanOptions::default()
        };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert_eq!(report.total_files, 4);
        assert!(report.text_metrics.is_none());
    }
}
