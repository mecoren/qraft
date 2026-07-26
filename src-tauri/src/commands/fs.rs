// 文件系统 IPC Command(受限)
//
// 实现 fs_read_file、fs_write_file,通过 AuthorizedPaths 沙箱限制:
// 仅允许用户在 dialog 中显式选择的路径 + app 数据目录。
// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。

use std::collections::HashSet;
use std::sync::Mutex;

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 授权路径集合
///
/// 用户通过 dialog 显式选择的文件路径会被加入此集合,
/// `fs_read_file` / `fs_write_file` 仅允许操作集合中的路径或 app 数据目录。
#[derive(Default)]
pub struct AuthorizedPaths {
    inner: Mutex<HashSet<String>>,
}

impl AuthorizedPaths {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 授权一个路径(用户通过 dialog 选择后调用)
    pub fn authorize(&self, path: &str) {
        // Mutex 中毒时取出内部数据继续操作:授权集合仅追加/查询,中毒不代表
        // 数据不可用,继续运行比 panic 更友好
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(path.to_string());
    }

    /// 检查路径是否已授权
    pub fn is_authorized(&self, path: &str) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(path)
    }

    /// 撤销路径授权
    pub fn revoke(&self, path: &str) {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(path);
    }
}

// ============ 内部函数(可测试) ============

/// 校验路径是否在允许范围内
///
/// MVP 简化策略:仅允许 `AuthorizedPaths` 中的路径。
/// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。
fn validate_path(path: &str, authorized: &AuthorizedPaths) -> Result<(), AppError> {
    if authorized.is_authorized(path) {
        Ok(())
    } else {
        Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )))
    }
}

/// 读取指定路径的文件内容(必须在 `authorized` 集合中)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败(不存在/权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_read_file_inner(
    path: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    validate_path(path, authorized)?;
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(content))
}

/// 向指定路径写入文件内容(必须在 `authorized` 集合中)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败(权限不足/磁盘满)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_write_file_inner(
    path: &str,
    content: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<()>, AppError> {
    validate_path(path, authorized)?;
    tokio::fs::write(path, content)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

/// 读取指定路径的文件内容(必须在 dialog 中已授权)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_read_file(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<String>, AppError> {
    fs_read_file_inner(&path, &authorized).await
}

/// 向指定路径写入文件内容(必须在 dialog 中已授权)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<()>, AppError> {
    fs_write_file_inner(&path, &content, &authorized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authorized_paths_authorize_and_check() {
        let paths = AuthorizedPaths::new();
        assert!(!paths.is_authorized("/tmp/secret.txt"));

        paths.authorize("/tmp/allowed.txt");
        assert!(paths.is_authorized("/tmp/allowed.txt"));
        assert!(!paths.is_authorized("/tmp/other.txt"));
    }

    #[test]
    fn test_authorized_paths_revoke() {
        let paths = AuthorizedPaths::new();
        paths.authorize("/tmp/revoke.txt");
        assert!(paths.is_authorized("/tmp/revoke.txt"));

        paths.revoke("/tmp/revoke.txt");
        assert!(!paths.is_authorized("/tmp/revoke.txt"));
    }

    #[tokio::test]
    async fn test_fs_read_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_read_file_inner("/etc/passwd", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_write_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_write_file_inner("/tmp/forbidden.txt", "content", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_read_write_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_round_trip.txt");
        let path_str = path.to_str().unwrap();

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        // 写入
        let write_resp = fs_write_file_inner(path_str, "hello qraft", &paths)
            .await
            .unwrap();
        assert!(write_resp.success);

        // 读取
        let read_resp = fs_read_file_inner(path_str, &paths).await.unwrap();
        assert!(read_resp.success);
        assert_eq!(read_resp.data.unwrap(), "hello qraft");

        // 清理
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_fs_read_file_not_found_but_authorized() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_nonexistent.txt");
        let path_str = path.to_str().unwrap();
        // 确保文件不存在
        let _ = std::fs::remove_file(&path);

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        let result = fs_read_file_inner(path_str, &paths).await;
        assert!(result.is_err());
        // io::Error → AppError::Io → code "ERR_FILE_IO"
        assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
    }
}
