// 大文件流式查看 IPC Command(Tauri 薄包装)
//
// 核心逻辑在 `media::large_file`(纯逻辑层,测试编译下可用):
// - `fs_large_file_info`:元数据 + 行校准点索引(一次顺序扫描)
// - `fs_read_file_lines`:锚点式行窗口读取(滚动/跳转按需加载)
// - `fs_large_file_search`:流式全文搜索
// 此处只做授权校验、spawn_blocking 卸载、进度事件转发与取消令牌登记。
//
// 长任务(10GB 索引可达数秒)按前端生成的 `scanId` 登记进流式任务注册表,
// `fs_cancel_large_file_scan` 据此中断:关闭 Tab / 发起新搜索后不再读盘。
//
// 10GB+ 文件从不整读进内存:索引扫描只统计 \n 位置并采样校准点,
// 行窗口按需读取固定行数/字节,webview 与 Rust 两侧内存占用均为常数级。

/// 全文搜索命中数硬上限(与前端约定钳制范围的上界)
const MAX_HITS_CAP: usize = 1000;

use tauri::Emitter;

use crate::commands::fs::AuthorizedPaths;
use crate::media::large_file::{
    LargeFileInfo, LargeFileSearchResult, LinesWindow, search_large_file,
};
use crate::shell::response::CommandResponse;
use crate::shell::{AppError, AppState};

/// 大文件查看元数据 + 行校准点(编辑器大文件模式打开时调用一次)
///
/// 超过编辑器整读上限(`EDITOR_FILE_MAX_BYTES`)的文件由前端路由到
/// 只读大文件视图;扫描期间通过 `app:large-file-progress` 事件上报进度
/// (载荷 `{ path, scanned, total }`),前端用于展示「正在索引」状态。
///
/// `scan_id` 为前端生成的本次扫描标识,登记到流式任务注册表供
/// `fs_cancel_large_file_scan` 中断。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 扫描被取消时返回 `AppError::Tool`(`ERR_CANCELLED`)
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_large_file_info(
    app: tauri::AppHandle,
    path: String,
    scan_id: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<LargeFileInfo>, AppError> {
    if !authorized.is_path_allowed(&path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )));
    }
    let cancel = state.streaming_tasks.register(&scan_id);
    let path_for_progress = path.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        crate::media::large_file::scan_large_file(
            &path,
            &move |scanned: u64, total: u64| {
                // 进度事件失败仅忽略,不影响扫描
                let payload = serde_json::json!({
                    "path": path_for_progress,
                    "scanned": scanned,
                    "total": total,
                });
                let _ = app.emit("app:large-file-progress", payload);
            },
            &cancel,
        )
    })
    .await;
    state.streaming_tasks.unregister(&scan_id);
    let info = outcome.map_err(|e| AppError::Unknown(format!("scan task failed: {e}")))??;
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

/// 大文件流式全文搜索(只读视图 Ctrl+F 入口)
///
/// 子串匹配,`case_sensitive` 决定大小写口径(默认 false 不敏感,与编辑器
/// 跨文件搜索一致);命中数达 `maxHits`(钳制上限 `MAX_HITS_CAP`)即停
/// 并在 `truncated` 标记,防止失控扫描。扫描期间经
/// `app:large-file-search-progress` 事件上报进度
/// (载荷 `{ path, scanned, total }`),前端展示搜索进度态。
///
/// `scan_id` 同 `fs_large_file_info`:新一轮搜索用新 id,旧 id 由前端取消,
/// 避免过期扫描继续占用磁盘带宽并把结果写回已刷新的 UI。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 搜索被取消时返回 `AppError::Tool`(`ERR_CANCELLED`)
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_large_file_search(
    app: tauri::AppHandle,
    path: String,
    needle: String,
    case_sensitive: Option<bool>,
    max_hits: Option<usize>,
    scan_id: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<LargeFileSearchResult>, AppError> {
    if !authorized.is_path_allowed(&path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )));
    }
    // 命中上限钳制:防前端误传超大值导致失控扫描
    let max_hits = max_hits.unwrap_or(100).clamp(1, MAX_HITS_CAP);
    let case_sensitive = case_sensitive.unwrap_or(false);
    let cancel = state.streaming_tasks.register(&scan_id);
    let path_for_progress = path.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        search_large_file(
            &path,
            &needle,
            case_sensitive,
            max_hits,
            &move |scanned: u64, total: u64| {
                let payload = serde_json::json!({
                    "path": path_for_progress,
                    "scanned": scanned,
                    "total": total,
                });
                let _ = app.emit("app:large-file-search-progress", payload);
            },
            &cancel,
        )
    })
    .await;
    state.streaming_tasks.unregister(&scan_id);
    let result = outcome.map_err(|e| AppError::Unknown(format!("search task failed: {e}")))??;
    Ok(CommandResponse::ok(result))
}

/// 取消正在执行的大文件索引扫描 / 全文搜索
///
/// 只做令牌置位:任务侧在下一个字节节奏点(1MB)停止读盘并回 `ERR_CANCELLED`。
/// 任务已结束或 id 未登记时返回 false 而非报错——关闭 Tab 与任务完成本就是
/// 竞态,取消失败无副作用,前端无需分支处理。
///
/// # Errors
///
/// 恒成功(取消是幂等提示,未登记的 id 视为已结束)。
#[tauri::command]
pub async fn fs_cancel_large_file_scan(
    scan_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResponse<bool>, AppError> {
    Ok(CommandResponse::ok(state.streaming_tasks.cancel(&scan_id)))
}
