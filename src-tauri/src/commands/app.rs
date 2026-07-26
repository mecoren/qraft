// 应用级 IPC Command
//
// 实现 app_open_external(仅 http/https)、app_version、app_quit。

use tauri_plugin_shell::ShellExt;

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

// ============ URL 校验 ============

/// 校验 URL scheme 是否允许打开
///
/// 仅允许 `http://` 和 `https://`,防止 `file://`、`javascript://` 等危险 scheme。
///
/// # Errors
///
/// - 当 URL scheme 不是 `http://` 或 `https://` 时返回 `AppError::Forbidden`
pub fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let lower = url.to_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "url scheme not allowed, only http/https: {url}"
        )))
    }
}

// ============ 内部函数(可测试) ============

/// 通过系统默认浏览器打开 URL(仅 http/https)
///
/// # Errors
///
/// - URL scheme 非法(非 http/https)时返回 `AppError::Forbidden`
/// - `tauri-plugin-shell` 调用失败时返回 `AppError::Internal`
pub fn app_open_external_inner(
    url: &str,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    validate_url_scheme(url)?;
    // TODO(P2): tauri-plugin-shell 的 `Shell::open` 已废弃,官方建议迁移到
    // tauri-plugin-opener。当前保留以避免引入新依赖破坏 PRD 03-tech-stack.md
    // 锁定的依赖清单,后续在 P2 阶段统一切换。
    #[allow(deprecated)]
    app_handle
        .shell()
        .open(url, None)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("open url failed: {e}")))?;
    Ok(CommandResponse::ok(()))
}

/// 返回应用版本号(取自 `CARGO_PKG_VERSION`)
///
/// # Errors
///
/// 当前实现恒返回 `Ok`;保留 `Result` 以保持与其它 inner 函数一致的签名,
/// 便于未来扩展(例如从配置文件读取版本)
pub fn app_version_inner() -> Result<CommandResponse<String>, AppError> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    Ok(CommandResponse::ok(version))
}

/// 退出应用
///
/// # Errors
///
/// 当前实现恒返回 `Ok`;保留 `Result` 以保持签名一致性
pub fn app_quit_inner(app_handle: &tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    app_handle.exit(0);
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

/// 通过系统默认浏览器打开 URL(仅 http/https)
///
/// # Errors
///
/// - URL scheme 非法(非 http/https)时返回 `AppError::Forbidden`
/// - `tauri-plugin-shell` 调用失败时返回 `AppError::Internal`
#[tauri::command]
pub async fn app_open_external(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_open_external_inner(&url, &app_handle)
}

/// 返回应用版本号
///
/// # Errors
///
/// 当前实现恒返回 `Ok`(参见 `app_version_inner` 说明)
#[tauri::command]
pub async fn app_version() -> Result<CommandResponse<String>, AppError> {
    app_version_inner()
}

/// 退出应用
///
/// # Errors
///
/// 当前实现恒返回 `Ok`(参见 `app_quit_inner` 说明)
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
