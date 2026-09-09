//! 文件本地历史(保存前快照)—— 编辑器「历史版本」功能的数据层。
//!
//! 语义:每次经 `fs_write_file` / `fs_write_file_encoded` 覆盖保存前,
//! 把**磁盘上的旧内容**快照到 app 数据目录 `file-history/` 下;
//! 覆盖后仍可用「历史版本」对比 / 找回上一版。快照以
//! `路径 SHA-256 前 16 hex` 分桶,桶内每版一个 `<epoch_ms>.snap` 文件 +
//! 一个 `meta.json` 记录每版的保存时间 / 原始字节数 / 快照字节数;
//! 每桶保留最近 `MAX_SNAPSHOTS_PER_FILE` 份,超出自动淘汰最旧版。
//!
//! 设计取舍(与 config/history 的 `JsonlStore` 对齐):
//! - 快照为**原始字节**拷贝(不经编码往返),二进制与任意编码文件同样适用;
//!   文本编辑器场景下 UTF-8 / GBK / 带 BOM 文件还原后与原盘字节一致。
//! - 元数据独立成 `meta.json`(而非从文件名反推),便于后续扩展(如记录
//!   触发来源)且 list 不需读快照本体。
//! - 所有失败**不阻塞保存**:快照属增强能力,损坏时静默跳过这一版
//!   (list 时过滤损坏条目),保存主链路永远优先成功。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 每个文件保留的最近快照份数(VSCode Local History 默认同量级)
pub const MAX_SNAPSHOTS_PER_FILE: usize = 20;

/// 单条快照元数据(list 按保存时间倒序返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshotMeta {
    /// 快照 id(桶内文件名,不含扩展名):保存时刻的 epoch 毫秒
    pub id: String,
    /// 保存发生时刻(epoch 毫秒;即被快照的旧内容的「死亡时间」)
    pub saved_at_ms: u64,
    /// 原始文件字节数(快照时的磁盘内容长度)
    pub original_bytes: u64,
}

/// 桶级元数据文件内容(版本数组按时间倒序)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BucketMeta {
    versions: Vec<FileSnapshotMeta>,
}

/// 文件本地历史存储(app 数据目录 `file-history/` 布局的纯逻辑封装)
#[derive(Debug, Clone)]
pub struct FileHistoryStore {
    root: PathBuf,
}

