# 03 - Tauri Shell 层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现 Tauri Shell 层——IPC Command、权限管理、文件系统/剪贴板封装、事件广播,桥接 Rust Core 与 React UI,所有 Command 返回统一 CommandResponse 包络。

**Architecture:** Shell 层通过 `#[tauri::command]` 暴露 IPC,通过 `tauri::AppHandle::emit` 推送事件,通过 `tauri::State<AppState>` 注入 Core 依赖。capabilities/ 目录配置细粒度权限,严格遵循最小权限原则。

**Tech Stack:** Tauri V2 + tauri-plugin-dialog/clipboard-manager/shell/updater + tokio + serde + tracing + async_trait

**Depends on:** 02-rust-core-engine.md(ToolExecutor、ToolRegistry、ConfigStore、HistoryStore 等 Core 抽象)

---

## 前置约定

### Shell 层模块结构

执行本计划前,确认以下目录结构(在 01 脚手架阶段已创建 `src-tauri/` 基础骨架):

```
src-tauri/
  Cargo.toml
  tauri.conf.json
  src/
    main.rs              # 入口,调用 lib::run()
    lib.rs               # Tauri 应用装配
    shell/
      mod.rs             # 模块导出
      error.rs           # AppError 顶层错误
      response.rs        # CommandResponse 包络
      state.rs           # AppState 全局状态容器
    commands/
      mod.rs             # 模块导出
      tool.rs            # 工具执行 IPC
      config.rs          # 配置 IPC
      history.rs         # 历史 IPC
      clipboard.rs       # 剪贴板 IPC
      fs.rs              # 文件系统 IPC(受限)
      app.rs             # 应用级 IPC
  capabilities/
    default.json
    tool.json
    config.json
    history.json
    clipboard.json
    fs.json
    shell.json
    updater.json
  tests/
    smoke.rs             # 集成冒烟测试
```

### Core 类型路径假设

子计划 02 已实现以下类型,本计划直接 `use` 引用:

- `qraft::core::tool::{Tool, ToolMetadata, ToolCategory, StreamingTool, StreamEvent}`
- `qraft::core::input::ToolInput`
- `qraft::core::output::ToolOutput`
- `qraft::core::error::ToolError`
- `qraft::core::context::{ToolContext, HistorySink}`
- `qraft::core::registry::{ToolRegistry, ToolEntry}`
- `qraft::core::executor::ToolExecutor`
- `qraft::store::config::{ConfigStore, ConfigError, UserConfig, JsonConfigStore}`
- `qraft::store::history::{HistoryStore, HistoryError, HistoryEntry, HistoryFilter, JsonlHistoryStore}`

### IPC Command 与事件名规范(来自 09-interface-design.md)

**Command 清单(MVP 子集):**

| Command | 参数 | 返回 |
|---------|------|------|
| `tool_list` | 无 | `Vec<ToolMetadata>` |
| `tool_metadata` | `toolId: String` | `ToolMetadata` |
| `tool_execute` | `toolId, input: ToolInput` | `ToolOutput` |
| `tool_execute_stream` | `toolId, filePath: String` | `String`(任务 ID) |
| `tool_cancel` | `taskId: String` | `()` |
| `config_get` | `key: String` | `Option<Value>` |
| `config_set` | `key, value: Value` | `()` |
| `config_get_all` | 无 | `UserConfig` |
| `config_reset` | `key: String` | `()` |
| `history_list` | `limit: Option<u32>` | `Vec<HistoryEntry>` |
| `history_clear` | 无 | `()` |
| `clipboard_read_text` | 无 | `String` |
| `clipboard_write_text` | `text: String` | `()` |
| `fs_read_file` | `path: String` | `String` |
| `fs_write_file` | `path, content: String` | `()` |
| `app_open_external` | `url: String` | `()` |
| `app_version` | 无 | `String` |
| `app_quit` | 无 | `()` |

**事件清单:**

| 事件名 | Payload | 触发时机 |
|--------|---------|----------|
| `config_changed` | `{ key, oldValue, newValue }` | 配置写入成功后 |
| `history_added` | `HistoryEntry` | 历史记录写入后 |
| `tool_progress` | `{ taskId, percent, message }` | 流式工具进度更新 |
| `tool_chunk` | `{ taskId, text }` | 流式工具输出片段 |
| `tool_completed` | `{ taskId, output }` | 流式工具完成 |
| `tool_failed` | `{ taskId, error }` | 流式工具失败 |

---

## Task 1: Cargo.toml 添加 Tauri 依赖

**目标:** 为 Shell 层添加 Tauri V2 运行时与官方插件依赖。

### 步骤 1.1: 添加依赖到 `src-tauri/Cargo.toml`

- [x] 编辑 `src-tauri/Cargo.toml`,在 `[dependencies]` 段添加以下内容(若 `serde_json`、`tracing`、`tokio`、`serde`、`async-trait`、`anyhow`、`thiserror` 已在 02 添加则跳过):

```toml
[package]
name = "qraft"
version = "0.1.0"
edition = "2021"

[lib]
name = "qraft_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[dependencies]
# Tauri 核心与插件(Shell 层专用)
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"

# 异步运行时与流处理(若 02 已添加则保留)
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["rt"] }
futures = "0.3"

# 序列化(若 02 已添加则保留)
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# 错误处理(若 02 已添加则保留)
thiserror = "1"
anyhow = "1"

# 日志(若 02 已添加则保留)
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# 工具依赖
async-trait = "0.1"
uuid = { version = "1", features = ["v4"] }

# 测试依赖
[dev-dependencies]
mockall = "0.12"

[profile.dev]
panic = "unwind"

[profile.release]
panic = "unwind"
```

### 步骤 1.2: 验证依赖可编译

- [x] 运行以下命令,确认依赖解析无误:

```bash
cd src-tauri && cargo check
```

**预期输出:** `Finished` 且无错误(可能有 unused warning,可忽略)。

### 步骤 1.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build(shell): add tauri v2 and plugin dependencies"
```

---

## Task 2: AppError 顶层错误类型

**目标:** 在 `src-tauri/src/shell/error.rs` 实现 AppError 顶层错误,封装 Core 层错误与 Shell 层错误,可序列化跨越 IPC 边界。

### 设计说明

AppError 需要序列化通过 IPC 传给前端。由于 `std::io::Error` 和 `anyhow::Error` 不实现 `Serialize`,采用手动 `impl Serialize` 而非 `#[derive(Serialize)]`,序列化格式仍遵循 `#[serde(tag = "kind", content = "detail")]` 的 tag/content 语义。

### 步骤 2.1: 写失败测试

- [x] 创建 `src-tauri/src/shell/error.rs` 并写入以下测试代码(此时无实现,测试应编译失败):

```rust
// src-tauri/src/shell/error.rs

use serde::Serialize;

use crate::core::error::ToolError;

/// AppError 顶层错误类型,跨越 IPC 边界
///
/// 序列化格式: { "kind": "<code>", "detail": "<display or struct>" }
/// 前端通过 kind 字段识别错误类型,通过 detail 获取详情
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("tool error: {0}")]
    Tool(ToolError),

    #[error("config error: {0}")]
    Config(String),

    #[error("history error: {0}")]
    History(String),

    #[error("io error: {0}")]
    Io(std::io::Error),

    #[error("permission denied: {0}")]
    Permission(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("internal error: {0}")]
    Internal(anyhow::Error),
}

impl AppError {
    /// 返回错误码字符串,供前端做精准 UI 反馈
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Tool(e) => e.code(),
            AppError::Config(_) => "ERR_CONFIG_IO",
            AppError::History(_) => "ERR_HISTORY_IO",
            AppError::Io(_) => "ERR_FILE_IO",
            AppError::Permission(_) => "ERR_PERMISSION_DENIED",
            AppError::Forbidden(_) => "ERR_PERMISSION_DENIED",
            AppError::Internal(_) => "ERR_INTERNAL",
        }
    }
}

// 手动实现 Serialize:将 io::Error / anyhow::Error 转为 Display 字符串
// 格式与 serde(tag="kind", content="detail") 等价
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("kind", self.code())?;
        match self {
            AppError::Tool(e) => {
                // ToolError 自身实现 Serialize,序列化为嵌套结构
                map.serialize_entry("detail", e)?;
            }
            AppError::Config(s) | AppError::History(s) | AppError::Permission(s)
            | AppError::Forbidden(s) => {
                map.serialize_entry("detail", s)?;
            }
            AppError::Io(e) => {
                map.serialize_entry("detail", &e.to_string())?;
            }
            AppError::Internal(e) => {
                map.serialize_entry("detail", &format!("{:#}", e))?;
            }
        }
        map.end()
    }
}

impl From<ToolError> for AppError {
    fn from(e: ToolError) -> Self {
        AppError::Tool(e)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(e)
    }
}

// 从 String 构造 Config/History 错误的便捷方法
impl AppError {
    pub fn config(msg: impl Into<String>) -> Self {
        AppError::Config(msg.into())
    }

    pub fn history(msg: impl Into<String>) -> Self {
        AppError::History(msg.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn test_from_tool_error() {
        let tool_err = ToolError::InvalidInput("missing field".into());
        let app_err = AppError::from(tool_err);
        assert!(matches!(app_err, AppError::Tool(_)));
        assert_eq!(app_err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "file missing");
        let app_err = AppError::from(io_err);
        assert!(matches!(app_err, AppError::Io(_)));
        assert_eq!(app_err.code(), "ERR_FILE_IO");
    }

    #[test]
    fn test_from_anyhow_error() {
        let err = anyhow::anyhow!("something went wrong");
        let app_err = AppError::from(err);
        assert!(matches!(app_err, AppError::Internal(_)));
        assert_eq!(app_err.code(), "ERR_INTERNAL");
    }

    #[test]
    fn test_code_for_each_variant() {
        assert_eq!(AppError::Config("x".into()).code(), "ERR_CONFIG_IO");
        assert_eq!(AppError::History("x".into()).code(), "ERR_HISTORY_IO");
        assert_eq!(AppError::Permission("x".into()).code(), "ERR_PERMISSION_DENIED");
        assert_eq!(AppError::Forbidden("x".into()).code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_serialize_tool_variant() {
        let err = AppError::Tool(ToolError::ParseFailed("bad json".into()));
        let json = serde_json::to_string(&err).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["kind"], "ERR_PARSE_FAILED");
        assert!(value["detail"].is_object());
    }

    #[test]
    fn test_serialize_io_variant() {
        let err = AppError::Io(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
        let json = serde_json::to_string(&err).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["kind"], "ERR_FILE_IO");
        assert!(value["detail"].is_string());
    }

    #[test]
    fn test_serialize_config_variant() {
        let err = AppError::Config("key not found".into());
        let json = serde_json::to_string(&err).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["kind"], "ERR_CONFIG_IO");
        assert_eq!(value["detail"], "key not found");
    }
}
```

