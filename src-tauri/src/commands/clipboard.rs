// 剪贴板 IPC Command
//
// 实现 clipboard_read_text、clipboard_write_text,使用 tauri-plugin-clipboard-manager。

use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

// ============ 内部函数(可测试) ============

/// 读取系统剪贴板文本
///
/// # Errors
///
/// - 剪贴板访问失败(系统拒绝/不可用)时返回 `AppError::Internal`
pub fn clipboard_read_text_inner(
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    let text = app_handle
        .clipboard()
        .read_text()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clipboard read failed: {e}")))?;
    tracing::info!(length = text.len(), "clipboard read");
    Ok(CommandResponse::ok(text))
}

/// 写入文本到系统剪贴板
///
/// # Errors
///
/// - 剪贴板访问失败(系统拒绝/不可用)时返回 `AppError::Internal`
pub fn clipboard_write_text_inner(
    text: &str,
    app_handle: &tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    app_handle
        .clipboard()
        .write_text(text)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clipboard write failed: {e}")))?;
    tracing::info!(length = text.len(), "clipboard write");
    Ok(CommandResponse::ok(()))
}

// ============ Tauri Command 包装 ============

/// 读取系统剪贴板文本
///
/// # Errors
///
/// - 剪贴板访问失败时返回 `AppError::Internal`
#[tauri::command]
pub async fn clipboard_read_text(
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<String>, AppError> {
    clipboard_read_text_inner(&app_handle)
}

/// 写入文本到系统剪贴板
///
/// # Errors
///
/// - 剪贴板访问失败时返回 `AppError::Internal`
#[tauri::command]
pub async fn clipboard_write_text(
    text: String,
    app_handle: tauri::AppHandle,
) -> Result<CommandResponse<()>, AppError> {
    clipboard_write_text_inner(&text, &app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 剪贴板操作需要 Tauri 运行时与系统剪贴板访问权限,
    // 单元测试无法模拟,以下测试标记为 #[ignore],需手动运行:
    //   cargo test -- --ignored commands::clipboard

    #[tokio::test]
    #[ignore = "requires running tauri app with clipboard access"]
    async fn test_clipboard_read_text_integration() {
        // 需要在 Tauri 测试环境中运行
    }

    #[tokio::test]
    #[ignore = "requires running tauri app with clipboard access"]
    async fn test_clipboard_write_text_integration() {
        // 同上
    }

    #[test]
    fn test_clipboard_command_signatures() {
        // 验证函数存在且签名正确(编译期检查)
        let _read_fn = clipboard_read_text_inner;
        let _write_fn = clipboard_write_text_inner;
    }
}
