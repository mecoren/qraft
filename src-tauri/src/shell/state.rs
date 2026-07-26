// Shell 层全局状态容器
//
// 持有 ToolExecutor、ConfigStore、HistoryStore、流式任务注册表,
// 通过 `tauri::State<AppState>` 注入到每个 Command。
// app_handle 在 setup hook 中通过 `set_app_handle` 注入。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::core::context::{HistoryEntry, HistorySink};
use crate::core::error::ToolError;
use crate::core::executor::ToolExecutor;
use crate::store::config::ConfigStore;
use crate::store::history::HistoryStore;

/// 流式任务注册表
///
/// 管理 `tool_execute_stream` 启动的后台任务的 `CancellationToken`,
/// 供 `tool_cancel` 命令按 `task_id` 取消。
pub struct StreamingTaskRegistry {
    tasks: Mutex<HashMap<String, CancellationToken>>,
}

impl StreamingTaskRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// 注册新任务,返回其 `CancellationToken` 副本供执行使用
    pub fn register(&self, task_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        // Mutex 中毒时仍取出内部数据继续操作:注册表仅记录 task_id 与 token,
        // 中毒不代表数据不可用,继续运行比 panic 更友好
        self.tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(task_id.to_string(), token.clone());
        token
    }

    /// 取消指定任务,返回 true 表示找到并取消,false 表示任务不存在或已完成
    pub fn cancel(&self, task_id: &str) -> bool {
        // 使用 is_some_and 替代 if let-else,同时避免在 scrutinee 中持有 MutexGuard
        // (significant_drop_in_scrutinee 警告)导致 guard 寿命延长可能引发死锁
        self.tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(task_id)
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }

    /// 任务完成后注销(从注册表移除)
    pub fn unregister(&self, task_id: &str) {
        // 同 register:Mutex 中毒时直接恢复内部数据,不 panic
        self.tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(task_id);
    }

    /// 当前活跃任务数(用于测试与诊断)
    pub fn active_count(&self) -> usize {
        self.tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }
}

impl Default for StreamingTaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// `HistorySink` 的 Shell 层实现
///
/// 将 `HistoryEntry` 通过 `tokio::spawn` 异步写入 `HistoryStore`,
/// 不阻塞工具执行返回(满足"历史写入异步"约束)。
pub struct HistorySinkImpl {
    store: Arc<dyn HistoryStore>,
}

impl HistorySinkImpl {
    pub fn new(store: Arc<dyn HistoryStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl HistorySink for HistorySinkImpl {
    async fn write(&self, entry: HistoryEntry) -> Result<(), ToolError> {
        // 内部直接 await,调用方(tokio::spawn)负责异步化
        // 若需进一步解耦,可在 ToolContext 注入时包一层 spawn
        self.store.add(entry).await
    }
}

/// 全局状态容器
///
/// 通过 `tauri::State<AppState>` 注入到每个 Command,
/// 持有 Core 层依赖的 Arc 引用。`app_handle` 在 setup hook 中注入。
pub struct AppState {
    pub executor: Arc<ToolExecutor>,
    pub config_store: Arc<dyn ConfigStore>,
    pub history_store: Arc<dyn HistoryStore>,
    pub streaming_tasks: Arc<StreamingTaskRegistry>,
    /// 运行时注入的 AppHandle,初始为 None,setup hook 中调用 `set_app_handle`
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

    /// 在 setup hook 中注入 `AppHandle`
    ///
    /// # Errors
    ///
    /// - 当 `app_handle` 已被设置过(例如 setup hook 重复执行)时,返回
    ///   `Err(tauri::AppHandle)`,内含本次尝试注入但未能写入的 handle。
    #[allow(clippy::result_large_err)]
    pub fn set_app_handle(&self, handle: tauri::AppHandle) -> Result<(), tauri::AppHandle> {
        self.app_handle.set(handle)
    }

    /// 获取 AppHandle(若已注入)
    #[must_use]
    pub fn app_handle(&self) -> Option<&tauri::AppHandle> {
        self.app_handle.get()
    }

    /// 构造 HistorySink(用于 `ToolContext`)
    pub fn history_sink(&self) -> HistorySinkImpl {
        HistorySinkImpl::new(self.history_store.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::executor::ToolExecutor;
    use crate::core::registry::ToolRegistry;
    use crate::store::config::{ConfigStore, UserConfig};
    use crate::store::history::HistoryStore;
    use async_trait::async_trait;
    use parking_lot::Mutex as ParkingMutex;
    use serde_json::Value;

    /// Mock ConfigStore(适配实际的 ConfigStore trait:返回 Option<Value>, ToolError)
    struct MockConfigStore {
        data: ParkingMutex<std::collections::HashMap<String, Value>>,
    }

    impl MockConfigStore {
        fn new() -> Self {
            Self {
                data: ParkingMutex::new(std::collections::HashMap::new()),
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

    /// Mock HistoryStore(适配实际的 HistoryStore trait:list(usize), clear())
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

    #[tokio::test]
    async fn test_history_sink_impl_writes_to_store() {
        let store: Arc<dyn HistoryStore> = Arc::new(MockHistoryStore::new());
        let sink = HistorySinkImpl::new(store.clone());
        let entry = HistoryEntry {
            tool_id: "test".into(),
            input_summary: "in".into(),
            output_summary: "out".into(),
            timestamp: 1000,
            duration_ms: 5,
        };
        sink.write(entry).await.unwrap();
        let list = store.list(10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tool_id, "test");
    }
}
