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

/// `bytes_look_like_text_kind` 的探测结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextKind {
    /// 普通文本(无 NUL,或带 BOM)
    Text,
    /// 无 BOM 的 UTF-16(按 NUL 奇偶位模式识别;LE/BE 无法细分,回退 LE 解码)
    Utf16NoBom,
    /// 二进制内容
    Binary,
}

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

/// NUL 字节检测窗口(字节):与 VS Code `ZERO_BYTE_DETECTION_BUFFER_MAX_LEN`
/// 一致,只看头部 512 字节,避免长文本中后段偶发 NUL 被误判为二进制。
const ZERO_BYTE_DETECTION_BUFFER_MAX_LEN: usize = 512;

/// 探测结果:文本 / 无 BOM 的 UTF-16(仍可打开)/ 二进制
///
/// 语义对齐 VS Code `detectEncodingFromBuffer`(workbench/services/textfile/common/encoding.ts):
/// 1. 先查 BOM(`Encoding::for_bom`)—— 带 BOM 的 UTF-16 恒视为文本
/// 2. 前 512 字节内出现 NUL 时,用「NUL 是否固定落在奇/偶字节位」识别
///    无 BOM 的 UTF-16(LE 期望 0xAA 0x00 模式、BE 期望 0x00 0xAA 模式)
/// 3. 两者都不满足才判为二进制
///
/// 与 `shell/file_open` 的系统级打开入口共用同一策略。
#[must_use]
pub fn bytes_look_like_text(bytes: &[u8]) -> bool {
    !matches!(bytes_look_like_text_kind(bytes), TextKind::Binary)
}

/// `bytes_look_like_text` 的细分版本,供需要区分「无 BOM UTF-16」的调用方使用
#[must_use]
pub fn bytes_look_like_text_kind(bytes: &[u8]) -> TextKind {
    // 带 BOM(含 UTF-16 LE/BE)一律视为文本,编码交给 detect_encoding 分流
    if encoding_rs::Encoding::for_bom(bytes).is_some() {
        return TextKind::Text;
    }
    let window = &bytes[..bytes.len().min(ZERO_BYTE_DETECTION_BUFFER_MAX_LEN)];
    let mut le_shape_possible = true;
    let mut be_shape_possible = true;
    let mut contains_zero = false;
    for (i, &b) in window.iter().enumerate() {
        let is_odd = i % 2 == 1;
        let is_zero = b == 0;
        if is_zero {
            contains_zero = true;
        }
        // UTF-16 LE:期望 0xAA 0x00(NUL 只出现在奇数位)
        if le_shape_possible && (is_odd != is_zero) {
            le_shape_possible = false;
        }
        // UTF-16 BE:期望 0x00 0xAA(NUL 只出现在偶数位)
        if be_shape_possible && (is_odd == is_zero) {
            be_shape_possible = false;
        }
        // 与 VS Code 一致:确认非 UTF-16 且遇到 NUL 即提前退出
        if is_zero && !le_shape_possible && !be_shape_possible {
            break;
        }
    }
    if !contains_zero {
        return TextKind::Text;
    }
    if le_shape_possible || be_shape_possible {
        // 无 BOM 的 UTF-16:探测为文本,但 detect_encoding 不带 BOM 分不出
        // LE/BE,标记出来供调用方按 LE 优先处理
        TextKind::Utf16NoBom
    } else {
        TextKind::Binary
    }
}

/// 文件内容上限(字节):编辑器走 IPC 传全文,超过该值拒绝打开并提示
/// (对齐 VS Code 文本编辑器打开大文件的代价控制;二进制视图另议)。
/// `shell/file_open` 的拖放/关联入口共用同一上限。
pub const EDITOR_FILE_MAX_BYTES: u64 = 20 * 1024 * 1024;

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

// ============ 文件编码(编辑器编码切换;纯逻辑见 media::text_encoding)============

use crate::media::text_encoding::{
    decode_text, detect_encoding, encode_text, is_supported_encoding,
};

/// 带编码信息的文本读取结果(`fs_read_text_file_encoded` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedTextContent {
    pub content: String,
    /// 探测到的编码标识(`detect_encoding` 输出,前端展示/保存用)
    pub encoding: String,
}

