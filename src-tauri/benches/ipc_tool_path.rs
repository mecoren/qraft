//! 工具执行 IPC 路径基准(criterion)
//!
//! 覆盖 PRD 18「IPC 性能:1MB 输入 <50ms」口径:从 `tool_execute_inner`
//! (IPC command 入口的内层函数,含授权校验/历史写入/CommandResponse 包络)
//! 到响应 `serde_json` 序列化(模拟 IPC 桥回传编码)的完整路径。
//! 真实 `WebView2` invoke 桥本身的编解码开销不在 cargo 环境可测范围,
//! 该部分由前端侧 `t Execution time` 元数据(工具快照 `meta.executionMs`)
//! 在应用运行时呈现,与此处 Rust 口径互为印证。
//!
//! 场景:
//! - `ipc_execute_small`:1KB 输入(高频轻工具的典型负载)
//! - `ipc_execute_1mb`:1MB JSON 输入(PRD 目标口径)
//!
//! 运行:`cargo bench --bench ipc_tool_path`。
//! 历史落盘指向临时文件(每轮 bench 一次 append,criterion 迭代内
//! 累计条数对耗时的影响已用 `max_history=0` 关闭裁剪重写路径)。

use std::fmt::Write as _;
use std::sync::Arc;

use criterion::{Criterion, criterion_group, criterion_main};
use tokio::runtime::Runtime;

use qraft_lib::commands::tool::tool_execute_inner;
use qraft_lib::core::executor::ToolExecutor;
use qraft_lib::core::input::ToolInput;
use qraft_lib::core::registry::ToolRegistry;
use qraft_lib::shell::state::AppState;
use qraft_lib::store::config::{ConfigStore, JsonConfigStore};
use qraft_lib::store::file_history::FileHistoryStore;
use qraft_lib::store::history::{HistoryStore, JsonlHistoryStore};

/// bench 专用 config:走 `JsonConfigStore` 真实实现(临时文件),
/// `max_history = 0` 关闭历史裁剪(裁剪触发全量重写会污染采样)
fn bench_state(dir: &std::path::Path) -> AppState {
    let config_store: Arc<dyn ConfigStore> =
        Arc::new(JsonConfigStore::new(dir.join("config.json")));
    let history_store: Arc<dyn HistoryStore> = Arc::new(JsonlHistoryStore::new(
        dir.join("history.jsonl"),
        config_store.clone(),
    ));
    AppState::new(
        Arc::new(ToolExecutor::new(ToolRegistry::global())),
        config_store,
        history_store,
        FileHistoryStore::new(dir.join("file-history")),
    )
}

/// 生成分嵌套对象数组 JSON,体积约等于 `target_bytes`(与 `json_formatter` bench 同构,
/// 便于两处口径对照)
fn nested_json(target_bytes: usize) -> String {
    let mut out = String::with_capacity(target_bytes + 16);
    out.push_str("{\"items\":[");
    let mut i = 0usize;
    while out.len() < target_bytes {
        if i > 0 {
            out.push(',');
        }
        // 写入目标仅是构造中的 String,write! 到 String 上不会失败,忽略返回值即可
        let _ = write!(
            out,
            "{{\"id\":{i},\"name\":\"item-{i}\",\"tags\":[\"alpha\",\"beta\"],\"score\":0.{i:03}}}"
        );
        i += 1;
    }
    out.push_str("]}");
    out
}

// bench 场景下 runtime/临时目录构建失败直接 panic 合理,允许 expect
#[allow(clippy::expect_used, clippy::panic)]
fn bench_ipc_tool_path(c: &mut Criterion) {
    let rt = Runtime::new().expect("failed to build tokio runtime");
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let state = bench_state(dir.path());
    let authorized = qraft_lib::commands::fs::AuthorizedPaths::new();

    // 历史条数上限沿用 UserConfig::default()(max_history = 0,不裁剪),
    // bench 迭代内追加不触发裁剪重写,采样稳定
    let small = ToolInput {
        text: Some(r#"{"a":1,"b":[1,2,3],"c":{"d":"e"}}"#.to_string()),
        ..Default::default()
    };
    let large = ToolInput {
        text: Some(nested_json(1024 * 1024)),
        ..Default::default()
    };

    c.bench_function("ipc_execute_small", |b| {
        b.iter(|| {
            let outcome = rt.block_on(tool_execute_inner(
                "json_formatter",
                small.clone(),
                &state,
                &authorized,
            ));
            debug_assert!(outcome.is_ok(), "small execute should ok");
        });
    });

    c.bench_function("ipc_execute_1mb", |b| {
        b.iter(|| {
            // 响应序列化含在内:模拟 IPC 桥回传前的 serde 编码
            let outcome = rt.block_on(tool_execute_inner(
                "json_formatter",
                large.clone(),
                &state,
                &authorized,
            ));
            let resp = outcome.expect("large execute should ok");
            let payload = serde_json::to_string(&resp).expect("response should serialize");
            criterion::black_box(payload);
        });
    });
}

criterion_group!(benches, bench_ipc_tool_path);
criterion_main!(benches);
