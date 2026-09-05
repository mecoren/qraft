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

use crate::commands::fs::{AuthorizedPaths, TextKind, bytes_look_like_text_kind};
use crate::shell::AppError;

/// 推送给前端的待打开文件负载
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub path: String,
    pub content: String,
    /// 探测到的编码标识(utf-8 / gb18030 等);前端打开 Tab 时沿用
    #[serde(default)]
    pub encoding: String,
}

/// 打开失败的载荷变体:
/// - `Unsupported`:内容为二进制,无法作为文本打开(前端提供「仍要打开」)
/// - `TooLarge`:超过编辑器大小上限(前端提示,不可恢复)
/// - `Error`:读取失败等其他原因
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OpenFileUnsupported {
    /// 二进制内容(`reason="binary"`);payload 为完整路径
    Unsupported { path: String },
    /// 文件过大(`reason="too-large"`)
    TooLarge { path: String },
    /// 其他错误(路径非法/读取失败等)
    Error { message: String },
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

/// 读取文件文本内容(编码自动探测,与 `fs_open_dialog` 同一策略:
/// GBK/Big5/Shift-JIS/UTF-16 等自动解码;仅二进制内容返回 None)
///
/// # Errors
///
/// - 文件读取失败(权限不足等)时返回 `AppError::Io`(`ERR_FILE_IO`)
fn read_file_text(path: &str) -> Result<Option<(String, String)>, AppError> {
    let bytes = std::fs::read(path).map_err(AppError::from)?;
    match bytes_look_like_text_kind(&bytes) {
        TextKind::Text | TextKind::Utf16NoBom => {
            let encoding = detect_encoding_for_bytes(&bytes);
            let content = crate::media::text_encoding::decode_text(&bytes, encoding);
            Ok(Some((content, encoding.to_string())))
        }
        TextKind::Binary => Ok(None),
    }
}

/// 无 BOM UTF-16 的编码回退(LE);其余交给 `detect_encoding`
fn detect_encoding_for_bytes(bytes: &[u8]) -> &'static str {
    match bytes_look_like_text_kind(bytes) {
        TextKind::Utf16NoBom => "utf-16le",
        _ => crate::media::text_encoding::detect_encoding(bytes),
    }
}

/// 推送「无法打开」提示事件到前端(载荷含完整路径与原因)
fn emit_unsupported(app: &tauri::AppHandle, payload: &OpenFileUnsupported) {
    if let Err(e) = app.emit("app:open-file-unsupported", payload) {
        tracing::warn!("failed to emit app:open-file-unsupported event: {e}");
    }
}

/// 通过文件关联/命令行/拖放打开单个文件;若为二进制或目录,不打开并推送
/// `app:open-file-unsupported` 事件(载荷含路径与原因),供前端提示
/// 并提供「仍要打开」(参考 VS Code Open Anyway)。
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
    let full_path = p.to_string_lossy().into_owned();

    if !p.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("path does not exist: {path}"),
        )));
    }

    // 拖入目录:不支持在单文件编辑器中打开文件夹,提示用户
    if p.is_dir() {
        emit_unsupported(app, &OpenFileUnsupported::Error { message: full_path });
        return Ok(());
    }

    // 非普通文件(如设备/管道):跳过
    if !p.is_file() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("path is not a regular file: {path}"),
        )));
    }

    // 大小上限先行(读取 20MB+ 二进制进内存再丢弃没有意义)
    if let Ok(meta) = std::fs::metadata(&full_path) {
        if meta.len() > crate::commands::fs::EDITOR_FILE_MAX_BYTES {
            emit_unsupported(app, &OpenFileUnsupported::TooLarge { path: full_path });
            return Ok(());
        }
    }

    // 二进制内容:不打开,通知前端提供「仍要打开」兜底
    if read_file_text(path)?.is_none() {
        emit_unsupported(
            app,
            &OpenFileUnsupported::Unsupported {
                path: path.to_string(),
            },
        );
        return Ok(());
    }

    open_file_in_app(app, authorized, pending, path)
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
    path.strip_prefix(r"\\?\").map_or(path, |stripped| stripped)
}