/// 读取文本文件并探测编码(必须在授权范围内);支持显式指定编码与强制打开
///
/// 与 `fs_read_text_file_checked` 的差异:
/// - 不要求严格 UTF-8:GBK/Big5 等编码自动探测并解码
/// - 返回内容 + 编码标识,供编辑器状态栏展示与「以该编码保存」复用
///
/// `encoding` 提供且非空时跳过探测,直接按该编码解码
/// (VSCode「通过编码重新打开」语义);编码不受支持时返回 `AppError::Unsupported`。
/// `force` 为 true 时跳过二进制启发式(VSCode「仍要打开」),按探测编码
/// 有损解码;同时受 `EDITOR_FILE_MAX_BYTES` 大小上限约束。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件超过编辑器大小上限时返回 `AppError::Unsupported`(`ERR_FILE_TOO_LARGE`)
/// - 二进制内容时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 显式指定的编码不受支持时返回 `AppError::Unsupported`
pub async fn fs_read_text_file_encoded_inner(
    path: &str,
    encoding: Option<&str>,
    force: bool,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<EncodedTextContent>, AppError> {
    validate_path(path, authorized)?;
    ensure_editable_size(path).await?;
    let bytes = tokio::fs::read(path).await.map_err(AppError::from)?;
    if !force && !bytes_look_like_text(&bytes) {
        return Err(AppError::Unsupported("binary content".into()));
    }
    let encoding_id = match encoding {
        Some(id) if !id.is_empty() => {
            if !is_supported_encoding(id) {
                return Err(AppError::Unsupported(format!("unsupported encoding: {id}")));
            }
            id
        }
        _ => detect_encoding_forced(&bytes),
    };
    Ok(CommandResponse::ok(EncodedTextContent {
        content: decode_text(&bytes, encoding_id),
        encoding: encoding_id.to_string(),
    }))
}

/// 打开前校验文件大小,超过编辑器上限时拒绝(VSCode 大文件保护语义)
///
/// # Errors
///
/// - 文件超过 `EDITOR_FILE_MAX_BYTES` 时返回 `AppError::Unsupported`(`ERR_FILE_TOO_LARGE`)
async fn ensure_editable_size(path: &str) -> Result<(), AppError> {
    let meta = tokio::fs::metadata(path).await.map_err(AppError::from)?;
    if meta.len() > EDITOR_FILE_MAX_BYTES {
        return Err(AppError::FileTooLarge {
            size: meta.len(),
            max: EDITOR_FILE_MAX_BYTES,
        });
    }
    Ok(())
}

/// 强制打开路径下的编码探测:二进制数据经 `decode_text` 按兜底编码
/// (Windows-1252)有损解码;无 BOM UTF-16 回退 LE 解码。
/// 普通路径由 `detect_encoding` 处理,避免行为分叉。
fn detect_encoding_forced(bytes: &[u8]) -> &'static str {
    match bytes_look_like_text_kind(bytes) {
        TextKind::Text => detect_encoding(bytes),
        // detect_encoding 依赖 BOM 分流 UTF-16 方向,无 BOM 时保持 LE 回退
        TextKind::Utf16NoBom => "utf-16le",
        TextKind::Binary => "windows-1252",
    }
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

/// 打开对话框失败的可恢复原因(`openDialogReason` / `reason` 字段值)
///
/// 前端据此分流:
/// - `binary`:二进制启发式命中,用户可强制按探测编码有损打开
/// - `too-large`:超过编辑器整读上限,进入大文件只读查看模式
///   (前端经 `fs_large_file_info` / `fs_read_file_lines` 流式打开)
pub const OPEN_DIALOG_REASON_BINARY: &str = "binary";
pub const OPEN_DIALOG_REASON_TOO_LARGE: &str = "too-large";

/// 打开文件对话框的失败载荷(路径 + 原因;前端「仍要打开」需回读该路径)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileFailure {
    pub path: String,
    /// `OPEN_DIALOG_REASON_*` 常量
    pub reason: String,
    /// 文件大小(字节,too-large 时展示)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
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
/// 与文件树/拖放路径共用 `read_openable_text_file` 打开逻辑:二进制 /
/// 超大文件不再整体失败,而是返回 `OpenFileOutcome::Failed` 携带路径与
/// 原因,供前端展示「仍要打开」(VSCode Open Anyway)。
///
/// # Errors
///
/// - 文件读取失败(不存在/权限不足/编码非法)时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_open_dialog(
    app: tauri::AppHandle,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<OpenFileOutcome>, AppError> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("打开文本文件")
        .blocking_pick_file()
    else {
        // 用户取消对话框:返回 None,前端据此静默处理(不视为错误)
        return Ok(CommandResponse::ok(OpenFileOutcome::cancelled()));
    };

    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("open path invalid: {e}")))?;
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    // 读取失败(不存在/权限)仍走错误通道:与「内容不可编辑」性质不同
    read_openable_text_file(&path_str)
        .await
        .map(CommandResponse::ok)
}

