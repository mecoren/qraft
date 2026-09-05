// Qraft 应用入口
//
// 声明所有业务模块,装配 Tauri 应用:注册插件、初始化 AppState、注册 IPC Command。
// 各模块职责:
//   - core:    工具执行核心(Tool trait、Registry、Executor、错误体系)
//   - store:   持久化存储(ConfigStore、HistoryStore)
//   - shell:   Shell 层(AppState、CommandResponse 包络、HistorySink 实现)
//   - commands:IPC Command 实现(tool/config/history/clipboard/fs/app)
//   - tools:   具体工具实现(P0 工具在 05 子计划中填充)
//
// 注意:`commands` 和 `shell` 模块依赖 Tauri 运行时,在 `cargo test` 下
// 条件编译排除,避免测试二进制链接 WebView2 等 native DLL 导致运行失败。

// 测试代码允许使用 unwrap/expect/panic:这些是测试中惯用的失败快速触发方式,
// 在生产代码中仍按 Cargo.toml 中 lints.clippy 配置保持 warn 级别。
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod core;
pub mod media;
pub mod net;
pub mod regex_lab;
pub mod store;
pub mod tools;

// Tauri 依赖模块:仅在非测试编译下包含
// `commands` 模块使用 `#[tauri::command]` 宏与 Tauri 运行时 trait,需要完整运行时
// `shell` 模块本身仅 `state` 子模块依赖运行时(见 shell/mod.rs),`response` 子模块
// 仅依赖 serde,可在测试下编译供集成测试断言 CommandResponse 包络
#[cfg(not(test))]
pub mod commands;
pub mod shell;

// 重导出 Core 层关键类型,方便外部使用
pub use core::context::{HistoryEntry, HistorySink, ToolContext};
pub use core::error::{AppError, EngineError, ToolError};
pub use core::executor::ToolExecutor;
pub use core::input::ToolInput;
pub use core::output::{Alert, AlertLevel, OutputMeta, ToolOutput};
pub use core::registry::{StreamingEntry, ToolEntry, ToolRegistry};
pub use core::tool::{StreamEvent, StreamingTool, Tool, ToolCategory, ToolMetadata};

// 注册宏 register_tool / register_stream_tool 通过 #[macro_export] 已自动位于 crate 根,
// 无需再次 pub use(否则会与 #[macro_export] 产生命名冲突)。

// 重导出 Store 层
pub use store::config::{GeneralConfig, ShortcutBinding, ThemeConfig, ThemeMode, UserConfig};

// —— Tauri 应用启动(仅非测试编译)——
//
// `run()` 直接定义在 crate 根,以便 `tauri::generate_handler!` 宏能找到
// `#[tauri::command]` 通过 `#[macro_export]` 导出到 crate 根的
// `__cmd__<name>` / `__tauri_command_name_<name>` 宏。

