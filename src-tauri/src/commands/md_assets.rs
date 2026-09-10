// Markdown 图片资产 IPC Command
//
// 供 Markdown 预览工具的「粘贴图片落盘」使用:位图存入
// `app_data_dir/markdown_assets/`,markdown 源内以 `mdasset:<文件名>` 引用;
// 预览渲染前经 `md_read_image_asset` 读回 base64 转 data URL(纯本地,
// 零网络,满足 Local-First 原则)。
//
// 文件名由后端生成(时间戳 + 随机后缀,带扩展名白名单),不信任前端
// 传入的文件名,杜绝路径穿越;读取同样按白名单校验后再拼接目录。

use base64::Engine as _;
use tauri::Manager;

use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// 允许保存的图片扩展名(与前端粘贴位图类型对应)
const ALLOWED_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// 资产目录名(位于 `app_data_dir` 下)
const ASSETS_DIR: &str = "markdown_assets";

/// 解析 app 数据目录下的资产目录路径;AppHandle 缺失(单元测试)时返回错误
fn assets_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Unknown(format!("app data dir unavailable: {e}")))?;
    Ok(data_dir.join(ASSETS_DIR))
}

/// 生成不与现有文件冲突的资产文件名:`img-<uuid 短码>.<ext>`
fn generate_asset_name(dir: &std::path::Path, ext: &str) -> String {
    loop {
        // uuid v4 取前 12 位 hex 足够避免粘贴场景的碰撞;存在性检查兜底
        let id = uuid::Uuid::new_v4().simple().to_string();
        let name = format!("img-{id}.{ext}");
        if !dir.join(&name).exists() {
            return name;
        }
    }
}

/// 校验资产文件名:仅允许 `[A-Za-z0-9._-]` 且必须带白名单扩展名
/// (路径分隔符与 `..` 天然被拒,防穿越)。
/// pub 供集成测试直接断言(commands 模块在 lib 测试目标下不编译,
/// 见 lib.rs 的 #[cfg(not(test))] 门控)。
#[must_use]
pub fn is_valid_asset_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    let ok_chars = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let ext = name
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    ok_chars && ALLOWED_EXTS.contains(&ext.as_str()) && !name.contains("..")
}

/// 校验失败时返回错误(`is_valid_asset_name` 的 `Result` 封装)
fn validate_asset_name(name: &str) -> Result<(), AppError> {
    if is_valid_asset_name(name) {
        Ok(())
    } else {
        Err(AppError::Unknown(format!("invalid asset name: {name}")))
    }
}

/// 保存一张粘贴图片到资产目录
///
/// # Errors
///
/// - `AppHandle` 缺失(测试环境)或目录创建失败时返回 `AppError::Io`
/// - 扩展名不在白名单时返回 `AppError::Unknown`
#[tauri::command]
pub async fn md_save_image_asset(
    app: tauri::AppHandle,
    base64: String,
    ext: String,
) -> Result<CommandResponse<String>, AppError> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Unknown(format!("unsupported image ext: {ext}")));
    }
    let dir = assets_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(AppError::from)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| AppError::Unknown(format!("invalid base64: {e}")))?;
    // 上限 16MB:粘贴截图远小于此,防御异常载荷
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(AppError::Unknown("image too large (max 16MB)".to_string()));
    }

    let name = generate_asset_name(&dir, &ext);
    tokio::fs::write(dir.join(&name), &bytes)
        .await
        .map_err(AppError::from)?;
    Ok(CommandResponse::ok(name))
}

/// 读取资产图片为 base64(前端拼 data URL)
///
/// # Errors
///
/// - 文件名非法 / 文件不存在 / 读取失败时返回对应错误
#[tauri::command]
pub async fn md_read_image_asset(
    app: tauri::AppHandle,
    name: String,
) -> Result<CommandResponse<String>, AppError> {
    validate_asset_name(&name)?;
    let path = assets_dir(&app)?.join(&name);
    if !path.is_file() {
        return Err(AppError::Unknown(format!("asset not found: {name}")));
    }
    let bytes = tokio::fs::read(&path).await.map_err(AppError::from)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(CommandResponse::ok(b64))
}