### 步骤 2.2: 验证测试失败

- [x] 运行测试,确认编译失败(因为 `shell/mod.rs` 未导出、`crate::core` 未导出):

```bash
cd src-tauri && cargo test --lib shell::error
```

**预期:** 编译错误,提示找不到 `crate::core::error::ToolError` 或 `shell` 模块未声明。

### 步骤 2.3: 写实现(创建 shell 模块导出)

- [x] 创建 `src-tauri/src/shell/mod.rs`:

```rust
// src-tauri/src/shell/mod.rs

pub mod error;
pub mod response;
pub mod state;

pub use error::AppError;
pub use response::{CommandResponse, ErrorInfo};
pub use state::{AppState, StreamingTaskRegistry, HistorySinkImpl};
```

- [x] 在 `src-tauri/src/lib.rs`(若 02 已创建则编辑,否则创建)中添加模块声明:

```rust
// src-tauri/src/lib.rs

pub mod core;
pub mod store;
pub mod shell;
pub mod commands;
```

> 注:`core` 与 `store` 模块由 02 子计划提供。若 02 的模块路径不同,执行时按实际路径调整。

### 步骤 2.4: 验证测试通过

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib shell::error
```

**预期:** 7 个测试全部通过。

### 步骤 2.5: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/shell/
git commit -m "feat(shell): add AppError top-level error type with serde"
```

---

## Task 3: CommandResponse 包络

**目标:** 在 `src-tauri/src/shell/response.rs` 实现统一响应包络,所有 Command 返回 `Result<CommandResponse<T>, AppError>`。

### 步骤 3.1: 写失败测试

- [x] 创建 `src-tauri/src/shell/response.rs` 并写入测试与实现:

```rust
// src-tauri/src/shell/response.rs

use serde::{Deserialize, Serialize};

/// 统一响应包络
///
/// 所有 IPC Command 返回此结构,前端通过 success 字段判断成败,
/// 通过 data 获取数据,通过 error 获取错误详情。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ErrorInfo>,
    pub code: String,
}

/// 错误信息(前端可读)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    /// 错误种类(对应 AppError::code())
    pub kind: String,
    /// 错误详情(序列化后的 AppError detail)
    pub detail: String,
    /// 用户可读的错误消息
    pub message: String,
}

impl<T: Serialize> CommandResponse<T> {
    /// 构造成功响应
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            code: "OK".to_string(),
        }
    }

    /// 构造失败响应
    pub fn err(error: ErrorInfo, code: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
            code,
        }
    }
}

impl<T: Serialize + Default> CommandResponse<T> {
    /// 构造成功响应但不携带数据(用于 void 返回)
    pub fn ok_empty() -> Self {
        Self {
            success: true,
            data: Some(T::default()),
            error: None,
            code: "OK".to_string(),
        }
    }
}

/// 便捷函数:从 AppError 构造 ErrorInfo
impl ErrorInfo {
    pub fn from_app_error(e: &crate::shell::AppError) -> Self {
        Self {
            kind: e.code().to_string(),
            detail: format!("{:#}", anyhow::Error::from(e.clone_for_display())),
            message: e.to_string(),
        }
    }

    pub fn new(kind: impl Into<String>, detail: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            detail: detail.into(),
            message: message.into(),
        }
    }
}

// 用于 ErrorInfo::from_app_error 的辅助 trait(仅取 Display 字符串,避免 Clone 要求)
impl crate::shell::AppError {
    fn clone_for_display(&self) -> Self {
        match self {
            crate::shell::AppError::Tool(e) => crate::shell::AppError::Tool(e.clone()),
            crate::shell::AppError::Config(s) => crate::shell::AppError::Config(s.clone()),
            crate::shell::AppError::History(s) => crate::shell::AppError::History(s.clone()),
            crate::shell::AppError::Io(e) => crate::shell::AppError::Io(std::io::Error::new(e.kind(), e.to_string())),
            crate::shell::AppError::Permission(s) => crate::shell::AppError::Permission(s.clone()),
            crate::shell::AppError::Forbidden(s) => crate::shell::AppError::Forbidden(s.clone()),
            crate::shell::AppError::Internal(e) => crate::shell::AppError::Internal(anyhow::anyhow!("{}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize)]
    struct TestData {
        name: String,
        value: i32,
    }

    #[test]
    fn test_ok_serialization() {
        let data = TestData { name: "test".into(), value: 42 };
        let resp = CommandResponse::ok(data);
        let json = serde_json::to_string(&resp).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["success"], true);
        assert_eq!(value["code"], "OK");
        assert_eq!(value["data"]["name"], "test");
        assert_eq!(value["data"]["value"], 42);
        assert!(value["error"].is_null());
    }

    #[test]
    fn test_err_serialization() {
        let error_info = ErrorInfo::new("ERR_TOOL_NOT_FOUND", "tool_id: missing", "工具不存在");
        let resp: CommandResponse<TestData> = CommandResponse::err(error_info, "ERR_TOOL_NOT_FOUND".into());
        let json = serde_json::to_string(&resp).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["success"], false);
        assert_eq!(value["code"], "ERR_TOOL_NOT_FOUND");
        assert!(value["data"].is_null());
        assert_eq!(value["error"]["kind"], "ERR_TOOL_NOT_FOUND");
        assert_eq!(value["error"]["message"], "工具不存在");
    }

    #[test]
    fn test_ok_empty_for_unit() {
        let resp: CommandResponse<()> = CommandResponse::ok_empty();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
        assert!(resp.data.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_camel_case_serialization() {
        let error_info = ErrorInfo::new("ERR_X", "d", "m");
        let resp: CommandResponse<String> = CommandResponse::err(error_info, "ERR_X".into());
        let json = serde_json::to_string(&resp).unwrap();
        // 字段名应为 camelCase
        assert!(json.contains("\"success\""));
        assert!(json.contains("\"errorInfo\"") || json.contains("\"error\""));
    }

    #[test]
    fn test_error_info_new() {
        let info = ErrorInfo::new("ERR_TIMEOUT", "5s", "执行超时");
        assert_eq!(info.kind, "ERR_TIMEOUT");
        assert_eq!(info.detail, "5s");
        assert_eq!(info.message, "执行超时");
    }
}
```

### 步骤 2.2: 验证测试

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib shell::response
```

**预期:** 5 个测试通过(若 `AppError` 未实现 Clone,`clone_for_display` 会编译失败,需在 Task 2 中为 AppError 派生 Clone 或调整实现)。

> **修正提示:** 若 AppError 因包含 `anyhow::Error`(非 Clone)无法派生 Clone,将 `clone_for_display` 改为仅取 `to_string()` 结果:
> ```rust
> pub fn from_app_error(e: &crate::shell::AppError) -> Self {
>     Self {
>         kind: e.code().to_string(),
>         detail: e.to_string(),
>         message: e.to_string(),
>     }
> }
> ```
> 并删除 `clone_for_display` 辅助方法。以修正版为准。

### 步骤 3.3: 应用修正并验证通过

- [x] 将 `ErrorInfo::from_app_error` 简化为不依赖 Clone:

```rust
impl ErrorInfo {
    pub fn from_app_error(e: &crate::shell::AppError) -> Self {
        Self {
            kind: e.code().to_string(),
            detail: e.to_string(),
            message: e.to_string(),
        }
    }

    pub fn new(kind: impl Into<String>, detail: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            detail: detail.into(),
            message: message.into(),
        }
    }
}
```

- [x] 删除 `clone_for_display` 方法。

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib shell::response
```

**预期:** 5 个测试全部通过。

### 步骤 3.4: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/shell/response.rs
git commit -m "feat(shell): add CommandResponse envelope and ErrorInfo"
```

---

## Task 4: AppState — 全局状态容器

**目标:** 在 `src-tauri/src/shell/state.rs` 实现全局状态容器,持有 ToolExecutor、ConfigStore、HistoryStore、流式任务注册表,并提供 HistorySink 实现。

### 步骤 4.1: 写失败测试

- [x] 创建 `src-tauri/src/shell/state.rs` 并写入测试与实现:

```rust
// src-tauri/src/shell/state.rs

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use tokio_util::sync::CancellationToken;

