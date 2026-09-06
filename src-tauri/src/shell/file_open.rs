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
    /// 拖放落点的 CSS 像素坐标(webview 内 `{ x, y }`);非拖放入口(文件
    /// 关联/命令行)不携带,前端按无落点处理
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drop_position: Option<DropPosition>,
}

/// 拖放落点坐标(CSS 像素,物理坐标已除以窗口 scale factor)
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropPosition {
    pub x: f64,
    pub y: f64,
}

/// 打开失败的载荷变体:
/// - `Unsupported`:内容为二进制,无法作为文本打开(前端提供「仍要打开」)
/// - `TooLarge`:超过编辑器整读上限,进入大文件只读查看模式
///   (前端经 `fs_large_file_info` / `fs_read_file_lines` 流式打开)
/// - `Error`:读取失败等其他原因
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OpenFileUnsupported {
    /// 二进制内容(`reason="binary"`);payload 为完整路径
    Unsupported { path: String },
    /// 文件过大(`reason="too-large"`):切换到大文件查看模式,并非错误
    TooLarge { path: String },
    /// PDF 文档:切换到 PDF 工具打开(表单填写 + 编辑;前端经 `fs_read_pdf` 读取)。
    /// 拖放入口附带落点坐标,前端据此豁免「直接拖入文本编辑器编辑框」
    /// (命中 .monaco-editor 时回退编辑器的二进制提示路径,与 .md 同口径)。
    Pdf {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        drop_position: Option<DropPosition>,
    },
    /// Office 文档(docx / xlsx / pptx 及 WPS 旧格式 doc / xls / ppt):
    /// 切换到 Office 工具打开(前端经 `fs_read_office` 读取;旧二进制格式
    /// 由前端展示转换指引)。落点坐标语义同 Pdf。
    Office {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        drop_position: Option<DropPosition>,
    },
    /// 其他错误(路径非法/读取失败等)
    Error { message: String },
}

/// 待打开项:成功读取的文本文件,或需前端分流处理的失败载荷(too-large / pdf)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PendingOpenItem {
    /// 正常打开(内容 + 编码)
    File {
        path: String,
        content: String,
        #[serde(default)]
        encoding: String,
    },
    /// 超限文件:前端切换大文件只读查看模式(`fs_large_file_info` 流式打开)
    TooLarge { path: String },
    /// PDF 文档:前端切换到 PDF 工具(`fs_read_pdf` 读取);拖放入口附带落点
    Pdf {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        drop_position: Option<DropPosition>,
    },
    /// Office 文档:前端切换到 Office 工具(`fs_read_office` 读取);拖放入口附带落点
    Office {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        drop_position: Option<DropPosition>,
    },
}

/// 待打开文件队列(事件可能因前端未就绪而丢失,队列作为兜底)
#[derive(Default)]
pub struct PendingOpenFiles {
    inner: Mutex<Vec<PendingOpenItem>>,
}

impl PendingOpenFiles {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加一个待打开文件
    pub fn push(&self, payload: OpenFilePayload) {
        self.push_item(PendingOpenItem::File {
            path: payload.path,
            content: payload.content,
            encoding: payload.encoding,
        });
    }

    /// 追加一个超限文件(前端走大文件只读查看模式)
    pub fn push_too_large(&self, path: &str) {
        self.push_item(PendingOpenItem::TooLarge {
            path: path.to_string(),
        });
    }

    /// 追加一个 PDF 文档(前端走 PDF 工具打开;拖放入口附带落点坐标)
    pub fn push_pdf(&self, path: &str, drop_position: Option<DropPosition>) {
        self.push_item(PendingOpenItem::Pdf {
            path: path.to_string(),
            drop_position,
        });
    }

    /// 追加一个 Office 文档(前端走 Office 工具打开;拖放入口附带落点坐标)
    pub fn push_office(&self, path: &str, drop_position: Option<DropPosition>) {
        self.push_item(PendingOpenItem::Office {
            path: path.to_string(),
            drop_position,
        });
    }

    fn push_item(&self, item: PendingOpenItem) {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(item);
    }

