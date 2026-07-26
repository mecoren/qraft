# 02 - Rust 核心引擎实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Qraft Rust Core 层的完整核心抽象——Tool trait、ToolRegistry、ToolExecutor、错误类型、输入输出、ConfigStore 与 HistoryStore,所有代码不依赖 Tauri,可独立单元测试。

**Architecture:** Core 层通过 `inventory` crate 编译期注册工具,`ToolExecutor` 提供 tokio timeout + catch_unwind + CancellationToken 三重隔离。Core 通过 trait(HistorySink、ConfigStore)接收外部能力,不持有 Tauri 类型引用。

**Tech Stack:** Rust stable (edition 2024) + tokio + serde + thiserror + anyhow + inventory + async_trait + tokio-util (CancellationToken) + futures (BoxStream) + directories + atomicwrites + parking_lot + tracing + tracing-subscriber

**Depends on:** 01-project-bootstrap.md(Rust 工具链、Cargo.toml 已就绪)

---

## 文件结构总览

| 文件 | 职责 |
|------|------|
| `src-tauri/Cargo.toml` | 添加 Core 层所有依赖 |
| `src-tauri/src/core/mod.rs` | 声明 core 子模块并重导出 |
| `src-tauri/src/core/error.rs` | ToolError / EngineError / AppError 错误层级 |
| `src-tauri/src/core/input.rs` | ToolInput 输入抽象 |
| `src-tauri/src/core/output.rs` | ToolOutput / OutputMeta / Alert 输出抽象 |
| `src-tauri/src/core/tool.rs` | Tool / StreamingTool trait + ToolMetadata + StreamEvent |
| `src-tauri/src/core/context.rs` | ToolContext + HistorySink + HistoryEntry |
| `src-tauri/src/core/registry.rs` | ToolRegistry + inventory 注册 + 宏 |
| `src-tauri/src/core/executor.rs` | ToolExecutor(超时 / 取消 / panic 隔离) |
| `src-tauri/src/store/mod.rs` | ProjectDirs 基目录解析 |
| `src-tauri/src/store/config.rs` | ConfigStore trait + JsonConfigStore |
| `src-tauri/src/store/history.rs` | HistoryStore trait + JsonlHistoryStore |
| `src-tauri/src/tools/mod.rs` | 工具聚合模块(本子计划中为空) |
| `src-tauri/src/lib.rs` | 模块声明与重导出 |

---

## Task 0: Cargo.toml 依赖与 panic 策略

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 查看当前 Cargo.toml**

```bash
cat src-tauri/Cargo.toml
```

确认 `[package]` 段中 `edition = "2024"`、`name = "qraft"`。若 edition 不是 2024,修改为 `edition = "2024"`。

- [ ] **Step 2: 添加 Core 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 段追加以下依赖(保留 Tauri 已有依赖不动):

```toml
[dependencies]
# —— 以下为 Core 层新增依赖(Tauri 已有依赖保持不变)——
tokio = { version = "1.40", features = ["rt", "rt-multi-thread", "macros", "time", "fs", "sync"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
anyhow = "1.0"
inventory = "0.3"
async-trait = "0.1"
tokio-util = { version = "0.7", features = ["sync"] }
futures = "0.3"
directories = "5.0"
atomicwrites = "0.4"
parking_lot = "0.12"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
tempfile = "3.10"
```

- [ ] **Step 3: 添加 panic 策略**

在 `src-tauri/Cargo.toml` 末尾追加(catch_unwind 需要 unwind 策略,见 10-error-handling.md §6.3):

```toml
[profile.dev]
panic = "unwind"

[profile.release]
panic = "unwind"
```

- [ ] **Step 4: 验证依赖解析**

```bash
cargo check -p qraft
```

预期:`Finished` 无错误。若有版本冲突,调整版本号至兼容。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build(core): add Core layer dependencies and panic=unwind profile"
```

---

## Task 1: error.rs — 错误类型层级

**Files:**
- Create: `src-tauri/src/lib.rs`(临时声明 core 模块)
- Create: `src-tauri/src/core/mod.rs`
- Create: `src-tauri/src/core/error.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/error.rs`,只写入测试模块(实现尚未写,编译应失败):

```rust
use serde_json::json;
use std::time::Duration;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_input_code() {
        let err = ToolError::InvalidInput("missing field".into());
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_invalid_input_display() {
        let err = ToolError::InvalidInput("missing field".into());
        assert!(err.to_string().contains("missing field"));
    }

    #[test]
    fn test_parse_failed_code() {
        let err = ToolError::ParseFailed("unexpected token".into());
        assert_eq!(err.code(), "ERR_PARSE_FAILED");
        assert!(err.to_string().contains("unexpected token"));
    }

    #[test]
    fn test_timeout_code_and_display() {
        let err = ToolError::Timeout(Duration::from_secs(5));
        assert_eq!(err.code(), "ERR_TIMEOUT");
        assert!(err.to_string().contains("5s"));
    }

    #[test]
    fn test_cancelled_serde() {
        let err = ToolError::Cancelled;
        assert_eq!(err.code(), "ERR_CANCELLED");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "cancelled"}));
    }

    #[test]
    fn test_tool_not_found_serde() {
        let err = ToolError::ToolNotFound("xxx".into());
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "tool_not_found", "detail": "xxx"}));
    }

    #[test]
    fn test_input_too_large_serde() {
        let err = ToolError::InputTooLarge { size: 100, max: 50 };
        assert_eq!(err.code(), "ERR_INPUT_TOO_LARGE");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "input_too_large", "detail": {"size": 100, "max": 50}}));
    }

    #[test]
    fn test_out_of_memory_code() {
        let err = ToolError::OutOfMemory { size: 1024, max: 512 };
        assert_eq!(err.code(), "ERR_OUT_OF_MEMORY");
    }

    #[test]
    fn test_internal_code_and_serde() {
        let err = ToolError::Internal("boom".into());
        assert_eq!(err.code(), "ERR_INTERNAL");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "internal", "detail": "boom"}));
    }

    #[test]
    fn test_engine_error_from_tool_error() {
        let tool_err = ToolError::InvalidInput("bad".into());
        let engine_err: EngineError = tool_err.into();
        assert!(matches!(engine_err, EngineError::Tool(ToolError::InvalidInput(_))));
    }

    #[test]
    fn test_engine_error_tool_not_found() {
        let err = EngineError::ToolNotFound("missing".into());
        assert!(err.to_string().contains("missing"));
    }

    #[test]
    fn test_app_error_tool_variant() {
        let tool_err = ToolError::InvalidInput("bad".into());
        let app_err = AppError::Tool(tool_err);
        assert_eq!(app_err.code(), "ERR_INVALID_INPUT");
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

先创建临时 `src-tauri/src/lib.rs`:

```rust
pub mod core;
```

再创建 `src-tauri/src/core/mod.rs`:

```rust
pub mod error;
```

运行:

```bash
cargo test -p qraft core::error -- --nocapture
```

预期:编译失败,`cannot find type ToolError in this scope`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/error.rs` 测试模块之上插入实现代码:

```rust
use std::time::Duration;
use serde::Serialize;
use thiserror::Error;

/// 工具执行错误
///
/// 所有工具的 execute 方法只返回 ToolError,不返回 anyhow::Error。
/// 前端可以根据错误码做精准的 UI 反馈。
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum ToolError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("parse failed: {0}")]
    ParseFailed(String),

    #[error("timeout after {0:?}")]
    Timeout(Duration),

    #[error("cancelled by user")]
    Cancelled,

    #[error("input too large: {size} bytes, max {max} bytes")]
    InputTooLarge { size: usize, max: usize },

    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("out of memory: {size} bytes, max {max} bytes")]
    OutOfMemory { size: usize, max: usize },

    #[error("internal error: {0}")]
    Internal(String),
}

