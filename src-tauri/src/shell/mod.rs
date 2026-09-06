// Shell 层:桥接 Rust Core 与 React UI
//
// - 通过 `#[tauri::command]` 暴露 IPC(具体命令在 `crate::commands` 模块)
// - 通过 `tauri::AppHandle::emit` 推送事件
// - 通过 `tauri::State<AppState>` 注入 Core 依赖
// - capabilities/ 目录配置细粒度权限(最小权限原则)
//
// 模块拆分说明:`response` 仅依赖 serde,可在测试编译下复用(供集成测试断言
// CommandResponse 包络);`state` 持有 `tauri::AppHandle` 等运行时类型,仅在
// 非测试编译下包含,避免测试二进制链接 WebView2 等 native DLL。

pub mod fs_reveal;
pub mod response;
pub mod updater;

// state 模块依赖 Tauri 运行时类型(如 tauri::AppHandle),仅在非测试编译下包含
#[cfg(not(test))]
pub mod state;

// file_open 模块依赖 commands::fs::AuthorizedPaths 与 tauri::AppHandle,
// 二者均在非测试编译下才可用,故同样在非测试编译下包含
#[cfg(not(test))]
pub mod file_open;
#[cfg(not(test))]
pub use file_open::{
    DropPosition, OpenFilePayload, PendingOpenFiles, is_pdf_path, open_dropped_files,
    open_file_in_app, open_files_from_args, sanitize_dropped_path,
};

// AppError 在 core::error 中定义,Shell 层直接复用,避免类型割裂
pub use crate::core::error::AppError;
pub use fs_reveal::fs_reveal_in_explorer_inner;
// reveal_command_for_platform 仅在非 Windows 平台编译
// (Windows 策略:默认管理器优先,失败降级内置 Explorer,见 fs_reveal.rs 模块注释)
#[cfg(not(target_os = "windows"))]
pub use fs_reveal::reveal_command_for_platform;
pub use response::{CommandResponse, ErrorInfo};
pub use updater::{AvailableUpdate, CheckUpdateResponse, build_check_update_response};

// state 的重导出仅在不测试编译下可用
#[cfg(not(test))]
pub use state::{AppState, HistorySinkImpl, StreamingTaskRegistry};
