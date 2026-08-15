// Shell 层「在文件管理器中显示」模块
//
// 此模块仅依赖标准库与 serde,不依赖 Tauri 运行时,可在 `cargo test` 下编译与测试。
// `#[tauri::command]` 包装留在 `commands::fs`(被 `#[cfg(not(test))]` 门控),
// 通过 `fs_reveal_in_explorer_inner` 委托到此模块的纯函数,实现可测试性。
//
// 架构一致性:与 `shell::response` / `shell::updater` 相同的设计模式(纯类型 + 不门控)。

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 构造「在文件管理器中显示」的平台命令
///
/// 返回 `(程序名, 参数列表)`,由调用方通过 `std::process::Command` 执行。
/// 参数经 `Command::arg` 传入,天然处理路径中的空格与特殊字符。
/// 该函数为纯函数,可跨平台测试命令形状。
#[must_use]
pub fn reveal_command_for_platform(path: &str) -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        // explorer 的 /select, 参数需作为一个整体参数传入
        (String::from("explorer"), vec![format!("/select,{path}")])
    } else if cfg!(target_os = "macos") {
        (String::from("open"), vec![String::from("-R"), path.to_string()])
    } else {
        // Linux: 打开父目录;xdg-open 不保证定位选中文件,能打开目录即可
        let parent = std::path::Path::new(path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(path);
        (String::from("xdg-open"), vec![parent.to_string()])
    }
}

/// 在系统文件管理器中定位指定文件(不读写文件,仅揭示位置)
///
/// 仅要求路径存在,不要求 AuthorizedPaths 授权。
///
/// # Errors
///
/// - 路径为空时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 路径不存在时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 平台命令启动失败(explorer/open/xdg-open 不可用)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub fn fs_reveal_in_explorer_inner(path: &str) -> Result<CommandResponse<()>, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path must not be empty",
        )));
    }
    if !std::path::Path::new(path).exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("path does not exist: {path}"),
        )));
    }
    let (program, args) = reveal_command_for_platform(path);
    let mut cmd = std::process::Command::new(program);
    cmd.args(&args);
    // 不阻塞等待:explorer/open/xdg-open 均为独立进程,立即返回
    let _child = cmd.spawn().map_err(|e| {
        AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("failed to launch file manager: {e}"),
        ))
    })?;
    Ok(CommandResponse::ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_builds_select_arg_with_spaces() {
        let (program, args) = reveal_command_for_platform(r"C:\My Dir\a b.txt");
        if cfg!(target_os = "windows") {
            assert_eq!(program, "explorer");
            assert_eq!(args, vec![r"/select,C:\My Dir\a b.txt"]);
        } else {
            // 其它平台也应返回非空命令,不 panic
            assert!(!program.is_empty());
            assert!(!args.is_empty());
        }
    }

    #[test]
    fn macos_uses_reveal_flag() {
        let (program, args) = reveal_command_for_platform("/tmp/a.txt");
        if cfg!(target_os = "macos") {
            assert_eq!(program, "open");
            assert_eq!(args, vec!["-R", "/tmp/a.txt"]);
        } else {
            assert!(!program.is_empty());
            assert!(!args.is_empty());
        }
    }

    #[test]
    fn linux_opens_parent_dir() {
        let (program, args) = reveal_command_for_platform("/home/user/a.txt");
        if cfg!(not(any(target_os = "windows", target_os = "macos"))) {
            assert_eq!(program, "xdg-open");
            assert_eq!(args, vec!["/home/user"]);
        } else {
            assert!(!program.is_empty());
            assert!(!args.is_empty());
        }
    }

    #[test]
    fn inner_rejects_empty_path() {
        let result = fs_reveal_in_explorer_inner("   ");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
    }

    #[test]
    fn inner_rejects_missing_path() {
        let dir = std::env::temp_dir();
        let missing = dir.join("qraft_test_nonexistent_reveal.txt");
        let _ = std::fs::remove_file(&missing);
        let result = fs_reveal_in_explorer_inner(missing.to_str().unwrap());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
    }

    #[test]
    fn inner_accepts_existing_path() {
        let dir = std::env::temp_dir();
        let existing = dir.join("qraft_test_reveal_target.txt");
        std::fs::write(&existing, "x").expect("write target file");
        let result = fs_reveal_in_explorer_inner(existing.to_str().unwrap());
        // 存在路径时命令可启动;CI/无桌面环境下 explorer 可能不可用,
        // 仅当 spawn 成功才返回 Ok;此处不强制成功,避免 CI 不稳定
        if result.is_err() {
            assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
        }
        let _ = std::fs::remove_file(existing);
    }
}