    /// 取出全部待打开项并清空队列(前端初始化拉取)
    pub fn drain_all(&self) -> Vec<PendingOpenItem> {
        std::mem::take(
            &mut self
                .inner
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }

    /// 队列中是否有待打开项
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

/// 判断路径是否指向 PDF 文档(扩展名 .pdf,大小写不敏感)
///
/// 判定口径与前端 PDF 工具(isPdfPath)保持一致;除扩展名外不嗅探
/// 魔数(与 .md 分流同一策略,扩展名即用户意图)。
#[must_use]
pub fn is_pdf_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// 判断路径是否指向 Office 文档(扩展名判定,大小写不敏感)
///
/// 覆盖两类来源:
/// - Microsoft OOXML:`docx` / `xlsx` / `pptx`(`docm` / `xlsm` / `pptm`
///   宏文档同源,同为 OOXML ZIP 容器,前端渲染库可直接解析)
/// - WPS / 旧二进制格式:`doc` / `xls` / `ppt` —— WPS 与 MS Office 的旧
///   格式互为兼容(二进制),前端渲染库不支持,由 Office 工具展示转换
///   指引;仍分流进 Office 工具以统一入口。
///
/// 判定口径与前端 Office 工具(`isOfficePath`)保持一致,除扩展名外不嗅探魔数。
#[must_use]
pub fn is_office_path(path: &str) -> bool {
    const OFFICE_EXTS: &[&str] = &[
        "docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "doc", "xls", "ppt",
    ];
    Path::new(path)
        .extension()
        .is_some_and(|ext| OFFICE_EXTS.iter().any(|e| ext.eq_ignore_ascii_case(e)))
}

/// 通过文件关联/命令行/拖放打开单个文件;若为二进制或目录,不打开并推送
/// `app:open-file-unsupported` 事件(载荷含路径与原因),供前端提示
/// 并提供「仍要打开」(参考 VS Code Open Anyway)。
///
/// `drop_position` 为拖放落点的 CSS 像素坐标(物理坐标 ÷ scale factor);
/// 文件关联/命令行等非拖放入口传 `None`。
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
    drop_position: Option<DropPosition>,
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

    // 大小上限先行(读取 20MB+ 二进制进内存再丢弃没有意义):
    // 超限文件直接进入大文件只读查看模式,事件载荷复用 TooLarge 通道,
    // 前端据此调用 fs_large_file_info 流式打开;webview 未就绪导致事件
    // 丢失时由 pending 队列兜底(app_pull_open_files 拉取)
    if let Ok(meta) = std::fs::metadata(&full_path) {
        if meta.len() > crate::commands::fs::EDITOR_FILE_MAX_BYTES {
            authorized.authorize(&full_path);
            pending.push_too_large(&full_path);
            emit_unsupported(app, &OpenFileUnsupported::TooLarge { path: full_path });
            return Ok(());
        }
    }

    // PDF 文档:授权路径后交由前端 PDF 工具打开(渲染 + 表单 + 编辑;
    // 前端经 fs_read_pdf 按需读取字节)。不走二进制启发式与文本解码。
    // 大小上限与文本编辑器对齐(fs_read_pdf 超限时报 FileTooLarge)。
    // 落点坐标透传给前端:命中 Monaco 编辑框时前端豁免 PDF 分流,
    // 回退编辑器的二进制提示路径(与 .md 的编辑框例外同口径)。
    if is_pdf_path(&full_path) {
        authorized.authorize(&full_path);
        pending.push_pdf(&full_path, drop_position);
        emit_unsupported(
            app,
            &OpenFileUnsupported::Pdf {
                path: full_path,
                drop_position,
            },
        );
        return Ok(());
    }

    // Office 文档(docx/xlsx/pptx + WPS 旧格式 doc/xls/ppt):授权路径后
    // 交由前端 Office 工具打开(渲染 + 表格编辑;旧二进制格式展示转换指引)。
    // 不走二进制启发式与文本解码;大小上限由 fs_read_office 强制
    // (与 PDF 同为 100MB)。落点坐标透传给前端:命中 Monaco 编辑框时
    // 前端豁免分流,回退编辑器的二进制提示路径(与 .md / .pdf 同口径)。
    if is_office_path(&full_path) {
        authorized.authorize(&full_path);
        pending.push_office(&full_path, drop_position);
        emit_unsupported(
            app,
            &OpenFileUnsupported::Office {
                path: full_path,
                drop_position,
            },
        );
        return Ok(());
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

    open_file_in_app(app, authorized, pending, path, drop_position)
}

/// 批量处理拖放的文件路径列表
///
/// 逐个调用 `open_dropped_file`;单个文件失败(不存在/读取失败)仅记录日志,
/// 不中断其它文件。二进制文件由 `open_dropped_file` 内部 emit 提示。
/// 所有文件共享同一拖放落点坐标。
pub fn open_dropped_files(
    app: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
    pending: &PendingOpenFiles,
    paths: &[String],
    drop_position: Option<DropPosition>,
) {
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Err(e) = open_dropped_file(app, authorized, pending, trimmed, drop_position) {
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
/// - 通过 `app:open-file` 事件推送 `{ path, content, encoding, dropPosition }`
///   给前端(拖放入口附带落点坐标,前端据此实现「拖入编辑框则直接进编辑器」)。
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
    drop_position: Option<DropPosition>,
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
        drop_position,
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
/// 走 `open_dropped_file` 统一分流:超限文件进入大文件只读查看模式
/// (emit TooLarge),二进制 emit Unsupported,普通文本正常打开。
/// 命令行入口无拖放落点,`drop_position` 恒为 `None`。
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
    open_dropped_file(app, authorized, pending, &path, None)
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
            drop_position: None,
        });
        pending.push(OpenFilePayload {
            path: "/b.json".into(),
            content: "{}".into(),
            encoding: "utf-8".into(),
            drop_position: Some(DropPosition { x: 12.0, y: 34.5 }),
        });
        // 超限文件入队:前端切换大文件只读查看模式
        pending.push_too_large("/huge.log");
        assert!(!pending.is_empty());

        let drained = pending.drain_all();
        assert_eq!(drained.len(), 3);
        let PendingOpenItem::File { path, encoding, .. } = &drained[0] else {
            panic!("first item must be File");
        };
        assert_eq!(path, "/a.txt");
        assert_eq!(encoding, "utf-8");
        let PendingOpenItem::TooLarge { path: huge } = &drained[2] else {
            panic!("third item must be TooLarge");
        };
        assert_eq!(huge, "/huge.log");
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
    fn is_pdf_path_matches_extension_case_insensitive() {
        assert!(is_pdf_path("/home/user/doc.pdf"));
        assert!(is_pdf_path(r"C:\a\B.PDF"));
        assert!(is_pdf_path("report.Pdf"));
        assert!(!is_pdf_path("/home/user/doc.pdfx"));
        assert!(!is_pdf_path("/home/user/doc.pd"));
        assert!(!is_pdf_path("/home/user/pdf"));
        assert!(!is_pdf_path(""));
    }

    #[test]
    fn is_office_path_matches_supported_extensions() {
        // OOXML 三件套 + 宏文档变体
        for ext in ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"] {
            assert!(is_office_path(&format!("/doc/report.{ext}")), "{ext}");
        }
        // WPS / MS 旧二进制格式
        for ext in ["doc", "xls", "ppt"] {
            assert!(is_office_path(&format!(r"C:\docs\report.{ext}")), "{ext}");
        }
        // 大小写不敏感
        assert!(is_office_path("/doc/Report.DOCX"));
        assert!(is_office_path("/doc/预算表.XLS"));
        // 非白名单扩展名与无扩展名
        assert!(!is_office_path("/doc/report.docx~"));
        assert!(!is_office_path("/doc/report.pdf"));
        assert!(!is_office_path("/doc/report.txt"));
        assert!(!is_office_path("/doc/report"));
        assert!(!is_office_path(""));
    }