impl ToolError {
    /// 错误码,用于前端国际化与精准提示
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput(_) => "ERR_INVALID_INPUT",
            Self::ParseFailed(_) => "ERR_PARSE_FAILED",
            Self::Timeout(_) => "ERR_TIMEOUT",
            Self::Cancelled => "ERR_CANCELLED",
            Self::InputTooLarge { .. } => "ERR_INPUT_TOO_LARGE",
            Self::ToolNotFound(_) => "ERR_TOOL_NOT_FOUND",
            Self::OutOfMemory { .. } => "ERR_OUT_OF_MEMORY",
            Self::Internal(_) => "ERR_INTERNAL",
        }
    }

    /// 是否可重试
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Timeout(_) | Self::Internal(_))
    }
}

/// 引擎层错误(注册、调度)
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("registry error: {0}")]
    RegistryError(String),

    #[error("executor error: {0}")]
    ExecutorError(String),

    #[error(transparent)]
    Tool(#[from] ToolError),
}

/// 应用层顶层错误
///
/// Shell 层错误变体(Forbidden 等)留待 03-tauri-shell-layer.md 扩展。
#[derive(Debug, Error, Serialize)]
#[serde(tag = "domain", content = "detail", rename_all = "snake_case")]
pub enum AppError {
    #[error(transparent)]
    Tool(ToolError),