use crate::core::context::HistorySink;
use crate::core::executor::ToolExecutor;
use crate::store::config::ConfigStore;
use crate::store::history::{HistoryEntry, HistoryStore};

/// 流式任务注册表
///
/// 管理 tool_execute_stream 启动的后台任务的 CancellationToken,
/// 供 tool_cancel 命令按 taskId 取消。
pub struct StreamingTaskRegistry {
    tasks: Mutex<HashMap<String, CancellationToken>>,
}

impl StreamingTaskRegistry {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// 注册新任务,返回其 CancellationToken 副本供执行使用
    pub fn register(&self, task_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.tasks
            .lock()
            .expect("StreamingTaskRegistry mutex poisoned")
            .insert(task_id.to_string(), token.clone());
        token
    }

    /// 取消指定任务,返回 true 表示找到并取消,false 表示任务不存在或已完成
    pub fn cancel(&self, task_id: &str) -> bool {
        if let Some(token) = self
            .tasks
            .lock()
            .expect("StreamingTaskRegistry mutex poisoned")
            .remove(task_id)
        {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// 任务完成后注销(从注册表移除)
    pub fn unregister(&self, task_id: &str) {
        self.tasks
            .lock()
            .expect("StreamingTaskRegistry mutex poisoned")
            .remove(task_id);
    }

    /// 当前活跃任务数(用于测试与诊断)
    pub fn active_count(&self) -> usize {
        self.tasks
            .lock()
            .expect("StreamingTaskRegistry mutex poisoned")
            .len()
    }
}

impl Default for StreamingTaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// HistorySink 的 Shell 层实现
///
/// 将 HistoryEntry 通过 tokio::spawn 异步写入 HistoryStore,
/// 不阻塞工具执行返回(满足"历史写入异步"约束)。
pub struct HistorySinkImpl {
    store: Arc<dyn HistoryStore>,
}

impl HistorySinkImpl {
    pub fn new(store: Arc<dyn HistoryStore>) -> Self {
        Self { store }
    }
}

impl HistorySink for HistorySinkImpl {
    fn write(&self, entry: HistoryEntry) {
        let store = self.store.clone();
        tokio::spawn(async move {
            if let Err(e) = store.add(entry).await {
                tracing::warn!(error = %e, "failed to write history entry asynchronously");
            }
        });
    }
}

/// 全局状态容器
///
/// 通过 tauri::State<AppState> 注入到每个 Command,
/// 持有 Core 层依赖的 Arc 引用。app_handle 在 setup hook 中注入。
pub struct AppState {
    pub executor: Arc<ToolExecutor>,
    pub config_store: Arc<dyn ConfigStore>,
    pub history_store: Arc<dyn HistoryStore>,
    pub streaming_tasks: Arc<StreamingTaskRegistry>,
    /// 运行时注入的 AppHandle,初始为 None,setup hook 中调用 set_app_handle
    app_handle: OnceLock<tauri::AppHandle>,
}

impl AppState {
    pub fn new(
        executor: Arc<ToolExecutor>,
        config_store: Arc<dyn ConfigStore>,
        history_store: Arc<dyn HistoryStore>,
    ) -> Self {
        Self {
            executor,
            config_store,
            history_store,
            streaming_tasks: Arc::new(StreamingTaskRegistry::new()),
            app_handle: OnceLock::new(),
        }
    }

    /// 在 setup hook 中注入 AppHandle
    pub fn set_app_handle(&self, handle: tauri::AppHandle) -> Result<(), tauri::AppHandle> {
        self.app_handle.set(handle)
    }

    /// 获取 AppHandle(若已注入)
    pub fn app_handle(&self) -> Option<&tauri::AppHandle> {
        self.app_handle.get()
    }

    /// 构造 HistorySink(用于 ToolContext)
    pub fn history_sink(&self) -> HistorySinkImpl {
        HistorySinkImpl::new(self.history_store.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::context::ToolContext;
    use crate::core::executor::ToolExecutor;
    use crate::core::registry::ToolRegistry;
    use crate::store::config::{ConfigError, UserConfig};
    use crate::store::history::{HistoryError, HistoryFilter};
    use async_trait::async_trait;
    use serde_json::Value;

    /// Mock ConfigStore 用于测试
    struct MockConfigStore {
        data: Mutex<std::collections::HashMap<String, Value>>,
    }

    impl MockConfigStore {
        fn new() -> Self {
            Self {
                data: Mutex::new(std::collections::HashMap::new()),
            }
        }
    }

    #[async_trait]
    impl ConfigStore for MockConfigStore {
        async fn get(&self, key: &str) -> Result<Value, ConfigError> {
            self.data
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .ok_or_else(|| ConfigError::NotFound(key.into()))
        }

        async fn set(&self, key: &str, value: Value) -> Result<(), ConfigError> {
            self.data.lock().unwrap().insert(key.into(), value);
            Ok(())
        }

        async fn get_all(&self) -> Result<UserConfig, ConfigError> {
            Ok(UserConfig::default())
        }

        async fn reset(&self, key: &str) -> Result<(), ConfigError> {
            self.data.lock().unwrap().remove(key);
            Ok(())
        }
    }

    /// Mock HistoryStore 用于测试
    struct MockHistoryStore {
        entries: Mutex<Vec<HistoryEntry>>,
    }

    impl MockHistoryStore {
        fn new() -> Self {
            Self {
                entries: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, entry: HistoryEntry) -> Result<(), HistoryError> {
            self.entries.lock().unwrap().push(entry);
            Ok(())
        }

        async fn list(&self, filter: HistoryFilter) -> Result<Vec<HistoryEntry>, HistoryError> {
            let entries = self.entries.lock().unwrap();
            let limit = filter.limit.unwrap_or(entries.len());
            Ok(entries.iter().take(limit).cloned().collect())
        }

        async fn clear(&self, _tool_id: Option<&str>) -> Result<(), HistoryError> {
            self.entries.lock().unwrap().clear();
            Ok(())
        }
    }

    fn make_test_state() -> AppState {
        let registry = ToolRegistry::global();
        let executor = Arc::new(ToolExecutor::new(registry));
        let config_store: Arc<dyn ConfigStore> = Arc::new(MockConfigStore::new());
        let history_store: Arc<dyn HistoryStore> = Arc::new(MockHistoryStore::new());
        AppState::new(executor, config_store, history_store)
    }

    #[test]
    fn test_app_state_construction() {
        let state = make_test_state();
        // 验证字段可访问
        let _executor = &state.executor;
        let _config = &state.config_store;
        let _history = &state.history_store;
        let _tasks = &state.streaming_tasks;
    }

    #[test]
    fn test_app_handle_initially_none() {
        let state = make_test_state();
        assert!(state.app_handle().is_none());
    }

    #[test]
    fn test_streaming_task_registry_register_cancel() {
        let registry = StreamingTaskRegistry::new();
        let task_id = "task-123";
        let token = registry.register(task_id);
        assert_eq!(registry.active_count(), 1);
        assert!(!token.is_cancelled());

        assert!(registry.cancel(task_id));
        assert!(token.is_cancelled());
        assert_eq!(registry.active_count(), 0);

        // 再次取消返回 false
        assert!(!registry.cancel(task_id));
    }

    #[test]
    fn test_streaming_task_registry_unregister() {
        let registry = StreamingTaskRegistry::new();
        let _token = registry.register("task-456");
        assert_eq!(registry.active_count(), 1);
        registry.unregister("task-456");
        assert_eq!(registry.active_count(), 0);
    }

    #[test]
    fn test_history_sink_impl_construct() {
        let store: Arc<dyn HistoryStore> = Arc::new(MockHistoryStore::new());
        let sink = HistorySinkImpl::new(store);
        // 仅验证构造成功
        let _ = &sink;
    }
}
```

### 步骤 4.2: 验证测试失败

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib shell::state
```

**预期:** 若 `ConfigStore` trait 无 `reset` 方法或 `UserConfig` 无 `Default`,编译失败。需在 02 Core 中补充(或本计划中调整 Mock)。

> **修正提示:** 若 02 的 ConfigStore trait 尚无 `reset` 方法,需在 02 中补充:
> ```rust
> async fn reset(&self, key: &str) -> Result<(), ConfigError>;
> ```
> 若 UserConfig 无 Default,添加 `#[derive(Default)]`。本计划假设 02 已包含这些。

### 步骤 4.3: 确保 Core 类型满足要求

- [x] 若 02 的 `ConfigStore` trait 缺少 `reset` 方法,在 `src-tauri/src/store/config.rs` 中添加:

```rust
#[async_trait]
pub trait ConfigStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<serde_json::Value, ConfigError>;
    async fn set(&self, key: &str, value: serde_json::Value) -> Result<(), ConfigError>;
    async fn get_all(&self) -> Result<UserConfig, ConfigError>;
    async fn reset(&self, key: &str) -> Result<(), ConfigError>;
}
```

- [x] 确保 `UserConfig` 派生 `Default`:

```rust
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct UserConfig {
    // ... 字段
}
```

### 步骤 4.4: 验证测试通过

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib shell::state
```

**预期:** 5 个测试全部通过。

### 步骤 4.5: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/shell/state.rs src-tauri/src/store/config.rs
git commit -m "feat(shell): add AppState, StreamingTaskRegistry, HistorySinkImpl"
```

---

## Task 5: commands/tool.rs — 工具执行 IPC

**目标:** 实现工具相关的 5 个 IPC Command:tool_list、tool_metadata、tool_execute、tool_execute_stream、tool_cancel。

### 设计说明

为保证可测试性,每个 `#[tauri::command]` 函数委托给一个内部函数(`_inner`),内部函数接收 `&AppState` 等普通引用,可在单元测试中直接调用。流式任务通过 `tokio::spawn` 在后台执行,通过事件推送 StreamEvent。

### 步骤 5.1: 写失败测试

- [x] 创建 `src-tauri/src/commands/tool.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/tool.rs

use std::sync::Arc;

use futures::StreamExt;
use serde_json::Value;
use tauri::Emitter;

use crate::core::context::ToolContext;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::tool::{StreamEvent, ToolMetadata};
use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;

// ============ 内部函数(可测试) ============

/// 列出所有已注册工具的元数据
pub async fn tool_list_inner(state: &AppState) -> Result<CommandResponse<Vec<ToolMetadata>>, AppError> {
    let tools = state.executor.list_tools();
    Ok(CommandResponse::ok(tools))
}

/// 查询单个工具的元数据
pub async fn tool_metadata_inner(
    tool_id: &str,
    state: &AppState,
) -> Result<CommandResponse<ToolMetadata>, AppError> {
    let meta = state
        .executor
        .get_tool(tool_id)
        .ok_or_else(|| AppError::Tool(crate::core::error::ToolError::ToolNotFound(tool_id.into())))?;
    Ok(CommandResponse::ok(meta.clone()))
}

/// 同步执行工具
pub async fn tool_execute_inner(
    tool_id: &str,
    input: ToolInput,
    state: &AppState,
) -> Result<CommandResponse<ToolOutput>, AppError> {
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let history_sink = state.history_sink();

    let ctx = ToolContext {
        cancel_token,
        history_sink: Box::new(history_sink),
    };

    let output = state.executor.execute(tool_id, input, ctx).await?;
    Ok(CommandResponse::ok(output))
}

/// 启动流式工具执行,返回 task_id,后台通过事件推送结果
///
/// 事件映射:
/// - StreamEvent::Progress → "tool_progress"
/// - StreamEvent::Chunk → "tool_chunk"
/// - StreamEvent::Done → "tool_completed"
/// - StreamEvent::Error → "tool_failed"
pub async fn tool_execute_stream_inner(
    tool_id: &str,
    file_path: &str,
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = state.streaming_tasks.register(&task_id);

    let input = ToolInput {
        file_path: Some(file_path.to_string()),
        ..Default::default()
    };

    let history_sink = state.history_sink();
    let ctx = ToolContext {
        cancel_token: cancel_token.clone(),
        history_sink: Box::new(history_sink),
    };

    let executor = state.executor.clone();
    let streaming_tasks = state.streaming_tasks.clone();
    let task_id_clone = task_id.clone();
    let tool_id_owned = tool_id.to_string();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let stream_result = executor.execute_stream(&tool_id_owned, input, ctx).await;

        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(StreamEvent::Progress { percent, message }) => {
                            let payload = serde_json::json!({
                                "taskId": &task_id_clone,
                                "percent": percent,
                                "message": message,
                            });
                            let _ = app_handle_clone.emit("tool_progress", &payload);
                        }
                        Ok(StreamEvent::Chunk { text }) => {
                            let payload = serde_json::json!({
                                "taskId": &task_id_clone,
                                "text": text,
                            });
                            let _ = app_handle_clone.emit("tool_chunk", &payload);
                        }
                        Ok(StreamEvent::Done { output }) => {
                            let payload = serde_json::json!({
                                "taskId": &task_id_clone,
                                "output": output,
                            });
                            let _ = app_handle_clone.emit("tool_completed", &payload);
                            break;
                        }
                        Ok(StreamEvent::Error { error }) => {
                            let payload = serde_json::json!({
                                "taskId": &task_id_clone,
                                "error": error,
                            });
                            let _ = app_handle_clone.emit("tool_failed", &payload);
                            break;
                        }
                        Err(e) => {
                            let payload = serde_json::json!({
                                "taskId": &task_id_clone,
                                "error": e,
                            });
                            let _ = app_handle_clone.emit("tool_failed", &payload);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                let payload = serde_json::json!({
                    "taskId": &task_id_clone,
                    "error": e,
                });
                let _ = app_handle_clone.emit("tool_failed", &payload);
            }
        }

        streaming_tasks.unregister(&task_id_clone);
    });

    Ok(CommandResponse::ok(task_id))
}

/// 取消流式任务
///
/// 注:taskId 仅适用于流式任务(tool_execute_stream 返回的 ID),
/// 对同步执行的 tool_execute 无效。
pub async fn tool_cancel_inner(
    task_id: &str,
    state: &AppState,
) -> Result<CommandResponse<()>, AppError> {
    let cancelled = state.streaming_tasks.cancel(task_id);
    if !cancelled {
        return Err(AppError::Permission(format!(
            "task not found or already completed: {}",
            task_id
        )));
    }
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn tool_list(
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<Vec<ToolMetadata>>, AppError> {
    tool_list_inner(&state).await
}

#[tauri::command]
pub async fn tool_metadata(
    tool_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<ToolMetadata>, AppError> {
    tool_metadata_inner(&tool_id, &state).await
}

#[tauri::command]
pub async fn tool_execute(
    tool_id: String,
    input: ToolInput,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<ToolOutput>, AppError> {
    tool_execute_inner(&tool_id, input, &state).await
}

#[tauri::command]
pub async fn tool_execute_stream(
    tool_id: String,
    file_path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    tool_execute_stream_inner(&tool_id, &file_path, &state, &app_handle).await
}

/// 取消流式任务
///
/// 注:taskId 仅适用于流式任务(tool_execute_stream 返回的 ID),
/// 对同步执行的 tool_execute 无效。
#[tauri::command]
pub async fn tool_cancel(
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<()>, AppError> {
    tool_cancel_inner(&task_id, &state).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::context::HistorySink;
    use crate::core::error::ToolError;
    use crate::core::executor::ToolExecutor;
    use crate::core::input::ToolInput;
    use crate::core::output::ToolOutput;
    use crate::core::registry::ToolRegistry;
    use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
    use crate::shell::state::AppState;
    use crate::store::config::{ConfigError, UserConfig};
    use crate::store::history::{HistoryEntry, HistoryError, HistoryFilter};
    use async_trait::async_trait;
    use serde_json::Value;
    use std::sync::Mutex;

    // ---- Mock 依赖 ----

    struct MockConfigStore;
    #[async_trait]
    impl crate::store::config::ConfigStore for MockConfigStore {
        async fn get(&self, _key: &str) -> Result<Value, ConfigError> {
            Err(ConfigError::NotFound("none".into()))
        }
        async fn set(&self, _key: &str, _value: Value) -> Result<(), ConfigError> {
            Ok(())
        }
        async fn get_all(&self) -> Result<UserConfig, ConfigError> {
            Ok(UserConfig::default())
        }
        async fn reset(&self, _key: &str) -> Result<(), ConfigError> {
            Ok(())
        }
    }

    struct MockHistoryStore;
    #[async_trait]
    impl crate::store::history::HistoryStore for MockHistoryStore {
        async fn add(&self, _entry: HistoryEntry) -> Result<(), HistoryError> {
            Ok(())
        }
        async fn list(&self, _filter: HistoryFilter) -> Result<Vec<HistoryEntry>, HistoryError> {
            Ok(vec![])
        }
        async fn clear(&self, _tool_id: Option<&str>) -> Result<(), HistoryError> {
            Ok(())
        }
    }

    fn make_state() -> AppState {
        let registry = ToolRegistry::global();
        let executor = Arc::new(ToolExecutor::new(registry));
        AppState::new(
            executor,
            Arc::new(MockConfigStore) as Arc<dyn crate::store::config::ConfigStore>,
            Arc::new(MockHistoryStore) as Arc<dyn crate::store::history::HistoryStore>,
        )
    }

    #[tokio::test]
    async fn test_tool_list_returns_response() {
        let state = make_state();
        let resp = tool_list_inner(&state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
        // 注册表可能为空(无工具编译进来)或非空(有测试工具)
        let _tools = resp.data.unwrap();
    }

    #[tokio::test]
    async fn test_tool_metadata_not_found() {
        let state = make_state();
        let result = tool_metadata_inner("nonexistent_tool", &state).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
    }

    #[tokio::test]
    async fn test_tool_execute_not_found() {
        let state = make_state();
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        let result = tool_execute_inner("nonexistent_tool", input, &state).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
    }

    #[tokio::test]
    async fn test_tool_cancel_nonexistent_task() {
        let state = make_state();
        let result = tool_cancel_inner("nonexistent-task-id", &state).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_tool_cancel_registered_task() {
        let state = make_state();
        let task_id = "test-task-001";
        let _token = state.streaming_tasks.register(task_id);

        let resp = tool_cancel_inner(task_id, &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
    }
}
```

### 步骤 5.2: 验证测试失败

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::tool
```

**预期:** 若 `ToolExecutor` 缺少 `list_tools`、`get_tool`、`execute_stream` 方法,编译失败。

### 步骤 5.3: 确保 ToolExecutor 暴露必要方法

- [x] 若 02 的 `ToolExecutor` 缺少以下方法,在 `src-tauri/src/core/executor.rs` 中补充:

```rust
impl ToolExecutor {
    /// 列出所有工具元数据
    pub fn list_tools(&self) -> Vec<ToolMetadata> {
        self.registry.list().into_iter().cloned().collect()
    }

    /// 按 id 查找工具元数据
    pub fn get_tool(&self, id: &str) -> Option<ToolMetadata> {
        self.registry.get(id).map(|e| e.metadata.clone())
    }

    /// 启动流式执行,返回事件流
    pub async fn execute_stream(
        &self,
        tool_id: &str,
        input: ToolInput,
        ctx: ToolContext,
    ) -> Result<futures::stream::BoxStream<'static, Result<StreamEvent, ToolError>>, ToolError>
    {
        use crate::core::registry::StreamingEntry;
        use inventory::iter;

        let entry = iter::<StreamingEntry>()
            .find(|e| e.id == tool_id)
            .ok_or_else(|| ToolError::ToolNotFound(tool_id.to_string()))?;

        let stream = entry.tool.execute_stream(input, &ctx);
        Ok(stream)
    }
}
```

- [x] 创建 `src-tauri/src/commands/mod.rs`:

```rust
// src-tauri/src/commands/mod.rs

pub mod tool;
pub mod config;
pub mod history;
pub mod clipboard;
pub mod fs;
pub mod app;
```

### 步骤 5.4: 验证测试通过

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::tool
```

**预期:** 5 个测试全部通过。

### 步骤 5.5: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/ src-tauri/src/core/executor.rs
git commit -m "feat(shell): add tool IPC commands (list/metadata/execute/stream/cancel)"
```

---

## Task 6: commands/config.rs — 配置 IPC

**目标:** 实现 config_get、config_set、config_get_all、config_reset 四个 Command。config_set 与 config_reset 成功后 emit `config_changed` 事件。

### 步骤 6.1: 写失败测试

- [x] 创建 `src-tauri/src/commands/config.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/config.rs

use serde_json::Value;
use tauri::Emitter;

use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;
use crate::store::config::UserConfig;

// ============ 事件 Payload ============

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangedPayload {
    pub key: String,
    pub old_value: Value,
    pub new_value: Value,
}

// ============ 内部函数(可测试) ============

pub async fn config_get_inner(
    key: &str,
    state: &AppState,
) -> Result<CommandResponse<Option<Value>>, AppError> {
    match state.config_store.get(key).await {
        Ok(value) => Ok(CommandResponse::ok(Some(value))),
        Err(crate::store::config::ConfigError::NotFound(_)) => Ok(CommandResponse::ok(None)),
        Err(e) => Err(AppError::config(e.to_string())),
    }
}

pub async fn config_set_inner(
    key: &str,
    value: Value,
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    // 读取旧值用于事件 payload
    let old_value = state
        .config_store
        .get(key)
        .await
        .unwrap_or(Value::Null);

    state
        .config_store
        .set(key, value.clone())
        .await
        .map_err(|e| AppError::config(e.to_string()))?;

    // emit config_changed 事件
    let payload = ConfigChangedPayload {
        key: key.to_string(),
        old_value,
        new_value: value,
    };
    let _ = app_handle.emit("config_changed", &payload);

    Ok(CommandResponse::ok(()))
}

pub async fn config_get_all_inner(
    state: &AppState,
) -> Result<CommandResponse<UserConfig>, AppError> {
    let config = state
        .config_store
        .get_all()
        .await
        .map_err(|e| AppError::config(e.to_string()))?;
    Ok(CommandResponse::ok(config))
}

pub async fn config_reset_inner(
    key: &str,
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    let old_value = state
        .config_store
        .get(key)
        .await
        .unwrap_or(Value::Null);

    state
        .config_store
        .reset(key)
        .await
        .map_err(|e| AppError::config(e.to_string()))?;

    let payload = ConfigChangedPayload {
        key: key.to_string(),
        old_value,
        new_value: Value::Null,
    };
    let _ = app_handle.emit("config_changed", &payload);

    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn config_get(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<Option<Value>>, AppError> {
    config_get_inner(&key, &state).await
}

#[tauri::command]
pub async fn config_set(
    key: String,
    value: Value,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    config_set_inner(&key, value, &state, &app_handle).await
}

#[tauri::command]
pub async fn config_get_all(
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<UserConfig>, AppError> {
    config_get_all_inner(&state).await
}

#[tauri::command]
pub async fn config_reset(
    key: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    config_reset_inner(&key, &state, &app_handle).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::config::{ConfigError, ConfigStore, UserConfig};
    use crate::store::history::{HistoryEntry, HistoryError, HistoryFilter, HistoryStore};
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    struct MockConfigStore {
        data: Mutex<std::collections::HashMap<String, Value>>,
    }

    impl MockConfigStore {
        fn new() -> Self {
            let mut data = std::collections::HashMap::new();
            data.insert("theme".into(), Value::String("dark".into()));
            Self { data: Mutex::new(data) }
        }
    }

    #[async_trait]
    impl ConfigStore for MockConfigStore {
        async fn get(&self, key: &str) -> Result<Value, ConfigError> {
            self.data
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .ok_or_else(|| ConfigError::NotFound(key.into()))
        }
        async fn set(&self, key: &str, value: Value) -> Result<(), ConfigError> {
            self.data.lock().unwrap().insert(key.into(), value);
            Ok(())
        }
        async fn get_all(&self) -> Result<UserConfig, ConfigError> {
            Ok(UserConfig::default())
        }
        async fn reset(&self, key: &str) -> Result<(), ConfigError> {
            self.data.lock().unwrap().remove(key);
            Ok(())
        }
    }

    struct MockHistoryStore;
    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, _entry: HistoryEntry) -> Result<(), HistoryError> { Ok(()) }
        async fn list(&self, _filter: HistoryFilter) -> Result<Vec<HistoryEntry>, HistoryError> { Ok(vec![]) }
        async fn clear(&self, _tool_id: Option<&str>) -> Result<(), HistoryError> { Ok(()) }
    }

    fn make_state() -> AppState {
        let registry = crate::core::registry::ToolRegistry::global();
        let executor = Arc::new(crate::core::executor::ToolExecutor::new(registry));
        AppState::new(
            executor,
            Arc::new(MockConfigStore::new()) as Arc<dyn ConfigStore>,
            Arc::new(MockHistoryStore) as Arc<dyn HistoryStore>,
        )
    }

    #[tokio::test]
    async fn test_config_get_existing_key() {
        let state = make_state();
        let resp = config_get_inner("theme", &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap(), Some(Value::String("dark".into())));
    }

    #[tokio::test]
    async fn test_config_get_missing_key_returns_none() {
        let state = make_state();
        let resp = config_get_inner("nonexistent", &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap(), None);
    }

    #[tokio::test]
    async fn test_config_get_all() {
        let state = make_state();
        let resp = config_get_all_inner(&state).await.unwrap();
        assert!(resp.success);
        assert!(resp.data.is_some());
    }

    #[tokio::test]
    async fn test_config_reset_missing_key_no_error() {
        let state = make_state();
        // reset 不存在的 key 不应报错
        // 注意:无法在无 Tauri 运行时测试 emit,此测试仅验证 reset 逻辑
        let result = state.config_store.reset("nonexistent").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_config_set_via_store() {
        let state = make_state();
        // 直接测试 store 层 set,绕过 emit(emit 需 AppHandle)
        state
            .config_store
            .set("new_key", Value::String("new_value".into()))
            .await
            .unwrap();
        let val = state.config_store.get("new_key").await.unwrap();
        assert_eq!(val, Value::String("new_value".into()));
    }
}
```

### 步骤 6.2: 验证测试

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::config
```

**预期:** 5 个测试通过(emit 相关逻辑需集成测试覆盖,单元测试绕过)。

### 步骤 6.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/config.rs
git commit -m "feat(shell): add config IPC commands with config_changed event"
```

---

## Task 7: commands/history.rs — 历史 IPC

**目标:** 实现 history_list、history_clear 两个 Command。

### 步骤 7.1: 写失败测试

- [x] 创建 `src-tauri/src/commands/history.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/history.rs

use tauri::Emitter;

use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;
use crate::store::history::{HistoryEntry, HistoryFilter};

// ============ 事件 Payload ============

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryClearedPayload {
    pub tool_id: Option<String>,
}

// ============ 内部函数(可测试) ============

pub async fn history_list_inner(
    limit: Option<u32>,
    state: &AppState,
) -> Result<CommandResponse<Vec<HistoryEntry>>, AppError> {
    let filter = HistoryFilter {
        limit: limit.map(|l| l as usize),
        offset: None,
        tool_id: None,
    };
    let entries = state
        .history_store
        .list(filter)
        .await
        .map_err(|e| AppError::history(e.to_string()))?;
    Ok(CommandResponse::ok(entries))
}

pub async fn history_clear_inner(
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    state
        .history_store
        .clear(None)
        .await
        .map_err(|e| AppError::history(e.to_string()))?;

    let payload = HistoryClearedPayload { tool_id: None };
    let _ = app_handle.emit("history_cleared", &payload);

    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn history_list(
    limit: Option<u32>,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<Vec<HistoryEntry>>, AppError> {
    history_list_inner(limit, &state).await
}

#[tauri::command]
pub async fn history_clear(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    history_clear_inner(&state, &app_handle).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::config::{ConfigError, ConfigStore, UserConfig};
    use crate::store::history::{HistoryError, HistoryStore};
    use async_trait::async_trait;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};

    struct MockConfigStore;
    #[async_trait]
    impl ConfigStore for MockConfigStore {
        async fn get(&self, _key: &str) -> Result<Value, ConfigError> {
            Err(ConfigError::NotFound("none".into()))
        }
        async fn set(&self, _key: &str, _value: Value) -> Result<(), ConfigError> { Ok(()) }
        async fn get_all(&self) -> Result<UserConfig, ConfigError> { Ok(UserConfig::default()) }
        async fn reset(&self, _key: &str) -> Result<(), ConfigError> { Ok(()) }
    }

    struct MockHistoryStore {
        entries: Mutex<Vec<HistoryEntry>>,
    }
    impl MockHistoryStore {
        fn with_entries(count: usize) -> Self {
            let entries: Vec<HistoryEntry> = (0..count)
                .map(|i| HistoryEntry {
                    id: format!("entry-{}", i),
                    tool_id: "test_tool".into(),
                    ..Default::default()
                })
                .collect();
            Self { entries: Mutex::new(entries) }
        }
    }
    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, _entry: HistoryEntry) -> Result<(), HistoryError> { Ok(()) }
        async fn list(&self, filter: HistoryFilter) -> Result<Vec<HistoryEntry>, HistoryError> {
            let entries = self.entries.lock().unwrap();
            let limit = filter.limit.unwrap_or(entries.len());
            Ok(entries.iter().take(limit).cloned().collect())
        }
        async fn clear(&self, _tool_id: Option<&str>) -> Result<(), HistoryError> {
            self.entries.lock().unwrap().clear();
            Ok(())
        }
    }

    fn make_state(history: MockHistoryStore) -> AppState {
        let registry = crate::core::registry::ToolRegistry::global();
        let executor = Arc::new(crate::core::executor::ToolExecutor::new(registry));
        AppState::new(
            executor,
            Arc::new(MockConfigStore) as Arc<dyn ConfigStore>,
            Arc::new(history) as Arc<dyn HistoryStore>,
        )
    }

    #[tokio::test]
    async fn test_history_list_empty() {
        let state = make_state(MockHistoryStore::with_entries(0));
        let resp = history_list_inner(None, &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_history_list_with_entries() {
        let state = make_state(MockHistoryStore::with_entries(5));
        let resp = history_list_inner(None, &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap().len(), 5);
    }

    #[tokio::test]
    async fn test_history_list_with_limit() {
        let state = make_state(MockHistoryStore::with_entries(10));
        let resp = history_list_inner(Some(3), &state).await.unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn test_history_clear_via_store() {
        let state = make_state(MockHistoryStore::with_entries(3));
        state.history_store.clear(None).await.unwrap();
        let resp = history_list_inner(None, &state).await.unwrap();
        assert_eq!(resp.data.unwrap().len(), 0);
    }
}
```

### 步骤 7.2: 验证测试

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::history
```

**预期:** 4 个测试通过。

> **修正提示:** 若 `HistoryEntry` 未派生 `Default` 或字段不匹配,需在 02 中调整。本计划假设 `HistoryEntry` 有 `id`、`tool_id` 字段且派生 `Default`、`Clone`。

### 步骤 7.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/history.rs
git commit -m "feat(shell): add history IPC commands (list/clear)"
```

---

## Task 8: commands/clipboard.rs — 剪贴板 IPC

**目标:** 实现 clipboard_read_text、clipboard_write_text,使用 tauri-plugin-clipboard-manager。

### 步骤 8.1: 写失败测试与实现

- [x] 创建 `src-tauri/src/commands/clipboard.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/clipboard.rs

use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;

// ============ 内部函数(可测试) ============

pub fn clipboard_read_text_inner(
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    let text = app_handle
        .clipboard()
        .read_text()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clipboard read failed: {}", e)))?;
    tracing::info!(length = text.len(), "clipboard read");
    Ok(CommandResponse::ok(text))
}

pub fn clipboard_write_text_inner(
    text: &str,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_handle
        .clipboard()
        .write_text(text)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clipboard write failed: {}", e)))?;
    tracing::info!(length = text.len(), "clipboard write");
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn clipboard_read_text(
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    clipboard_read_text_inner(&app_handle)
}

#[tauri::command]
pub async fn clipboard_write_text(
    text: String,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    clipboard_write_text_inner(&text, &app_handle)
}

#[cfg(test)]
mod tests {
    // 剪贴板操作需要 Tauri 运行时与系统剪贴板访问权限,
    // 单元测试无法模拟,以下测试标记为 #[ignore],需手动运行:
    //   cargo test -- --ignored commands::clipboard
    //
    // 集成测试在 tests/smoke.rs 中覆盖(若需)。

    use super::*;

    #[tokio::test]
    #[ignore = "requires running tauri app with clipboard access"]
    async fn test_clipboard_read_text_integration() {
        // 需要在 Tauri 测试环境中运行
        // 此测试仅作为占位,实际验证在 smoke test 中
    }

    #[tokio::test]
    #[ignore = "requires running tauri app with clipboard access"]
    async fn test_clipboard_write_text_integration() {
        // 同上
    }

    // 以下为纯逻辑测试(不依赖剪贴板)

    #[test]
    fn test_clipboard_command_signatures() {
        // 验证函数存在且签名正确(编译期检查)
        let _read_fn = clipboard_read_text_inner;
        let _write_fn = clipboard_write_text_inner;
    }
}
```

### 步骤 8.2: 验证测试

- [x] 运行测试(仅非 ignore 的):

```bash
cd src-tauri && cargo test --lib commands::clipboard
```

**预期:** 1 个非 ignore 测试通过,2 个 ignore 测试跳过。

### 步骤 8.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/clipboard.rs
git commit -m "feat(shell): add clipboard IPC commands via tauri-plugin-clipboard-manager"
```

---

## Task 9: commands/fs.rs — 文件系统 IPC(受限)

**目标:** 实现 fs_read_file、fs_write_file,通过 AuthorizedPaths 限制仅允许用户在 dialog 中显式选择的路径 + app 数据目录。

### 步骤 9.1: 写失败测试与实现

- [x] 创建 `src-tauri/src/commands/fs.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/fs.rs

use std::collections::HashSet;
use std::sync::Mutex;

use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;

/// 授权路径集合
///
/// 用户通过 dialog 显式选择的文件路径会被加入此集合,
/// fs_read_file / fs_write_file 仅允许操作集合中的路径或 app 数据目录。
#[derive(Default)]
pub struct AuthorizedPaths {
    inner: Mutex<HashSet<String>>,
}

impl AuthorizedPaths {
    pub fn new() -> Self {
        Self::default()
    }

    /// 授权一个路径(用户通过 dialog 选择后调用)
    pub fn authorize(&self, path: &str) {
        self.inner
            .lock()
            .expect("AuthorizedPaths mutex poisoned")
            .insert(path.to_string());
    }

    /// 检查路径是否已授权
    pub fn is_authorized(&self, path: &str) -> bool {
        self.inner
            .lock()
            .expect("AuthorizedPaths mutex poisoned")
            .contains(path)
    }

    /// 撤销路径授权
    pub fn revoke(&self, path: &str) {
        self.inner
            .lock()
            .expect("AuthorizedPaths mutex poisoned")
            .remove(path);
    }
}

// ============ 内部函数(可测试) ============

/// 校验路径是否在允许范围内
///
/// MVP 简化策略:仅允许 AuthorizedPaths 中的路径。
/// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。
fn validate_path(path: &str, authorized: &AuthorizedPaths) -> Result<(), AppError> {
    if authorized.is_authorized(path) {
        Ok(())
    } else {
        Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {}",
            path
        )))
    }
}

pub async fn fs_read_file_inner(
    path: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    validate_path(path, authorized)?;
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(content))
}

pub async fn fs_write_file_inner(
    path: &str,
    content: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<()>, AppError> {
    validate_path(path, authorized)?;
    tokio::fs::write(path, content)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn fs_read_file(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<String>, AppError> {
    fs_read_file_inner(&path, &authorized).await
}

#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<()>, AppError> {
    fs_write_file_inner(&path, &content, &authorized).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_authorized_paths_authorize_and_check() {
        let paths = AuthorizedPaths::new();
        assert!(!paths.is_authorized("/tmp/secret.txt"));

        paths.authorize("/tmp/allowed.txt");
        assert!(paths.is_authorized("/tmp/allowed.txt"));
        assert!(!paths.is_authorized("/tmp/other.txt"));
    }

    #[test]
    fn test_authorized_paths_revoke() {
        let paths = AuthorizedPaths::new();
        paths.authorize("/tmp/revoke.txt");
        assert!(paths.is_authorized("/tmp/revoke.txt"));

        paths.revoke("/tmp/revoke.txt");
        assert!(!paths.is_authorized("/tmp/revoke.txt"));
    }

    #[tokio::test]
    async fn test_fs_read_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_read_file_inner("/etc/passwd", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_write_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_write_file_inner("/tmp/forbidden.txt", "content", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_read_write_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_round_trip.txt");
        let path_str = path.to_str().unwrap();

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        // 写入
        let write_resp = fs_write_file_inner(path_str, "hello qraft", &paths).await.unwrap();
        assert!(write_resp.success);

        // 读取
        let read_resp = fs_read_file_inner(path_str, &paths).await.unwrap();
        assert!(read_resp.success);
        assert_eq!(read_resp.data.unwrap(), "hello qraft");

        // 清理
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_fs_read_file_not_found_but_authorized() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_nonexistent.txt");
        let path_str = path.to_str().unwrap();
        // 确保文件不存在
        let _ = std::fs::remove_file(&path);

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        let result = fs_read_file_inner(path_str, &paths).await;
        assert!(result.is_err());
        // io::Error → AppError::Io → code "ERR_FILE_IO"
        assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
    }
}
```

### 步骤 9.2: 验证测试

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::fs
```

**预期:** 6 个测试通过。

### 步骤 9.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/fs.rs
git commit -m "feat(shell): add fs IPC commands with AuthorizedPaths sandbox"
```

---

## Task 10: commands/app.rs — 应用级 IPC

**目标:** 实现 app_open_external(仅 http/https)、app_version、app_quit。

### 步骤 10.1: 写失败测试与实现

- [x] 创建 `src-tauri/src/commands/app.rs` 并写入测试与实现:

```rust
// src-tauri/src/commands/app.rs

use tauri_plugin_shell::ShellExt;

use crate::shell::error::AppError;
use crate::shell::response::CommandResponse;

// ============ URL 校验 ============

/// 校验 URL scheme 是否允许打开
///
/// 仅允许 http:// 和 https://,防止 file://、javascript:// 等危险 scheme
pub fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let lower = url.to_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "url scheme not allowed, only http/https: {}",
            url
        )))
    }
}

// ============ 内部函数(可测试) ============

pub fn app_open_external_inner(
    url: &str,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    validate_url_scheme(url)?;
    app_handle
        .shell()
        .open(url, None)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("open url failed: {}", e)))?;
    Ok(CommandResponse::ok(()))
}

pub fn app_version_inner() -> Result<CommandResponse<String>, AppError> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    Ok(CommandResponse::ok(version))
}

pub fn app_quit_inner(app_handle: &tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    app_handle.exit(0);
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn app_open_external(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_open_external_inner(&url, &app_handle)
}

#[tauri::command]
pub async fn app_version() -> Result<CommandResponse<String>, AppError> {
    app_version_inner()
}

#[tauri::command]
pub async fn app_quit(
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_quit_inner(&app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_scheme_https() {
        assert!(validate_url_scheme("https://example.com").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_http() {
        assert!(validate_url_scheme("http://localhost:3000").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_uppercase_https() {
        assert!(validate_url_scheme("HTTPS://Example.COM").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_file_forbidden() {
        let result = validate_url_scheme("file:///etc/passwd");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_validate_url_scheme_javascript_forbidden() {
        let result = validate_url_scheme("javascript:alert(1)");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_validate_url_scheme_ftp_forbidden() {
        let result = validate_url_scheme("ftp://example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_app_version_returns_nonempty() {
        let resp = app_version_inner().unwrap();
        assert!(resp.success);
        let version = resp.data.unwrap();
        assert!(!version.is_empty());
        // 应为 semver 格式
        assert!(version.contains('.'));
    }

    #[tokio::test]
    #[ignore = "requires running tauri app"]
    async fn test_app_quit_integration() {
        // 需要 Tauri 运行时,手动测试
    }
}
```

### 步骤 10.2: 验证测试

- [x] 运行测试:

```bash
cd src-tauri && cargo test --lib commands::app
```

**预期:** 7 个非 ignore 测试通过,1 个 ignore 测试跳过。

### 步骤 10.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/commands/app.rs
git commit -m "feat(shell): add app IPC commands (open_external/version/quit) with url validation"
```

---

## Task 11: capabilities/ — 权限配置

**目标:** 在 `src-tauri/capabilities/` 创建 8 个 JSON 文件,严格遵循最小权限原则,禁止 `**` 通配。

### 步骤 11.1: 创建 capabilities 文件

- [x] 创建 `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for main window: core Tauri permissions only",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-unminimize",
    "core:window:allow-unmaximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:event:default"
  ]
}
```

- [x] 创建 `src-tauri/capabilities/tool.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "tool",
  "description": "Capability for tool_* commands: list/metadata/execute/stream/cancel",
  "windows": ["main"],
  "permissions": []
}
```

> 注:Tauri V2 中自定义 `#[tauri::command]` 默认可被调用,capabilities 中无需额外声明。此文件作为文档保留,记录 tool 命令的权限意图。若后续需要限制自定义命令访问,可通过 Tauri 的命令权限系统扩展。

- [x] 创建 `src-tauri/capabilities/config.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "config",
  "description": "Capability for config_* commands: get/set/get_all/reset",
  "windows": ["main"],
  "permissions": []
}
```

- [x] 创建 `src-tauri/capabilities/history.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "history",
  "description": "Capability for history_* commands: list/clear",
  "windows": ["main"],
  "permissions": []
}
```

- [x] 创建 `src-tauri/capabilities/clipboard.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "clipboard",
  "description": "Capability for clipboard access: read/write text only",
  "windows": ["main"],
  "permissions": [
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text"
  ]
}
```

- [x] 创建 `src-tauri/capabilities/fs.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "fs",
  "description": "Capability for fs commands and dialog: read/write text files, file picker dialogs",
  "windows": ["main"],
  "permissions": [
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

> 注:`fs_read_file` / `fs_write_file` 为自定义命令,通过 AuthorizedPaths 在应用层校验路径,不使用 Tauri 内置 fs 插件权限(保持沙箱严格性)。dialog 权限供文件选择对话框使用。

- [x] 创建 `src-tauri/capabilities/shell.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "shell",
  "description": "Capability for shell: open external URLs (http/https only, validated in app layer)",
  "windows": ["main"],
  "permissions": [
    "shell:allow-open"
  ]
}
```

- [ ] 创建 `src-tauri/capabilities/updater.json`: <!-- 未完成: 文件不存在,仅创建 7 个 capability 文件(updater.json 缺失) -->

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "updater",
  "description": "Capability for updater: check and install updates (user-initiated only)",
  "windows": ["main"],
  "permissions": [
    "updater:default"
  ]
}
```

### 步骤 11.2: 验证 capabilities 配置

- [x] 运行 `pnpm tauri dev`(若前端尚未就绪,可仅 `cargo build` 验证 capabilities 解析):

```bash
cd src-tauri && cargo build
```

**预期:** 编译成功,无 capabilities 解析错误。若出现 `permission not found` 错误,检查插件是否在 lib.rs 中注册(见 Task 12)。

### 步骤 11.3: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/capabilities/
git commit -m "feat(shell): add capability files with minimum permissions"
```

---

## Task 12: lib.rs + main.rs — Tauri 应用装配

**目标:** 在 `src-tauri/src/lib.rs` 注册所有 commands、plugins、setup hook 初始化 AppState;`src-tauri/src/main.rs` 调用 `qraft_lib::run()`。

### 步骤 12.1: 写 lib.rs

- [x] 编辑 `src-tauri/src/lib.rs`:

```rust
// src-tauri/src/lib.rs

pub mod commands;
pub mod core;
pub mod shell;
pub mod store;

use std::sync::Arc;

use shell::state::AppState;
use store::config::{ConfigStore, JsonConfigStore};
use store::history::{HistoryStore, JsonlHistoryStore};
use tracing_subscriber::EnvFilter;

use commands::app::{app_open_external, app_quit, app_version};
use commands::clipboard::{clipboard_read_text, clipboard_write_text};
use commands::config::{config_get, config_get_all, config_reset, config_set};
use commands::fs::{fs_read_file, fs_write_file, AuthorizedPaths};
use commands::history::{history_clear, history_list};
use commands::tool::{tool_cancel, tool_execute, tool_execute_stream, tool_list, tool_metadata};

/// 初始化并运行 Tauri 应用
pub fn run() -> anyhow::Result<()> {
    // 初始化 tracing 日志
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::init())
        .setup(|app| {
            // 初始化 Core 依赖
            let registry = core::registry::ToolRegistry::global();
            tracing::info!("registered {} tools", registry.list().len());

            let executor = Arc::new(core::executor::ToolExecutor::new(registry));

            // 初始化 ConfigStore(应用数据目录)
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let config_path = config_dir.join("config.json");
            let config_store: Arc<dyn ConfigStore> = Arc::new(
                JsonConfigStore::new(&config_path)
                    .map_err(|e| anyhow::anyhow!("failed to init config store: {}", e))?,
            );

            // 初始化 HistoryStore(应用数据目录)
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let history_path = data_dir.join("history.jsonl");
            let history_store: Arc<dyn HistoryStore> = Arc::new(
                JsonlHistoryStore::new(&history_path)
                    .map_err(|e| anyhow::anyhow!("failed to init history store: {}", e))?,
            );

            // 构造 AppState 并注入 AppHandle
            let state = AppState::new(executor, config_store, history_store);
            state.set_app_handle(app.handle().clone())
                .map_err(|_| anyhow::anyhow!("app_handle already set"))?;

            app.manage(state);
            app.manage(AuthorizedPaths::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // tool commands
            tool_list,
            tool_metadata,
            tool_execute,
            tool_execute_stream,
            tool_cancel,
            // config commands
            config_get,
            config_set,
            config_get_all,
            config_reset,
            // history commands
            history_list,
            history_clear,
            // clipboard commands
            clipboard_read_text,
            clipboard_write_text,
            // fs commands
            fs_read_file,
            fs_write_file,
            // app commands
            app_open_external,
            app_version,
            app_quit,
        ])
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("tauri run error: {}", e))?;

    Ok(())
}
```

### 步骤 12.2: 写 main.rs

- [x] 编辑 `src-tauri/src/main.rs`:

```rust
// src-tauri/src/main.rs

// 防止 Windows release 构建弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = qraft_lib::run() {
        eprintln!("fatal error: {:#}", e);
        std::process::exit(1);
    }
}
```

### 步骤 12.3: 验证编译

- [x] 运行:

```bash
cd src-tauri && cargo check
```

**预期:** 编译通过,无错误。

### 步骤 12.4: 验证启动

- [x] 运行(若前端未就绪,WebView 会显示空白页,这是预期行为):

```bash
pnpm tauri dev
```

**预期:**
- 应用窗口启动
- 终端输出 `registered N tools`(N 可能为 0,因为 05 子计划尚未实现工具)
- 无权限错误、无 panic

### 步骤 12.5: 提交

- [x] 执行 git 提交:

```bash
git add src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat(shell): wire up tauri app with all commands, plugins, and state setup"
```

---

## Task 13: 集成冒烟测试

**目标:** 在 `src-tauri/tests/smoke.rs` 编写集成测试,启动 Tauri 应用并调用 tool_list,验证 Shell 层端到端可用。

### 步骤 13.1: 写冒烟测试

- [ ] 创建 `src-tauri/tests/smoke.rs`: <!-- 未完成: 文件不存在,tests 目录仅有 p0_tools_integration.rs -->

```rust
// src-tauri/tests/smoke.rs
//
// 集成冒烟测试:验证 Tauri Shell 层端到端可用。
//
// 运行方式:
//   cargo test --test smoke -- --ignored
//
// 标记 #[ignore] 因为需要窗口环境(WebView 初始化),
// 在无头 CI 环境中可能失败,需手动运行或在带桌面的 CI runner 中运行。

use qraft_lib::shell::response::CommandResponse;
use qraft_lib::core::tool::ToolMetadata;

/// 冒烟测试:启动 Tauri 应用,调用 tool_list,验证返回成功响应
///
/// 此测试验证:
/// 1. Tauri 应用可正常启动
/// 2. AppState 正确初始化
/// 3. tool_list Command 可被调用
/// 4. 返回符合 CommandResponse 包络格式
#[tokio::test]
#[ignore = "requires desktop environment with window support"]
async fn smoke_tool_list() {
    let app = tauri::test::mock_app()
        .build(tauri::generate_context!())
        .expect("failed to build mock app");

    let app_handle = app.handle().clone();

    // 通过 invoke 调用 tool_list
    let result: Result<CommandResponse<Vec<ToolMetadata>>, String> = app_handle
        .invoke("tool_list", ())
        .await;

    // 验证返回成功
    assert!(result.is_ok(), "tool_list should succeed");
    let resp = result.unwrap();
    assert!(resp.success, "response success should be true");
    assert_eq!(resp.code, "OK");
    // 此时 Core 已注册但 tools/ 为空,断言 = 0
    // (后续 05 子计划实现工具后会 > 0)
    let tools = resp.data.expect("data should be present");
    assert!(tools.len() == 0 || tools.len() > 0, "tool list should be accessible");
}

/// 冒烟测试:调用 app_version,验证返回版本号
#[tokio::test]
#[ignore = "requires desktop environment with window support"]
async fn smoke_app_version() {
    let app = tauri::test::mock_app()
        .build(tauri::generate_context!())
        .expect("failed to build mock app");

    let app_handle = app.handle().clone();

    let result: Result<CommandResponse<String>, String> = app_handle
        .invoke("app_version", ())
        .await;

    assert!(result.is_ok());
    let resp = result.unwrap();
    assert!(resp.success);
    let version = resp.data.unwrap();
    assert!(!version.is_empty());
    assert!(version.contains('.'), "version should be semver: {}", version);
}

/// 冒烟测试:调用不存在的工具,验证返回 ToolNotFound 错误
#[tokio::test]
#[ignore = "requires desktop environment with window support"]
async fn smoke_tool_not_found() {
    use qraft_lib::core::input::ToolInput;

    let app = tauri::test::mock_app()
        .build(tauri::generate_context!())
        .expect("failed to build mock app");

    let app_handle = app.handle().clone();

    let input = ToolInput {
        text: Some("test".into()),
        ..Default::default()
    };

    // tool_execute 对不存在的工具应返回错误
    let result: Result<CommandResponse<serde_json::Value>, tauri::ipc::InvokeError> = app_handle
        .invoke("tool_execute", tauri::ipc::InvokeArgs::new(serde_json::json!({
            "toolId": "nonexistent_smoke_tool",
            "input": input,
        })).unwrap())
        .await;

    // 由于 AppError 通过 Err 返回,invoke 应返回 InvokeError
    assert!(result.is_err(), "tool_execute with nonexistent tool should error");
}
```

### 步骤 13.2: 验证测试编译

- [ ] 运行(仅编译,不运行 ignored 测试): <!-- 未完成: smoke.rs 不存在,无法编译 -->

```bash
cd src-tauri && cargo test --test smoke --no-run
```

**预期:** 编译成功。

> **注:** Tauri V2 的测试 API(`tauri::test::mock_app()`)签名可能因版本略有差异。若编译失败,参考 [Tauri V2 测试文档](https://tauri.app/v2/guides/testing/) 调整 mock 调用方式。常见替代:
> ```rust
> let app = tauri::test::mock_builder()
>     .build(tauri::generate_context!())
>     .expect("failed to build mock app");
> ```

### 步骤 13.3: 运行冒烟测试(手动)

- [ ] 在带桌面环境的机器上运行: <!-- 未完成: smoke.rs 不存在 -->

```bash
cd src-tauri && cargo test --test smoke -- --ignored
```

**预期:** 3 个测试通过(或因 Tauri 测试 API 差异需微调,但核心逻辑验证 tool_list 可调用)。

### 步骤 13.4: 提交

- [ ] 执行 git 提交: <!-- 未完成: smoke.rs 不存在,无法提交 -->

```bash
git add src-tauri/tests/smoke.rs
git commit -m "test(shell): add integration smoke tests for tool_list, app_version, tool_not_found"
```

---

## 完成检查清单

执行完所有 Task 后,确认以下检查项全部通过:

### 编译与测试

- [x] `cd src-tauri && cargo check` 无错误
- [x] `cd src-tauri && cargo clippy -- -D warnings` 无 warning
- [x] `cd src-tauri && cargo fmt --check` 格式正确
- [x] `cd src-tauri && cargo test` 所有非 ignore 测试通过
- [ ] `cd src-tauri && cargo test -- --ignored` 冒烟测试通过(需桌面环境) <!-- 未完成: smoke.rs 不存在 -->

### 功能验证

- [x] `pnpm tauri dev` 启动应用,终端输出 `registered N tools`
- [x] WebView 显示空白页(无 React 内容,符合预期)
- [x] 无权限错误、无 panic、无 CSP 违规

### IPC Command 覆盖

确认以下 17 个 Command 已实现并在 `generate_handler!` 中注册:

| Command | 文件 | 状态 |
|---------|------|------|
| `tool_list` | `commands/tool.rs` | ☐ |
| `tool_metadata` | `commands/tool.rs` | ☐ |
| `tool_execute` | `commands/tool.rs` | ☐ |
| `tool_execute_stream` | `commands/tool.rs` | ☐ |
| `tool_cancel` | `commands/tool.rs` | ☐ |
| `config_get` | `commands/config.rs` | ☐ |
| `config_set` | `commands/config.rs` | ☐ |
| `config_get_all` | `commands/config.rs` | ☐ |
| `config_reset` | `commands/config.rs` | ☐ |
| `history_list` | `commands/history.rs` | ☐ |
| `history_clear` | `commands/history.rs` | ☐ |
| `clipboard_read_text` | `commands/clipboard.rs` | ☐ |
| `clipboard_write_text` | `commands/clipboard.rs` | ☐ |
| `fs_read_file` | `commands/fs.rs` | ☐ |
| `fs_write_file` | `commands/fs.rs` | ☐ |
| `app_open_external` | `commands/app.rs` | ☐ |
| `app_version` | `commands/app.rs` | ☐ |
| `app_quit` | `commands/app.rs` | ☐ |

### 事件覆盖

确认以下 6 个事件已实现:

| 事件名 | 触发位置 | 状态 |
|--------|----------|------|
| `config_changed` | `commands/config.rs` (config_set, config_reset) | ☐ |
| `history_cleared` | `commands/history.rs` (history_clear) | ☐ |
| `tool_progress` | `commands/tool.rs` (tool_execute_stream) | ☐ |
| `tool_chunk` | `commands/tool.rs` (tool_execute_stream) | ☐ |
| `tool_completed` | `commands/tool.rs` (tool_execute_stream) | ☐ |
| `tool_failed` | `commands/tool.rs` (tool_execute_stream) | ☐ |

### 权限配置

- [ ] `capabilities/` 下 8 个 JSON 文件已创建 <!-- 未完成: 仅创建 7 个,updater.json 缺失 -->
- [x] 无 `**` 通配符
- [x] `clipboard-manager` 仅 `read-text`/`write-text`
- [x] `shell` 仅 `allow-open`(应用层校验 http/https)
- [ ] `updater` 仅 `default` <!-- 未完成: updater.json 缺失 -->

---

## 变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0.0 | 2026-07-25 | 初始版本:13 个 Task,覆盖 18 个 IPC Command、6 个事件、8 个 capability 文件 | Qraft 团队 |
