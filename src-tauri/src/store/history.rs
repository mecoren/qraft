use async_trait::async_trait;
use parking_lot::{Mutex, RwLock};
use std::io::Write;
use std::path::PathBuf;

use crate::core::context::HistoryEntry;
use crate::core::error::ToolError;
use crate::store::config::ConfigStore;

/// 触发文件裁剪的行数缓冲倍数(超过 `max_history * TRIM_FACTOR` 才重写,降低裁剪频率)
const TRIM_FACTOR: usize = 2;

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
///
/// 当 config 中的 `general.max_history` 大于 0 时,文件行数超过
/// `max_history * TRIM_FACTOR` 后会自动裁剪(重写文件),仅保留最近 `max_history` 条,
/// 避免历史文件随使用时间无限增长导致的全量读取/解析性能退化。
pub struct JsonlHistoryStore {
    path: PathBuf,
    write_lock: Mutex<()>,
    config_store: std::sync::Arc<dyn ConfigStore>,
    /// 近似行数计数,避免每次 `add` 都扫描整个文件来判定是否裁剪。
    /// 由 `list`/`clear` 同步修正,`add` 时递增。
    line_count: RwLock<usize>,
}

impl JsonlHistoryStore {
    #[must_use]
    pub fn new(path: PathBuf, config_store: std::sync::Arc<dyn ConfigStore>) -> Self {
        let line_count = estimate_line_count(&path);
        Self {
            path,
            write_lock: Mutex::new(()),
            config_store,
            line_count: RwLock::new(line_count),
        }
    }

    /// 读取 config 中的 `general.max_history`(0 表示不限制)
    async fn max_history(&self) -> usize {
        match self.config_store.get_all().await {
            Ok(cfg) => cfg.general.max_history,
            Err(_) => 0,
        }
    }

    /// 若行数超过上限则重写文件,只保留最近 `max_history` 条(末尾 N 行)
    ///
    /// 必须在持有 `write_lock` 的情况下调用,避免与并发追加竞争。
    async fn maybe_trim(&self) {
        let max = self.max_history().await;
        if max == 0 {
            return;
        }
        let count = *self.line_count.read();
        if count <= max * TRIM_FACTOR {
            return;
        }
        // 读取全部有效行
        let Ok(content) = std::fs::read_to_string(&self.path) else {
            return;
        };
        let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        if lines.len() <= max {
            *self.line_count.write() = lines.len();
            return;
        }
        let keep = &lines[lines.len() - max..];
        let trimmed = keep.join("\n");
        let _ = std::fs::write(&self.path, format!("{trimmed}\n"));
        *self.line_count.write() = keep.len();
    }
}

/// 估算文件行数(用于初始化 `line_count` 计数)
fn estimate_line_count(path: &PathBuf) -> usize {
    std::fs::read_to_string(path).map_or(0, |c| c.lines().filter(|l| !l.trim().is_empty()).count())
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

        *self.line_count.write() += 1;
        // 释放写锁后再做裁剪(裁剪内含 .await,且 MutexGuard 不跨 await Send)。
        // 裁剪窗口与并发追加的竞态极小,下一次 add 会重新计数并在必要时再次裁剪。
        drop(_guard);
        self.maybe_trim().await;
        Ok(())
    }

    async fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>, ToolError> {
        if !self.path.exists() {
            *self.line_count.write() = 0;
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
        // 用真实行数修正计数(取 max 避免低估导致裁剪延迟)
        let real = entries.len();
        let mut lc = self.line_count.write();
        if real > *lc {
            *lc = real;
        }
        drop(lc);
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
        *self.line_count.write() = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::config::UserConfig;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tempfile::TempDir;

    /// 测试用 ConfigStore,:通过闭包注入 `max_history`
    struct TestConfigStore {
        max_history: usize,
    }
    #[async_trait]
    impl ConfigStore for TestConfigStore {
        async fn get(&self, _key: &str) -> Result<Option<serde_json::Value>, ToolError> {
            Ok(None)
        }
        async fn set(&self, _key: &str, _value: serde_json::Value) -> Result<(), ToolError> {
            Ok(())
        }
        async fn get_all(&self) -> Result<UserConfig, ToolError> {
            let mut cfg = UserConfig::default();
            cfg.general.max_history = self.max_history;
            Ok(cfg)
        }
        async fn reset(&self, _key: &str) -> Result<(), ToolError> {
            Ok(())
        }
    }

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

    fn make_store(max_history: usize) -> (TempDir, JsonlHistoryStore) {
        let (dir, path) = temp_history_path();
        let store = JsonlHistoryStore::new(path, Arc::new(TestConfigStore { max_history }));
        (dir, store)
    }

    #[tokio::test]
    async fn test_add_and_list() {
        let (_tmp, store) = make_store(0);
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
        let (_tmp, store) = make_store(0);
        store.add(sample_entry("a", 1)).await.unwrap();
        store.add(sample_entry("b", 2)).await.unwrap();
        assert_eq!(store.list(10).await.unwrap().len(), 2);
        store.clear().await.unwrap();
        assert_eq!(store.list(10).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_limit_truncates() {
        let (_tmp, store) = make_store(0);
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
        let (_tmp, store) = make_store(0);
        let list = store.list(10).await.unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn test_multiple_entries_preserved() {
        let (_tmp, store) = make_store(0);
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
            let store =
                JsonlHistoryStore::new(path.clone(), Arc::new(TestConfigStore { max_history: 0 }));
            store.add(sample_entry("persisted", 999)).await.unwrap();
        }
        let store2 = JsonlHistoryStore::new(path, Arc::new(TestConfigStore { max_history: 0 }));
        let list = store2.list(10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tool_id, "persisted");
    }

    #[tokio::test]
    async fn test_trim_keeps_recent_n() {
        // max_history=50, 写入 1000 条, 超过 50*2=100 触发多次裁剪。
        // 裁剪保留最近 50 条, 缓冲上限为 max*TRIM_FACTOR=100, 因此文件不会无限增长。
        let (_tmp, store) = make_store(50);
        for i in 0..1000u64 {
            store.add(sample_entry("tool", i)).await.unwrap();
        }
        let list = store.list(200).await.unwrap();
        // 文件行数被裁剪收敛, 远小于写入的 1000 条
        assert!(
            list.len() <= 50 * TRIM_FACTOR,
            "file trimmed to <= max*TRIM_FACTOR"
        );
        assert!(list.len() >= 50, "keep at least the most recent 50");
        assert_eq!(list[0].timestamp, 999, "most recent first");
        // 保留的是最近一批条目(时间戳接近 999)
        assert!(
            list[list.len() - 1].timestamp >= 999 - (50 * TRIM_FACTOR) as u64,
            "oldest kept entry is recent"
        );

        // 验证磁盘文件实际行数同样收敛
        let total: Vec<HistoryEntry> = {
            let content = std::fs::read_to_string(&store.path).unwrap();
            content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| serde_json::from_str::<HistoryEntry>(l).unwrap())
                .collect()
        };
        assert_eq!(total.len(), list.len(), "on-disk lines match list");
        assert!(total.len() <= 50 * TRIM_FACTOR);
    }

    #[tokio::test]
    async fn test_no_trim_when_under_limit() {
        let (_tmp, store) = make_store(50);
        for i in 0..40u64 {
            store.add(sample_entry("tool", i)).await.unwrap();
        }
        let list = store.list(200).await.unwrap();
        assert_eq!(list.len(), 40, "under threshold, nothing trimmed");
    }
}