    #[error(transparent)]
    Engine(#[from] EngineError),

    #[error("permission denied: {0}")]
    Permission(String),

    #[error("unknown error: {0}")]
    Unknown(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Tool(e) => e.code(),
            Self::Engine(EngineError::Tool(_)) => "ERR_TOOL",
            Self::Engine(EngineError::RegistryError(_)) => "ERR_REGISTRY",
            Self::Engine(EngineError::ExecutorError(_)) => "ERR_EXECUTOR",
            Self::Permission(_) => "ERR_PERMISSION_DENIED",
            Self::Unknown(_) => "ERR_INTERNAL",
        }
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::error -- --nocapture
```

预期:`test result: ok. 12 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/lib.rs src-tauri/src/core/mod.rs src-tauri/src/core/error.rs
git commit -m "feat(core): add ToolError/EngineError/AppError with serde-tagged variants"
```

---

## Task 2: input.rs — ToolInput

**Files:**
- Create: `src-tauri/src/core/input.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/input.rs`,只写测试模块:

```rust
use std::collections::HashMap;
use serde_json::{json, Value};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_input() {
        let input = ToolInput::default();
        assert!(input.text.is_none());
        assert!(input.file_path.is_none());
        assert!(input.params.is_empty());
    }

    #[test]
    fn test_text_ok() {
        let input = ToolInput { text: Some("hello".into()), ..Default::default() };
        assert_eq!(input.text().unwrap(), "hello");
    }

    #[test]
    fn test_text_err_when_missing() {
        let input = ToolInput::default();
        let err = input.text().unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_file_path_ok() {
        let input = ToolInput { file_path: Some("/tmp/x.txt".into()), ..Default::default() };
        assert_eq!(input.file_path().unwrap(), "/tmp/x.txt");
    }

    #[test]
    fn test_file_path_err_when_missing() {
        let input = ToolInput::default();
        let err = input.file_path().unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_param_ok() {
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        let input = ToolInput { params, ..Default::default() };
        let indent: u32 = input.param("indent").unwrap();
        assert_eq!(indent, 4);
    }

    #[test]
    fn test_param_missing() {
        let input = ToolInput::default();
        let err = input.param::<u32>("indent").unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
        assert!(err.to_string().contains("indent"));
    }

    #[test]
    fn test_param_wrong_type() {
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!("not_a_number"));
        let input = ToolInput { params, ..Default::default() };
        let err = input.param::<u32>("indent").unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_serde_roundtrip() {
        let mut params = HashMap::new();
        params.insert("flag".to_string(), json!(true));
        let input = ToolInput {
            text: Some("hello".into()),
            file_path: None,
            params,
        };
        let json_str = serde_json::to_string(&input).unwrap();
        let decoded: ToolInput = serde_json::from_str(&json_str).unwrap();
        assert_eq!(decoded.text().unwrap(), "hello");
        assert!(decoded.param::<bool>("flag").unwrap());
    }

    #[test]
    fn test_skip_serializing_if() {
        let input = ToolInput::default();
        let v = serde_json::to_value(&input).unwrap();
        assert!(v.get("text").is_none());
        assert!(v.get("file_path").is_none());
        assert!(v.get("params").is_none());
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod error;
pub mod input;
```

运行:

```bash
cargo test -p qraft core::input -- --nocapture
```

预期:编译失败,`cannot find type ToolInput in this scope`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/input.rs` 测试模块之上插入实现:

```rust
use std::collections::HashMap;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::core::error::ToolError;

/// 工具执行的输入
///
/// - text 是主输入(用户粘贴/输入的文本)
/// - params 是工具特定参数(如 Base64 的 url_safe 开关)
/// - file_path 用于文件类工具,与 text 二选一
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,

    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, Value>,
}

impl ToolInput {
    pub fn text(&self) -> Result<&str, ToolError> {
        self.text.as_deref()
            .ok_or(ToolError::InvalidInput("missing 'text' field".into()))
    }

    pub fn file_path(&self) -> Result<&str, ToolError> {
        self.file_path.as_deref()
            .ok_or(ToolError::InvalidInput("missing 'file_path' field".into()))
    }

    pub fn param<T: DeserializeOwned>(&self, key: &str) -> Result<T, ToolError> {
        let v = self.params.get(key)
            .ok_or_else(|| ToolError::InvalidInput(format!("missing param '{}'", key)))?;
        serde_json::from_value(v.clone())
            .map_err(|e| ToolError::InvalidInput(format!("invalid param '{}': {}", key, e)))
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::input -- --nocapture
```

预期:`test result: ok. 10 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/input.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): add ToolInput with text/file_path/params accessors"
```

---

## Task 3: output.rs — ToolOutput

**Files:**
- Create: `src-tauri/src/core/output.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/output.rs`,只写测试模块:

```rust
use serde_json::{json, Value};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_output() {
        let out = ToolOutput::default();
        assert_eq!(out.text, "");
        assert!(out.extra.is_none());
        assert!(out.meta.is_none());
        assert!(out.alerts.is_empty());
    }

    #[test]
    fn test_serde_skip_none_fields() {
        let out = ToolOutput { text: "hi".into(), ..Default::default() };
        let v = serde_json::to_value(&out).unwrap();
        assert_eq!(v["text"], "hi");
        assert!(v.get("extra").is_none());
        assert!(v.get("meta").is_none());
        assert!(v.get("alerts").is_none());
    }

    #[test]
    fn test_alert_level_info_serde() {
        let alert = Alert { level: AlertLevel::Info, message: "ok".into() };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v, json!({"level": "info", "message": "ok"}));
    }

    #[test]
    fn test_alert_level_warning_serde() {
        let alert = Alert { level: AlertLevel::Warning, message: "careful".into() };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v["level"], "warning");
    }

    #[test]
    fn test_alert_level_error_serde() {
        let alert = Alert { level: AlertLevel::Error, message: "bad".into() };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v["level"], "error");
    }

    #[test]
    fn test_output_meta_serde() {
        let meta = OutputMeta { duration_ms: 42, input_bytes: 100, output_bytes: 200 };
        let v = serde_json::to_value(&meta).unwrap();
        assert_eq!(v, json!({"duration_ms": 42, "input_bytes": 100, "output_bytes": 200}));
    }

    #[test]
    fn test_full_output_serde() {
        let out = ToolOutput {
            text: "result".into(),
            extra: Some(json!({"count": 3})),
            meta: Some(OutputMeta { duration_ms: 5, input_bytes: 10, output_bytes: 20 }),
            alerts: vec![Alert { level: AlertLevel::Warning, message: "trimmed".into() }],
        };
        let v = serde_json::to_value(&out).unwrap();
        assert_eq!(v["text"], "result");
        assert_eq!(v["extra"]["count"], 3);
        assert_eq!(v["meta"]["duration_ms"], 5);
        assert_eq!(v["alerts"][0]["level"], "warning");
    }

    #[test]
    fn test_alerts_not_serialized_when_empty() {
        let out = ToolOutput { text: "x".into(), alerts: vec![], ..Default::default() };
        let v = serde_json::to_value(&out).unwrap();
        assert!(v.get("alerts").is_none());
    }

    #[test]
    fn test_serde_roundtrip() {
        let out = ToolOutput {
            text: "hello".into(),
            extra: Some(json!({"k": "v"})),
            meta: None,
            alerts: vec![Alert { level: AlertLevel::Info, message: "done".into() }],
        };
        let s = serde_json::to_string(&out).unwrap();
        let decoded: ToolOutput = serde_json::from_str(&s).unwrap();
        assert_eq!(decoded.text, "hello");
        assert_eq!(decoded.alerts.len(), 1);
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod error;
pub mod input;
pub mod output;
```

运行:

```bash
cargo test -p qraft core::output -- --nocapture
```

预期:编译失败,`cannot find type ToolOutput in this scope`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/output.rs` 测试模块之上插入实现:

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 工具执行的输出
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolOutput {
    pub text: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<OutputMeta>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputMeta {
    pub duration_ms: u64,
    pub input_bytes: usize,
    pub output_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub level: AlertLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertLevel {
    Info,
    Warning,
    Error,
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::output -- --nocapture
```

预期:`test result: ok. 9 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/output.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): add ToolOutput with OutputMeta and Alert types"
```

---

## Task 4: tool.rs — Tool trait + ToolMetadata + ToolCategory + StreamingTool + StreamEvent

**Files:**
- Create: `src-tauri/src/core/tool.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/tool.rs`,只写测试模块:

```rust
use serde_json::json;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_category_formatter_serde() {
        let v = serde_json::to_value(ToolCategory::Formatter).unwrap();
        assert_eq!(v, "formatter");
    }

    #[test]
    fn test_category_encoder_serde() {
        let v = serde_json::to_value(ToolCategory::Encoder).unwrap();
        assert_eq!(v, "encoder");
    }

    #[test]
    fn test_category_generator_serde() {
        let v = serde_json::to_value(ToolCategory::Generator).unwrap();
        assert_eq!(v, "generator");
    }

    #[test]
    fn test_category_parser_serde() {
        let v = serde_json::to_value(ToolCategory::Parser).unwrap();
        assert_eq!(v, "parser");
    }

    #[test]
    fn test_category_converter_serde() {
        let v = serde_json::to_value(ToolCategory::Converter).unwrap();
        assert_eq!(v, "converter");
    }

    #[test]
    fn test_category_comparator_serde() {
        let v = serde_json::to_value(ToolCategory::Comparator).unwrap();
        assert_eq!(v, "comparator");
    }

    #[test]
    fn test_metadata_static_construction() {
        static SCHEMA: serde_json::Value = serde_json::Value::Null;
        static META: ToolMetadata = ToolMetadata {
            id: "test_tool",
            name: "Test Tool",
            category: ToolCategory::Formatter,
            icon: "circle",
            description: "test",
            input_schema: &SCHEMA,
            output_schema: None,
            tags: &["test"],
            version: "0.1.0",
            timeout_secs: Some(5),
            streaming_supported: false,
        };
        assert_eq!(META.id, "test_tool");
        assert_eq!(META.timeout_secs, Some(5));
        assert!(!META.streaming_supported);
    }

    #[test]
    fn test_stream_event_progress_serde() {
        let ev = StreamEvent::Progress { percent: 50, message: "half done".into() };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "progress");
        assert_eq!(v["percent"], 50);
        assert_eq!(v["message"], "half done");
    }

    #[test]
    fn test_stream_event_chunk_serde() {
        let ev = StreamEvent::Chunk { text: "partial".into() };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "chunk");
        assert_eq!(v["text"], "partial");
    }

    #[test]
    fn test_stream_event_done_serde() {
        let ev = StreamEvent::Done { output: ToolOutput { text: "final".into(), ..Default::default() } };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "done");
        assert_eq!(v["output"]["text"], "final");
    }

    #[test]
    fn test_stream_event_error_serde() {
        let ev = StreamEvent::Error { error: ToolError::Internal("oops".into()) };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["error"]["kind"], "internal");
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod error;
pub mod input;
pub mod output;
pub mod tool;
```

运行:

```bash
cargo test -p qraft core::tool -- --nocapture
```

预期:编译失败,`cannot find type ToolCategory in this scope`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/tool.rs` 测试模块之上插入实现:

```rust
use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;

/// 所有工具必须实现的核心 trait
///
/// 实现要点:
/// 1. metadata() 返回静态描述,在编译期通过 inventory 注册
/// 2. execute() 是纯函数式:相同输入 + 相同 context 配置 → 相同输出
/// 3. 禁止在 execute 中调用 Tauri API,所有外部能力通过 ToolContext 注入
#[async_trait]
pub trait Tool: Send + Sync {
    fn metadata(&self) -> &'static ToolMetadata;

    async fn execute(&self, input: ToolInput, ctx: &ToolContext) -> Result<ToolOutput, ToolError>;
}

/// 工具的静态元数据
#[derive(Debug, Clone, Serialize)]
pub struct ToolMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub category: ToolCategory,
    pub icon: &'static str,
    pub description: &'static str,
    pub input_schema: &'static serde_json::Value,
    pub output_schema: Option<&'static serde_json::Value>,
    pub tags: &'static [&'static str],
    pub version: &'static str,
    pub timeout_secs: Option<u32>,
    pub streaming_supported: bool,
}

/// 工具分类
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    Formatter,
    Encoder,
    Generator,
    Parser,
    Converter,
    Comparator,
}

/// 流式工具 trait(可选)
///
/// 仅当 ToolMetadata.streaming_supported == true 时实现。
/// execute_stream 返回异步流,每个 Item 是一个流式事件。
#[async_trait]
pub trait StreamingTool: Send + Sync {
    fn execute_stream(
        &self,
        input: ToolInput,
        ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>>;
}

/// 流式事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    Progress { percent: u8, message: String },
    Chunk { text: String },
    Done { output: ToolOutput },
    Error { error: ToolError },
}
```

注意:`tool.rs` 引用了 `crate::core::context::ToolContext`,该模块在 Task 5 才实现。为了让 Task 4 的测试独立编译通过,需先创建一个临时的 `src-tauri/src/core/context.rs` 占位文件:

```rust
// 占位:Task 5 将填充完整实现
pub struct ToolContext;
```

并更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod context;
pub mod error;
pub mod input;
pub mod output;
pub mod tool;
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::tool -- --nocapture
```

预期:`test result: ok. 12 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/tool.rs src-tauri/src/core/context.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): add Tool/StreamingTool traits, ToolMetadata, StreamEvent"
```

---

## Task 5: context.rs — ToolContext + HistorySink + HistoryEntry

**Files:**
- Modify: `src-tauri/src/core/context.rs`(替换 Task 4 的占位)

- [ ] **Step 1: 写失败测试**

将 `src-tauri/src/core/context.rs` 内容替换为以下测试模块(覆盖占位实现):

```rust
use std::sync::Arc;
use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::core::error::ToolError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_context_construction() {
        let ctx = ToolContext {
            cancel_token: CancellationToken::new(),
            config: Value::Null,
            history_sink: Arc::new(MockHistorySink::new()),
        };
        assert!(!ctx.is_cancelled());
    }

    #[test]
    fn test_cancel_token_trigger() {
        let token = CancellationToken::new();
        let ctx = ToolContext {
            cancel_token: token.clone(),
            config: Value::Null,
            history_sink: Arc::new(MockHistorySink::new()),
        };
        assert!(!ctx.is_cancelled());
        token.cancel();
        assert!(ctx.is_cancelled());
    }

    #[tokio::test]
    async fn test_history_sink_mock_write() {
        let sink = MockHistorySink::new();
        let entry = HistoryEntry {
            tool_id: "test".into(),
            input_summary: "in".into(),
            output_summary: "out".into(),
            timestamp: 1000,
            duration_ms: 42,
        };
        HistorySink::write(sink.as_ref(), entry).await.unwrap();
        let entries = sink.entries.lock().clone();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tool_id, "test");
    }

    #[test]
    fn test_history_entry_serde() {
        let entry = HistoryEntry {
            tool_id: "json_formatter".into(),
            input_summary: "{\"a\":1}".into(),
            output_summary: "{\n  \"a\": 1\n}".into(),
            timestamp: 1721900000000,
            duration_ms: 5,
        };
        let v = serde_json::to_value(&entry).unwrap();
        assert_eq!(v["tool_id"], "json_formatter");
        assert_eq!(v["timestamp"], 1721900000000);
        assert_eq!(v["duration_ms"], 5);
    }

    #[test]
    fn test_history_entry_default() {
        let entry = HistoryEntry::default();
        assert_eq!(entry.tool_id, "");
        assert_eq!(entry.duration_ms, 0);
    }

    #[tokio::test]
    async fn test_history_sink_error_propagation() {
        let sink = FailingSink;
        let entry = HistoryEntry::default();
        let result = HistorySink::write(&sink, entry).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_INTERNAL");
    }

    #[tokio::test]
    async fn test_cancelled_future_completes() {
        let token = CancellationToken::new();
        token.cancel();
        // cancelled() future should complete immediately
        token.cancelled().await;
    }

    #[derive(Debug)]
    struct MockHistorySink {
        entries: Mutex<Vec<HistoryEntry>>,
    }

    impl MockHistorySink {
        fn new() -> Self {
            Self { entries: Mutex::new(Vec::new()) }
        }
    }

    #[async_trait]
    impl HistorySink for MockHistorySink {
        async fn write(&self, entry: HistoryEntry) -> Result<(), ToolError> {
            self.entries.lock().push(entry);
            Ok(())
        }
    }

    struct FailingSink;

    #[async_trait]
    impl HistorySink for FailingSink {
        async fn write(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
            Err(ToolError::Internal("sink failed".into()))
        }
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cargo test -p qraft core::context -- --nocapture
```

预期:编译失败,`cannot find type ToolContext` 或字段不匹配(因为占位只有 `pub struct ToolContext;`)

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/context.rs` 测试模块之上插入实现(替换占位):

```rust
use std::sync::Arc;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::core::error::ToolError;

/// 工具执行时注入的运行时环境
pub struct ToolContext {
    pub cancel_token: CancellationToken,
    pub config: Value,
    pub history_sink: Arc<dyn HistorySink>,
}

impl ToolContext {
    pub fn is_cancelled(&self) -> bool {
        self.cancel_token.is_cancelled()
    }
}

/// 历史记录写入接口(由 Shell 层注入具体实现,Core 不依赖具体存储)
#[async_trait]
pub trait HistorySink: Send + Sync {
    async fn write(&self, entry: HistoryEntry) -> Result<(), ToolError>;
}

/// 历史记录单条
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub tool_id: String,
    pub input_summary: String,
    pub output_summary: String,
    pub timestamp: u64,
    pub duration_ms: u64,
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::context -- --nocapture
```

预期:`test result: ok. 7 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/context.rs
git commit -m "feat(core): add ToolContext, HistorySink trait, HistoryEntry"
```

---

## Task 6: registry.rs — ToolRegistry + inventory 注册

**Files:**
- Create: `src-tauri/src/core/registry.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/registry.rs`,只写测试模块:

```rust
use async_trait::async_trait;
use serde_json::Value;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

#[cfg(test)]
mod tests {
    use super::*;

    const DUMMY_SCHEMA: Value = Value::Null;

    static DUMMY_METADATA: ToolMetadata = ToolMetadata {
        id: "dummy_test_tool",
        name: "Dummy Test Tool",
        category: ToolCategory::Formatter,
        icon: "circle",
        description: "dummy for registry test",
        input_schema: &DUMMY_SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    struct DummyTool;

    impl DummyTool {
        fn new() -> Self { Self }
    }

    #[async_trait]
    impl Tool for DummyTool {
        fn metadata(&self) -> &'static ToolMetadata { &DUMMY_METADATA }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            Ok(ToolOutput::default())
        }
    }

    register_tool!(DummyTool, &DUMMY_METADATA);

    #[test]
    fn test_global_registry_singleton() {
        let r1 = ToolRegistry::global();
        let r2 = ToolRegistry::global();
        // 同一静态地址
        assert!(std::ptr::eq(r1, r2));
    }

    #[test]
    fn test_get_found() {
        let registry = ToolRegistry::global();
        let entry = registry.get("dummy_test_tool");
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().metadata.id, "dummy_test_tool");
    }

    #[test]
    fn test_get_not_found() {
        let registry = ToolRegistry::global();
        assert!(registry.get("nonexistent_tool_xyz").is_none());
    }

    #[test]
    fn test_list_contains_dummy() {
        let registry = ToolRegistry::global();
        let list = registry.list();
        assert!(list.iter().any(|m| m.id == "dummy_test_tool"));
    }

    #[test]
    fn test_tool_id_unique() {
        let registry = ToolRegistry::global();
        let list = registry.list();
        let mut ids: Vec<_> = list.iter().map(|m| m.id).collect();
        let original_len = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), original_len, "duplicate tool ids detected");
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod context;
pub mod error;
pub mod input;
pub mod output;
pub mod registry;
pub mod tool;
```

运行:

```bash
cargo test -p qraft core::registry -- --nocapture
```

预期:编译失败,`cannot find type ToolRegistry` / `cannot find macro register_tool`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/registry.rs` 测试模块之上插入实现:

```rust
use std::collections::HashMap;
use std::sync::OnceLock;

use inventory;

use crate::core::tool::{Tool, ToolMetadata, StreamingTool};

/// 工具注册条目(inventory 收集单元)
pub struct ToolEntry {
    pub tool: Box<dyn Tool>,
    pub metadata: &'static ToolMetadata,
}

inventory::collect!(ToolEntry);

/// 全局工具注册表
pub struct ToolRegistry {
    by_id: HashMap<&'static str, &'static ToolEntry>,
}

impl ToolRegistry {
    /// 初始化全局注册表(应用启动时调用一次)
    pub fn global() -> &'static ToolRegistry {
        static REGISTRY: OnceLock<ToolRegistry> = OnceLock::new();
        REGISTRY.get_or_init(|| {
            let mut by_id = HashMap::new();
            for entry in inventory::iter::<ToolEntry> {
                if by_id.insert(entry.metadata.id, entry).is_some() {
                    panic!("duplicate tool id: {}", entry.metadata.id);
                }
            }
            ToolRegistry { by_id }
        })
    }

    /// 按 id 查找工具
    pub fn get(&self, id: &str) -> Option<&'static ToolEntry> {
        self.by_id.get(id).copied()
    }

    /// 列出所有工具元数据
    pub fn list(&self) -> Vec<&'static ToolMetadata> {
        self.by_id.values().map(|e| e.metadata).collect()
    }
}

/// 流式工具注册条目
pub struct StreamingEntry {
    pub id: &'static str,
    pub tool: Box<dyn StreamingTool>,
}

inventory::collect!(StreamingEntry);

/// 工具自注册宏
#[macro_export]
macro_rules! register_tool {
    ($tool_ty:ty, $metadata:expr) => {
        inventory::submit! {
            $crate::core::registry::ToolEntry {
                tool: Box::new(<$tool_ty>::new()),
                metadata: $metadata,
            }
        }
    };
}

/// 流式工具自注册宏
#[macro_export]
macro_rules! register_stream_tool {
    ($tool_ty:ty, $metadata:expr) => {
        inventory::submit! {
            $crate::core::registry::StreamingEntry {
                id: $metadata.id,
                tool: Box::new(<$tool_ty>::new()),
            }
        }
    };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::registry -- --nocapture
```

预期:`test result: ok. 5 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/registry.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): add ToolRegistry with inventory-based compile-time registration"
```

---

## Task 7: executor.rs — ToolExecutor

**Files:**
- Create: `src-tauri/src/core/executor.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/core/executor.rs`,只写测试模块:

```rust
use std::sync::Arc;
use std::time::Duration;
use async_trait::async_trait;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::core::context::{HistoryEntry, HistorySink, ToolContext};
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::registry::ToolRegistry;
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: Value = Value::Null;

    static NORMAL_META: ToolMetadata = ToolMetadata {
        id: "exec_normal_tool",
        name: "Normal",
        category: ToolCategory::Formatter,
        icon: "circle",
        description: "normal test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    static SLOW_META: ToolMetadata = ToolMetadata {
        id: "exec_slow_tool",
        name: "Slow",
        category: ToolCategory::Formatter,
        icon: "clock",
        description: "slow test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(1),
        streaming_supported: false,
    };

    static PANIC_META: ToolMetadata = ToolMetadata {
        id: "exec_panic_tool",
        name: "Panic",
        category: ToolCategory::Formatter,
        icon: "alert",
        description: "panicking test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    struct NormalTool;
    impl NormalTool { fn new() -> Self { Self } }
    #[async_trait]
    impl Tool for NormalTool {
        fn metadata(&self) -> &'static ToolMetadata { &NORMAL_META }
        async fn execute(&self, input: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            let text = input.text()?;
            Ok(ToolOutput { text: text.to_string(), ..Default::default() })
        }
    }
    register_tool!(NormalTool, &NORMAL_META);

    struct SlowTool;
    impl SlowTool { fn new() -> Self { Self } }
    #[async_trait]
    impl Tool for SlowTool {
        fn metadata(&self) -> &'static ToolMetadata { &SLOW_META }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok(ToolOutput::default())
        }
    }
    register_tool!(SlowTool, &SLOW_META);

    struct PanicTool;
    impl PanicTool { fn new() -> Self { Self } }
    #[async_trait]
    impl Tool for PanicTool {
        fn metadata(&self) -> &'static ToolMetadata { &PANIC_META }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            panic!("intentional test panic");
        }
    }
    register_tool!(PanicTool, &PANIC_META);

    fn make_ctx() -> ToolContext {
        ToolContext {
            cancel_token: CancellationToken::new(),
            config: Value::Null,
            history_sink: Arc::new(NoopSink),
        }
    }

    fn make_ctx_with_cancel(cancel: CancellationToken) -> ToolContext {
        ToolContext {
            cancel_token: cancel,
            config: Value::Null,
            history_sink: Arc::new(NoopSink),
        }
    }

    struct NoopSink;
    #[async_trait]
    impl HistorySink for NoopSink {
        async fn write(&self, _: HistoryEntry) -> Result<(), ToolError> { Ok(()) }
    }

    #[tokio::test]
    async fn test_execute_success() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let input = ToolInput { text: Some("hello".into()), ..Default::default() };
        let result = executor.execute("exec_normal_tool", input, make_ctx()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().text, "hello");
    }

    #[tokio::test]
    async fn test_execute_tool_not_found() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor.execute("nonexistent_xyz", ToolInput::default(), make_ctx()).await;
        assert!(matches!(result, Err(ToolError::ToolNotFound(_))));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor.execute("exec_slow_tool", ToolInput::default(), make_ctx()).await;
        assert!(matches!(result, Err(ToolError::Timeout(_))));
    }

    #[tokio::test]
    async fn test_execute_cancelled() {
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancel_clone.cancel();
        });
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor.execute("exec_slow_tool", ToolInput::default(), make_ctx_with_cancel(cancel)).await;
        assert!(matches!(result, Err(ToolError::Cancelled)));
    }

    #[tokio::test]
    async fn test_execute_panic_isolation() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor.execute("exec_panic_tool", ToolInput::default(), make_ctx()).await;
        match result {
            Err(ToolError::Internal(msg)) => {
                assert!(msg.contains("tool panicked"));
                assert!(msg.contains("intentional test panic"));
            }
            other => panic!("expected ToolError::Internal, got {:?}", other),
        }
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/core/mod.rs`:

```rust
pub mod context;
pub mod error;
pub mod executor;
pub mod input;
pub mod output;
pub mod registry;
pub mod tool;
```

运行:

```bash
cargo test -p qraft core::executor -- --nocapture
```

预期:编译失败,`cannot find type ToolExecutor`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/core/executor.rs` 测试模块之上插入实现:

```rust
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use futures::FutureExt;
use tokio::time::timeout;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::registry::ToolRegistry;
use crate::core::tool::Tool;

pub struct ToolExecutor {
    registry: &'static ToolRegistry,
    default_timeout: Duration,
}

impl ToolExecutor {
    pub fn new(registry: &'static ToolRegistry) -> Self {
        Self {
            registry,
            default_timeout: Duration::from_secs(5),
        }
    }

