// 文件系统 IPC Command(受限)
//
// 实现 fs_read_file、fs_write_file、fs_save_bytes、fs_read_dir、
// fs_read_text_file_checked 等,通过 AuthorizedPaths 沙箱限制:
// 仅允许用户在 dialog 中显式选择的路径/文件夹 + app 数据目录。
// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。
//
// 「打开文件夹」语义:用户通过 dialog 显式选择的目录根加入授权集合后,
// 该目录子树内的文件视为同等可信(对齐 VSCode 工作区),允许读取、
// 枚举与覆盖保存;目录外的路径依旧被拒绝。

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use base64::Engine as _;
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use crate::shell::AppError;
use crate::shell::fs_reveal::fs_reveal_in_explorer_inner;
use crate::shell::response::CommandResponse;

/// 授权路径集合
///
/// 用户通过 dialog 显式选择的文件路径或文件夹根路径会被加入此集合,
/// `fs_read_file` / `fs_write_file` / `fs_read_dir` 等仅允许操作集合中的
/// 路径、已授权目录的子树内路径,或 app 数据目录。
#[derive(Default)]
pub struct AuthorizedPaths {
    inner: Mutex<HashSet<String>>,
}

impl AuthorizedPaths {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 授权一个路径(用户通过 dialog 选择后调用)
    pub fn authorize(&self, path: &str) {
        // Mutex 中毒时取出内部数据继续操作:授权集合仅追加/查询,中毒不代表
        // 数据不可用,继续运行比 panic 更友好
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(path.to_string());
    }

    /// 检查路径是否已授权(精确匹配)
    pub fn is_authorized(&self, path: &str) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(path)
    }

    /// 检查路径是否可访问:精确授权,或位于某个已授权目录的子树内
    ///
    /// 「打开文件夹」会把用户显式选择的目录根加入集合;此后该目录下的
    /// 文件与子目录均视为已授权(组件级比较,`C:\dir2` 不会误匹配 `C:\dir`)。
    #[must_use]
    pub fn is_path_allowed(&self, path: &str) -> bool {
        let guard = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.contains(path) {
            return true;
        }
        let p = Path::new(path);
        guard.iter().any(|root| p.starts_with(root))
    }

    /// 撤销路径授权
    pub fn revoke(&self, path: &str) {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(path);
    }
}

// ============ 内部函数(可测试) ============

/// 校验路径是否在允许范围内
///
/// MVP 简化策略:仅允许 `AuthorizedPaths` 中的路径或其授权目录子树内的路径。
/// app 数据目录的读写由 ConfigStore/HistoryStore 内部处理,不走此 Command。
fn validate_path(path: &str, authorized: &AuthorizedPaths) -> Result<(), AppError> {
    if authorized.is_path_allowed(path) {
        Ok(())
    } else {
        Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog: {path}"
        )))
    }
}

/// 读取指定路径的文件内容(必须在 `authorized` 集合中)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败(不存在/权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_read_file_inner(
    path: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    validate_path(path, authorized)?;
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(content))
}

/// 向指定路径写入文件内容(必须在 `authorized` 集合中)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败(权限不足/磁盘满)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_write_file_inner(
    path: &str,
    content: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<()>, AppError> {
    validate_path(path, authorized)?;
    tokio::fs::write(path, content)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(()))
}

/// 将字节写入指定路径
///
/// # Errors
///
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn save_bytes_to_path(path: &str, bytes: &[u8]) -> Result<(), AppError> {
    tokio::fs::write(path, bytes).await.map_err(AppError::from)
}

/// NUL 字节启发式:前 8192 字节中出现 NUL(`\0`)即视为二进制内容。
/// 与 `shell/file_open` 的系统级打开入口共用同一策略(参考 VS Code)。
#[must_use]
pub fn bytes_look_like_text(bytes: &[u8]) -> bool {
    !bytes[..bytes.len().min(8192)].contains(&0)
}

