// 工具执行 IPC Command
//
// 实现 tool_list、tool_metadata、tool_execute、tool_execute_stream、tool_cancel 五个命令。
// 流式任务通过 `tokio::spawn` 在后台执行,通过事件推送 StreamEvent。

use std::sync::Arc;

use futures::StreamExt;
use serde_json::json;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::fs::AuthorizedPaths;
use crate::core::context::{HistoryEntry, ToolContext};
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::tool::{StreamEvent, ToolMetadata};
use crate::shell::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;

// ============ 内部函数(可测试) ============

/// 历史条目摘要截断上限(字符):历史仅存预览,避免携带超大输入/输出载荷
const HISTORY_PREVIEW_CHARS: usize = 200;

/// 按 Unicode 码点截断预览文本,避免多字节字符被切出无效 UTF-8 边界
fn text_preview(s: &str) -> String {
    s.chars().take(HISTORY_PREVIEW_CHARS).collect()
}

/// 当前 Unix 时间(毫秒);系统时钟早于 1970 时回退 0
fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// 成功执行后落一条历史并向前端广播 `history_added`(经 `HistorySink`)。
/// 历史是旁路数据:写入失败不阻断工具结果的返回。
async fn record_history(
    sink: &dyn crate::core::context::HistorySink,
    tool_id: &str,
    input_preview: &str,
    output_text: &str,
    elapsed_ms: u64,
) {
    let entry = HistoryEntry {
        tool_id: tool_id.to_string(),
        input_summary: input_preview.to_string(),
        output_summary: text_preview(output_text),
        timestamp: unix_millis(),
        duration_ms: elapsed_ms,
    };
    let _ = sink.write(entry).await;
}

/// 校验 `file_path` 已经由 dialog 选择或拖放授权,未授权则拒绝。
/// 同步(`tool_execute_inner`)与流式(`tool_execute_stream_inner`)
/// 两条 IPC 路径共用的安全门。
///
/// # Errors
///
/// - 路径不在授权集合(及其授权目录子树)内时返回
///   `AppError::Permission`(`ERR_PERMISSION_DENIED`)
pub fn ensure_file_path_authorized(
    file_path: &str,
    authorized: &AuthorizedPaths,
) -> Result<(), AppError> {
    if !authorized.is_path_allowed(file_path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog or drop: {file_path}"
        )));
    }
    Ok(())
}

/// 列出所有已注册工具的元数据
///
/// # Errors
///
/// 当前实现恒返回 `Ok`;保留 `Result` 以保持签名一致性,便于未来扩展
/// (例如过滤/权限校验)
pub fn tool_list_inner(state: &AppState) -> Result<CommandResponse<Vec<ToolMetadata>>, AppError> {
    let tools = state.executor.list_tools();
    Ok(CommandResponse::ok(tools))
}

/// 查询单个工具的元数据
///
/// # Errors
///
/// - 当 `tool_id` 未在注册表中找到时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
pub fn tool_metadata_inner(
    tool_id: &str,
    state: &AppState,
) -> Result<CommandResponse<ToolMetadata>, AppError> {
    let meta = state
        .executor
        .get_tool(tool_id)
        .ok_or_else(|| AppError::Tool(ToolError::ToolNotFound(tool_id.into())))?;
    Ok(CommandResponse::ok(meta))
}

