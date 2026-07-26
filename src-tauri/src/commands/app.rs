// 应用级 IPC Command
//
// 实现 app_open_external(仅 http/https)、app_version、app_quit。

use tauri_plugin_shell::ShellExt;

use crate::shell::response::CommandResponse;
use crate::shell::AppError;

// ============ URL 校验 ============

/// 校验 URL scheme 是否允许打开
///
/// 仅允许 `http://` 和 `https://`,防止 `file://`、`javascript://` 等危险 scheme。
pub fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let lower = url.to_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "url scheme not allowed, only http/https: {}",
            url
        )))
    }
}

// ============ 内部函数(可测试) ============

pub fn app_open_external_inner(
    url: &str,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    validate_url_scheme(url)?;
    app_handle
        .shell()
        .open(url, None)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("open url failed: {e}")))?;
    Ok(CommandResponse::ok(()))
}

pub fn app_version_inner() -> Result<CommandResponse<String>, AppError> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    Ok(CommandResponse::ok(version))
}

pub fn app_quit_inner(app_handle: &tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    app_handle.exit(0);
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

#[tauri::command]
pub async fn app_open_external(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_open_external_inner(&url, &app_handle)
}

#[tauri::command]
pub async fn app_version() -> Result<CommandResponse<String>, AppError> {
    app_version_inner()
}

#[tauri::command]
pub async fn app_quit(app_handle: tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    app_quit_inner(&app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_scheme_https() {
        assert!(validate_url_scheme("https://example.com").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_http() {
        assert!(validate_url_scheme("http://localhost:3000").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_uppercase_https() {
        assert!(validate_url_scheme("HTTPS://Example.COM").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_file_forbidden() {
        let result = validate_url_scheme("file:///etc/passwd");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_validate_url_scheme_javascript_forbidden() {
        let result = validate_url_scheme("javascript:alert(1)");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_validate_url_scheme_ftp_forbidden() {
        let result = validate_url_scheme("ftp://example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_app_version_returns_nonempty() {
        let resp = app_version_inner().unwrap();
        assert!(resp.success);
        let version = resp.data.unwrap();
        assert!(!version.is_empty());
        // 应为 semver 格式
        assert!(version.contains('.'));
    }

    #[tokio::test]
    #[ignore = "requires running tauri app"]
    async fn test_app_quit_integration() {
        // 需要 Tauri 运行时,手动测试
    }
}
