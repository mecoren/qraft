// 测试辅助工具
//
// 提供 mock_context() 等工具,便于工具单元测试构造 ToolContext。
// 仅在 cfg(test) 下可见,不进入 release 产物。

#![cfg(test)]

use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::core::context::{HistoryEntry, HistorySink, ToolContext};
use crate::core::error::ToolError;

/// 构造一个用于测试的 `ToolContext`:
/// - `cancel_token` 未触发
/// - config 为空对象 `{}`
/// - `history_sink` 使用 NoopHistorySink,写入即丢弃
#[must_use]
pub fn mock_context() -> ToolContext {
    ToolContext {
        cancel_token: CancellationToken::new(),
        config: Value::Object(serde_json::Map::new()),
        history_sink: Arc::new(NoopHistorySink),
    }
}

/// 构造一个可读取已写入历史条目的 ToolContext,返回 (ctx, sink)。
/// sink 实现 Clone,可在测试中读取 entries。
#[must_use]
pub fn mock_context_with_sink() -> (ToolContext, RecordingHistorySink) {
    let sink = RecordingHistorySink::default();
    let ctx = ToolContext {
        cancel_token: CancellationToken::new(),
        config: Value::Object(serde_json::Map::new()),
        history_sink: Arc::new(sink.clone()),
    };
    (ctx, sink)
}

/// 不做任何操作的 HistorySink,用于不需要校验历史的测试。
#[derive(Debug, Default, Clone)]
pub struct NoopHistorySink;

#[async_trait::async_trait]
impl HistorySink for NoopHistorySink {
    async fn write(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
        Ok(())
    }
}

/// 记录所有写入条目的 HistorySink,用于测试断言。
#[derive(Debug, Default, Clone)]
pub struct RecordingHistorySink {
    entries: std::sync::Arc<parking_lot::Mutex<Vec<HistoryEntry>>>,
}

#[async_trait::async_trait]
impl HistorySink for RecordingHistorySink {
    async fn write(&self, entry: HistoryEntry) -> Result<(), ToolError> {
        self.entries.lock().push(entry);
        Ok(())
    }
}

impl RecordingHistorySink {
    /// 读取已写入的条目快照
    #[must_use]
    pub fn entries(&self) -> Vec<HistoryEntry> {
        self.entries.lock().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_context_not_cancelled() {
        let ctx = mock_context();
        assert!(!ctx.is_cancelled());
    }

    #[test]
    fn test_mock_context_config_is_empty_object() {
        let ctx = mock_context();
        assert!(ctx.config.is_object());
        assert!(ctx.config.as_object().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_noop_sink_succeeds() {
        let sink = NoopHistorySink;
        let result = HistorySink::write(&sink, HistoryEntry::default()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_recording_sink_records_entries() {
        let sink = RecordingHistorySink::default();
        let entry = HistoryEntry {
            tool_id: "test_tool".into(),
            ..Default::default()
        };
        HistorySink::write(&sink, entry).await.unwrap();
        assert_eq!(sink.entries().len(), 1);
        assert_eq!(sink.entries()[0].tool_id, "test_tool");
    }

    #[tokio::test]
    async fn test_mock_context_with_sink_returns_recorded() {
        let (ctx, sink) = mock_context_with_sink();
        let entry = HistoryEntry {
            tool_id: "json_formatter".into(),
            ..Default::default()
        };
        ctx.history_sink.write(entry).await.unwrap();
        assert_eq!(sink.entries().len(), 1);
        assert_eq!(sink.entries()[0].tool_id, "json_formatter");
    }
}
