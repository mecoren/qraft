// 应用级 IPC Command
//
// 实现 app_open_external(仅 http/https)、app_version、app_quit、app_check_update、app_install_update。

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

use crate::shell::AppError;
use crate::shell::file_open::{OpenFilePayload, PendingOpenFiles};
use crate::shell::response::CommandResponse;
use crate::shell::updater::{AvailableUpdate, CheckUpdateResponse, build_check_update_response};

// ============ 窗口关闭守卫 ============

/// 窗口关闭守卫状态:协调「用户点击关闭窗口」与前端「未保存确认」。
///
/// 流程(由 `lib.rs` 的 `on_window_event` 驱动):
/// 1. 前端加载完成后调用 `window_close_ready` 置位 `webview_ready`。
/// 2. 用户点窗口关闭 → 拦截 `CloseRequested`:若前端已就绪且未处于确认流程,
///    则 `prevent_close` 并向前端 emit `app:close-requested`。
/// 3. 前端检查未保存内容:
///    - 无未保存 → 调用 `app_quit` 直接退出;
///    - 有未保存 → 弹确认框,确认后 `app_quit`,取消后 `window_close_cancel`
///      复位 `pending`(下次关闭可再次走确认流程)。
/// 4. 若前端未就绪(启动瞬间)或 `pending` 已置位(再次点击关闭 = 强制退出),
///    则放行关闭,避免前端异常/卡死时窗口无法关闭。
#[derive(Default)]
pub struct WindowCloseGuard {
    pub inner: Mutex<WindowCloseGuardState>,
}

#[derive(Default)]
pub struct WindowCloseGuardState {
    /// 前端已加载完成并调用 `window_close_ready` 置位
    pub webview_ready: bool,
    /// 已拦截一次关闭并通知前端,等待确认结果
    pub pending: bool,
}

/// 前端就绪通知:应用启动、前端加载完成后调用一次
///
/// # Errors
///
/// - 守卫互斥锁中毒时返回 `AppError::Internal`
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn window_close_ready(app: tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    let guard = app.state::<WindowCloseGuard>();
    let mut g = guard
        .inner
        .lock()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("window close guard poisoned: {e}")))?;
    g.webview_ready = true;
    drop(g);
    Ok(CommandResponse::ok(()))
}

/// 用户取消退出:复位 `pending`,下次关闭窗口可再次进入确认流程
///
/// # Errors
///
/// - 守卫互斥锁中毒时返回 `AppError::Internal`
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn window_close_cancel(app: tauri::AppHandle) -> Result<CommandResponse<()>, AppError> {
    let guard = app.state::<WindowCloseGuard>();
    let mut g = guard
        .inner
        .lock()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("window close guard poisoned: {e}")))?;
    g.pending = false;
    drop(g);
    Ok(CommandResponse::ok(()))
}

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

// ============ 文件打开队列 ============

/// 拉取「通过文件关联/命令行打开」的待打开文件列表(并清空队列)
///
/// 前端初始化时调用,作为 `app:open-file` 事件丢失时的兜底:
/// 若应用在 webview 就绪前就收到打开文件请求,事件可能丢失,
/// 前端挂载后调用此命令即可补齐。
///
/// # Errors
///
/// - 队列互斥锁中毒时返回 `AppError::Internal`
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn app_pull_open_files(
    pending: tauri::State<'_, PendingOpenFiles>,
) -> Result<CommandResponse<Vec<OpenFilePayload>>, AppError> {
    Ok(CommandResponse::ok(pending.drain_all()))
}

// ============ Updater 相关 Command ============

/// IPC Command:检查是否有新版本
///
/// 通过 `tauri-plugin-updater` 拉取 `tauri.conf.json` 中 `endpoints` 配置的 URL,
/// 返回 `CheckUpdateResponse`,前端据此显示更新对话框。
///
/// # Errors
///
/// - Updater 插件初始化失败(配置缺失/endpoint 不可达)返回 `AppError::Unknown`
/// - 网络请求或响应解析失败返回 `AppError::Unknown`
#[tauri::command]
pub async fn app_check_update(app: tauri::AppHandle) -> Result<CheckUpdateResponse, AppError> {
    let updater = app
        .updater()
        .map_err(|e| AppError::Unknown(format!("updater init failed: {e}")))?;

    // Updater 结构体本身不暴露 current_version;Update.current_version 字段仅在
    // 有可用更新时存在。统一使用 CARGO_PKG_VERSION 作为当前版本(与 app_version
    // command 一致),避免 None 分支无法获取版本号。
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let update_result = updater
        .check()
        .await
        .map_err(|e| AppError::Unknown(format!("updater check failed: {e}")))?;

    // 将 tauri_plugin_updater::Update 转换为 shell::updater::AvailableUpdate,
    // 避免 updater 插件类型泄漏到 IPC 边界,保持 shell::updater 的可测试性。
    // date 字段使用 OffsetDateTime::to_string()(ISO 8601 格式),
    // 避免引入 time crate 的 formatting feature 依赖。
    let update = update_result.map(|u| AvailableUpdate {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });

    Ok(build_check_update_response(current_version, update))
}

/// IPC Command:下载并安装更新,然后重启应用
///
/// 用户在 UI 确认后调用此命令。安装完成后调用 `app.restart()` 自动重启,
/// 因此正常路径下不会返回(返回类型 `Result<(), AppError>` 仅为错误路径使用)。
///
/// # Errors
///
/// - Updater 插件初始化或检查失败返回 `AppError::Unknown`
/// - 无可用更新时返回 `AppError::Unknown("no update available")`
/// - 下载或安装失败返回 `AppError::Unknown`
#[tauri::command]
pub async fn app_install_update(app: tauri::AppHandle) -> Result<(), AppError> {
    let updater = app
        .updater()
        .map_err(|e| AppError::Unknown(format!("updater init failed: {e}")))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Unknown(format!("updater check failed: {e}")))?
        .ok_or_else(|| AppError::Unknown("no update available".into()))?;

    // 进度回调:MVP 不展示进度,可在 v1.0 扩展为事件广播到前端。
    // download_and_install 签名要求 2 个回调:on_chunk(进度) + on_download_finish(下载完成)。
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| AppError::Unknown(format!("updater install failed: {e}")))?;

    // 安装完成后重启应用;restart() 返回 ! 类型,后续代码不可达
    app.restart();
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