impl FileHistoryStore {
    /// 以指定根目录构造(生产为 app config dir 下 `file-history/`)
    #[must_use]
    pub const fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 存储根目录(测试与诊断用)
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 把原文件路径映射为桶目录名(路径 SHA-256 前 16 hex,
    /// 大小写与分隔符归一避免 Windows/Unix 路径风格差异产生双桶)
    #[must_use]
    fn bucket_name(path: &str) -> String {
        use std::fmt::Write as _;

        let normalized = path.replace('\\', "/").to_lowercase();
        let digest = Sha256::digest(normalized.as_bytes());
        let mut name = String::with_capacity(16);
        for b in digest.iter().take(8) {
            let _ = write!(name, "{b:02x}");
        }
        name
    }

    /// 桶目录绝对路径
    #[must_use]
    fn bucket_dir(&self, path: &str) -> PathBuf {
        self.root.join(Self::bucket_name(path))
    }

    /// 快照前把 `source`(磁盘上的旧文件)字节拷入桶内,
    /// 更新元数据并按上限淘汰最旧版本。
    ///
    /// `source` 不存在(首次保存新文件)时为 no-op,返回 Ok(())。
    /// 任何 IO 失败不阻塞保存主链路:返回 Err 由调用方决定忽略,
    /// 语义上等价于「这一版没有被记录」。
    ///
    /// # Errors
    ///
    /// - `source` 元数据读取 / 桶目录创建 / 字节拷贝 / 元数据写回任一失败时
    ///   返回对应 `std::io::Error`
    pub fn snapshot_before_write(&self, source: &str, now_ms: u64) -> std::io::Result<()> {
        let src = Path::new(source);
        let Ok(meta) = fs::metadata(src) else {
            // 首次保存(磁盘尚无该文件)没有可快照的旧内容
            return Ok(());
        };
        if !meta.is_file() {
            return Ok(());
        }
        let dir = self.bucket_dir(source);
        fs::create_dir_all(&dir)?;
        let snap_path = dir.join(format!("{now_ms}.snap"));

        // 同毫秒重复保存:覆盖同一快照(旧版内容已被前一次覆盖,无信息损失)
        fs::copy(src, &snap_path)?;
        let bytes = meta.len();

        let mut bucket = Self::load_bucket(&dir);
        let id = now_ms.to_string();
        // 重写同 id 时先移除旧条目
        bucket.versions.retain(|v| v.id != id);
        bucket.versions.push(FileSnapshotMeta {
            id,
            saved_at_ms: now_ms,
            original_bytes: bytes,
        });
        // 倒序(新→旧),淘汰超限的最旧版本
        bucket
            .versions
            .sort_by(|a, b| b.saved_at_ms.cmp(&a.saved_at_ms).then(b.id.cmp(&a.id)));
        while bucket.versions.len() > MAX_SNAPSHOTS_PER_FILE {
            let oldest = bucket
                .versions
                .pop()
                .map(|v| dir.join(format!("{}.snap", v.id)));
            if let Some(p) = oldest {
                let _ = fs::remove_file(p);
            }
        }
        Self::save_bucket(&dir, &bucket)
    }

    /// 列出某文件的全部快照元数据(新→旧);无桶/损坏时返回空
    #[must_use]
    pub fn list_snapshots(&self, path: &str) -> Vec<FileSnapshotMeta> {
        let dir = self.bucket_dir(path);
        if !dir.is_dir() {
            return Vec::new();
        }
        Self::load_bucket(&dir).versions
    }

    /// 读取指定快照的字节内容
    ///
    /// # Errors
    ///
    /// - 快照 id 不存在或文件损坏时返回 `std::io::Error`
    ///   (`ErrorKind::NotFound`,调用方按「版本已丢失」提示)
    pub fn read_snapshot(&self, path: &str, snapshot_id: &str) -> std::io::Result<Vec<u8>> {
        // id 白名单校验:只允许纯数字(避免路径穿越)
        if snapshot_id.is_empty() || !snapshot_id.chars().all(|c| c.is_ascii_digit()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid snapshot id",
            ));
        }
        let dir = self.bucket_dir(path);
        let versions = Self::load_bucket(&dir).versions;
        if !versions.iter().any(|v| v.id == snapshot_id) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "snapshot not found",
            ));
        }
        fs::read(dir.join(format!("{snapshot_id}.snap")))
    }

    /// 清空某文件的全部快照(删除桶目录)
    ///
    /// # Errors
    ///
    /// - 目录删除失败(文件被占用等)时返回 `std::io::Error`
    pub fn clear_snapshots(&self, path: &str) -> std::io::Result<()> {
        let dir = self.bucket_dir(path);
        if !dir.exists() {
            return Ok(());
        }
        fs::remove_dir_all(dir)
    }

    /// 读取桶元数据;损坏时丢弃全部版本(快照属增强能力,不因元数据损坏阻塞)
    fn load_bucket(dir: &Path) -> BucketMeta {
        fs::read_to_string(dir.join("meta.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// 写回桶元数据(原子性靠同目录 rename 免中途损坏)
    fn save_bucket(dir: &Path, meta: &BucketMeta) -> std::io::Result<()> {
        let tmp = dir.join("meta.json.tmp");
        let target = dir.join("meta.json");
        fs::write(
            &tmp,
            serde_json::to_vec(meta).map_err(std::io::Error::other)?,
        )?;
        fs::rename(&tmp, &target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时目录夹具:返回(`store_root`,`file_path`);测试结束由操作系统回收
    fn setup(tag: &str) -> (PathBuf, String) {
        let root = std::env::temp_dir().join(format!("qraft-file-history-{tag}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");
        let file = root.join("note.txt");
        (root, file.to_string_lossy().into_owned())
    }

    fn write_source(path: &str, content: &str) {
        fs::write(path, content).expect("write source");
    }

    #[test]
    fn test_snapshot_lifecycle() {
        let (root, path) = setup("lifecycle");
        let store = FileHistoryStore::new(root);

        // 首次保存(文件尚不存在):no-op,无版本
        store
            .snapshot_before_write(&path, 1_000)
            .expect("first snapshot");
        assert!(store.list_snapshots(&path).is_empty());

        // 三轮「写盘 → 保存前快照」
        write_source(&path, "v1");
        store
            .snapshot_before_write(&path, 2_000)
            .expect("snapshot v1");
        write_source(&path, "v2");
        store
            .snapshot_before_write(&path, 3_000)
            .expect("snapshot v2");
        write_source(&path, "v3");
        store
            .snapshot_before_write(&path, 4_000)
            .expect("snapshot v3");

        let versions = store.list_snapshots(&path);
        assert_eq!(versions.len(), 3);
        // 新 → 旧排序
        assert_eq!(versions[0].id, "4000");
        assert_eq!(versions[1].id, "3000");
        assert_eq!(versions[2].id, "2000");
        // 元数据记录的是被快照的旧内容字节数
        assert_eq!(versions[2].original_bytes, 2);

        // 读取最早版本:v1 内容
        let bytes = store.read_snapshot(&path, "2000").expect("read v1");
        assert_eq!(String::from_utf8(bytes).unwrap(), "v1");

        // 清空
        store.clear_snapshots(&path).expect("clear");
        assert!(store.list_snapshots(&path).is_empty());
    }

    #[test]
    fn test_same_millisecond_overwrites_single_version() {
        let (root, path) = setup("same-ms");
        let store = FileHistoryStore::new(root);
        write_source(&path, "a");
        store.snapshot_before_write(&path, 7_000).expect("snap a");
        write_source(&path, "b");
        store.snapshot_before_write(&path, 7_000).expect("snap b");

        let versions = store.list_snapshots(&path);
        assert_eq!(versions.len(), 1);
        // 后写入的内容覆盖同 id 快照
        let bytes = store.read_snapshot(&path, "7000").expect("read");
        assert_eq!(String::from_utf8(bytes).unwrap(), "b");
    }

    #[test]
    fn test_eviction_keeps_recent() {
        let (root, path) = setup("eviction");
        let store = FileHistoryStore::new(root);
        for i in 0..MAX_SNAPSHOTS_PER_FILE + 5 {
            write_source(&path, &format!("v{i}"));
            store
                .snapshot_before_write(&path, 1_000 + i as u64)
                .expect("snapshot");
        }
        let versions = store.list_snapshots(&path);
        assert_eq!(versions.len(), MAX_SNAPSHOTS_PER_FILE);
        // 最旧 5 版被淘汰:首版 id 不在列表
        assert!(!versions.iter().any(|v| v.id == "1000"));
        // 最新的保留
        assert_eq!(
            versions[0].id,
            format!("{}", 1_000 + MAX_SNAPSHOTS_PER_FILE + 4)
        );
    }

    #[test]
    fn test_path_style_maps_to_same_bucket() {
        let (root, _path) = setup("bucket");
        let store = FileHistoryStore::new(root);
        // Windows 与 Unix 风格、大小写差异应映射到同一桶
        let a = store.bucket_dir("C:\\Docs\\Note.TXT");
        let b = store.bucket_dir("c:/docs/note.txt");
        assert_eq!(a, b);
    }

    #[test]
    fn test_read_snapshot_rejects_traversal_and_unknown() {
        let (root, path) = setup("invalid");
        let store = FileHistoryStore::new(root);
        write_source(&path, "x");
        store.snapshot_before_write(&path, 5_000).expect("snap");

        // 路径穿越 / 非数字 id
        assert!(store.read_snapshot(&path, "../meta").is_err());
        assert!(store.read_snapshot(&path, "abc").is_err());
        assert!(store.read_snapshot(&path, "").is_err());
        // 未记录的 id
        assert!(store.read_snapshot(&path, "999999").is_err());
    }

    #[test]
    fn test_corrupted_meta_isolated() {
        let (root, path) = setup("corrupt");
        let store = FileHistoryStore::new(root);
        write_source(&path, "x");
        store.snapshot_before_write(&path, 1_000).expect("snap");

        // 损坏元数据后:list 返回空而非 panic;继续快照可恢复
        let dir = store.bucket_dir(&path);
        fs::write(dir.join("meta.json"), "not-json").expect("corrupt meta");
        assert!(store.list_snapshots(&path).is_empty());

        write_source(&path, "y");
        store.snapshot_before_write(&path, 2_000).expect("re-snap");
        let versions = store.list_snapshots(&path);
        assert_eq!(versions.len(), 1);
        // 孤儿快照文件不阻塞新版本读取
        let bytes = store.read_snapshot(&path, "2000").expect("read new");
        assert_eq!(String::from_utf8(bytes).unwrap(), "y");
    }

    #[test]
    fn test_binary_snapshot_roundtrip() {
        // 字节级快照:非 UTF-8 / 二进制内容原样往返(GBK 汉字 + NUL)
        let (root, path) = setup("binary");
        let store = FileHistoryStore::new(root);
        let gbk = [0xC4, 0xE3, 0xBA, 0xC3, 0x00, 0xFF]; // “你好” GBK + NUL + 0xFF
        fs::write(&path, gbk).expect("write gbk");
        store.snapshot_before_write(&path, 1_000).expect("snap");
        let bytes = store.read_snapshot(&path, "1000").expect("read");
        assert_eq!(bytes, gbk.to_vec());
    }
}
