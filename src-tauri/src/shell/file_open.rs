// Shell 层「通过文件关联/命令行打开文件」模块
//
// 职责:接收「用 Qraft 打开」的文件路径,读取内容后推送给前端,由前端在
// 代码编辑器工作区中打开该文件。
//
// 平台差异:
// - Windows / Linux:通过文件关联或命令行双击打开时,文件路径作为命令行
//   参数传入(第二个参数,`args[1]`)。
// - macOS:系统通过 `open` 事件回调传入文件路径,需在 `RunEvent::Opened`
//   中接收。
// - 若应用已运行(单实例插件),重复启动时文件路径会经
//   `single_instance` 回调转发到现有实例。
//
// 安全模型:
// - 通过文件关联打开的文件路径会被加入 `AuthorizedPaths` 授权集合,
//   使前端能够通过 `fs_read_file` 读取、`fs_write_file` 覆盖保存
//   (与 dialog 选择的路径同等对待)。
// - 打开失败(路径非法/读取失败)仅记录日志,不阻塞应用启动。
//
// 可靠性设计:
// - 通过文件关联打开的文件会同时「emit 事件」与「写入待打开队列」。
//   前端已挂载 listener 时实时收到事件;若应用启动早期事件丢失
//   (webview 尚未就绪),前端可在初始化时调用 `app_pull_open_files`
//   拉取队列补齐,避免漏开文件。
//
// 该模块依赖 `commands::fs::AuthorizedPaths` 与 `tauri::AppHandle`,仅在
// 非测试编译下包含(与 `shell::state` 一致),避免测试二进制链接 native 依赖。

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::Emitter;

use crate::commands::fs::AuthorizedPaths;
use crate::shell::AppError;

/// 推送给前端的待打开文件负载
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub path: String,
    pub content: String,
}

/// 待打开文件队列(事件可能因前端未就绪而丢失,队列作为兜底)
#[derive(Default)]
pub struct PendingOpenFiles {
    inner: Mutex<Vec<OpenFilePayload>>,
}

impl PendingOpenFiles {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加一个待打开文件
    pub fn push(&self, payload: OpenFilePayload) {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(payload);
    }

    /// 取出全部待打开文件并清空队列(前端初始化拉取)
    pub fn drain_all(&self) -> Vec<OpenFilePayload> {
        std::mem::take(
            &mut self
                .inner
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }

    /// 队列中是否有待打开文件
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    }
}

/// 从启动命令行参数中提取待打开的文件路径(Windows / Linux)
///
/// 通过文件关联打开文件时,系统会把文件路径作为第一个附加参数传入,
/// 即 `args[1]`(args[0] 是可执行文件自身)。
///
/// 返回 `Option<String>`:无参数或参数为空时不返回,避免误读。
#[must_use]
pub fn extract_file_arg_from_args(args: &[String]) -> Option<String> {
    let path = args.get(1)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// 校验参数是否指向一个存在的普通文件,而非目录或无效路径
#[must_use]
pub fn is_openable_file(path: &str) -> bool {
    Path::new(path).is_file()
}

/// 读取文件文本内容
///
/// # Errors
///
/// - 文件读取失败(权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
fn read_file_text(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(AppError::from)
}

/// 检测文件内容是否为可编辑文本
///
/// 参考 VS Code 的启发式:读取文件前若干字节,若出现 NUL 字节(`\0`)则视为
/// 二进制文件(UTF-16 编码也会被误判为二进制,但本工具聚焦 UTF-8/ASCII 文本,
/// 与前端语言检测一致)。空文件视为文本。
///
/// # Errors
///
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
fn file_is_text(path: &str) -> Result<bool, AppError> {
    let bytes = std::fs::read(path).map_err(AppError::from)?;
    Ok(!bytes[..bytes.len().min(8192)].contains(&0))
}

/// 通过文件关联/命令行/拖放打开单个文件;若为二进制或目录,不打开并推送
/// `app:open-file-unsupported` 事件(文件名),供前端提示(参考 VS Code)。
///
/// # Errors
///
/// - 路径不存在时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件读取失败(权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub fn open_dropped_file(
    app: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
    pending: &PendingOpenFiles,
    path: &str,
) -> Result<(), AppError> {
    let p = Path::new(path);
    let name = || {
        p.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string())
    };

    if !p.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("path does not exist: {path}"),
        )));
    }

    // 拖入目录:不支持在单文件编辑器中打开文件夹,提示用户
    if p.is_dir() {
        emit_unsupported(app, &name());
        return Ok(());
    }

    // 非普通文件(如设备/管道):跳过
    if !p.is_file() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("path is not a regular file: {path}"),
        )));
    }

    // 二进制内容:不打开,通知前端「格式不支持」
    if !file_is_text(path)? {
        emit_unsupported(app, &name());
        return Ok(());
    }

    open_file_in_app(app, authorized, pending, path)
}

/// 推送「无法打开」提示事件到前端(文件名)
fn emit_unsupported(app: &tauri::AppHandle, name: &str) {
    if let Err(e) = app.emit("app:open-file-unsupported", name) {
        tracing::warn!("failed to emit app:open-file-unsupported event: {e}");
    }
}

/// 批量处理拖放的文件路径列表
///
/// 逐个调用 `open_dropped_file`;单个文件失败(不存在/读取失败)仅记录日志,
/// 不中断其它文件。二进制文件由 `open_dropped_file` 内部 emit 提示。
pub fn open_dropped_files(
    app: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
    pending: &PendingOpenFiles,
    paths: &[String],
) {
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Err(e) = open_dropped_file(app, authorized, pending, trimmed) {
            tracing::warn!("failed to open dropped file `{trimmed}`: {e}");
        }
    }
}

