// 文件夹/文件分析器(只读)
//
// scan: 目录统计(数量/大小/扩展名/类别/文本行数字数)
// search: 跨文本文件内容搜索(普通串或正则)
// file: 单文件解析(魔数/编码/行字数/SHA-256)

pub mod classify;
pub mod inspect;
pub mod scanner;
pub mod search;
pub mod text_metrics;

use async_trait::async_trait;
use serde_json::json;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

use self::inspect::inspect_file;
use self::scanner::{ScanOptions, ScanReport, scan_folder};
use self::search::{SearchOptions, SearchReport, build_matcher, search_folder};

pub struct FolderAnalyzer;

impl FolderAnalyzer {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for FolderAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

fn scan_options_from(input: &ToolInput) -> ScanOptions {
    let mut o = ScanOptions::default();
    if let Ok(v) = input.param::<bool>("include_hidden") {
        o.include_hidden = v;
    }
    if let Ok(v) = input.param::<bool>("analyze_text_metrics") {
        o.analyze_text_metrics = v;
    }
    if let Ok(v) = input.param::<u64>("max_text_file_bytes") {
        o.max_text_file_bytes = v;
    }
    if let Ok(v) = input.param::<u64>("max_entries") {
        o.max_entries = v;
    }
    o
}

fn search_options_from(input: &ToolInput) -> Result<SearchOptions, ToolError> {
    let mut o = SearchOptions {
        pattern: input.param::<String>("pattern")?,
        ..SearchOptions::default()
    };
    if let Ok(v) = input.param::<bool>("is_regex") {
        o.is_regex = v;
    }
    if let Ok(v) = input.param::<bool>("case_insensitive") {
        o.case_insensitive = v;
    }
    if let Ok(v) = input.param::<Vec<String>>("extensions") {
        o.extensions = v.into_iter().map(|s| s.to_ascii_lowercase()).collect();
    }
    if let Ok(v) = input.param::<bool>("include_hidden") {
        o.include_hidden = v;
    }
    Ok(o)
}

/// scan 结果一句话中文摘要
#[must_use]
pub fn summarize_scan(r: &ScanReport) -> String {
    format!(
        "{} 个文件 / {} 个目录,共 {} 字节;文本统计覆盖 {} 个文件",
        r.total_files,
        r.total_dirs,
        r.total_bytes,
        r.text_metrics.as_ref().map_or(0, |t| t.files_analyzed)
    )
}

/// search 结果一句话中文摘要
#[must_use]
pub fn summarize_search(r: &SearchReport) -> String {
    format!(
        "共 {} 处匹配,分布在 {} 个文件",
        r.total_matches, r.files_with_matches
    )
}

#[async_trait]
impl Tool for FolderAnalyzer {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let start = std::time::Instant::now();
        let mode: String = input.param("mode")?;
        let input_bytes = input.file_path.as_ref().map_or(0, String::len);