/// 打开文件对话框的结果:成功 / 用户取消 / 内容不可直接编辑(带原因)
///
/// 「不可直接编辑」不再整体报错(VSCode 对二进制文件也照常进入占位
/// 编辑器,由用户决定是否仍要以文本打开),前端据 `failed` 展示提示与
/// 「仍要打开」动作;取消与失败是两种独立的静默/交互路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileOutcome {
    /// 成功打开的文件内容;取消 / 失败时为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<OpenFileResult>,
    /// 未能直接打开的文件信息(二进制/过大),供前端展示「仍要打开」
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<OpenFileFailure>,
}

impl OpenFileOutcome {
    /// 用户取消对话框
    #[must_use]
    pub const fn cancelled() -> Self {
        Self {
            file: None,
            failed: None,
        }
    }
}

/// 读取已授权路径为可编辑文本(对话框 / 文件树 / 拖放共用)
///
/// - 大小超上限 → `failed.reason = "too-large"`(前端切换大文件只读查看)
/// - 二进制启发式命中 → `failed.reason = "binary"`(前端可强制打开)
///
/// # Errors
///
/// - 文件读取失败(不存在/权限不足)时返回 `AppError::Io`(`ERR_FILE_IO`)
pub async fn read_openable_text_file(path: &str) -> Result<OpenFileOutcome, AppError> {
    let meta = tokio::fs::metadata(path).await.map_err(AppError::from)?;
    if meta.len() > EDITOR_FILE_MAX_BYTES {
        return Ok(OpenFileOutcome {
            file: None,
            failed: Some(OpenFileFailure {
                path: path.to_string(),
                reason: OPEN_DIALOG_REASON_TOO_LARGE.to_string(),
                size: Some(meta.len()),
            }),
        });
    }
    let bytes = tokio::fs::read(path).await.map_err(AppError::from)?;
    if !bytes_look_like_text(&bytes) {
        return Ok(OpenFileOutcome {
            file: None,
            failed: Some(OpenFileFailure {
                path: path.to_string(),
                reason: OPEN_DIALOG_REASON_BINARY.to_string(),
                size: None,
            }),
        });
    }
    let encoding = detect_encoding(&bytes).to_string();
    let content = decode_text(&bytes, &encoding);
    Ok(OpenFileOutcome {
        file: Some(OpenFileResult {
            path: path.to_string(),
            content,
            encoding,
        }),
        failed: None,
    })
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

/// 读取文本文件并自动探测编码(GBK/Big5/Shift-JIS 等自动解码)
///
/// `force=true` 跳过二进制启发式并按兜底编码有损解码(VSCode「仍要打开」);
/// 其余语义同 `fs_read_text_file_encoded_inner`。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件超过编辑器大小上限时返回 `AppError::FileTooLarge`(`ERR_FILE_TOO_LARGE`)
/// - 二进制内容且未 force 时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 显式指定的编码不受支持时返回 `AppError::Unsupported`
#[tauri::command]
pub async fn fs_read_text_file_encoded(
    path: String,
    encoding: Option<String>,
    force: Option<bool>,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<EncodedTextContent>, AppError> {
    fs_read_text_file_encoded_inner(
        &path,
        encoding.as_deref(),
        force.unwrap_or(false),
        &authorized,
    )
    .await
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

/// PDF 文件大小上限(字节):PDF 视图按 base64 全量过 IPC,
/// 与文本编辑器 20MB 对齐,超过则提示用户(二进制视图另议)。
pub const PDF_FILE_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// PDF 文件读取结果(`fs_read_pdf` / `fs_open_pdf_dialog` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFileContent {
    pub path: String,
    /// 文件字节数
    pub size: u64,
    /// 文件内容(UTF-8 无填充 base64)
    pub base64: String,
}

/// 读取 PDF 文件为 base64(必须在授权范围内)
///
/// PDF 工具按需读取整文件字节(渲染 + 表单 + 编辑共用);
/// 大小超过 `PDF_FILE_MAX_BYTES` 时返回 `AppError::FileTooLarge`。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - 文件不存在/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
/// - 文件超过 PDF 大小上限时返回 `AppError::FileTooLarge`(`ERR_FILE_TOO_LARGE`)
#[tauri::command]
pub async fn fs_read_pdf(
    path: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<PdfFileContent>, AppError> {
    validate_path(&path, &authorized)?;
    let bytes = tokio::fs::read(&path).await.map_err(AppError::from)?;
    let size = bytes.len() as u64;
    if size > PDF_FILE_MAX_BYTES {
        return Err(AppError::FileTooLarge {
            size,
            max: PDF_FILE_MAX_BYTES,
        });
    }
    let base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(CommandResponse::ok(PdfFileContent {
        path,
        size,
        base64,
    }))
}

/// 以 base64 覆盖写入已授权路径(PDF 等二进制工作区的「保存」)
///
/// 与 `fs_write_file`(文本)对齐:必须在 `authorized` 集合中。
///
/// # Errors
///
/// - 路径未授权时返回 `AppError::Permission`(`ERR_PERMISSION_DENIED`)
/// - base64 解码失败或写入失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_save_bytes_to_path(
    path: String,
    base64: String,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<bool>, AppError> {
    validate_path(&path, &authorized)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| AppError::Io(std::io::Error::other(format!("base64 decode: {e}"))))?;
    save_bytes_to_path(&path, &bytes).await?;
    Ok(CommandResponse::ok(true))
}

/// 弹出「打开 PDF」对话框:选择文件、授权并读取为 base64
///
/// 用户取消时返回 `Ok(CommandResponse::ok(None))`。
///
/// # Errors
///
/// - 所选文件超过 PDF 大小上限时返回 `AppError::FileTooLarge`(`ERR_FILE_TOO_LARGE`)
/// - 文件读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
#[tauri::command]
pub async fn fs_open_pdf_dialog(
    app: tauri::AppHandle,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Option<PdfFileContent>>, AppError> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("打开 PDF 文件")
        .add_filter("PDF 文档", &["pdf"])
        .blocking_pick_file()
    else {
        return Ok(CommandResponse::ok(None));
    };
    let path_buf = path
        .into_path()
        .map_err(|e| AppError::Unknown(format!("open path invalid: {e}")))?;
    let path_str = path_buf.to_string_lossy().into_owned();
    authorized.authorize(&path_str);
    let content = fs_read_pdf(path_str, authorized).await?.data;
    Ok(CommandResponse::ok(content))
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
        // 头部含 NUL → 二进制
        assert!(!bytes_look_like_text(&[0x00, 0x01, 0x02]));
        // NUL 在 512 字节检测窗口之后:启发式只看头部(VSCode 同款窗口)
        let mut late_nul = vec![b'a'; 600];
        late_nul[520] = 0;
        assert!(bytes_look_like_text(&late_nul));
    }

    #[test]
    fn test_bytes_look_like_text_utf16_without_bom_is_text() {
        // 无 BOM 的 UTF-16 LE(ASCII 文本,偶数位 0x00):VSCode 判为文本
        let bytes: Vec<u8> = b"hello world".iter().flat_map(|&b| [b, 0]).collect();
        assert!(bytes_look_like_text(&bytes));
        assert_eq!(bytes_look_like_text_kind(&bytes), TextKind::Utf16NoBom);
        // UTF-16 BE(NUL 在偶数位)
        let be: Vec<u8> = b"hello world".iter().flat_map(|&b| [0, b]).collect();
        assert_eq!(bytes_look_like_text_kind(&be), TextKind::Utf16NoBom);
        // NUL 位置混杂 → 二进制
        assert_eq!(
            bytes_look_like_text_kind(&[0x41, 0x00, 0x00, 0x42]),
            TextKind::Binary
        );
    }

    #[test]
    fn test_bytes_look_like_text_bom_utf16_is_text() {
        // 带 BOM 的 UTF-16 恒为文本(即使后段出现「非 UTF-16 模式」的 NUL)
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend_from_slice(&[0x41, 0x00, 0x00, 0x00]);
        assert!(bytes_look_like_text(&bytes));
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
    async fn test_fs_read_text_file_encoded_force_opens_binary() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_encoded_force.bin");
        std::fs::write(&path, [0x00u8, 0x01, 0xFF, 0x0A]).expect("write bin");

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        // 未 force:二进制 → ERR_FILE_UNSUPPORTED
        let err = fs_read_text_file_encoded_inner(path.to_str().unwrap(), None, false, &paths)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_UNSUPPORTED");

        // force:按兜底编码有损解码打开(VSCode「仍要打开」)
        let resp = fs_read_text_file_encoded_inner(path.to_str().unwrap(), None, true, &paths)
            .await
            .unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.encoding, "windows-1252");
        assert!(!data.content.is_empty());

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_encoded_explicit_encoding() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_encoded_explicit.txt");
        std::fs::write(&path, [0xFFu8, 0xFE]).expect("write");

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        let resp =
            fs_read_text_file_encoded_inner(path.to_str().unwrap(), Some("gb18030"), false, &paths)
                .await
                .unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.encoding, "gb18030");
        assert_eq!(data.content, "\u{FFFD}\u{FFFD}");

        // 不受支持的编码标识 → ERR_FILE_UNSUPPORTED
        let err = fs_read_text_file_encoded_inner(
            path.to_str().unwrap(),
            Some("iso-2022-jp"),
            false,
            &paths,
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_UNSUPPORTED");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_encoded_utf16_without_bom() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_encoded_utf16le_nobom.dat");
        // ASCII 内容的 UTF-16 LE,无 BOM:旧实现直接判二进制
        let bytes: Vec<u8> = b"hello world".iter().flat_map(|&b| [b, 0]).collect();
        std::fs::write(&path, bytes).expect("write utf16le");

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        let resp = fs_read_text_file_encoded_inner(path.to_str().unwrap(), None, false, &paths)
            .await
            .unwrap();
        let data = resp.data.unwrap();
        // 无 BOM UTF-16 → LE 回退解码,内容可读
        assert_eq!(data.encoding, "utf-16le");
        assert_eq!(data.content, "hello world");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_fs_read_text_file_encoded_rejects_too_large() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_encoded_huge.txt");
        // 用 sparse file 伪造超限大小,避免真实写入 20MB
        let file = std::fs::File::create(&path).expect("create");
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            file.set_len(EDITOR_FILE_MAX_BYTES + 1).expect("sparse");
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            // seek+write 单字节即可把文件长度撑到目标值(NTFS 稀疏扩展)
            file.seek_write(
                &[0],
                EDITOR_FILE_MAX_BYTES, // 写在 max 处 → len = max+1
            )
            .expect("sparse extend");
        }
        drop(file);

        let paths = AuthorizedPaths::new();
        paths.authorize(path.to_str().unwrap());

        let err = fs_read_text_file_encoded_inner(path.to_str().unwrap(), None, false, &paths)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_TOO_LARGE");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_read_openable_text_file_binary_reports_failure_payload() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_openable_bin.dat");
        std::fs::write(&path, [0x00u8, 0x01, 0x02]).expect("write bin");

        let outcome = read_openable_text_file(path.to_str().unwrap())
            .await
            .unwrap();
        assert!(outcome.file.is_none());
        let failed = outcome.failed.expect("failed payload");
        assert_eq!(failed.reason, OPEN_DIALOG_REASON_BINARY);
        assert_eq!(failed.path, path.to_string_lossy());

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_read_openable_text_file_utf8_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_test_openable_utf8.txt");
        std::fs::write(&path, "hello qraft").expect("write");

        let outcome = read_openable_text_file(path.to_str().unwrap())
            .await
            .unwrap();
        let file = outcome.file.expect("opened");
        assert_eq!(file.content, "hello qraft");
        assert_eq!(file.encoding, "utf-8");
        assert!(outcome.failed.is_none());

        let _ = std::fs::remove_file(&path);
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