/// 同步执行工具
///
/// # Errors
///
/// - 当 `input.file_path` 存在但未经过 dialog/拖放授权时返回
///   `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 当 `tool_id` 未找到时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
/// - 工具执行失败时返回对应的 `AppError::Tool`(`ERR_TOOL_*`)
pub async fn tool_execute_inner(
    tool_id: &str,
    input: ToolInput,
    state: &AppState,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<ToolOutput>, AppError> {
    if let Some(p) = input.file_path.as_deref() {
        ensure_file_path_authorized(p, authorized)?;
    }
    let cancel_token = CancellationToken::new();
    let history_sink = Arc::new(state.history_sink()) as Arc<dyn crate::core::context::HistorySink>;

    let ctx = ToolContext {
        cancel_token,
        config: serde_json::Value::Null,
        history_sink: history_sink.clone(),
    };

    // 在 input 被 move 进执行器之前捕获输入摘要(历史条目仅存预览)
    let input_preview = text_preview(input.text.as_deref().unwrap_or_default());
    let started = std::time::Instant::now();

    let output = state.executor.execute(tool_id, input, ctx).await?;
    record_history(
        history_sink.as_ref(),
        tool_id,
        &input_preview,
        &output.text,
        u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    )
    .await;
    Ok(CommandResponse::ok(output))
}

/// 启动流式工具执行,返回 `task_id,后台通过事件推送结果`
///
/// 事件映射:
/// - `StreamEvent::Progress` → "`tool_progress`"
/// - `StreamEvent::Chunk` → "`tool_chunk`"
/// - `StreamEvent::Done` → "`tool_completed`"
/// - `StreamEvent::Error` → "`tool_failed`"
///
/// # Errors
///
/// - 当 `file_path` 未经过 dialog/拖放授权时返回
///   `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 当 `tool_id` 不支持流式执行时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
#[allow(clippy::implicit_hasher)]
pub fn tool_execute_stream_inner(
    tool_id: &str,
    file_path: &str,
    text: Option<String>,
    params: Option<std::collections::HashMap<String, serde_json::Value>>,
    state: &AppState,
    app_handle: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    // 授权校验必须在 spawn 之前同步完成:拒绝时直接返回错误给调用方,
    // 不注册任务、不产生任何后台事件
    ensure_file_path_authorized(file_path, authorized)?;
    let task_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = state.streaming_tasks.register(&task_id);

    let input = ToolInput {
        text,
        file_path: Some(file_path.to_string()),
        params: params.unwrap_or_default(),
    };

    // 在 input 被 move 进后台任务之前捕获输入摘要(历史条目仅存预览)
    let input_preview = text_preview(input.text.as_deref().unwrap_or_default());
    let started = std::time::Instant::now();

    let history_sink = Arc::new(state.history_sink()) as Arc<dyn crate::core::context::HistorySink>;
    let ctx = ToolContext {
        cancel_token,
        config: serde_json::Value::Null,
        history_sink,
    };

    let executor = state.executor.clone();
    let streaming_tasks = state.streaming_tasks.clone();
    let task_id_clone = task_id.clone();
    let tool_id_owned = tool_id.to_string();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        // execute_stream 需要借用 ctx,使用 Box::pin 避免 lifetime 问题
        let stream_result = executor.execute_stream(&tool_id_owned, input, &ctx);
        match stream_result {
            Ok(stream) => {
                let mut pinned = std::pin::pin!(stream);
                while let Some(event_result) = pinned.next().await {
                    match event_result {
                        Ok(StreamEvent::Progress {
                            percent,
                            message,
                            processed,
                            total,
                        }) => {
                            let payload = json!({
                                "taskId": &task_id_clone,
                                "percent": percent,
                                "message": message,
                                "processed": processed,
                                "total": total,
                            });
                            let _ = app_handle_clone.emit("tool_progress", &payload);
                        }
                        Ok(StreamEvent::Chunk { text }) => {
                            let payload = json!({
                                "taskId": &task_id_clone,
                                "text": text,
                            });
                            let _ = app_handle_clone.emit("tool_chunk", &payload);
                        }
                        Ok(StreamEvent::Done { output }) => {
                            let payload = json!({
                                "taskId": &task_id_clone,
                                "output": output,
                            });
                            let _ = app_handle_clone.emit("tool_completed", &payload);
                            // 与同步路径一致:流式成功完成也落一条历史并广播
                            record_history(
                                ctx.history_sink.as_ref(),
                                &tool_id_owned,
                                &input_preview,
                                &output.text,
                                u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                            )
                            .await;
                            break;
                        }
                        Ok(StreamEvent::Error { error }) => {
                            let payload = json!({
                                "taskId": &task_id_clone,
                                "error": error,
                            });
                            let _ = app_handle_clone.emit("tool_failed", &payload);
                            break;
                        }
                        Err(e) => {
                            let payload = json!({
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
                let payload = json!({
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
/// # Errors
///
/// - 当 `task_id` 不存在或任务已完成时返回 `AppError::Permission`
///   (`ERR_PERMISSION_DENIED`)
pub fn tool_cancel_inner(task_id: &str, state: &AppState) -> Result<CommandResponse<()>, AppError> {
    let cancelled = state.streaming_tasks.cancel(task_id);
    if !cancelled {
        return Err(AppError::Permission(format!(
            "task not found or already completed: {task_id}"
        )));
    }
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

/// 列出所有已注册工具的元数据
///
/// # Errors
///
/// 当前实现恒返回 `Ok`(参见 `tool_list_inner` 说明)
#[tauri::command]
pub async fn tool_list(
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<Vec<ToolMetadata>>, AppError> {
    tool_list_inner(&state)
}

/// 查询单个工具的元数据
///
/// # Errors
///
/// - 当 `tool_id` 未在注册表中找到时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
#[tauri::command]
pub async fn tool_metadata(
    tool_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<ToolMetadata>, AppError> {
    tool_metadata_inner(&tool_id, &state)
}

/// 同步执行工具
///
/// # Errors
///
/// - 当 `input.file_path` 未授权时返回 `AppError::Permission`
///   (`ERR_PERMISSION_DENIED`)
/// - 当 `tool_id` 未找到时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
/// - 工具执行失败时返回对应的 `AppError::Tool`(`ERR_TOOL_*`)
#[tauri::command]
pub async fn tool_execute(
    tool_id: String,
    input: ToolInput,
    authorized: tauri::State<'_, AuthorizedPaths>,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<ToolOutput>, AppError> {
    tool_execute_inner(&tool_id, input, &state, &authorized).await
}

/// 启动流式工具执行,返回 `task_id`
///
/// `text` / `params` 可选:Tauri V2 对 JS 侧缺省参数自动映射为 `None`,
/// 旧调用 `{toolId, filePath}` 完全兼容。
///
/// # Errors
///
/// - 当 `file_path` 未授权时返回 `AppError::Permission`
///   (`ERR_PERMISSION_DENIED`)
/// - 当 `tool_id` 不支持流式执行时返回 `AppError::Tool`(`ERR_TOOL_NOT_FOUND`)
#[tauri::command]
#[allow(clippy::implicit_hasher)]
pub async fn tool_execute_stream(
    tool_id: String,
    file_path: String,
    text: Option<String>,
    params: Option<std::collections::HashMap<String, serde_json::Value>>,
    authorized: tauri::State<'_, AuthorizedPaths>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    tool_execute_stream_inner(
        &tool_id,
        &file_path,
        text,
        params,
        &state,
        &app_handle,
        &authorized,
    )
}

/// 取消流式任务
///
/// # Errors
///
/// - 当 `task_id` 不存在或任务已完成时返回 `AppError::Permission`
///   (`ERR_PERMISSION_DENIED`)
#[tauri::command]
pub async fn tool_cancel(
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<()>, AppError> {
    tool_cancel_inner(&task_id, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::context::HistoryEntry;
    use crate::core::executor::ToolExecutor;
    use crate::core::registry::ToolRegistry;
    use crate::shell::state::AppState;
    use crate::store::config::{ConfigStore, UserConfig};
    use crate::store::history::HistoryStore;
    use async_trait::async_trait;
    use parking_lot::Mutex as ParkingMutex;
    use serde_json::Value;

    struct MockConfigStore;
    #[async_trait]
    impl ConfigStore for MockConfigStore {
        async fn get(&self, _key: &str) -> Result<Option<Value>, ToolError> {
            Ok(None)
        }
        async fn set(&self, _key: &str, _value: Value) -> Result<(), ToolError> {
            Ok(())
        }
        async fn get_all(&self) -> Result<UserConfig, ToolError> {
            Ok(UserConfig::default())
        }
        async fn reset(&self, _key: &str) -> Result<(), ToolError> {
            Ok(())
        }
    }

    /// 可读取的历史存储 Mock:记录 add 写入的条目供断言
    struct MockHistoryStore {
        entries: ParkingMutex<Vec<HistoryEntry>>,
    }
    impl MockHistoryStore {
        fn new() -> Self {
            Self {
                entries: ParkingMutex::new(Vec::new()),
            }
        }
    }
    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, entry: HistoryEntry) -> Result<(), ToolError> {
            self.entries.lock().push(entry);
            Ok(())
        }
        async fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>, ToolError> {
            Ok(self.entries.lock().iter().take(limit).cloned().collect())
        }
        async fn clear(&self) -> Result<(), ToolError> {
            self.entries.lock().clear();
            Ok(())
        }
    }

    fn make_state_with(history_store: Arc<dyn HistoryStore>) -> AppState {
        let registry = ToolRegistry::global();
        let executor = Arc::new(ToolExecutor::new(registry));
        AppState::new(
            executor,
            Arc::new(MockConfigStore) as Arc<dyn ConfigStore>,
            history_store,
        )
    }

    fn make_state() -> AppState {
        make_state_with(Arc::new(MockHistoryStore::new()))
    }

    #[tokio::test]
    async fn test_tool_list_returns_response() {
        let state = make_state();
        let resp = tool_list_inner(&state).unwrap();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
        let _tools = resp.data.unwrap();
    }

    #[tokio::test]
    async fn test_tool_metadata_not_found() {
        let state = make_state();
        let result = tool_metadata_inner("nonexistent_tool", &state);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
    }

    #[tokio::test]
    async fn test_tool_execute_not_found() {
        let state = make_state();
        let authorized = AuthorizedPaths::new();
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        let result = tool_execute_inner("nonexistent_tool", input, &state, &authorized).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
    }

    #[tokio::test]
    async fn test_tool_execute_records_history_on_success() {
        let mock = Arc::new(MockHistoryStore::new());
        let state = make_state_with(mock.clone() as Arc<dyn HistoryStore>);
        let authorized = AuthorizedPaths::new();
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        let resp = tool_execute_inner("base64_codec", input, &state, &authorized)
            .await
            .unwrap();
        assert!(resp.success);
        let entries = mock.entries.lock();
        assert_eq!(entries.len(), 1, "成功执行后应恰好写入一条历史");
        assert_eq!(entries[0].tool_id, "base64_codec");
        // 输入摘要为原文预览;输出摘要非空且耗时为合理量级
        assert_eq!(entries[0].input_summary, "hello");
        assert!(!entries[0].output_summary.is_empty());
        assert!(entries[0].duration_ms <= 5_000);
    }

    #[tokio::test]
    async fn test_tool_execute_failure_does_not_record_history() {
        let mock = Arc::new(MockHistoryStore::new());
        let state = make_state_with(mock.clone() as Arc<dyn HistoryStore>);
        let authorized = AuthorizedPaths::new();
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        let result = tool_execute_inner("nonexistent_tool", input, &state, &authorized).await;
        assert!(result.is_err());
        assert_eq!(mock.entries.lock().len(), 0, "失败执行不应写入历史");
    }

    #[tokio::test]
    async fn test_execute_rejects_unauthorized_file_path() {
        let authorized = AuthorizedPaths::new();
        let state = make_state();
        let input = ToolInput {
            file_path: Some("C:/definitely/not/authorized.txt".into()),
            params: [("mode".to_string(), serde_json::json!("file"))]
                .into_iter()
                .collect(),
            ..Default::default()
        };
        let err = tool_execute_inner("folder_analyzer", input, &state, &authorized)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[tokio::test]
    async fn test_tool_cancel_nonexistent_task() {
        let state = make_state();
        let result = tool_cancel_inner("nonexistent-task-id", &state);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_tool_cancel_registered_task() {
        let state = make_state();
        let task_id = "test-task-001";
        let _token = state.streaming_tasks.register(task_id);

        let resp = tool_cancel_inner(task_id, &state).unwrap();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
    }

    #[test]
    fn test_tool_command_signatures() {
        let _list_fn = tool_list;
        let _metadata_fn = tool_metadata;
        let _execute_fn = tool_execute;
        let _stream_fn = tool_execute_stream;
        let _cancel_fn = tool_cancel;
    }

    // 防止未使用导入警告
    #[allow(dead_code)]
    const _DUMMY: () = ((),).0;
}