    pub async fn execute(
        &self,
        tool_id: &str,
        input: ToolInput,
        ctx: ToolContext,
    ) -> Result<ToolOutput, ToolError> {
        let entry = self.registry.get(tool_id)
            .ok_or_else(|| ToolError::ToolNotFound(tool_id.to_string()))?;

        let tool = entry.tool.as_ref();
        let meta = tool.metadata();
        let timeout_dur = meta.timeout_secs
            .map(Duration::from_secs)
            .unwrap_or(self.default_timeout);

        self.execute_with_isolation(tool, input, ctx, timeout_dur).await
    }

    async fn execute_with_isolation(
        &self,
        tool: &dyn Tool,
        input: ToolInput,
        ctx: ToolContext,
        timeout_dur: Duration,
    ) -> Result<ToolOutput, ToolError> {
        let cancel = ctx.cancel_token.clone();

        // catch_unwind 包裹工具执行:panic 隔离
        let exec_fut = async {
            let fut = tool.execute(input, &ctx);
            AssertUnwindSafe(fut).catch_unwind().await
                .map_err(|p| {
                    let msg = if let Some(s) = p.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = p.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    ToolError::Internal(format!("tool panicked: {}", msg))
                })?
        };

        tokio::select! {
            result = timeout(timeout_dur, exec_fut) => {
                match result {
                    Ok(r) => r,
                    Err(_) => Err(ToolError::Timeout(timeout_dur)),
                }
            }
            _ = cancel.cancelled() => {
                Err(ToolError::Cancelled)
            }
        }
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft core::executor -- --nocapture
```

预期:`test result: ok. 5 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/executor.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): add ToolExecutor with timeout/cancel/panic isolation"
```

---

## Task 8: store/mod.rs — ProjectDirs 基目录

**Files:**
- Create: `src-tauri/src/store/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/store/mod.rs`,只写测试模块:

```rust
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_dirs_available() {
        let dirs = project_dirs();
        assert!(!dirs.config_dir().as_os_str().is_empty());
    }

