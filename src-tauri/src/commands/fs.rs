// 文件系统 IPC Command(受限)
//
// 实现 fs_read_file、fs_write_file、fs_save_bytes,通过 AuthorizedPaths 沙箱限制:
// 仅允许用户在 dialog 中显式选择的路径 + app 数据目录。
// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。

use std::collections::HashSet;
use std::sync::Mutex;

use base64::Engine as _;
use tauri_plugin_dialog::DialogExt;

use crate::shell::AppError;
use crate::shell::fs_reveal::fs_reveal_in_explorer_inner;
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

/// 将字节写入指定路径
///
/// # Errors
///
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn save_bytes_to_path(path: &str, bytes: &[u8]) -> Result<(), AppError> {
    tokio::fs::write(path, bytes)
        .await
        .map_err(AppError::from)
}

/// 校验文件扩展名与 MIME 的映射关系,返回规范扩展名(未匹配时返回 `bin`)
#[must_use]
pub fn extension_for_mime(mime: &str, fallback: &str) -> String {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/x-icon" => "ico",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => fallback,
    }
    .to_string()
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

/// 弹出保存对话框并写入二进制字节(前端「另存为」使用)
///
/// 用户在保存对话框中显式选择路径后,该路径被授权并写入 `bytes`。
/// 用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - base64 解码失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_save_bytes(
    app: tauri::AppHandle,
    file_name: String,
    base64: String,
    mime: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<String>>, AppError> {
    let ext = extension_for_mime(&mime, "bin");
    let mime_name = mime.split(';').next().unwrap_or(&mime);
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(mime_name, &[ext.as_str()])
        .blocking_save_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };

    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("save path invalid: {e}")))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| AppError::Unknown(format!("invalid base64: {e}")))?;

    // 保存路径由用户显式选择,加入授权集合(与 fs_write_file 沙箱语义一致),
    // 便于后续直接 fs_write_file 覆盖保存,无需再次弹窗
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    save_bytes_to_path(&path_str, &bytes).await?;
    Ok(CommandResponse::ok(Some(path_str)))
}

/// 在系统文件管理器中定位指定文件
///
/// # Errors
///
/// - 路径为空/不存在时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 平台命令启动失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub fn fs_reveal_in_explorer(path: String) -> Result<CommandResponse<()>, AppError> {
    fs_reveal_in_explorer_inner(&path)
}

/// 打开文件对话框的返回结果(路径 + 内容)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileResult {
    pub path: String,
    pub content: String,
}

/// 弹出打开文件对话框,读取选中文件的内容
///
/// 用户在打开对话框中显式选择的路径会被加入授权集合,此后可通过
/// `fs_read_file` 重新读取或 `fs_write_file` 直接覆盖保存。
/// 用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - 文件读取失败(不存在/权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_open_dialog(
    app: tauri::AppHandle,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<OpenFileResult>>, AppError> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("打开文本文件")
        .blocking_pick_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };

    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("open path invalid: {e}")))?;
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    let resp = fs_read_file_inner(&path_str, &authorized).await?;
    let content = resp
        .data
        .ok_or_else(|| AppError::Unknown("fs_open_dialog: empty response".into()))?;
    Ok(CommandResponse::ok(Some(OpenFileResult {
        path: path_str,
        content,
    })))
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

    #[tokio::test]
    async fn test_save_bytes_to_path_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_save_bytes.bin");
        let path_str = path.to_str().unwrap();
        let _ = std::fs::remove_file(&path);

        save_bytes_to_path(path_str, &[0x00, 0x01, 0x02, 0xff])
            .await
            .expect("save should succeed");

        let content = std::fs::read(&path).expect("file should exist");
        assert_eq!(content, vec![0x00, 0x01, 0x02, 0xff]);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_extension_for_mime_known() {
        assert_eq!(extension_for_mime("image/png", "bin"), "png");
        assert_eq!(extension_for_mime("application/pdf", "bin"), "pdf");
        assert_eq!(extension_for_mime("audio/mpeg", "bin"), "mp3");
        assert_eq!(extension_for_mime("video/mp4", "bin"), "mp4");
    }

    #[test]
    fn test_extension_for_mime_with_params_and_unknown() {
        // 带 charset 参数的 MIME
        assert_eq!(extension_for_mime("image/svg+xml;charset=utf-8", "bin"), "svg");
        // 未知 MIME 使用回退扩展名
        assert_eq!(extension_for_mime("application/octet-stream", "dat"), "dat");
    }
}