/// 处理一个待打开的文件路径:授权 + 读取内容 + 入队 + 推送给前端
///
/// - 将路径加入 `AuthorizedPaths`,使前端可读写该文件;
/// - 读取文件文本内容(编码自动探测,返回内容 + 编码标识);
/// - 写入 `PendingOpenFiles` 队列(兜底);
/// - 通过 `app:open-file` 事件推送 `{ path, content, encoding }` 给前端。
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

    // 编码自动探测(与 fs_open_dialog 同一策略):二进制返回 None,
    // 由调用方决定 emit 「仍要打开」载荷还是报错
    let Some((content, encoding)) = read_file_text(path)? else {
        return Err(AppError::Unsupported("binary content".into()));
    };

    // 授权路径,使前端可 fs_read_file 重新读取 / fs_write_file 覆盖保存
    authorized.authorize(path);

    let payload = OpenFilePayload {
        path: path.to_string(),
        content,
        encoding,
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
            encoding: "utf-8".into(),
        });
        pending.push(OpenFilePayload {
            path: "/b.json".into(),
            content: "{}".into(),
            encoding: "utf-8".into(),
        });
        assert!(!pending.is_empty());

        let drained = pending.drain_all();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].path, "/a.txt");
        assert_eq!(drained[0].encoding, "utf-8");
        assert_eq!(drained[1].path, "/b.json");
        assert!(pending.is_empty());
    }

    #[test]
    fn read_file_text_detects_binary_nul_byte() {
        let dir = std::env::temp_dir();
        let text = dir.join("qraft_text_detect.txt");
        let bin = dir.join("qraft_bin_detect.bin");
        std::fs::write(&text, b"hello world").expect("write text file");
        // 含 NUL 字节 → 二进制(None)
        std::fs::write(&bin, b"\x00\x01\x02").expect("write binary file");

        let (content, encoding) = read_file_text(text.to_str().unwrap())
            .unwrap()
            .expect("text");
        assert_eq!(content, "hello world");
        assert_eq!(encoding, "utf-8");
        assert!(read_file_text(bin.to_str().unwrap()).unwrap().is_none());

        let _ = std::fs::remove_file(&text);
        let _ = std::fs::remove_file(&bin);
    }

    #[test]
    fn read_file_text_decodes_legacy_encodings() {
        let dir = std::env::temp_dir();
        // GBK 编码的「你好」(非合法 UTF-8):旧 read_to_string 会直接失败
        let gbk = dir.join("qraft_gbk_open.dat");
        std::fs::write(&gbk, [0xD6_u8, 0xD0, 0xCE, 0xC4]).expect("write gbk");
        // UTF-16 LE 无 BOM 的 ASCII 文本(偶数位 NUL):旧实现判为二进制
        let utf16 = dir.join("qraft_utf16le_open.dat");
        let bytes: Vec<u8> = b"hi".iter().flat_map(|&b| [b, 0]).collect();
        std::fs::write(&utf16, bytes).expect("write utf16le");

        let (content, encoding) = read_file_text(gbk.to_str().unwrap())
            .unwrap()
            .expect("gbk text");
        assert_eq!(content, "中文");
        assert_eq!(encoding, "gb18030");

        let (content, encoding) = read_file_text(utf16.to_str().unwrap())
            .unwrap()
            .expect("utf16 text");
        assert_eq!(content, "hi");
        assert_eq!(encoding, "utf-16le");

        let _ = std::fs::remove_file(&gbk);
        let _ = std::fs::remove_file(&utf16);
    }

    #[test]
    fn read_file_text_empty_is_text() {
        let dir = std::env::temp_dir();
        let empty = dir.join("qraft_empty_detect.txt");
        std::fs::write(&empty, b"").expect("write empty file");
        let (content, encoding) = read_file_text(empty.to_str().unwrap())
            .unwrap()
            .expect("text");
        assert_eq!(content, "");
        assert_eq!(encoding, "utf-8");
        let _ = std::fs::remove_file(&empty);
    }

    #[test]
    fn sanitize_strips_windows_long_path_prefix() {
        assert_eq!(sanitize_dropped_path(r"\\?\C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(sanitize_dropped_path(r"C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(
            sanitize_dropped_path("/home/user/a.txt"),
            "/home/user/a.txt"
        );
    }
}