/// 枚举目录内容(必须在授权集合或其授权目录子树内)
///
/// 排序规则:子目录在前,名称不分大小写升序(对齐 `VSCode` 资源管理器)。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 目录读取失败(不存在/权限不足)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_read_dir_inner(
    path: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<Vec<DirEntryInfo>>, AppError> {
    validate_path(path, authorized)?;
    let mut rd = tokio::fs::read_dir(path).await.map_err(AppError::from)?;
    let mut entries: Vec<DirEntryInfo> = Vec::new();
    while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
        let is_dir = entry.file_type().await.map_err(AppError::from)?.is_dir();
        // Windows 目录分隔符统一为 `\`,与 dialog 返回的路径形态保持一致
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        entries.push(DirEntryInfo {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(CommandResponse::ok(entries))
}

/// 读取文本文件并校验可编辑性(必须在授权范围内)
///
/// 用于「文件夹树」点击文件打开:
/// - 二进制内容(NUL 字节启发式)→ `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 非 UTF-8 编码 → 同样视为不受支持(编辑器聚焦 UTF-8 文本)
///
/// 前端据此弹「格式不支持」提示;文件仍保留在树列表中。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 二进制/非 UTF-8 时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
pub async fn fs_read_text_file_checked_inner(
    path: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    validate_path(path, authorized)?;
    let bytes = tokio::fs::read(path).await.map_err(AppError::from)?;
    if !bytes_look_like_text(&bytes) {
        return Err(AppError::Unsupported("binary content".into()));
    }
    String::from_utf8(bytes)
        .map(CommandResponse::ok)
        .map_err(|_| AppError::Unsupported("non-utf-8 content".into()))
}

// ============ 文件编码(编辑器编码切换;纯逻辑见 media::text_encoding)============

use crate::media::text_encoding::{decode_text, detect_encoding, encode_text, is_supported_encoding};

/// 带编码信息的文本读取结果(`fs_read_text_file_encoded` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedTextContent {
    pub content: String,
    /// 探测到的编码标识(`detect_encoding` 输出,前端展示/保存用)
    pub encoding: String,
}

/// 读取文本文件并探测编码(必须在授权范围内);支持显式指定编码
///
/// 与 `fs_read_text_file_checked` 的差异:
/// - 不要求严格 UTF-8:GBK/Big5 等编码自动探测并解码
/// - 返回内容 + 编码标识,供编辑器状态栏展示与「以该编码保存」复用
///
/// `encoding` 提供且非空时跳过探测,直接按该编码解码
/// (VSCode「通过编码重新打开」语义);编码不受支持时返回 `AppError::Unsupported`。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 二进制内容时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 显式指定的编码不受支持时返回 `AppError::Unsupported`
pub async fn fs_read_text_file_encoded_inner(
    path: &str,
    encoding: Option<&str>,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<EncodedTextContent>, AppError> {
    validate_path(path, authorized)?;
    let bytes = tokio::fs::read(path).await.map_err(AppError::from)?;
    if !bytes_look_like_text(&bytes) {
        return Err(AppError::Unsupported("binary content".into()));
    }
    let encoding_id = match encoding {
        Some(id) if !id.is_empty() => {
            if !is_supported_encoding(id) {
                return Err(AppError::Unsupported(format!("unsupported encoding: {id}")));
            }
            id
        }
        _ => detect_encoding(&bytes),
    };
    Ok(CommandResponse::ok(EncodedTextContent {
        content: decode_text(&bytes, encoding_id),
        encoding: encoding_id.to_string(),
    }))
}

/// 以指定编码把内容写入文件(路径必须已授权)
///
/// # Errors
///
/// - 编码不受支持时返回 `AppError::Unsupported`
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn fs_write_file_encoded_inner(
    path: &str,
    content: &str,
    encoding_id: &str,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<()>, AppError> {
    validate_path(path, authorized)?;
    let bytes = encode_text(content, encoding_id)?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(()))
}

/// 校验文件扩展名与 MIME 的映射关系,返回规范扩展名(未匹配时返回 `bin`)
#[must_use]
pub fn extension_for_mime(mime: &str, fallback: &str) -> String {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/x-icon" => "ico",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => fallback,
    }
    .to_string()
}

// ============ Tauri Command 包装 ============

/// 读取指定路径的文件内容(必须在 dialog 中已授权)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_read_file(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<String>, AppError> {
    fs_read_file_inner(&path, &authorized).await
}

