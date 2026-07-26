// 配置 IPC Command
//
// 实现 config_get、config_set、config_get_all、config_reset 四个命令。
// config_set 与 config_reset 成功后 emit `config_changed` 事件。

use serde_json::Value;
use tauri::Emitter;

use crate::shell::response::CommandResponse;
use crate::shell::state::AppState;
use crate::shell::AppError;
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
    let value = state
        .config_store
        .get(key)
        .await
        .map_err(|e| AppError::config(e.to_string()))?;
    Ok(CommandResponse::ok(value))
}

pub async fn config_set_inner(
    key: &str,
    value: Value,
    state: &AppState,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    // 读取旧值用于事件 payload(NotFound 或 Err 时均回退到 Null)
    let old_value = state
        .config_store
        .get(key)
        .await
        .unwrap_or(None)
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
        .unwrap_or(None)
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
    use crate::core::context::HistoryEntry;
    use crate::core::error::ToolError;
    use crate::core::executor::ToolExecutor;
    use crate::core::registry::ToolRegistry;
    use crate::shell::state::AppState;
    use crate::store::config::{ConfigStore, UserConfig};
    use crate::store::history::HistoryStore;
    use async_trait::async_trait;
    use parking_lot::Mutex as ParkingMutex;
    use std::collections::HashMap;
    use std::sync::Arc;

    struct MockConfigStore {
        data: ParkingMutex<HashMap<String, Value>>,
    }

    impl MockConfigStore {
        fn new() -> Self {
            let mut data = HashMap::new();
            data.insert("theme".into(), Value::String("dark".into()));
            Self {
                data: ParkingMutex::new(data),
            }
        }
    }

    #[async_trait]
    impl ConfigStore for MockConfigStore {
        async fn get(&self, key: &str) -> Result<Option<Value>, ToolError> {
            Ok(self.data.lock().get(key).cloned())
        }
        async fn set(&self, key: &str, value: Value) -> Result<(), ToolError> {
            self.data.lock().insert(key.into(), value);
            Ok(())
        }
        async fn get_all(&self) -> Result<UserConfig, ToolError> {
            Ok(UserConfig::default())
        }
        async fn reset(&self, key: &str) -> Result<(), ToolError> {
            self.data.lock().remove(key);
            Ok(())
        }
    }

    struct MockHistoryStore;
    #[async_trait]
    impl HistoryStore for MockHistoryStore {
        async fn add(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
            Ok(())
        }
        async fn list(&self, _limit: usize) -> Result<Vec<HistoryEntry>, ToolError> {
            Ok(vec![])
        }
        async fn clear(&self) -> Result<(), ToolError> {
            Ok(())
        }
    }

    fn make_state() -> AppState {
        let registry = ToolRegistry::global();
        let executor = Arc::new(ToolExecutor::new(registry));
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
        assert_eq!(
            resp.data.unwrap(),
            Some(Value::String("dark".into()))
        );
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
        let result = state.config_store.reset("nonexistent").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_config_set_via_store() {
        let state = make_state();
        state
            .config_store
            .set("new_key", Value::String("new_value".into()))
            .await
            .unwrap();
        let val = state.config_store.get("new_key").await.unwrap();
        assert_eq!(val, Some(Value::String("new_value".into())));
    }
}