    #[test]
    fn test_config_dir_nonempty() {
        let dir = config_dir();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn test_history_path_ends_with_jsonl() {
        let path = history_path();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "history.jsonl");
    }

    #[test]
    fn test_workspace_path_ends_with_json() {
        let path = workspace_path();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "workspace.json");
    }

    #[test]
    fn test_config_path_ends_with_config_json() {
        let path = config_path();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "config.json");
    }

    #[test]
    fn test_paths_consistent_across_calls() {
        let p1 = config_dir();
        let p2 = config_dir();
        assert_eq!(p1, p2);
    }

    #[test]
    fn test_all_paths_under_same_base() {
        let base = config_dir();
        assert!(history_path().starts_with(&base));
        assert!(workspace_path().starts_with(&base));
        assert!(config_path().starts_with(&base));
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/lib.rs`:

```rust
pub mod core;
pub mod store;
```

运行:

```bash
cargo test -p qraft store::tests -- --nocapture
```

预期:编译失败,`cannot find function project_dirs`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/store/mod.rs` 测试模块之上插入实现:

```rust
use std::path::PathBuf;
use directories::ProjectDirs;

/// 获取 Qraft 项目目录(配置基目录)
pub fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("dev", "qraft", "Qraft")
        .expect("Failed to determine project directories: home directory not found")
}

/// 配置基目录(跨平台)
pub fn config_dir() -> PathBuf {
    project_dirs().config_dir().to_path_buf()
}

/// config.json 路径
pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// history.jsonl 路径
pub fn history_path() -> PathBuf {
    config_dir().join("history.jsonl")
}

/// workspace.json 路径
pub fn workspace_path() -> PathBuf {
    config_dir().join("workspace.json")
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft store::tests -- --nocapture
```

预期:`test result: ok. 7 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/store/mod.rs src-tauri/src/lib.rs
git commit -m "feat(store): add ProjectDirs-based config/history/workspace path resolution"
```

---

## Task 9: store/config.rs — ConfigStore trait + JsonConfigStore

**Files:**
- Create: `src-tauri/src/store/config.rs`
- Modify: `src-tauri/src/store/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/store/config.rs`,只写测试模块:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::core::error::ToolError;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_path() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        (dir, path)
    }

    #[tokio::test]
    async fn test_get_nonexistent_key_returns_none() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        let result = store.get("nonexistent.key").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_set_and_get_top_level() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store.set("theme", json!({"mode": "dark", "accent_color": "#3b82f6"})).await.unwrap();
        let val = store.get("theme").await.unwrap().unwrap();
        assert_eq!(val["mode"], "dark");
    }

    #[tokio::test]
    async fn test_set_and_get_nested_path() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store.set("theme.mode", json!("light")).await.unwrap();
        let val = store.get("theme.mode").await.unwrap().unwrap();
        assert_eq!(val, "light");
    }

    #[tokio::test]
    async fn test_get_all_default() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        let config = store.get_all().await.unwrap();
        assert_eq!(config.version, 0);
        assert_eq!(config.general.font_size, 0);
    }

    #[tokio::test]
    async fn test_reset_to_default() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store.set("theme.mode", json!("light")).await.unwrap();
        assert!(store.get("theme.mode").await.unwrap().is_some());
        store.reset("theme.mode").await.unwrap();
        // reset 后 theme.mode 回到默认(String::default() = "")
        let val = store.get("theme.mode").await.unwrap();
        assert!(val.is_none() || val == Some(Value::String(String::new())));
    }

    #[tokio::test]
    async fn test_persist_across_instances() {
        let (_tmp, path) = temp_config_path();
        {
            let store = JsonConfigStore::new(path.clone());
            store.set("general.language", json!("zh")).await.unwrap();
        }
        // 新实例加载同一文件
        let store2 = JsonConfigStore::new(path);
        let val = store2.get("general.language").await.unwrap().unwrap();
        assert_eq!(val, "zh");
    }

    #[tokio::test]
    async fn test_concurrent_set_safe() {
        let (_tmp, path) = temp_config_path();
        let store = std::sync::Arc::new(JsonConfigStore::new(path));
        let mut handles = vec![];
        for i in 0..5 {
            let s = store.clone();
            handles.push(tokio::spawn(async move {
                s.set("general.font_size", json!(i)).await
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }
        // 文件应可读且为有效 JSON
        let val = store.get("general.font_size").await.unwrap().unwrap();
        assert!(val.is_number());
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/store/mod.rs`:

```rust
pub mod config;

use std::path::PathBuf;
use directories::ProjectDirs;

pub fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("dev", "qraft", "Qraft")
        .expect("Failed to determine project directories")
}

pub fn config_dir() -> PathBuf {
    project_dirs().config_dir().to_path_buf()
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn history_path() -> PathBuf {
    config_dir().join("history.jsonl")
}

pub fn workspace_path() -> PathBuf {
    config_dir().join("workspace.json")
}
```

运行:

```bash
cargo test -p qraft store::config -- --nocapture
```

预期:编译失败,`cannot find type JsonConfigStore` / `cannot find type ConfigStore`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/store/config.rs` 测试模块之上插入实现:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use async_trait::async_trait;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use atomicwrites::{AtomicFile, OverwriteBehavior};

use crate::core::error::ToolError;
use crate::store::config_path as default_config_path;

/// 配置访问接口(异步,便于未来扩展)
#[async_trait]
pub trait ConfigStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Value>, ToolError>;
    async fn set(&self, key: &str, value: Value) -> Result<(), ToolError>;
    async fn get_all(&self) -> Result<UserConfig, ToolError>;
    async fn reset(&self, key: &str) -> Result<(), ToolError>;
}

/// 用户配置根结构
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserConfig {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub theme: ThemeConfig,
    #[serde(default)]
    pub shortcuts: ShortcutBinding,
    #[serde(default)]
    pub tool_prefs: HashMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GeneralConfig {
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub font_size: u32,
    #[serde(default)]
    pub max_history: usize,
    #[serde(default)]
    pub confirm_on_clear: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ThemeConfig {
    #[serde(default)]
    pub mode: ThemeMode,
    #[serde(default)]
    pub accent_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

impl Default for ThemeMode {
    fn default() -> Self { Self::Dark }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShortcutBinding {
    #[serde(default)]
    pub open_command_palette: String,
    #[serde(default)]
    pub toggle_sidebar: String,
    #[serde(default)]
    pub execute_tool: String,
    #[serde(default)]
    pub clear_input: String,
    #[serde(default)]
    pub copy_output: String,
    #[serde(default)]
    pub toggle_settings: String,
    #[serde(default)]
    pub switch_tool: String,
    #[serde(default)]
    pub open_history: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub close_panel: String,
}

/// JSON 文件实现的 ConfigStore
pub struct JsonConfigStore {
    config: RwLock<UserConfig>,
    path: PathBuf,
}

impl JsonConfigStore {
    /// 用指定路径构造(测试用)
    pub fn new(path: PathBuf) -> Self {
        let config = if path.exists() {
            let json = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&json).unwrap_or_default()
        } else {
            UserConfig::default()
        };
        Self {
            config: RwLock::new(config),
            path,
        }
    }

    /// 用默认路径加载
    pub fn load() -> Self {
        Self::new(default_config_path())
    }

    fn persist(&self) -> Result<(), ToolError> {
        let config = self.config.read().clone();
        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| ToolError::Internal(format!("serialize config: {}", e)))?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Internal(format!("create config dir: {}", e)))?;
        }

        let af = AtomicFile::new(&self.path, OverwriteBehavior::AllowOverwrite);
        af.write(|f| f.write_all(json.as_bytes()))
            .map_err(|e| ToolError::Internal(format!("atomic write config: {}", e)))
    }
}

#[async_trait]
impl ConfigStore for JsonConfigStore {
    async fn get(&self, key: &str) -> Result<Option<Value>, ToolError> {
        let config = self.config.read().clone();
        let mut value = serde_json::to_value(&config)
            .map_err(|e| ToolError::Internal(format!("serialize config: {}", e)))?;
        for segment in key.split('.') {
            if segment.is_empty() {
                continue;
            }
            match value.get(segment) {
                Some(v) => value = v.clone(),
                None => return Ok(None),
            }
        }
        if value.is_null() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    }

    async fn set(&self, key: &str, value: Value) -> Result<(), ToolError> {
        {
            let mut config = self.config.write();
            let mut root = serde_json::to_value(&*config)
                .map_err(|e| ToolError::Internal(format!("serialize config: {}", e)))?;

            let segments: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
            if segments.is_empty() {
                return Err(ToolError::InvalidInput("empty config key".into()));
            }

            let mut current = &mut root;
            for seg in &segments[..segments.len() - 1] {
                current = current.get_mut(*seg)
                    .ok_or_else(|| ToolError::InvalidInput(format!("invalid config path: {}", key)))?;
            }
            let last = *segments.last().unwrap();
            if let Some(obj) = current.as_object_mut() {
                obj.insert(last.to_string(), value);
            } else {
                return Err(ToolError::InvalidInput(format!("config path not an object: {}", key)));
            }

            *config = serde_json::from_value(root)
                .map_err(|e| ToolError::Internal(format!("deserialize config: {}", e)))?;
        }
        self.persist()
    }

    async fn get_all(&self) -> Result<UserConfig, ToolError> {
        Ok(self.config.read().clone())
    }

    async fn reset(&self, key: &str) -> Result<(), ToolError> {
        let default_config = UserConfig::default();
        let default_value = serde_json::to_value(&default_config)
            .map_err(|e| ToolError::Internal(format!("serialize default: {}", e)))?;
        let mut value = default_value;
        for segment in key.split('.') {
            if segment.is_empty() {
                continue;
            }
            value = value.get(segment).cloned().unwrap_or(Value::Null);
        }
        self.set(key, value).await
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft store::config -- --nocapture
```

预期:`test result: ok. 7 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/store/config.rs src-tauri/src/store/mod.rs
git commit -m "feat(store): add ConfigStore trait and JsonConfigStore with atomic writes"
```

---

## Task 10: store/history.rs — HistoryStore

**Files:**
- Create: `src-tauri/src/store/history.rs`
- Modify: `src-tauri/src/store/mod.rs`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/store/history.rs`,只写测试模块:

```rust
use std::path::PathBuf;
use async_trait::async_trait;
use tempfile::TempDir;

use crate::core::context::HistoryEntry;
use crate::core::error::ToolError;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_history_path() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.jsonl");
        (dir, path)
    }

    fn sample_entry(tool_id: &str, ts: u64) -> HistoryEntry {
        HistoryEntry {
            tool_id: tool_id.into(),
            input_summary: "input".into(),
            output_summary: "output".into(),
            timestamp: ts,
            duration_ms: 10,
        }
    }

    #[tokio::test]
    async fn test_add_and_list() {
        let (_tmp, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path);
        store.add(sample_entry("json_formatter", 1000)).await.unwrap();
        let list = store.list(10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tool_id, "json_formatter");
    }

    #[tokio::test]
    async fn test_clear() {
        let (_tmp, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path);
        store.add(sample_entry("a", 1)).await.unwrap();
        store.add(sample_entry("b", 2)).await.unwrap();
        assert_eq!(store.list(10).await.unwrap().len(), 2);
        store.clear().await.unwrap();
        assert_eq!(store.list(10).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_limit_truncates() {
        let (_tmp, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path);
        for i in 0..5 {
            store.add(sample_entry("tool", i)).await.unwrap();
        }
        let list = store.list(3).await.unwrap();
        assert_eq!(list.len(), 3);
        // 最近 3 条(timestamp 最大的)
        assert_eq!(list[0].timestamp, 4);
        assert_eq!(list[2].timestamp, 2);
    }

    #[tokio::test]
    async fn test_empty_file_returns_empty_list() {
        let (_tmp, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path);
        let list = store.list(10).await.unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn test_multiple_entries_preserved() {
        let (_tmp, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path);
        store.add(sample_entry("base64", 100)).await.unwrap();
        store.add(sample_entry("jwt", 200)).await.unwrap();
        store.add(sample_entry("hash", 300)).await.unwrap();
        let list = store.list(100).await.unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].tool_id, "hash");
        assert_eq!(list[1].tool_id, "jwt");
        assert_eq!(list[2].tool_id, "base64");
    }

    #[tokio::test]
    async fn test_persistence_across_instances() {
        let (_tmp, path) = temp_history_path();
        {
            let store = JsonlHistoryStore::new(path.clone());
            store.add(sample_entry("persisted", 999)).await.unwrap();
        }
        let store2 = JsonlHistoryStore::new(path);
        let list = store2.list(10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tool_id, "persisted");
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

更新 `src-tauri/src/store/mod.rs`(在 `pub mod config;` 后加一行):

```rust
pub mod config;
pub mod history;
```

运行:

```bash
cargo test -p qraft store::history -- --nocapture
```

预期:编译失败,`cannot find type JsonlHistoryStore` / `cannot find type HistoryStore`

- [ ] **Step 3: 写最小实现**

在 `src-tauri/src/store/history.rs` 测试模块之上插入实现:

```rust
use std::path::{Path, PathBuf};
use async_trait::async_trait;
use parking_lot::Mutex;

use crate::core::context::HistoryEntry;
use crate::core::error::ToolError;

/// 历史记录存储接口
#[async_trait]
pub trait HistoryStore: Send + Sync {
    async fn add(&self, entry: HistoryEntry) -> Result<(), ToolError>;
    async fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>, ToolError>;
    async fn clear(&self) -> Result<(), ToolError>;
}

/// JSONL 文件实现的历史存储
///
/// 每条记录一行 JSON,追加写入;list 读取全部并返回最近 N 条(按文件顺序倒序)。
pub struct JsonlHistoryStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl JsonlHistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    pub fn load() -> Self {
        Self::new(crate::store::history_path())
    }
}

#[async_trait]
impl HistoryStore for JsonlHistoryStore {
    async fn add(&self, entry: HistoryEntry) -> Result<(), ToolError> {
        let _guard = self.write_lock.lock();
        let line = serde_json::to_string(&entry)
            .map_err(|e| ToolError::Internal(format!("serialize history entry: {}", e)))?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Internal(format!("create history dir: {}", e)))?;
        }

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| ToolError::Internal(format!("open history file: {}", e)))?;
        use std::io::Write;
        file.write_all(line.as_bytes())
            .map_err(|e| ToolError::Internal(format!("write history: {}", e)))?;
        file.write_all(b"\n")
            .map_err(|e| ToolError::Internal(format!("write history newline: {}", e)))?;
        Ok(())
    }

    async fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>, ToolError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.path)
            .map_err(|e| ToolError::Internal(format!("read history: {}", e)))?;

        let mut entries: Vec<HistoryEntry> = Vec::new();
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<HistoryEntry>(line) {
                Ok(e) => entries.push(e),
                Err(_) => continue, // 跳过损坏行
            }
        }
        // 倒序(最近在前),取前 limit 条
        entries.reverse();
        entries.truncate(limit);
        Ok(entries)
    }

    async fn clear(&self) -> Result<(), ToolError> {
        let _guard = self.write_lock.lock();
        if self.path.exists() {
            std::fs::write(&self.path, "")
                .map_err(|e| ToolError::Internal(format!("clear history: {}", e)))?;
        }
        Ok(())
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cargo test -p qraft store::history -- --nocapture
```

预期:`test result: ok. 6 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/store/history.rs src-tauri/src/store/mod.rs
git commit -m "feat(store): add HistoryStore trait and JsonlHistoryStore with append-only writes"
```

---

## Task 11: lib.rs — 模块导出与整体验证

**Files:**
- Create: `src-tauri/src/tools/mod.rs`(空模块)
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写失败测试**

更新 `src-tauri/src/lib.rs` 为以下内容(声明所有模块 + 重导出):

```rust
pub mod core;
pub mod store;
pub mod tools;

// 重导出 Core 层关键类型,方便外部使用
pub use core::error::{AppError, EngineError, ToolError};
pub use core::input::ToolInput;
pub use core::output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use core::tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};
pub use core::context::{HistoryEntry, HistorySink, ToolContext};
pub use core::registry::{ToolEntry, ToolRegistry, StreamingEntry};
pub use core::executor::ToolExecutor;

