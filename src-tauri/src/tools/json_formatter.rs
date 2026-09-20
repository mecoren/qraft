use async_trait::async_trait;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024; // 10MB

/// 缺省缩进空格数;与前端 `normalizeJsonIndent`(src/tools/json-utils.ts)同规则。
const DEFAULT_INDENT: u32 = 2;
/// 缩进上限;对齐设置页表单的 `int().min(0).max(8)`,0 与超限值都回落缺省。
const MAX_INDENT: u32 = 8;

/// 归一化缩进:`params` 由 IPC 直供,不做校验可传入 4e9 让 `" ".repeat` 直接崩内存。
/// 0 也回落——前端 `JSON.stringify(v, null, 0)` 是紧凑单行,与后端 `PrettyFormatter` 的
/// 「换行但零缩进」语义不同,放任会让同一文档在前后端分流两侧输出不一致。
fn normalize_indent(raw: u32) -> usize {
    if raw == 0 || raw > MAX_INDENT {
        DEFAULT_INDENT as usize
    } else {
        usize::try_from(raw).unwrap_or(DEFAULT_INDENT as usize)
    }
}

/// 结构统计的节点访问上限;与前端 `collectJsonStats` 的 `MAX_VISIT_NODES` 同值。
const MAX_STATS_NODES: usize = 2_000_000;
/// 顶层键列表的展示上限;与前端 `MAX_TOP_LEVEL_KEYS` 同值。
const MAX_STATS_TOP_LEVEL_KEYS: usize = 100;

pub struct JsonFormatter;

impl Default for JsonFormatter {
    fn default() -> Self {
        Self::new()
    }
}

impl JsonFormatter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JsonFormatter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(
        &self,
        mut input: ToolInput,
        _ctx: &ToolContext,
    ) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }

        let indent = normalize_indent(input.param::<u32>("indent").unwrap_or(DEFAULT_INDENT));
        let sort_keys: bool = input.param::<bool>("sort_keys").unwrap_or(false);
        // minify:紧凑单行输出(indent 参数被忽略),供超大输入的前端快速操作复用后端
        let minify: bool = input.param::<bool>("minify").unwrap_or(false);

        // 解析 + 序列化是纯 CPU 密集工作,10MB 级输入会占用 tokio worker 数百 ms;
        // 移交 spawn_blocking 执行避免阻塞异步运行时。校验通过后 text 必为 Some,
        // take 出所有权转移进闭包(避免整串克隆)。executor 的超时/取消仍作用于本 future。
        let text_owned = input.text.take().unwrap_or_default();
        let start = Instant::now();
        let mut output = tokio::task::spawn_blocking(move || {
            format_core(&text_owned, indent, sort_keys, minify, input_bytes)
        })
        .await
        .map_err(|e| ToolError::Internal(format!("format worker failed: {e}")))??;
        if let Some(meta) = output.meta.as_mut() {
            // u128 → u64 截断:实际耗时不会超过 u64 范围,允许截断
            #[allow(clippy::cast_possible_truncation)]
            let elapsed = start.elapsed().as_millis() as u64;
            meta.duration_ms = elapsed;
        }
        Ok(output)
    }
}

/// 同步格式化核心:纯 CPU 工作(解析 / 键排序 / 序列化),调用方须经 `spawn_blocking` 执行。
/// `meta.duration_ms` 恒为 0,由异步包装方按真实耗时回填;`output_bytes` 在此如实统计。
/// `minify = true` 时用紧凑序列化(无换行缩进),`indent` 参数被忽略。
/// `indent` 须先经 [`normalize_indent`] 归一(直接来自 IPC 的值不可信)。
/// 结构统计随 `extra.stats` 一并回传:前端拿到输出后不必再解析一遍整篇文本。
fn format_core(
    text: &str,
    indent: usize,
    sort_keys: bool,
    minify: bool,
    input_bytes: usize,
) -> Result<ToolOutput, ToolError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ToolError::ParseFailed(e.to_string()))?;
    let final_value = if sort_keys { sort_value(value) } else { value };
    let stats = collect_stats(&final_value);

    let out_text = if minify {
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::new(&mut buf);
        serde::Serialize::serialize(&final_value, &mut ser)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?
    } else {
        let indent_str = " ".repeat(indent);
        let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes());
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
        serde::Serialize::serialize(&final_value, &mut ser)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?
    };
    let output_bytes = out_text.len();

    Ok(ToolOutput {
        text: out_text,
        extra: Some(serde_json::json!({ "stats": stats })),
        meta: Some(OutputMeta {
            duration_ms: 0,
            input_bytes,
            output_bytes,
        }),
        alerts: Vec::new(),
    })
}

