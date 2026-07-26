// 历史 IPC Command
//
// 实现 history_list、history_clear 两个命令。

use tauri::Emitter;

use crate::core::context::HistoryEntry;
use crate::shell::AppError;
use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;

// ============ 事件 Payload ============

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryClearedPayload {
    pub tool_id: Option<String>,
}

// ============ 内部函数(可测试) ============

/// 列出历史记录(`limit` 为 None 时默认 100 条)
///
/// # Errors
///
/// - 历史存储读取失败时返回 `AppError::history`(`ERR_HISTORY_IO`)
pub async fn history_list_inner(
    limit: Option<u32>,
    state: &AppState,
) -> Result<CommandResponse<Vec<HistoryEntry>>, AppError> {
    let limit = limit.map_or(100, |l| l as usize);
    let entries = state
        .history_store
        .list(limit)
        .await
        .map_err(|e| AppError::history(e.to_string()))?;
    Ok(CommandResponse::ok(entries))
}

/// 清空历史记录,并 emit `history_cleared` 事件
///
/// # Errors
///
/// - 历史存储清空失败时返回 `AppError::history`(`ERR_HISTORY_IO`)
pub async fn history_clear_inner(
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    state
        .history_store
        .clear()
        .await
        .map_err(|e| AppError::history(e.to_string()))?;

    let payload = HistoryClearedPayload { tool_id: None };
    let _ = app_handle.emit("history_cleared", &payload);

    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

/// 列出历史记录
///
/// # Errors
///
/// - 历史存储读取失败时返回 `AppError::history`(`ERR_HISTORY_IO`)
#[tauri::command]
pub async fn history_list(
    limit: Option<u32>,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<Vec<HistoryEntry>>, AppError> {
    history_list_inner(limit, &state).await
}

/// 清空历史记录,并 emit `history_cleared` 事件
///
/// # Errors
///
/// - 历史存储清空失败时返回 `AppError::history`(`ERR_HISTORY_IO`)
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
    use crate::core::error::ToolError;
    use crate::core::executor::ToolExecutor;
    use crate::core::registry::ToolRegistry;
    use crate::shell::state::AppState;
    use crate::store::config::{ConfigStore, UserConfig};
    use crate::store::history::HistoryStore;
    use async_trait::async_trait;
    use parking_lot::Mutex as ParkingMutex;
    use serde_json::Value;
    use std::sync::Arc;

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

    struct MockHistoryStore {
        entries: ParkingMutex<Vec<HistoryEntry>>,
    }
    impl MockHistoryStore {
        fn with_entries(count: usize) -> Self {
            let entries: Vec<HistoryEntry> = (0..count)
                .map(|i| HistoryEntry {
                    tool_id: format!("tool-{i}"),
                    input_summary: "in".into(),
                    output_summary: "out".into(),
                    timestamp: i as u64,
                    duration_ms: 10,
                })
                .collect();
            Self {
                entries: ParkingMutex::new(entries),
            }
        }
    }
    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
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

    fn make_state(history: MockHistoryStore) -> AppState {
        let registry = ToolRegistry::global();
        let executor = Arc::new(ToolExecutor::new(registry));
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
        state.history_store.clear().await.unwrap();
        let resp = history_list_inner(None, &state).await.unwrap();
        assert_eq!(resp.data.unwrap().len(), 0);
    }
}