// 重导出注册宏
pub use crate::register_tool;
pub use crate::register_stream_tool;

// 重导出 Store 层
pub use store::config::{
    ConfigStore, GeneralConfig, JsonConfigStore, ShortcutBinding, ThemeConfig,
    ThemeMode, UserConfig,
};
pub use store::history::{HistoryStore, JsonlHistoryStore};

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn test_tool_error_reexport() {
        let err = ToolError::InvalidInput("test".into());
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_tool_input_reexport() {
        let input = ToolInput::default();
        assert!(input.text.is_none());
    }

    #[test]
    fn test_tool_output_reexport() {
        let out = ToolOutput::default();
        assert_eq!(out.text, "");
    }

    #[test]
    fn test_tool_registry_reexport() {
        let _registry = ToolRegistry::global();
    }

    #[test]
    fn test_config_store_reexport() {
        let _mode = ThemeMode::Dark;
    }

    #[test]
    fn test_history_store_reexport() {
        let entry = HistoryEntry::default();
        assert_eq!(entry.tool_id, "");
    }
}
```

创建空的 `src-tauri/src/tools/mod.rs`:

```rust
// 工具实现模块(P0 工具将在 05-p0-tools.md 中填充)
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cargo test -p qraft --lib -- --nocapture
```

预期:可能有未解析的导入或编译错误,因为部分 `pub use` 路径需要确认

- [ ] **Step 3: 修正 lib.rs 与 core/mod.rs**

更新 `src-tauri/src/core/mod.rs` 添加重导出:

```rust
pub mod context;
pub mod error;
pub mod executor;
pub mod input;
pub mod output;
pub mod registry;
pub mod tool;