/// 单次遍历收集结构统计,形状与前端 `JsonStats`(src/tools/json-stats.ts)逐字段一致:
/// 深度为树高(根算 1),`leaves` 计标量含 null,空容器不产叶,`topLevelKeys`
/// 仅在根为对象时给出。节点数超 [`MAX_STATS_NODES`] 时停止累计并如实返回已统计部分
/// (统计是展示信息,与前端同口径;该量级已超出 IPC 尺寸上限,实际不可达)。
fn collect_stats(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;

    let mut objects = 0usize;
    let mut arrays = 0usize;
    let mut keys = 0usize;
    let mut leaves = 0usize;
    let mut max_depth = 0usize;
    let mut top_level_keys: Vec<&str> = Vec::new();
    let mut visited = 0usize;

    // 显式栈 [(值, 深度)]:递归会在病态嵌套上爆调用栈,统计不值得为它冒这个风险
    let mut stack: Vec<(&Value, usize)> = vec![(value, 1)];

    while let Some((v, depth)) = stack.pop() {
        if visited >= MAX_STATS_NODES {
            break;
        }
        visited += 1;
        max_depth = max_depth.max(depth);

        match v {
            Value::Array(items) => {
                arrays += 1;
                stack.extend(items.iter().map(|item| (item, depth + 1)));
            }
            Value::Object(map) => {
                objects += 1;
                keys += map.len();
                if depth == 1 && top_level_keys.is_empty() {
                    top_level_keys.extend(
                        map.keys()
                            .take(MAX_STATS_TOP_LEVEL_KEYS)
                            .map(String::as_str),
                    );
                }
                stack.extend(map.values().map(|item| (item, depth + 1)));
            }
            _ => leaves += 1,
        }
    }

    serde_json::json!({
        "objects": objects,
        "arrays": arrays,
        "keys": keys,
        "leaves": leaves,
        "maxDepth": max_depth,
        "topLevelKeys": top_level_keys,
    })
}

