// 大文件流式查看 IPC Command(Tauri 薄包装)
//
// 核心逻辑在 `media::large_file`(纯逻辑层,测试编译下可用):
// - `fs_large_file_info`:元数据 + 行校准点索引(一次顺序扫描)
// - `fs_read_file_lines`:锚点式行窗口读取(滚动/跳转按需加载)
// 此处只做授权校验、spawn_blocking 卸载与进度事件转发。
//
// 10GB+ 文件从不整读进内存:索引扫描只统计 \n 位置并采样校准点,
// 行窗口按需读取固定行数/字节,webview 与 Rust 两侧内存占用均为常数级。

use tauri::Emitter;

use crate::commands::fs::AuthorizedPaths;
use crate::media::large_file::{LargeFileInfo, LinesWindow};
use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 大文件查看元数据 + 行校准点(编辑器大文件模式打开时调用一次)
///
/// 超过编辑器整读上限(`EDITOR_FILE_MAX_BYTES`)的文件由前端路由到
/// 只读大文件视图;扫描期间通过 `app:large-file-progress` 事件上报进度
/// (载荷 `{ path, scanned, total }`),前端用于展示「正在索引」状态。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_large_file_info(
    app: tauri::AppHandle,
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<LargeFileInfo>, AppError> {
    if !authorized.is_path_allowed(&path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )));
    }
    let path_for_progress = path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        crate::media::large_file::scan_large_file(&path, &move |scanned: u64, total: u64| {
            // 进度事件失败仅忽略,不影响扫描
            let payload = serde_json::json!({
                "path": path_for_progress,
                "scanned": scanned,
                "total": total,
            });
            let _ = app.emit("app:large-file-progress", payload);
        })
    })
    .await
    .map_err(|e| AppError::Unknown(format!("scan task failed: {e}")))??;
    Ok(CommandResponse::ok(info))
}

/// 行窗口读取(大文件只读视图滚动/跳转时调用)
///
/// `anchorOffset/anchorLine` 为精确锚点(校准点或上一窗口 `nextOffset/nextLine`),
/// `targetLine` 为要读取的首行(1-based);返回内容与下一个精确锚点。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - `encoding` 不受支持时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_read_file_lines(
    path: String,
    encoding: Option<String>,
    anchor_offset: u64,
    anchor_line: u64,
    target_line: u64,
    max_lines: u64,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<LinesWindow>, AppError> {
    if !authorized.is_path_allowed(&path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )));
    }
    let window = tauri::async_runtime::spawn_blocking(move || {
        crate::media::large_file::read_file_lines(
            &path,
            encoding.as_deref(),
            anchor_offset,
            anchor_line,
            target_line,
            max_lines,
        )
    })
    .await
    .map_err(|e| AppError::Unknown(format!("read task failed: {e}")))??;
    Ok(CommandResponse::ok(window))
}