pub use context::{HistoryEntry, HistorySink, ToolContext};
pub use error::{AppError, EngineError, ToolError};
pub use executor::ToolExecutor;
pub use input::ToolInput;
pub use output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use registry::{StreamingEntry, ToolEntry, ToolRegistry};
pub use tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};
```

修正 `src-tauri/src/lib.rs` 中的宏重导出(Rust 中 `pub use crate::macro_name` 需用 `pub use ::crate_name::macro_name` 或直接 `pub use macro_name`):

```rust
pub mod core;
pub mod store;
pub mod tools;

pub use core::error::{AppError, EngineError, ToolError};
pub use core::input::ToolInput;
pub use core::output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use core::tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};
pub use core::context::{HistoryEntry, HistorySink, ToolContext};
pub use core::registry::{ToolEntry, ToolRegistry, StreamingEntry};
pub use core::executor::ToolExecutor;

pub use register_tool;
pub use register_stream_tool;

pub use store::config::{
    ConfigStore, GeneralConfig, JsonConfigStore, ShortcutBinding, ThemeConfig,
    ThemeMode, UserConfig,
};
pub use store::history::{HistoryStore, JsonlHistoryStore};

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn test_tool_error_reexport() {
        let err = ToolError::InvalidInput("test".into());
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_tool_input_reexport() {
        let input = ToolInput::default();
        assert!(input.text.is_none());
    }

    #[test]
    fn test_tool_output_reexport() {
        let out = ToolOutput::default();
        assert_eq!(out.text, "");
    }

    #[test]
    fn test_tool_registry_reexport() {
        let _registry = ToolRegistry::global();
    }

    #[test]
    fn test_config_store_reexport() {
        let _mode = ThemeMode::Dark;
    }

    #[test]
    fn test_history_store_reexport() {
        let entry = HistoryEntry::default();
        assert_eq!(entry.tool_id, "");
    }
}
```

- [ ] **Step 4: 运行全部测试验证通过**

```bash
cargo test -p qraft -- --nocapture
```

预期:全部测试通过,`test result: ok. <总数> passed`

再运行 clippy 与格式检查:

```bash
cargo clippy -p qraft -- -D warnings
cargo fmt -p qraft --check
```

预期:无 warning,格式一致(若 fmt 报错,运行 `cargo fmt -p qraft` 修正)

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/lib.rs src-tauri/src/core/mod.rs src-tauri/src/tools/mod.rs
git commit -m "feat(core): finalize module exports and lib.rs re-exports"
```