/// 递归对 JSON 对象的键做字典序排序,保持数组顺序与基本类型不变。
fn sort_value(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            // 值也要过一遍 sort_value:只对当前层排序会让嵌套对象停在原键序,
            // 与前端递归排序的 sortJsonKeysBy 分叉(同一文档按阈值分流两侧结果不同)
            let mut pairs: Vec<(String, Value)> =
                map.into_iter().map(|(k, v)| (k, sort_value(v))).collect();
            pairs.sort_by(|a, b| a.0.cmp(&b.0));
            let sorted: serde_json::Map<String, Value> = pairs.into_iter().collect();
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_value).collect()),
        other => other,
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "json_formatter",
    name: "JSON Formatter",
    category: ToolCategory::Formatter,
    icon: "braces",
    description: "Format, validate and pretty-print JSON with configurable indent and key sorting",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["json", "format", "validate", "pretty"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

// `input_schema` 需要 JSON 值,而 `serde_json::json!` 展开出的代码不是 const 上下文,
// 无法用于 `static` 初始化;`ToolMetadata.input_schema` 是 `&'static Value`,故此处
// 只能占位为 Null(参数校验在 execute 内按 param 逐项做)。
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(JsonFormatter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    fn make_input_with_params(text: &str, params: HashMap<String, serde_json::Value>) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_format_simple_json_default_indent() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_custom_indent_4() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n    \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_indent_0_falls_back_to_default() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(0));
        let input = make_input_with_params(r#"{"a":1,"b":2}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // indent=0 在前端语义里是紧凑单行,与后端 PrettyFormatter 的「换行零缩进」不同;
        // 归一化为缺省 2,保证同一文档在前后端分流两侧输出一致
        assert_eq!(output.text, "{\n  \"a\": 1,\n  \"b\": 2\n}");
    }

    #[tokio::test]
    async fn test_format_with_oversized_indent_is_clamped() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        // IPC 可送任意 u32:超限不得去 repeat 出 GB 级空格串,而是回落缺省
        params.insert("indent".to_string(), json!(u32::MAX));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_max_allowed_indent() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(8));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n        \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_non_numeric_indent_falls_back() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        // 类型不符(param 反序列化失败)与缺省同结果,不报错
        params.insert("indent".to_string(), json!("2"));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_empty_object() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("{}");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{}");
    }

    #[tokio::test]
    async fn test_format_empty_array() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("[]");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "[]");
    }

    #[tokio::test]
    async fn test_format_minify_param_produces_compact_output() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("minify".to_string(), json!(true));
        let input = make_input_with_params("{\n  \"a\": 1,\n  \"b\": 2\n}", params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // minify:单行紧凑,无换行无缩进(indent 参数被忽略)
        assert_eq!(output.text, r#"{"a":1,"b":2}"#);
    }

    #[tokio::test]
    async fn test_format_preserves_original_key_order_without_sort() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        // 未开启 sort_keys 时必须保持文档原始键序(与前端 JSON.stringify 行为一致),
        // serde_json 开了 preserve_order 特性(Map 为 IndexMap),键序按文档顺序保留
        let input = make_input(r#"{"z":1,"a":2,"m":3}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"z\": 1,\n  \"a\": 2,\n  \"m\": 3\n}");
    }

    #[tokio::test]
    async fn test_format_with_sort_keys_true() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("sort_keys".to_string(), json!(true));
        let input = make_input_with_params(r#"{"b":1,"a":2,"c":3}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // 排序后 a 应在 b 之前
        let a_pos = output.text.find("\"a\"").unwrap();
        let b_pos = output.text.find("\"b\"").unwrap();
        assert!(a_pos < b_pos);
    }

    #[tokio::test]
    async fn test_sort_keys_applies_recursively() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("sort_keys".to_string(), json!(true));
        // 嵌套对象与数组内的对象都必须一起排序:只排根层时输出仍是 z/a 与 y/x 原序
        let input = make_input_with_params(r#"{"b":{"z":1,"a":[{"y":1,"x":2}]}}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(
            output.text,
            "{\n  \"b\": {\n    \"a\": [\n      {\n        \"x\": 2,\n        \"y\": 1\n      }\n    ],\n    \
             \"z\": 1\n  }\n}"
        );
    }

    #[tokio::test]
    async fn test_format_invalid_json_returns_parse_failed() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("{invalid}");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_format_input_too_large() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_format_includes_meta() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        let meta = output.meta.expect("meta should be set");
        assert_eq!(meta.input_bytes, 7);
        assert!(meta.output_bytes > 0);
    }

    /// 从 `extra` 里取出 stats 对象,缺失即 panic(测试内显式失败可接受)
    fn stats_of(output: &ToolOutput) -> serde_json::Value {
        output
            .extra
            .as_ref()
            .and_then(|e| e.get("stats"))
            .cloned()
            .expect("extra.stats should be set")
    }

    #[tokio::test]
    async fn test_extra_stats_counts_containers_keys_and_leaves() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1,"b":[1,2]}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        // 与前端 collectJsonStats 同口径:根对象 depth 1,数组元素 depth 3,树高取最深链
        assert_eq!(
            stats_of(&output),
            json!({
                "objects": 1,
                "arrays": 1,
                "keys": 2,
                "leaves": 3,
                "maxDepth": 3,
                "topLevelKeys": ["a", "b"],
            })
        );
    }

    #[tokio::test]
    async fn test_extra_stats_for_scalar_and_empty_container_roots() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();

        let scalar = tool
            .execute(make_input("42"), &ctx)
            .await
            .expect("scalar json is valid");
        assert_eq!(
            stats_of(&scalar),
            json!({
                "objects": 0,
                "arrays": 0,
                "keys": 0,
                "leaves": 1,
                "maxDepth": 1,
                "topLevelKeys": [],
            })
        );

        let empty = tool
            .execute(make_input("{}"), &ctx)
            .await
            .expect("empty object is valid");
        assert_eq!(
            stats_of(&empty),
            json!({
                "objects": 1,
                "arrays": 0,
                "keys": 0,
                "leaves": 0,
                "maxDepth": 1,
                "topLevelKeys": [],
            })
        );
    }

    #[tokio::test]
    async fn test_extra_stats_reflects_sorted_document() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("sort_keys".to_string(), json!(true));
        let input = make_input_with_params(r#"{"z":1,"a":{"q":2}}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let stats = stats_of(&output);
        assert_eq!(stats["objects"], json!(2));
        assert_eq!(stats["keys"], json!(3));
        assert_eq!(stats["leaves"], json!(2));
        assert_eq!(stats["maxDepth"], json!(3));
        // 顶层键序与展示出来的文档一致(排序后)
        assert_eq!(stats["topLevelKeys"], json!(["a", "z"]));
    }

    #[tokio::test]
    async fn test_extra_stats_caps_top_level_keys() {
        use std::fmt::Write as _;

        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut map = String::from('{');
        for i in 0..120 {
            if i > 0 {
                map.push(',');
            }
            let _ = write!(map, "\"k{i}\":{i}");
        }
        map.push('}');
        let input = make_input(&map);

        let output = tool.execute(input, &ctx).await.unwrap();

        let stats = stats_of(&output);
        assert_eq!(stats["keys"], json!(120));
        assert_eq!(
            stats["topLevelKeys"]
                .as_array()
                .expect("topLevelKeys should be an array")
                .len(),
            100
        );
    }
}