/// 清理拖放路径可能带上的 Windows 长路径前缀 `\\?\`
///
/// 参考 VS Code/系统行为:Webview 拖放路径在 Windows 上可能带 `\\?\` 前缀,
/// 直接传给 `std::fs` 通常也能工作,但清理后更干净且与对话框返回路径一致。
#[must_use]
pub fn sanitize_dropped_path(path: &str) -> &str {
    if let Some(stripped) = path.strip_prefix(r"\\?\") {
        stripped
    } else {
        path
    }
}

/// 处理一个待打开的文件路径:授权 + 读取内容 + 入队 + 推送给前端
///
/// - 将路径加入 `AuthorizedPaths`,使前端可读写该文件;
/// - 读取文件文本内容;
/// - 写入 `PendingOpenFiles` 队列(兜底);
/// - 通过 `app:open-file` 事件推送 `{ path, content }` 给前端。
///
/// # Errors
///
/// - 路径不存在或不是文件时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件读取失败(权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub fn open_file_in_app(
    app: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
    pending: &PendingOpenFiles,
    path: &str,
) -> Result<(), AppError> {
    if !is_openable_file(path) {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("path is not an existing file: {path}"),
        )));
    }

    let content = read_file_text(path)?;

    // 授权路径,使前端可 fs_read_file 重新读取 / fs_write_file 覆盖保存
    authorized.authorize(path);

    let payload = OpenFilePayload {
        path: path.to_string(),
        content,
    };

    // 写入待打开队列作为兜底(即使事件因前端未就绪而丢失也能补齐)
    pending.push(payload.clone());

    // 推送给前端;失败仅记录日志,不视为致命错误
    if let Err(e) = app.emit("app:open-file", &payload) {
        tracing::warn!("failed to emit app:open-file event: {e}");
    }

    Ok(())
}

/// 批量处理启动时传入的多个文件参数(目前取第一个,保持与 Windows 行为一致)
///
/// # Errors
///
/// - 所有文件打开失败时返回错误;部分失败时仅记录日志
pub fn open_files_from_args(
    app: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
    pending: &PendingOpenFiles,
    args: &[String],
) -> Result<(), AppError> {
    let Some(path) = extract_file_arg_from_args(args) else {
        return Ok(());
    };
    open_file_in_app(app, authorized, pending, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_file_arg_from_first_extra_arg() {
        let args = vec!["qraft.exe".to_string(), r"C:\a.txt".to_string()];
        assert_eq!(
            extract_file_arg_from_args(&args).as_deref(),
            Some(r"C:\a.txt")
        );
    }

    #[test]
    fn extract_file_arg_returns_none_when_missing() {
        let args = vec!["qraft.exe".to_string()];
        assert_eq!(extract_file_arg_from_args(&args), None);
    }

    #[test]
    fn extract_file_arg_returns_none_when_blank() {
        let args = vec!["qraft.exe".to_string(), "   ".to_string()];
        assert_eq!(extract_file_arg_from_args(&args), None);
    }

    #[test]
    fn is_openable_file_distinguishes_file_from_dir() {
        let tmp = std::env::temp_dir();
        let file = tmp.join("qraft_file_open_check.txt");
        std::fs::write(&file, "x").expect("write temp file");
        assert!(is_openable_file(file.to_str().unwrap()));
        // 目录不算可打开文件
        assert!(!is_openable_file(tmp.to_str().unwrap()));
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn pending_open_files_push_drain() {
        let pending = PendingOpenFiles::new();
        assert!(pending.is_empty());

        pending.push(OpenFilePayload {
            path: "/a.txt".into(),
            content: "a".into(),
        });
        pending.push(OpenFilePayload {
            path: "/b.json".into(),
            content: "{}".into(),
        });
        assert!(!pending.is_empty());

        let drained = pending.drain_all();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].path, "/a.txt");
        assert_eq!(drained[1].path, "/b.json");
        assert!(pending.is_empty());
    }

    #[test]
    fn file_is_text_detects_binary_nul_byte() {
        let dir = std::env::temp_dir();
        let text = dir.join("qraft_text_detect.txt");
        let bin = dir.join("qraft_bin_detect.bin");
        std::fs::write(&text, b"hello world").expect("write text file");
        // 含 NUL 字节 → 二进制
        std::fs::write(&bin, b"\x00\x01\x02").expect("write binary file");

        assert!(file_is_text(text.to_str().unwrap()).unwrap());
        assert!(!file_is_text(bin.to_str().unwrap()).unwrap());

        let _ = std::fs::remove_file(&text);
        let _ = std::fs::remove_file(&bin);
    }

    #[test]
    fn file_is_text_empty_is_text() {
        let dir = std::env::temp_dir();
        let empty = dir.join("qraft_empty_detect.txt");
        std::fs::write(&empty, b"").expect("write empty file");
        assert!(file_is_text(empty.to_str().unwrap()).unwrap());
        let _ = std::fs::remove_file(&empty);
    }

    #[test]
    fn sanitize_strips_windows_long_path_prefix() {
        assert_eq!(sanitize_dropped_path(r"\\?\C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(sanitize_dropped_path(r"C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(sanitize_dropped_path("/home/user/a.txt"), "/home/user/a.txt");
    }
}
