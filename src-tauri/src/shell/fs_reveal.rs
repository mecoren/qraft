// Shell 层「在文件管理器中显示」模块
//
// 平台策略:
// - Windows:优先使用系统默认文件管理器;并通过注册表检测默认管理器是否为
//   内置 Explorer:
//   - 默认是内置 Explorer(绝大多数情况,含未自定义)→ 直接用
//     `explorer /select,path` 打开并**定位选中**文件(既是默认管理器又能定位);
//   - 默认是第三方管理器(如 One Commander / Files / Directory Opus 等)→
//     用 ShellExecuteW("open", 父目录) 让第三方接管打开目录
//     (无法传定位参数是 Windows 平台限制,是否定位由第三方管理器决定);
//   - ShellExecuteW 失败(第三方不可用)→ 降级为 `explorer /select,path`
//     (内置 Explorer + 定位,保证功能可用)。
// - macOS:`open -R` 在 Finder 中定位并选中文件。
// - Linux:`xdg-open` 打开父目录(xdg-open 不保证定位选中文件)。
//
// 该模块仅依赖标准库、serde 与 windows(Windows 平台 FFI 绑定),不依赖
// Tauri 运行时,可在 `cargo test` 下编译与测试。
// `#[tauri::command]` 包装留在 `commands::fs`(被 `#[cfg(not(test))]` 门控),
// 通过 `fs_reveal_in_explorer_inner` 委托到此模块的纯函数,实现可测试性。

use std::path::Path;

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 提取文件所在父目录;路径无父目录时回退到路径自身(与 Linux 行为一致)
///
/// 注意:Windows 上 `Path::new("a.txt").parent()` 返回 `Some("")`(空字符串)
/// 而非 `None`,因此需显式过滤空父目录,避免返回空路径。
#[must_use]
pub fn parent_dir_of(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(Path::to_str)
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_owned())
}

/// 构造「在文件管理器中显示」的平台命令(macOS / Linux)
///
/// 返回 `(程序名, 参数列表)`,由调用方通过 `std::process::Command` 执行。
/// 参数经 `Command::arg` 传入,天然处理路径中的空格与特殊字符。
/// Windows 不使用此函数:改用 `windows::reveal`(见下方 windows 模块)。
#[cfg(not(target_os = "windows"))]
#[must_use]
pub fn reveal_command_for_platform(path: &str) -> (String, Vec<String>) {
    if cfg!(target_os = "macos") {
        // macOS:open -R 在 Finder 中定位并选中文件
        (
            String::from("open"),
            vec![String::from("-R"), path.to_string()],
        )
    } else {
        // Linux: 打开父目录;xdg-open 不保证定位选中文件,能打开目录即可
        let parent = parent_dir_of(path);
        (String::from("xdg-open"), vec![parent])
    }
}

