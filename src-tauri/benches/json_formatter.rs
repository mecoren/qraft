//! JSON 格式化基准(criterion)
//!
//! 三组数据,为「前端 / 后端分流阈值」(`src/tools/json-utils.ts` 的
//! `FRONTEND_FORMAT_LIMIT`)提供量化依据,结论记在 `prd/18-known-issues.md`:
//!
//! - `json_format_*`:走 `Tool::execute` 全链路(解析 + 结构统计 + 序列化 +
//!   `spawn_blocking`),即后端路径的真实成本。
//! - `serde_parse_only/*`、`serde_serialize_pretty/*`:`serde_json` 单步成本,
//!   与前端 `JSON.parse` / `JSON.stringify(v, null, 2)` 一一对应,用来判断
//!   「留在前端」到底值多少钱。
//! - 尺寸档 200KB / 1MB / 10MB:200KB 是历史阈值,10MB 是后端硬上限。
//!   前端侧(2MiB / 5MiB 等中间档)用同结构的 Node V8 脚本一次性实测,不入库,
//!   数字连同结论一并记在 `prd/18-known-issues.md`。
//!
//! bench 名保持扁平(`json_format_small` / `json_format_1mb` 从第一版起就在
//! `target/criterion` 根目录,塞进 `benchmark_group` 会挪目录、孤立历史数据);
//! 新增的 serde 单步项才用分组。
//!
//! 运行:`cargo bench --bench json_formatter`。
//! 注意:`core::test_utils` 为 `#![cfg(test)]`,bench 不可复用,故在此自建 `NoopSink`。

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Arc;

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use tokio_util::sync::CancellationToken;

use qraft_lib::core::context::{HistoryEntry, HistorySink, ToolContext};
use qraft_lib::core::error::ToolError;
use qraft_lib::core::input::ToolInput;
use qraft_lib::core::tool::Tool;
use qraft_lib::tools::json_formatter::JsonFormatter;

const KB: usize = 1024;
const MB: usize = 1024 * KB;

/// 三档尺寸:(bench 标签, 目标字节数)。
/// 10MB 档刻意留 64KB 余量 —— 后端 `MAX_INPUT_BYTES` 为 10MiB,
/// 越线会被 `InputTooLarge` 拦掉,量不到解析与序列化。
const SIZES: [(&str, usize); 3] = [
    ("200kb", 200 * KB),
    ("1mb", MB),
    ("10mb", 10 * MB - 64 * KB),
];

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

fn tool_input(text: String, params: &[(&str, serde_json::Value)]) -> ToolInput {
    let mut map = HashMap::new();
    for (key, value) in params {
        map.insert((*key).to_string(), (*value).clone());
    }
    ToolInput {
        text: Some(text),
        file_path: None,
        params: map,
    }
}

// bench 场景下 runtime 构建失败或输入不合法直接 panic 合理,允许 expect;
// criterion 的 BenchmarkGroup 靠 Drop 收尾,提前收紧作用域无意义
#[allow(clippy::expect_used, clippy::significant_drop_tightening)]
fn bench_json_formatter(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("failed to build tokio runtime");
    let ctx = bench_context();
    let tool = JsonFormatter::new();

    // —— 全链路:Tool::execute ——
    // 每轮都要 clone 整个 ToolInput(含 text),这段 memcpy 计入结果;
    // 相对解析/序列化是小头,换来的是「与真实 IPC 载荷同构」的输入。
    let tiny = r#"{"a":1,"b":[1,2,3],"c":{"d":"e"}}"#.to_string();
    c.bench_function("json_format_small", |b| {
        b.iter(|| {
            let input = tool_input(tiny.clone(), &[]);
            let outcome = rt.block_on(tool.execute(black_box(input), &ctx));
            debug_assert!(outcome.is_ok(), "small json should format ok");
        });
    });

    let mut group = c.benchmark_group("json_format_full");
    for (label, size) in SIZES {
        let text = nested_json(size);
        group.bench_function(label, |b| {
            b.iter(|| {
                let input = tool_input(text.clone(), &[]);
                let outcome = rt.block_on(tool.execute(black_box(input), &ctx));
                debug_assert!(outcome.is_ok(), "bench input should format ok");
            });
        });
    }
    group.finish();

    // 原有 bench 名 `json_format_1mb` 留在根目录(与上面的 group 不冲突),
    // 历史数据继续可比对;minify / sort_keys 是 1MB 档的两个变体,
    // 分别对应前端「压缩」和「字典序升序」分流到后端时走的路径。
    let large = nested_json(MB);
    c.bench_function("json_format_1mb", |b| {
        b.iter(|| {
            let input = tool_input(large.clone(), &[]);
            let outcome = rt.block_on(tool.execute(black_box(input), &ctx));
            debug_assert!(outcome.is_ok(), "1mb json should format ok");
        });
    });
    c.bench_function("json_format_1mb_minify", |b| {
        b.iter(|| {
            let input = tool_input(large.clone(), &[("minify", serde_json::Value::Bool(true))]);
            let outcome = rt.block_on(tool.execute(black_box(input), &ctx));
            debug_assert!(outcome.is_ok(), "1mb minify should format ok");
        });
    });
    c.bench_function("json_format_1mb_sort_keys", |b| {
        b.iter(|| {
            let input = tool_input(
                large.clone(),
                &[("sort_keys", serde_json::Value::Bool(true))],
            );
            let outcome = rt.block_on(tool.execute(black_box(input), &ctx));
            debug_assert!(outcome.is_ok(), "1mb sort_keys should format ok");
        });
    });

    // —— serde_json 单步:与前端解析 / 序列化对照 ——
    let mut parse_group = c.benchmark_group("serde_parse_only");
    for (label, size) in SIZES {
        let text = nested_json(size);
        parse_group.bench_function(label, |b| {
            b.iter(|| {
                let value: serde_json::Value =
                    serde_json::from_str(black_box(&text)).expect("bench input is valid JSON");
                black_box(value);
            });
        });
    }
    parse_group.finish();

    let mut pretty_group = c.benchmark_group("serde_serialize_pretty");
    for (label, size) in SIZES {
        let value: serde_json::Value =
            serde_json::from_str(&nested_json(size)).expect("bench input is valid JSON");
        pretty_group.bench_function(label, |b| {
            b.iter(|| {
                let text = serde_json::to_string_pretty(black_box(&value)).expect("serialize");
                black_box(text);
            });
        });
    }
    pretty_group.finish();

    let compact_value: serde_json::Value =
        serde_json::from_str(&large).expect("bench input is valid JSON");
    let mut compact_group = c.benchmark_group("serde_serialize_compact");
    compact_group.bench_function("1mb", |b| {
        b.iter(|| {
            let text = serde_json::to_string(black_box(&compact_value)).expect("serialize");
            black_box(text);
        });
    });
    compact_group.finish();
}

criterion_group!(benches, bench_json_formatter);
criterion_main!(benches);