    #[test]
    fn pending_open_files_push_office_item() {
        let pending = PendingOpenFiles::new();
        // 非拖放入口(文件关联/命令行):无落点
        pending.push_office("/doc/a.docx", None);
        // 拖放入口:附带落点坐标
        pending.push_office("/doc/b.xlsx", Some(DropPosition { x: 12.0, y: 34.5 }));
        let drained = pending.drain_all();
        let PendingOpenItem::Office {
            path,
            drop_position,
        } = &drained[0]
        else {
            panic!("item must be Office");
        };
        assert_eq!(path, "/doc/a.docx");
        assert_eq!(*drop_position, None);
        let PendingOpenItem::Office {
            path,
            drop_position,
        } = &drained[1]
        else {
            panic!("item must be Office");
        };
        assert_eq!(path, "/doc/b.xlsx");
        assert_eq!(drop_position.map(|d| (d.x, d.y)), Some((12.0, 34.5)));
    }

    #[test]
    fn pending_open_files_push_pdf_item() {
        let pending = PendingOpenFiles::new();
        // 非拖放入口(文件关联/命令行):无落点
        pending.push_pdf("/forms/tax.pdf", None);
        // 拖放入口:附带落点坐标
        pending.push_pdf("/forms/other.pdf", Some(DropPosition { x: 12.0, y: 34.5 }));
        let drained = pending.drain_all();
        let PendingOpenItem::Pdf {
            path,
            drop_position,
        } = &drained[0]
        else {
            panic!("item must be Pdf");
        };
        assert_eq!(path, "/forms/tax.pdf");
        assert_eq!(*drop_position, None);
        let PendingOpenItem::Pdf {
            path,
            drop_position,
        } = &drained[1]
        else {
            panic!("item must be Pdf");
        };
        assert_eq!(path, "/forms/other.pdf");
        assert_eq!(drop_position.map(|d| (d.x, d.y)), Some((12.0, 34.5)));
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