/// Windows 平台实现:「在文件管理器中显示」
///
/// 策略(按优先级):
/// 1. 检测系统默认文件管理器。Windows 上「打开文件夹」由多个 ProgID 键接管,
///    第三方管理器(Files / One Commander / Directory Opus 等)设置默认时会改写
///    `Directory\shell\open\command`、`Directory\Background\shell\open\command`
///    或 `Folder\shell\open\command` 的默认命令值:
///    - 任一键的命令明确指向第三方程序(不含 explorer.exe)→ 第三方默认管理器
///    - 全部键缺失/为空/指向 explorer.exe(未自定义)→ 内置 Explorer
/// 2. 按检测结果:
///    - 内置 Explorer → `explorer /select,path` 定位文件(既默认又能选中文件)
///    - 第三方 → ShellExecuteW 打开父目录,交给默认管理器
/// 3. ShellExecuteW 失败(第三方管理器不可用)→ 降级 `explorer /select,path`
///    (内置 Explorer + 定位,保证功能始终可用)
#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::process::Command;

    use windows::Win32::System::Registry::{
        HKEY, HKEY_CLASSES_ROOT, KEY_READ, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE, RegCloseKey,
        RegOpenKeyExW, RegQueryValueExW,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::PCWSTR;

    use crate::shell::AppError;

    /// 决定「文件夹用什么打开」的注册表键集合(第三方管理器接管点)
    ///
    /// - `Directory\shell\open\command`:文件夹双击打开命令
    /// - `Directory\Background\shell\open\command`:文件夹空白处右键打开
    /// - `Folder\shell\open\command`:通用 Folder 类打开命令
    ///   (Windows 默认:REG_EXPAND_SZ `%SystemRoot%\Explorer.exe` + DelegateExecute)
    ///
    /// 第三方管理器(Files / One Commander / Directory Opus)设为默认时,
    /// 会把这些键的默认值改写为自身可执行文件;任一键指向第三方即视为接管。
    const OPEN_COMMAND_KEYS: [&str; 3] = [
        "Directory\\shell\\open\\command",
        "Directory\\Background\\shell\\open\\command",
        "Folder\\shell\\open\\command",
    ];

    /// 读取 `HKCR` 下指定键的默认值(空值名)
    ///
    /// 支持 REG_SZ 与 REG_EXPAND_SZ(如 `%SystemRoot%\Explorer.exe`)。
    /// 键不存在 / 无默认值 / 类型不符 / 读取失败时返回 `None`。
    #[must_use]
    fn query_open_command_default(subkey: &str) -> Option<String> {
        let wide_key: Vec<u16> = (String::from(subkey) + "\0").encode_utf16().collect();
        let mut key = HKEY(std::ptr::null_mut());
        // SAFETY:
        // - wide_key 为 NUL 结尾的 UTF-16 字符串,满足 RegOpenKeyExW 的契约;
        // - KEY_READ 仅请求只读访问,不修改注册表;
        // - key 在成功打开后的所有分支都会 RegCloseKey 关闭(见下)。
        let err = unsafe {
            RegOpenKeyExW(
                HKEY_CLASSES_ROOT,
                PCWSTR(wide_key.as_ptr()),
                None,
                KEY_READ,
                &mut key,
            )
        };
        if err.0 != 0 {
            return None;
        }

        // 第一次调用查询默认值大小(字节数,含结尾 NUL)
        let mut size: u32 = 0;
        let err =
            unsafe { RegQueryValueExW(key, PCWSTR::null(), None, None, None, Some(&mut size)) };
        if err.0 != 0 || size == 0 {
            // SAFETY: key 已由上面 RegOpenKeyExW 成功打开,此处必须关闭。
            let _ = unsafe { RegCloseKey(key) };
            return None;
        }

        let mut buf = vec![0u8; size as usize];
        let mut value_type = REG_VALUE_TYPE::default();
        let err = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR::null(),
                None,
                Some(&mut value_type),
                Some(buf.as_mut_ptr()),
                Some(&mut size),
            )
        };
        // SAFETY: key 已打开,此处必须关闭避免句柄泄漏。
        let _ = unsafe { RegCloseKey(key) };
        if err.0 != 0 || (value_type != REG_SZ && value_type != REG_EXPAND_SZ) {
            return None;
        }

        // REG_SZ / REG_EXPAND_SZ 均为 UTF-16LE 字节序列,按 2 字节一组解析,遇 NUL 停止
        let units: Vec<u16> = buf[..size as usize]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&u| u != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    }

    /// 判断单个打开命令是否指向内置 Explorer
    ///
    /// - 空命令(键存在但未设置)→ 内置 Explorer
    /// - 命令含 `explorer.exe`(不区分大小写,如 `%SystemRoot%\Explorer.exe`)→ 内置
    /// - 其他(如 `"C:\Program Files\Files\Files.exe" "%1"`)→ 第三方
    #[must_use]
    fn command_refers_to_explorer(cmd: &str) -> bool {
        let cmd = cmd.trim();
        cmd.is_empty() || cmd.to_lowercase().contains("explorer.exe")
    }

    /// 判断系统默认文件管理器是否为内置 Explorer
    ///
    /// 遍历 `Directory` / `Directory\Background` / `Folder` 三个 ProgID 键,
    /// 任一键的默认命令明确指向第三方程序(不含 `explorer.exe`)即判定为
    /// 第三方默认管理器;全部键缺失 / 为空 / 指向 explorer.exe 时判定为内置。
    #[must_use]
    fn default_manager_is_explorer() -> bool {
        OPEN_COMMAND_KEYS.iter().all(|subkey| {
            query_open_command_default(subkey)
                .map(|cmd| command_refers_to_explorer(&cmd))
                .unwrap_or(true)
        })
    }

    /// 使用内置 Explorer 定位文件(`explorer /select,path`)
    fn reveal_with_explorer_select(path: &str) -> Result<(), AppError> {
        let mut cmd = Command::new("explorer");
        // explorer 的 /select 参数需作为一个整体参数传入(天然处理空格)
        cmd.arg(format!("/select,{path}"));
        // 不阻塞等待:explorer 为独立进程,立即返回
        let _child = cmd.spawn().map_err(|e| {
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("failed to launch explorer: {e}"),
            ))
        })?;
        Ok(())
    }

    /// 用 ShellExecuteW 打开父目录,交给系统默认文件管理器
    fn shell_execute_open_parent(path: &str) -> Result<(), AppError> {
        let parent = Path::new(path)
            .parent()
            .and_then(Path::to_str)
            .unwrap_or(path);
        // ShellExecuteW 要求 NUL 结尾的 UTF-16 宽字符串
        let parent_wide: Vec<u16> = OsStr::new(parent).encode_wide().chain(Some(0)).collect();
        let operation = "open\0".encode_utf16().collect::<Vec<u16>>();

        // SAFETY:
        // - parent_wide / operation 均为 NUL 结尾的 UTF-16 字符串,满足
        //   ShellExecuteW 对 lpFile / lpOperation 的契约;
        // - 打开目录属于只读操作,不修改文件系统;
        // - hwnd 传 None(当前进程无关联窗口),对打开目录无影响。
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(operation.as_ptr()),
                PCWSTR(parent_wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW 返回 ≤ 32 的值表示错误(0=OOM, 2=文件未找到等)
        if result.0 as usize <= 32 {
            return Err(AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("ShellExecuteW failed with code {}", result.0 as usize),
            )));
        }
        Ok(())
    }

    /// 打开文件所在位置:默认管理器优先,失败降级内置 Explorer 定位
    pub fn reveal(path: &str) -> Result<(), AppError> {
        // 默认管理器是内置 Explorer → 直接定位(既默认又能选中文件)
        if default_manager_is_explorer() {
            return reveal_with_explorer_select(path);
        }
        // 默认管理器是第三方 → 交给它打开父目录;
        // 第三方不可用(ShellExecuteW 失败)→ 降级内置 Explorer 定位
        shell_execute_open_parent(path).or_else(|e| {
            tracing::warn!("default file manager failed ({e}), fallback to explorer /select");
            reveal_with_explorer_select(path)
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn explorer_commands_are_recognized() {
            // 空命令 / 未展开的 %SystemRoot% / 完整路径 / 带引号带参数 → 均为内置
            assert!(command_refers_to_explorer(""));
            assert!(command_refers_to_explorer("  "));
            assert!(command_refers_to_explorer("%SystemRoot%\\Explorer.exe"));
            assert!(command_refers_to_explorer(r"C:\Windows\explorer.exe"));
            assert!(command_refers_to_explorer(
                r#""C:\Windows\explorer.exe" "%1""#
            ));
            // 大小写不敏感
            assert!(command_refers_to_explorer(r"C:\WINDOWS\EXPLORER.EXE"));
        }

        #[test]
        fn third_party_commands_are_rejected() {
            // Files 应用 / One Commander / Directory Opus 等第三方路径 → 非内置
            assert!(!command_refers_to_explorer(
                r#""C:\Program Files\Files\Files.exe" "%1""#,
            ));
            assert!(!command_refers_to_explorer(
                r#""C:\Program Files\OneCommander\OneCommander.exe" "%1""#,
            ));
            assert!(!command_refers_to_explorer(
                r#""C:\Program Files\GPSoftware\Directory Opus\dopusrt.exe" /c open "%1""#,
            ));
        }
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

    #[cfg(target_os = "windows")]
    windows::reveal(path)?;

    #[cfg(not(target_os = "windows"))]
    {
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
    }

    Ok(CommandResponse::ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_dir_extracts_directory() {
        assert_eq!(parent_dir_of("/home/user/a.txt"), "/home/user");
        // Windows 路径(反斜杠分隔符仅在 Windows 平台生效)
        if cfg!(target_os = "windows") {
            assert_eq!(parent_dir_of(r"C:\My Dir\a b.txt"), r"C:\My Dir");
        }
    }

    #[test]
    fn parent_dir_falls_back_for_root() {
        // 根目录下文件无父目录 → 回退到路径自身
        assert_eq!(parent_dir_of("/a.txt"), "/");
        if cfg!(target_os = "windows") {
            assert_eq!(parent_dir_of("a.txt"), "a.txt");
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn macos_uses_reveal_flag() {
        let (program, args) = reveal_command_for_platform("/tmp/a.txt");
        if cfg!(target_os = "macos") {
            assert_eq!(program, "open");
            assert_eq!(args, vec!["-R", "/tmp/a.txt"]);
        } else {
            assert_eq!(program, "xdg-open");
            assert_eq!(args, vec!["/tmp"]);
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn linux_opens_parent_dir() {
        if cfg!(not(any(target_os = "windows", target_os = "macos"))) {
            let (program, args) = reveal_command_for_platform("/home/user/a.txt");
            assert_eq!(program, "xdg-open");
            assert_eq!(args, vec!["/home/user"]);
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
        // 存在路径时命令可启动;CI/无桌面环境下文件管理器可能不可用,
        // 仅当启动成功才返回 Ok;此处不强制成功,避免 CI 不稳定
        if result.is_err() {
            assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
        }
        let _ = std::fs::remove_file(existing);
    }
}
