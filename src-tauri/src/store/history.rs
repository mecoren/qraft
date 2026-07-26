use async_trait::async_trait;
use parking_lot::Mutex;
use std::io::Write;
use std::path::PathBuf;

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
/// 写入操作通过 Mutex 串行化,避免并发追加导致行交错。
pub struct JsonlHistoryStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl JsonlHistoryStore {
    #[must_use]
    pub const fn new(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    #[must_use]
    pub fn load() -> Self {
        Self::new(crate::store::history_path())
    }
}

#[async_trait]
impl HistoryStore for JsonlHistoryStore {
    async fn add(&self, entry: HistoryEntry) -> Result<(), ToolError> {
        let _guard = self.write_lock.lock();
        let line = serde_json::to_string(&entry)
            .map_err(|e| ToolError::Internal(format!("serialize history entry: {e}")))?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Internal(format!("create history dir: {e}")))?;
        }

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| ToolError::Internal(format!("open history file: {e}")))?;
        file.write_all(line.as_bytes())
            .map_err(|e| ToolError::Internal(format!("write history: {e}")))?;
        file.write_all(b"\n")
            .map_err(|e| ToolError::Internal(format!("write history newline: {e}")))?;
        Ok(())
    }

    async fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>, ToolError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.path)
            .map_err(|e| ToolError::Internal(format!("read history: {e}")))?;

        let mut entries: Vec<HistoryEntry> = Vec::new();
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            // 跳过损坏行,不阻塞读取其他有效记录
            if let Ok(e) = serde_json::from_str::<HistoryEntry>(line) {
                entries.push(e);
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
                .map_err(|e| ToolError::Internal(format!("clear history: {e}")))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
        store
            .add(sample_entry("json_formatter", 1000))
            .await
            .unwrap();
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