---

## 附录:类型与 PRD 对照表

| 类型 | 字段/变体 | PRD 来源 |
|------|----------|----------|
| `ToolError` | InvalidInput / ParseFailed / Timeout / Cancelled / InputTooLarge / ToolNotFound / OutOfMemory / Internal | 05 §3.3 + 10 §3.1 + 本计划 Task 描述 |
| `ToolError::code()` | ERR_INVALID_INPUT / ERR_PARSE_FAILED / ERR_TIMEOUT / ERR_CANCELLED / ERR_INPUT_TOO_LARGE / ERR_TOOL_NOT_FOUND / ERR_OUT_OF_MEMORY / ERR_INTERNAL | 09 §3.5 |
| `ToolInput` | text / file_path / params | 08 §3.1 |
| `ToolOutput` | text / extra / meta / alerts | 08 §3.1 |
| `OutputMeta` | duration_ms / input_bytes / output_bytes | 08 §3.1 |
| `Alert` | level / message | 08 §3.1 |
| `AlertLevel` | Info / Warning / Error(snake_case) | 08 §3.1 |
| `ToolMetadata` | id / name / category / icon / description / input_schema / output_schema / tags / version / timeout_secs / streaming_supported | 05 §3.1 |
| `ToolCategory` | Formatter / Encoder / Generator / Parser / Converter / Comparator(snake_case) | 05 §3.1 |
| `StreamEvent` | Progress / Chunk / Done / Error(tag = "type") | 05 §3.1 |
| `ToolContext` | cancel_token / config / history_sink | 08 §3.1 + 本计划 Task 描述 |
| `HistorySink` | async fn write(HistoryEntry) | 08 §3.1 + 09 §3.4 |
| `HistoryEntry` | tool_id / input_summary / output_summary / timestamp / duration_ms | 本计划 Task 描述(MVP 简化版) |
| `UserConfig` | version / general / theme / shortcuts / tool_prefs | 08 §3.2 |
| `ConfigStore` | get / set / get_all / reset | 09 §3.4 + 16 §3.3 |
| `HistoryStore` | add / list / clear | 09 §3.4 |
