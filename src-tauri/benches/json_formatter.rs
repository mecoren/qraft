//! JSON 格式化基准(criterion)
//!
//! - `json_format_small`:小输入,走 `Tool::execute` 全链路(含 spawn_blocking 开销)
//! - `json_format_1mb`:1MB 输入,PRD「10MB JSON <500ms」目标的中间档参照
//!
//! 运行:`cargo bench --bench json_formatter`(结果写入 target/criterion)。
//! 注意:`core::test_utils` 为 `#![cfg(test)]`,bench 不可复用,故在此自建 NoopSink。

use std::sync::Arc;

use criterion::{Criterion, criterion_group, criterion_main};
use tokio_util::sync::CancellationToken;

use qraft_lib::core::context::{HistoryEntry, HistorySink, ToolContext};
use qraft_lib::core::error::ToolError;
use qraft_lib::core::input::ToolInput;
use qraft_lib::core::tool::Tool;
use qraft_lib::tools::json_formatter::JsonFormatter;

struct NoopSink;

#[async_trait::async_trait]
impl HistorySink for NoopSink {
    async fn write(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
        Ok(())
    }
}

fn bench_context() -> ToolContext {
    ToolContext {
        cancel_token: CancellationToken::new(),
        config: serde_json::Value::Object(serde_json::Map::new()),
        history_sink: Arc::new(NoopSink),
    }
}

/// 生成分嵌套对象数组 JSON,体积约等于 `target_bytes`(确定性构造,便于跨次对比)
fn nested_json(target_bytes: usize) -> String {
    let mut out = String::with_capacity(target_bytes + 16);
    out.push_str("{\"items\":[");
    let mut i = 0usize;
    while out.len() < target_bytes {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"id\":{i},\"name\":\"item-{i}\",\"tags\":[\"alpha\",\"beta\"],\"score\":0.{i:03}}}"
        ));
        i += 1;
    }
    out.push_str("]}");
    out
}

fn bench_json_formatter(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("failed to build tokio runtime");
    let ctx = bench_context();
    let tool = JsonFormatter::new();

    let small = ToolInput {
        text: Some(r#"{"a":1,"b":[1,2,3],"c":{"d":"e"}}"#.to_string()),
        ..Default::default()
    };
    let large = ToolInput {
        text: Some(nested_json(1024 * 1024)),
        ..Default::default()
    };

    c.bench_function("json_format_small", |b| {
        b.iter(|| {
            let outcome = rt.block_on(tool.execute(small.clone(), &ctx));
            debug_assert!(outcome.is_ok(), "small json should format ok");
        })
    });

    c.bench_function("json_format_1mb", |b| {
        b.iter(|| {
            let outcome = rt.block_on(tool.execute(large.clone(), &ctx));
            debug_assert!(outcome.is_ok(), "large json should format ok");
        })
    });
}

criterion_group!(benches, bench_json_formatter);
criterion_main!(benches);