/// 向指定路径写入文件内容(必须在 dialog 中已授权)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<()>, AppError> {
    fs_write_file_inner(&path, &content, &authorized).await
}

/// 弹出保存对话框并写入二进制字节(前端「另存为」使用)
///
/// 用户在保存对话框中显式选择路径后,该路径被授权并写入 `bytes`。
/// 用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - base64 解码失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_save_bytes(
    app: tauri::AppHandle,
    file_name: String,
    base64: String,
    mime: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<String>>, AppError> {
    // 扩展名优先取文件名(如 xxx.html),MIME 映射表未覆盖的类型
    // (text/html 等)不再退化为 .bin 过滤器,避免保存对话框误导后缀
    let ext_from_name = Path::new(&file_name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .filter(|e| !e.is_empty() && e.len() <= 8);
    let ext = ext_from_name.unwrap_or_else(|| extension_for_mime(&mime, "bin"));
    let mime_name = mime.split(';').next().unwrap_or(&mime);
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(mime_name, &[ext.as_str()])
        .blocking_save_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };

    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("save path invalid: {e}")))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| AppError::Unknown(format!("invalid base64: {e}")))?;

    // 保存路径由用户显式选择,加入授权集合(与 fs_write_file 沙箱语义一致),
    // 便于后续直接 fs_write_file 覆盖保存,无需再次弹窗
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    save_bytes_to_path(&path_str, &bytes).await?;
    Ok(CommandResponse::ok(Some(path_str)))
}

/// 弹出保存对话框并按指定编码写入文本(untitled Tab「通过编码保存」使用)
///
/// 用户在保存对话框中显式选择路径后,该路径被授权并按 `encoding` 编码写入
/// (`utf-8-bom` 自动补 BOM)。用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - 编码不受支持时返回 `AppError::Unsupported`
/// - 保存路径非法时返回 `AppError::Unknown`
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn fs_save_text_file_encoded(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
    encoding: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<String>>, AppError> {
    // 扩展名优先取文件名;缺失时回退 .txt 过滤器
    let ext_from_name = Path::new(&file_name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .filter(|e| !e.is_empty() && e.len() <= 8);
    let ext = ext_from_name.unwrap_or_else(|| "txt".to_string());
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("text/plain", &[ext.as_str(), "txt"])
        .blocking_save_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };
    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("save path invalid: {e}")))?;
    let bytes = encode_text(&content, &encoding)?;
    let path_str = path_buf.to_string_lossy().into_owned();
    // 保存路径由用户显式选择,加入授权集合(与 fs_save_bytes 沙箱语义一致)
    authorized.authorize(&path_str);
    tokio::fs::write(&path_str, bytes)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(Some(path_str)))
}

/// 在系统文件管理器中定位指定文件
///
/// # Errors
///
/// - 路径为空/不存在时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 平台命令启动失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn fs_reveal_in_explorer(path: String) -> Result<CommandResponse<()>, AppError> {
    fs_reveal_in_explorer_inner(&path)
}

/// 打开文件对话框的返回结果(路径 + 内容 + 探测到的编码)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileResult {
    pub path: String,
    pub content: String,
    /// 探测到的编码标识(如 utf-8 / gb18030),供编辑器状态栏展示与保存复用
    pub encoding: String,
}

/// 打开文件夹对话框的返回结果(目录根路径)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolderResult {
    pub path: String,
}

