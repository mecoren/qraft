// 原子写盘原语(纯 I/O,不依赖 Tauri 运行时,测试编译下可用)
//
// 从 `commands::fs` 下沉到 media 层:命令层被 `#[cfg(not(test))]` 门挡住,其
// 内嵌测试在 `cargo test` 下不编译;本模块常驻编译,让原子写这条易错路径
// (Windows rename 覆盖语义 / 失败回退 / POSIX 权限继承)拿到真实单测覆盖。

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::shell::AppError;

/// 原子写盘的临时文件名序号(同进程内去重,配合 pid 保证并发保存不撞名)
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 原子写入:先写目标**同目录**的临时文件并 `fsync`,再 `rename` 覆盖目标。
///
/// 目标文件要么保持旧内容完整、要么是本次新内容——绝不会因写入中途崩溃 /
/// 磁盘满而残留被截断的半截内容。`rename` 在同分区是原子替换(Windows 走
/// `MoveFileExW(REPLACE_EXISTING)`)。任一步失败即清理临时文件并回传错误,
/// 目标原样不动。POSIX 下继承已存在目标的权限位,避免把受限文件(如 0600)
/// 降级为默认 umask 权限;Windows 权限模型不同,不做映射。
///
/// # Errors
///
/// 创建 / 写入 / fsync / rename 任一失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn write_bytes_atomic(path: impl AsRef<Path>, bytes: &[u8]) -> Result<(), AppError> {
    use tokio::io::AsyncWriteExt as _;

    let target: &Path = path.as_ref();
    // 临时文件落在目标同目录:保证 rename 为同分区原子替换
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let base = target
        .file_name()
        .map_or_else(|| "file".to_string(), |n| n.to_string_lossy().into_owned());
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{base}.qraft-tmp-{}-{seq}", std::process::id()));

    let attempt: std::io::Result<()> = async {
        let mut f = tokio::fs::File::create(&tmp).await?;
        // 目标已存在:继承其权限位,避免把受限文件降级为默认 umask 权限
        // (仅 unix;Windows 的 set_permissions 只管只读位,不镜像)
        #[cfg(unix)]
        if let Ok(meta) = tokio::fs::metadata(target).await {
            let _ = f.set_permissions(meta.permissions()).await;
        }
        f.write_all(bytes).await?;
        f.flush().await?;
        f.sync_all().await?; // 数据落盘后再 rename,防断电留下空 / 半截文件
        drop(f);
        tokio::fs::rename(&tmp, target).await?;
        Ok(())
    }
    .await;

    if attempt.is_err() {
        // rename 前的任一步失败:清理残留临时文件(尽力而为),目标保持旧内容
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    attempt.map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::write_bytes_atomic;

    /// 统计目录内残留的原子写临时文件数(前缀 `.…qraft-tmp-`)
    fn temp_residue_count(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .expect("read_dir")
            .filter_map(std::result::Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".qraft-tmp-"))
            .count()
    }

    #[tokio::test]
    async fn atomic_write_creates_then_replaces_without_temp_residue() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("atomic.txt");
        let path_str = path.to_str().unwrap();

        // 首次创建:目标出现,无临时残留
        write_bytes_atomic(path_str, b"first").await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
        assert_eq!(temp_residue_count(dir.path()), 0);

        // 覆盖:原子替换为新内容,旧内容不留痕,仍无临时残留
        write_bytes_atomic(path_str, b"second-version")
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second-version");
        assert_eq!(temp_residue_count(dir.path()), 0);
    }

    #[tokio::test]
    async fn atomic_write_reports_io_error_and_leaves_no_target() {
        let dir = tempfile::tempdir().unwrap();
        // 父目录不存在:创建同目录临时文件即失败,不应凭空造出目标
        let bad = dir.path().join("no-such-dir").join("x.txt");
        let err = write_bytes_atomic(bad.to_str().unwrap(), b"x")
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_IO");
        assert!(!bad.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_write_preserves_existing_file_mode() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.txt");
        // 受限文件(0600)先落盘
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_bytes_atomic(path.to_str().unwrap(), b"new")
            .await
            .unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "原子替换不得把受限文件降级为默认 umask 权限");
    }
}
