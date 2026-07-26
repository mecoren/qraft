use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use crate::core::error::ToolError;

/// 工具执行时注入的运行时环境
pub struct ToolContext {
    pub cancel_token: CancellationToken,
    pub config: Value,
    pub history_sink: Arc<dyn HistorySink>,
}

impl ToolContext {
    #[must_use]
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

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

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
        HistorySink::write(&sink, entry).await.unwrap();
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
        assert_eq!(v["timestamp"], 1721900000000u64);
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
            Self {
                entries: Mutex::new(Vec::new()),
            }
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