/// 目录条目(`fs_read_dir` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 弹出打开文件对话框,读取选中文件的内容(自动探测编码)
///
/// 用户在打开对话框中显式选择的路径会被加入授权集合,此后可通过
/// `fs_read_file` 重新读取或 `fs_write_file` 直接覆盖保存。
/// 用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - 文件读取失败(不存在/权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_open_dialog(
    app: tauri::AppHandle,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<OpenFileResult>>, AppError> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("打开文本文件")
        .blocking_pick_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };

    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("open path invalid: {e}")))?;
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    let bytes = tokio::fs::read(&path_str).await.map_err(AppError::from)?;
    if !bytes_look_like_text(&bytes) {
        return Err(AppError::Unsupported("binary content".into()));
    }
    let encoding = detect_encoding(&bytes).to_string();
    let content = decode_text(&bytes, &encoding);
    Ok(CommandResponse::ok(Some(OpenFileResult {
        path: path_str,
        content,
        encoding,
    })))
}

/// 弹出打开文件夹对话框,返回所选目录根路径
///
/// 用户选择的目录会被加入授权集合,此后该目录子树内的文件可通过
/// `fs_read_file` 重新读取、`fs_write_file` 覆盖保存、`fs_read_dir` 枚举。
/// 用户取消对话框时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - 对话框路径转换失败时返回 `AppError::Unknown`
#[tauri::command]
pub async fn fs_open_folder_dialog(
    app: tauri::AppHandle,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<OpenFolderResult>>, AppError> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("打开文件夹")
        .blocking_pick_folder()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(None));
    };
    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("open folder path invalid: {e}")))?;
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    Ok(CommandResponse::ok(Some(OpenFolderResult {
        path: path_str,
    })))
}

/// 枚举指定目录的内容(必须在授权集合或其授权目录子树内)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 目录读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_read_dir(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Vec<DirEntryInfo>>, AppError> {
    fs_read_dir_inner(&path, &authorized).await
}

/// 拖放条目类型
#[derive(Debug, Serialize)]
pub struct DroppedKind {
    pub path: String,
    /// "dir" | "file"
    pub kind: String,
}

