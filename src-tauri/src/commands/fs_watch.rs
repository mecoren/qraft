// 外部文件变更监视 IPC Command(Tauri 薄包装)
//
// 逻辑在 `media::fs_watch`(纯逻辑层,测试编译下可用):注册表替换、父目录
// 差分、按路径去抖都在那里完成;此处只做授权校验与原生 watcher 装配。
//
// 全量替换语义:前端在打开的 Tab 集合变化时下发当前路径列表,而不是逐个
// add/remove —— 命令幂等,Tab 关闭/切换顺序不再影响最终注册集合。
// 主窗与弹窗共用同一份持久化工作区(路径集合一致),因此两窗先后下发不会互踩;
// 事件按 app 级广播,各窗各自按自己的 Tab 基准复核。

use std::path::PathBuf;
use std::sync::Arc;

use crate::commands::fs::AuthorizedPaths;
use crate::media::fs_watch::FsWatchHub;
use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 注册需要监视外部变更的文件路径(全量替换当前集合)
///
/// 命中变更时后端推送 `fs:external-change` 事件,载荷 `{ path }`;
/// 前端按该 Tab 记录的打开时 mtime 复核后再决定是否提示。
///
/// # Errors
///
/// - 任一路径未经对话框/拖放授权时返回 `AppError::Permission`
///   (`ERR_PERMISSION_DENIED`)
/// - 原生 watcher 创建失败时返回 `AppError::Internal`(`ERR_INTERNAL`)
#[tauri::command]
pub async fn fs_watch_open_files(
    paths: Vec<String>,
    authorized: tauri::State<'_, AuthorizedPaths>,
    hub: tauri::State<'_, Arc<FsWatchHub>>,
) -> Result<CommandResponse<()>, AppError> {
    for path in &paths {
        if !authorized.is_path_allowed(path) {
            return Err(AppError::Permission(format!(
                "path not authorized, must be selected via dialog: {path}"
            )));
        }
    }
    let converted: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    hub.replace(&converted)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to start file watcher: {e}")))?;
    Ok(CommandResponse::ok(()))
}