/// 初始化并运行 Tauri 应用。
///
/// # Errors
///
/// - 配置/历史存储初始化失败
/// - Tauri 应用启动失败
#[cfg(not(test))]
#[allow(clippy::expect_used, clippy::too_many_lines)]
pub fn run() -> anyhow::Result<()> {
    use std::sync::Arc;

    use crate::commands::app::{
        WindowCloseGuard, app_check_update, app_install_update, app_open_external,
        app_open_release_page, app_pull_open_files, app_quit, app_version, window_close_ready,
    };
    use crate::commands::clipboard::{clipboard_read_text, clipboard_write_text};
    use crate::commands::config::{config_get, config_get_all, config_reset, config_set};
    use crate::commands::font::list_system_fonts;
    use crate::commands::fs::{
        AuthorizedPaths, fs_authorize_dropped_paths, fs_open_dialog, fs_open_folder_dialog,
        fs_read_dir, fs_read_file, fs_read_text_file_encoded, fs_reveal_in_explorer, fs_save_bytes,
        fs_save_text_file_encoded, fs_write_file, fs_write_file_encoded,
    };
    use crate::commands::history::{history_clear, history_list};
    use crate::commands::image::png_compress;
    // IP 归属地查询(零网络原则的登记例外,见 net/mod.rs 与 PRD 13-security.md §3.1)
    use crate::commands::ip_lookup::ip_lookup;
    use crate::commands::regex_lab::{regex_codegen, regex_debug, regex_live, regex_tests};
    use crate::commands::tool::{
        tool_cancel, tool_execute, tool_execute_stream, tool_list, tool_metadata,
    };
    use crate::shell::file_open::{
        PendingOpenFiles, open_dropped_files, open_files_from_args, sanitize_dropped_path,
    };
    use crate::shell::state::AppState;
    use crate::store::config::{ConfigStore, JsonConfigStore};
    use crate::store::history::{HistoryStore, JsonlHistoryStore};
    // RunEvent 全平台均需(WindowEvent 拖放处理);其 Opened 变体仅在 macOS 上
    // 存在,对应分支已用 #[cfg(target_os = "macos")] 门控,非 macOS 不编译。
    use tauri::{DragDropEvent, Emitter, Manager, RunEvent, WindowEvent};
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        // 单实例:重复启动时聚焦已有实例,并把命令行传入的文件路径转发过去,
        // 由已运行实例在编辑器工作区中打开(避免打开两个窗口/文件丢失)。
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 聚焦主窗口(若已最小化则恢复)
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // 把新实例收到的文件参数交给现有实例处理
            // (single_instance 回调的 `app` 即 `&tauri::AppHandle`,直接复用)
            let authorized = app.state::<AuthorizedPaths>();
            let pending = app.state::<PendingOpenFiles>();
            if let Err(e) = open_files_from_args(app, &authorized, &pending, &args) {
                tracing::warn!("single_instance: failed to open file from args: {e}");
            }
        }))
        // Updater 插件:自动更新检查与下载(零网络原则的唯一例外,见 PRD 13-security.md §3.1)
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Window State 插件:记住窗口所在屏幕、位置与大小,重启后精确恢复。
        // 完全对照 wait-home/desktop 的实现:默认 Builder(全部 StateFlags,含 VISIBLE),
        // 窗口以 visible:false 创建,插件在 on_window_ready 恢复位置/大小/最大化并 show()。
        // 必须在 Builder 阶段注册(Tauri 2 先创建 config 声明的窗口再执行 setup 回调,
        // setup 中动态注册会错过 on_window_ready,导致既不恢复也不监听 Moved/Resized)。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let registry = crate::core::registry::ToolRegistry::global();
            tracing::info!("registered {} tools", registry.list().len());

            let executor = Arc::new(crate::core::executor::ToolExecutor::new(registry));

            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let config_path = config_dir.join("config.json");
            let config_store: Arc<dyn ConfigStore> = Arc::new(JsonConfigStore::new(config_path));

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let history_path = data_dir.join("history.jsonl");
            let history_store: Arc<dyn HistoryStore> =
                Arc::new(JsonlHistoryStore::new(history_path, config_store.clone()));

            let state = AppState::new(executor, config_store, history_store);
            state
                .set_app_handle(app.handle().clone())
                .map_err(|_| anyhow::anyhow!("app_handle already set"))?;

            app.manage(state);
            app.manage(AuthorizedPaths::new());
            app.manage(PendingOpenFiles::new());
            app.manage(WindowCloseGuard::default());

            // 应用原生窗口材质效果(Windows: Mica / macOS: vibrancy / Linux: 无原生,前端 CSS 回退)
            // 失败仅 warn,不阻塞启动;窗口仍可用,只是无模糊质感
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = apply_mica(&window, None) {
                        tracing::warn!("apply_mica failed: {e}");
                    }
                }
            }

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        None,
                        None,
                    ) {
                        tracing::warn!("apply_vibrancy failed: {e}");
                    }
                }
            }

            // 处理启动时通过命令行传入的文件路径(Windows/Linux 双击或右键
            // 「用 Qraft 打开」时,系统把路径作为参数传给本进程)。
            // 注:此刻 webview 可能尚未就绪,emit 事件可能丢失;文件已写入
            // PendingOpenFiles 队列,前端初始化时会通过 app_pull_open_files 补齐。
            {
                let authorized = app.state::<AuthorizedPaths>();
                let pending = app.state::<PendingOpenFiles>();
                let args: Vec<String> = std::env::args().collect();
                if let Err(e) = open_files_from_args(app.handle(), &authorized, &pending, &args) {
                    tracing::warn!("startup: failed to open file from args: {e}");
                }
            }

            Ok(())
        })
        // 窗口关闭拦截:
        // - 弹出窗口(popout-*):拦截一次并定向通知弹窗前端冲刷待落盘数据,
        //   由前端冲刷完成后自行 destroy;不触碰主窗口的 WindowCloseGuard 单例。
        // - 主窗口:前端已就绪且未在确认流程时,阻止关闭并通知前端冲刷缓存后退出。
        //   必须按 label 区分:WindowCloseGuard 是 app 级单例,且 window.emit 为
        //   全局广播,若放任弹窗走主窗口流程,关闭弹窗会广播 app:close-requested,
        //   主窗口 EditorWorkbench 收到后调用 app_quit,导致关闭弹窗反而退出整个
        //   应用(见 prd/tool-popout-window/design.md)。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("popout-") {
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), "app:popout-close-requested", ());
                    return;
                }
                if window.label() != "main" {
                    return;
                }
                let guard = window.state::<WindowCloseGuard>();
                let Ok(mut g) = guard.inner.lock() else {
                    return;
                };
                // 前端未就绪(启动瞬间)或已处于确认流程(再次关闭 = 强制退出):放行关闭
                if !g.webview_ready || g.pending {
                    return;
                }
                g.pending = true;
                api.prevent_close();
                drop(g);
                let _ = window.emit("app:close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            tool_list,
            tool_metadata,
            tool_execute,
            tool_execute_stream,
            tool_cancel,
            config_get,
            config_set,
            config_get_all,
            config_reset,
            history_list,
            history_clear,
            clipboard_read_text,
            clipboard_write_text,
            fs_authorize_dropped_paths,
            fs_read_file,
            fs_write_file,
            fs_save_bytes,
            fs_save_text_file_encoded,
            fs_open_dialog,
            fs_open_folder_dialog,
            fs_read_dir,
            fs_read_text_file_encoded,
            fs_write_file_encoded,
            fs_reveal_in_explorer,
            png_compress,
            ip_lookup,
            regex_live,
            regex_tests,
            regex_codegen,
            regex_debug,
            app_open_external,
            app_version,
            app_quit,
            window_close_ready,
            app_pull_open_files,
            app_check_update,
            app_install_update,
            app_open_release_page,
            list_system_fonts,
        ])
        // 捕获 RunEvent::Opened 以处理 macOS 通过文件关联打开文件的事件;
        // 其余事件(Exit 等)不处理,由默认逻辑正常收尾。
        .build(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("tauri build error: {e}"))?
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                for url in &urls {
                    // 仅处理 file:// scheme,忽略其它(如自定义协议)
                    if url.scheme() == "file" {
                        let Some(path) = url.to_file_path().ok() else {
                            tracing::warn!("cannot convert url to file path: {url}");
                            continue;
                        };
                        let path = path.to_string_lossy().into_owned();
                        let authorized = app_handle.state::<AuthorizedPaths>();
                        let pending = app_handle.state::<PendingOpenFiles>();
                        if let Err(e) =
                            open_files_from_args(app_handle, &authorized, &pending, &[path])
                        {
                            tracing::warn!("macOS open: failed to open file: {e}");
                        }
                    }
                }
            }
            // 拖放文件到窗口:把文本文件交给编辑器工作区打开(参考 VS Code),
            // 二进制/不支持的文件通过 open_dropped_files 内部 emit 提示前端。
            RunEvent::WindowEvent {
                event:
                    WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }),
                ..
            } => {
                let authorized = app_handle.state::<AuthorizedPaths>();
                let pending = app_handle.state::<PendingOpenFiles>();
                let cleaned: Vec<String> = paths
                    .iter()
                    .map(|p| sanitize_dropped_path(&p.to_string_lossy()).to_string())
                    .collect();
                open_dropped_files(app_handle, &authorized, &pending, &cleaned);
            }
            // 弹出窗口销毁后广播:主窗口据此把弹窗写入的持久化状态重新水合回
            // 内存 store(快照式模型的关闭时回写,载荷为窗口 label popout-<toolId>)
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label.starts_with("popout-") => {
                let _ = app_handle.emit("app:popout-closed", label);
            }
            _ => {}
        });

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn test_tool_error_reexport() {
        let err = ToolError::InvalidInput("test".into());
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_tool_input_reexport() {
        let input = ToolInput::default();
        assert!(input.text.is_none());
    }

    #[test]
    fn test_tool_output_reexport() {
        let out = ToolOutput::default();
        assert_eq!(out.text, "");
    }

    #[test]
    fn test_tool_registry_reexport() {
        let _registry = ToolRegistry::global();
    }

    #[test]
    fn test_config_store_reexport() {
        // 仅验证 ThemeMode 已重导出可访问,无需绑定变量
        let _ = ThemeMode::Dark;
    }

    #[test]
    fn test_history_store_reexport() {
        let entry = HistoryEntry::default();
        assert_eq!(entry.tool_id, "");
    }
}