/// 将拖放进来的路径加入授权集合(用户显式拖放视同 dialog 选择);
/// 不存在的路径跳过。返回实际授权成功的条目及类型。
///
/// # Errors
///
/// 当前恒成功;保留 Result 以对齐其他 fs 命令签名
pub fn fs_authorize_dropped_paths_inner(
    paths: Vec<String>,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<Vec<DroppedKind>>, AppError> {
    let mut kinds = Vec::with_capacity(paths.len());
    for p in paths {
        let Ok(meta) = std::fs::metadata(&p) else {
            continue;
        };
        let kind = if meta.is_dir() { "dir" } else { "file" }.to_string();
        authorized.authorize(&p);
        kinds.push(DroppedKind { path: p, kind });
    }
    Ok(CommandResponse::ok(kinds))
}

/// 将拖放条目加入授权集合并返回各条目类型(目录/文件)
///
/// # Errors
///
/// 当前恒成功;保留 Result 以对齐其他 fs 命令签名
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn fs_authorize_dropped_paths(
    paths: Vec<String>,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Vec<DroppedKind>>, AppError> {
    fs_authorize_dropped_paths_inner(paths, &authorized)
}

/// 读取文本文件并校验可编辑性,供文件夹树点击文件时调用
///
/// 二进制或非 UTF-8 内容返回 `ERR_FILE_UNSUPPORTED`,前端弹「格式不支持」提示。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 二进制/非 UTF-8 时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
#[tauri::command]
pub async fn fs_read_text_file_checked(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<String>, AppError> {
    fs_read_text_file_checked_inner(&path, &authorized).await
}

/// 读取文本文件并自动探测编码(GBK/Big5/Shift-JIS 等自动解码)
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 二进制内容时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 显式指定的编码不受支持时返回 `AppError::Unsupported`
#[tauri::command]
pub async fn fs_read_text_file_encoded(
    path: String,
    encoding: Option<String>,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<EncodedTextContent>, AppError> {
    fs_read_text_file_encoded_inner(&path, encoding.as_deref(), &authorized).await
}

/// 以指定编码写入文本文件(utf-8-bom 自动补 BOM)
///
/// # Errors
///
/// - 编码不受支持时返回 `AppError::Unsupported`
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_write_file_encoded(
    path: String,
    content: String,
    encoding: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<()>, AppError> {
    fs_write_file_encoded_inner(&path, &content, &encoding, &authorized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authorized_paths_authorize_and_check() {
        let paths = AuthorizedPaths::new();
        assert!(!paths.is_authorized("/tmp/secret.txt"));

        paths.authorize("/tmp/allowed.txt");
        assert!(paths.is_authorized("/tmp/allowed.txt"));
        assert!(!paths.is_authorized("/tmp/other.txt"));
    }

    #[test]
    fn test_authorized_paths_revoke() {
        let paths = AuthorizedPaths::new();
        paths.authorize("/tmp/revoke.txt");
        assert!(paths.is_authorized("/tmp/revoke.txt"));

        paths.revoke("/tmp/revoke.txt");
        assert!(!paths.is_authorized("/tmp/revoke.txt"));
    }

    #[test]
    fn test_authorized_paths_subtree_semantics() {
        // Windows 风格路径:组件级前缀比较,兄弟目录不误匹配
        let paths = AuthorizedPaths::new();
        paths.authorize(r"C:\work\project");

        assert!(paths.is_path_allowed(r"C:\work\project"));
        assert!(paths.is_path_allowed(r"C:\work\project\a.txt"));
        assert!(paths.is_path_allowed(r"C:\work\project\sub\b.txt"));
        // 兄弟目录(共享字符串前缀但非组件前缀)不可访问
        assert!(!paths.is_path_allowed(r"C:\work\project2\a.txt"));
        // 父目录与其它路径不可访问
        assert!(!paths.is_path_allowed(r"C:\work"));
        assert!(!paths.is_path_allowed(r"D:\elsewhere\a.txt"));
    }

    #[test]
    fn test_authorized_paths_subtree_unix_semantics() {
        let paths = AuthorizedPaths::new();
        paths.authorize("/home/user/project");

        assert!(paths.is_path_allowed("/home/user/project/src/main.rs"));
        assert!(!paths.is_path_allowed("/home/user/project2/a.txt"));
    }

    #[tokio::test]
    async fn test_fs_read_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_read_file_inner("/etc/passwd", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_write_file_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_write_file_inner("/tmp/forbidden.txt", "content", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_read_write_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_round_trip.txt");
        let path_str = path.to_str().unwrap();

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        // 写入
        let write_resp = fs_write_file_inner(path_str, "hello qraft", &paths)
            .await
            .unwrap();
        assert!(write_resp.success);

        // 读取
        let read_resp = fs_read_file_inner(path_str, &paths).await.unwrap();
        assert!(read_resp.success);
        assert_eq!(read_resp.data.unwrap(), "hello qraft");

        // 清理
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_fs_read_file_not_found_but_authorized() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_nonexistent.txt");
        let path_str = path.to_str().unwrap();
        // 确保文件不存在
        let _ = std::fs::remove_file(&path);

        let paths = AuthorizedPaths::new();
        paths.authorize(path_str);

        let result = fs_read_file_inner(path_str, &paths).await;
        assert!(result.is_err());
        // io::Error → AppError::Io → code "ERR_FILE_IO"
        assert_eq!(result.unwrap_err().code(), "ERR_FILE_IO");
    }

    #[tokio::test]
    async fn test_save_bytes_to_path_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_save_bytes.bin");
        let path_str = path.to_str().unwrap();
        let _ = std::fs::remove_file(&path);

        save_bytes_to_path(path_str, &[0x00, 0x01, 0x02, 0xff])
            .await
            .expect("save should succeed");

        let content = std::fs::read(&path).expect("file should exist");
        assert_eq!(content, vec![0x00, 0x01, 0x02, 0xff]);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_extension_for_mime_known() {
        assert_eq!(extension_for_mime("image/png", "bin"), "png");
        assert_eq!(extension_for_mime("application/pdf", "bin"), "pdf");
        assert_eq!(extension_for_mime("audio/mpeg", "bin"), "mp3");
        assert_eq!(extension_for_mime("video/mp4", "bin"), "mp4");
    }

    #[test]
    fn test_extension_for_mime_with_params_and_unknown() {
        // 带 charset 参数的 MIME
        assert_eq!(
            extension_for_mime("image/svg+xml;charset=utf-8", "bin"),
            "svg"
        );
        // 未知 MIME 使用回退扩展名
        assert_eq!(extension_for_mime("application/octet-stream", "dat"), "dat");
    }

    #[test]
    fn test_bytes_look_like_text() {
        assert!(bytes_look_like_text(b"hello world"));
        // 空文件视为文本(与 file_open 一致)
        assert!(bytes_look_like_text(b""));
        // 前 8192 字节内含 NUL → 二进制
        assert!(!bytes_look_like_text(&[0x00, 0x01, 0x02]));
        // NUL 在 8192 之后:启发式只看头部
        let mut late_nul = vec![b'a'; 9000];
        late_nul[8500] = 0;
        assert!(bytes_look_like_text(&late_nul));
    }

    #[tokio::test]
    async fn test_fs_read_dir_unauthorized_path() {
        let paths = AuthorizedPaths::new();
        let result = fs_read_dir_inner("/etc", &paths).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "ERR_PERMISSION_DENIED");
    }

    #[tokio::test]
    async fn test_fs_read_dir_sorts_dirs_first_then_case_insensitive() {
        let dir = std::env::temp_dir().join("qraft_test_read_dir");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).expect("create sub");
        std::fs::write(dir.join("b.txt"), b"2").expect("write b");
        std::fs::write(dir.join("A.txt"), b"1").expect("write A");

        let paths = AuthorizedPaths::new();
        paths.authorize(dir.to_str().unwrap());

        let resp = fs_read_dir_inner(dir.to_str().unwrap(), &paths)
            .await
            .unwrap();
        let entries = resp.data.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "A.txt", "b.txt"]);

        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].name, "A.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_checked_binary_is_unsupported() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_checked_bin.bin");
        std::fs::write(&path, [0x00u8, 0x01, 0x02]).expect("write bin");

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        let err = fs_read_text_file_checked_inner(path.to_str().unwrap(), &paths)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_UNSUPPORTED");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_checked_non_utf8_is_unsupported() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_checked_latin1.txt");
        // 无 NUL 但非 UTF-8(Latin-1 高位字节)
        std::fs::write(&path, [0xFFu8, 0xFE, 0x41]).expect("write non-utf8");

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        let err = fs_read_text_file_checked_inner(path.to_str().unwrap(), &paths)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_UNSUPPORTED");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_checked_round_trip_and_subtree() {
        let dir = std::env::temp_dir().join("qraft_test_checked_subtree");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("inner.txt");
        std::fs::write(&path, "hello folder").expect("write text");

        // 仅授权目录根:子树内文件可读(打开文件夹语义)
        let paths = AuthorizedPaths::new();
        paths.authorize(dir.to_str().unwrap());

        let resp = fs_read_text_file_checked_inner(path.to_str().unwrap(), &paths)
            .await
            .unwrap();
        assert_eq!(resp.data.unwrap(), "hello folder");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_authorize_dropped_paths_filters_missing() {
        let inner_paths = AuthorizedPaths::new();
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let out = fs_authorize_dropped_paths_inner(
            vec![
                file.to_string_lossy().into_owned(),
                tmp.path().to_string_lossy().into_owned(),
                "Z:/__no_such__/ghost.txt".to_string(),
            ],
            &inner_paths,
        )
        .unwrap()
        .data
        .unwrap();
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|d| d.kind == "dir"));
        assert!(out.iter().any(|d| d.kind == "file"));
        assert!(inner_paths.is_path_allowed(&file.to_string_lossy()));
        assert!(!inner_paths.is_path_allowed("Z:/__no_such__/ghost.txt"));
    }
}