        // 阻塞扫描放 blocking 线程,避免卡异步运行时
        let (text, extra) = match mode.as_str() {
            "scan" => {
                let root = input.file_path()?.to_string();
                let opts = scan_options_from(&input);
                let cancel = ctx.cancel_token.clone();
                let report = tokio::task::spawn_blocking(move || {
                    scan_folder(
                        std::path::Path::new(&root),
                        &opts,
                        Some(&cancel),
                        &|_, _| {},
                    )
                })
                .await
                .map_err(|e| ToolError::Internal(format!("join failed: {e}")))?;
                (summarize_scan(&report), json!(report))
            }
            "search" => {
                let root = input.file_path()?.to_string();
                let opts = search_options_from(&input)?;
                let matcher = build_matcher(&opts)?;
                let cancel = ctx.cancel_token.clone();
                let report = tokio::task::spawn_blocking(move || {
                    search_folder(
                        std::path::Path::new(&root),
                        &opts,
                        &matcher,
                        Some(&cancel),
                        &|_, _| {},
                    )
                })
                .await
                .map_err(|e| ToolError::Internal(format!("join failed: {e}")))?;
                (summarize_search(&report), json!(report))
            }
            "file" => {
                let path = input.file_path()?.to_string();
                let report =
                    tokio::task::spawn_blocking(move || inspect_file(std::path::Path::new(&path)))
                        .await
                        .map_err(|e| ToolError::Internal(format!("join failed: {e}")))??;
                let summary = format!(
                    "{}:{}({} 字节){}",
                    report.file_name,
                    if report.is_text {
                        "文本"
                    } else {
                        "二进制"
                    },
                    report.size_bytes,
                    report
                        .encoding
                        .as_ref()
                        .map_or_else(String::new, |e| format!(",编码 {e}"))
                );
                (summary, json!(report))
            }
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "mode must be scan/search/file, got '{other}'"
                )));
            }
        };

        Ok(ToolOutput {
            meta: Some(OutputMeta {
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                input_bytes,
                output_bytes: text.len(),
            }),
            text,
            extra: Some(extra),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "folder_analyzer",
    name: "Folder Analyzer",
    category: ToolCategory::Parser,
    icon: "folder-search",
    description: "Read-only analysis of folders/files: type stats, text lines & words, content search",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["folder", "file", "stats", "lines", "words", "grep"],
    version: "1.0.0",
    timeout_secs: Some(120),
    streaming_supported: true,
};

// serde_json::json! 非 const,占位(与 hash_calculator 同款处理)
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(FolderAnalyzer, &METADATA);

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::core::tool::{StreamEvent, StreamingTool};
use crate::register_stream_tool;

/// 流式执行期间由 blocking 线程持续写入的实时计数器,
/// 供 ~300ms 定时器读取并推送 Progress 事件
struct LiveCounters {
    files: AtomicU64,
    dirs: AtomicU64,
}

#[async_trait]
impl StreamingTool for FolderAnalyzer {
    /// 流式执行:scan/search 在 blocking 线程运行,每 ~300ms 推送一次进度;
    /// 取消令牌触发后作业提前收尾,Done 携带 cancelled 部分报告;file 模式不支持流式
    fn execute_stream(
        &self,
        input: ToolInput,
        ctx: &ToolContext,
    ) -> futures::stream::BoxStream<'static, Result<StreamEvent, ToolError>> {
        // 流必须 'static:先把取消令牌从 &ctx 中克隆出来再进入 stream 块
        let cancel_token = ctx.cancel_token.clone();
        Box::pin(async_stream::stream! {
            let start = std::time::Instant::now();
            let Ok(mode) = input.param::<String>("mode") else {
                yield Err(ToolError::InvalidInput("missing param 'mode'".into()));
                return;
            };
            let Ok(root) = input.file_path().map(str::to_string) else {
                yield Err(ToolError::InvalidInput("streaming requires file_path".into()));
                return;
            };
            if !matches!(mode.as_str(), "scan" | "search") {
                yield Err(ToolError::InvalidInput(format!(
                    "streaming supports scan/search only, got '{mode}'"
                )));
                return;
            }

            // root 随后 move 进闭包,input_bytes 先存下供 meta 使用
            let input_bytes = root.len();
            let counters = Arc::new(LiveCounters {
                files: AtomicU64::new(0),
                dirs: AtomicU64::new(0),
            });
            let cancel = cancel_token;
            let counters_cb = Arc::clone(&counters);

            enum Job { Scan(ScanReport), Search(SearchReport) }
            let handle = if mode == "scan" {
                let opts = scan_options_from(&input);
                tokio::task::spawn_blocking(move || {
                    let cb = move |f: u64, d: u64| {
                        counters_cb.files.store(f, Ordering::Relaxed);
                        counters_cb.dirs.store(d, Ordering::Relaxed);
                    };
                    Job::Scan(scan_folder(std::path::Path::new(&root), &opts, Some(&cancel), &cb))
                })
            } else {
                let opts = match search_options_from(&input) {
                    Ok(o) => o,
                    Err(e) => { yield Err(e); return; }
                };
                let matcher = match build_matcher(&opts) {
                    Ok(m) => m,
                    Err(e) => { yield Err(e); return; }
                };
                tokio::task::spawn_blocking(move || {
                    let cb = move |f: u64, _d: u64| {
                        counters_cb.files.store(f, Ordering::Relaxed);
                    };
                    Job::Search(search_folder(
                        std::path::Path::new(&root),
                        &opts,
                        &matcher,
                        Some(&cancel),
                        &cb,
                    ))
                })
            };

            let mut ticker = tokio::time::interval(std::time::Duration::from_millis(300));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut join = std::pin::pin!(handle);

            let job = loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let f = counters.files.load(Ordering::Relaxed);
                        let d = counters.dirs.load(Ordering::Relaxed);
                        yield Ok(StreamEvent::Progress {
                            percent: 0,
                            // 进度文案走英文(开发者向),与 hash/json_formatter 等流式工具一致;
                            // 前端展示原样透传,不做二次翻译
                            message: format!("Scanned {f} files · {d} dirs"),
                            processed: f,
                            total: 0,
                        });
                    }
                    res = &mut join => break res.map_err(|e| ToolError::Internal(format!("join failed: {e}"))),
                }
            };

            let Ok(job) = job else {
                yield Err(ToolError::Internal("blocking task panicked".into()));
                return;
            };
            let meta = OutputMeta {
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                input_bytes,
                output_bytes: 0,
            };
            let output = match job {
                Job::Scan(r) => ToolOutput {
                    text: summarize_scan(&r),
                    extra: Some(json!(r)),
                    meta: Some(meta),
                    alerts: Vec::new(),
                },
                Job::Search(r) => ToolOutput {
                    text: summarize_search(&r),
                    extra: Some(json!(r)),
                    meta: Some(meta),
                    alerts: Vec::new(),
                },
            };
            yield Ok(StreamEvent::Done { output });
        })
    }
}

register_stream_tool!(FolderAnalyzer, &METADATA);

#[cfg(test)]
mod tool_tests {
    use std::collections::HashMap;

    use futures::StreamExt;
    use serde_json::json;

    use crate::core::input::ToolInput;
    use crate::core::registry::ToolRegistry;
    use crate::core::test_utils::mock_context;
    use crate::core::tool::{StreamEvent, StreamingTool};
    use crate::tools::folder_analyzer::FolderAnalyzer;

    fn input(path: &std::path::Path, mode: &str, extra: &[(&str, serde_json::Value)]) -> ToolInput {
        let mut params: HashMap<String, serde_json::Value> = HashMap::new();
        params.insert("mode".to_string(), json!(mode));
        for (k, v) in extra {
            params.insert((*k).to_string(), v.clone());
        }
        ToolInput {
            text: None,
            file_path: Some(path.to_string_lossy().into_owned()),
            params,
        }
    }

    #[test]
    fn test_registered_in_registry() {
        assert!(ToolRegistry::global().get("folder_analyzer").is_some());
    }

    #[tokio::test]
    async fn test_execute_scan_mode() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"hi\n").unwrap();
        let tool = (ToolRegistry::global().get("folder_analyzer").unwrap().ctor)();
        let out = tool
            .execute(input(tmp.path(), "scan", &[]), &mock_context())
            .await
            .unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["total_files"], 1);
        assert_eq!(extra["by_extension"][0]["ext"], "txt");
        assert!(!out.text.is_empty());
    }

    #[tokio::test]
    async fn test_execute_search_mode() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("x.md"), "findme here\n").unwrap();
        let tool = (ToolRegistry::global().get("folder_analyzer").unwrap().ctor)();
        let out = tool
            .execute(
                input(tmp.path(), "search", &[("pattern", json!("findme"))]),
                &mock_context(),
            )
            .await
            .unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["total_matches"], 1);
        assert_eq!(extra["results"][0]["matches"][0]["line_number"], 1);
    }

    #[tokio::test]
    async fn test_execute_file_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("note.md");
        std::fs::write(&f, "hello\n").unwrap();
        let tool = (ToolRegistry::global().get("folder_analyzer").unwrap().ctor)();
        let out = tool
            .execute(input(&f, "file", &[]), &mock_context())
            .await
            .unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["is_text"], true);
        assert_eq!(extra["lines"], 1);
    }

    #[tokio::test]
    async fn test_missing_mode_is_invalid_input() {
        let tool = (ToolRegistry::global().get("folder_analyzer").unwrap().ctor)();
        let err = tool
            .execute(
                ToolInput {
                    file_path: Some("/tmp".into()),
                    ..Default::default()
                },
                &mock_context(),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[tokio::test]
    async fn test_bad_mode_is_invalid_input() {
        let tmp = tempfile::tempdir().unwrap();
        let tool = (ToolRegistry::global().get("folder_analyzer").unwrap().ctor)();
        let err = tool
            .execute(input(tmp.path(), "wat", &[]), &mock_context())
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    async fn collect(
        events: futures::stream::BoxStream<
            'static,
            Result<StreamEvent, crate::core::error::ToolError>,
        >,
    ) -> Vec<StreamEvent> {
        events.map(|r| r.unwrap()).collect::<Vec<_>>().await
    }

    #[tokio::test]
    async fn test_stream_scan_emits_done_with_report() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"hi\n").unwrap();
        let mut evs = collect(
            FolderAnalyzer::new().execute_stream(input(tmp.path(), "scan", &[]), &mock_context()),
        )
        .await;
        let last = evs.pop().unwrap();
        match last {
            StreamEvent::Done { output } => {
                let extra = output.extra.unwrap();
                assert_eq!(extra["total_files"], 1);
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_stream_respects_cancellation_with_partial_done() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..20 {
            std::fs::write(tmp.path().join(format!("{i}.txt")), b"x\n").unwrap();
        }
        let c = mock_context();
        c.cancel_token.cancel();
        let mut evs =
            collect(FolderAnalyzer::new().execute_stream(input(tmp.path(), "scan", &[]), &c)).await;
        let last = evs.pop().unwrap();
        match last {
            StreamEvent::Done { output } => {
                let extra = output.extra.unwrap();
                assert_eq!(extra["cancelled"], true);
                assert_eq!(extra["total_files"], 0);
            }
            other => panic!("expected partial Done, got {other:?}"),
        }
    }

    // 计划中的 collect() 会对 Err 项 unwrap panic,故本用例直接收集 Result
    #[tokio::test]
    async fn test_stream_file_mode_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.md");
        std::fs::write(&f, b"x\n").unwrap();
        let mut evs: Vec<_> = FolderAnalyzer::new()
            .execute_stream(input(&f, "file", &[]), &mock_context())
            .collect::<Vec<_>>()
            .await;
        assert!(matches!(
            evs.pop().unwrap(),
            Err(crate::core::error::ToolError::InvalidInput(_))
        ));
    }

    #[test]
    fn test_progress_event_has_processed_fields() {
        // 编译期断言:构造带 processed/total 的 Progress(字段存在即通过)
        let ev = StreamEvent::Progress {
            percent: 0,
            message: "x".into(),
            processed: 1,
            total: 0,
        };
        assert!(matches!(ev, StreamEvent::Progress { processed: 1, .. }));
    }
}
