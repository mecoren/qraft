// PNG 压缩 IPC Command
//
// 纯逻辑位于 `crate::media::png`(可单测),本模块仅做:
// - base64 解码与输入校验
// - 经 spawn_blocking 放入线程池(大图量化/OxiPNG 高级别耗时较长,避免阻塞 IPC)
// - CommandResponse 包络

use base64::Engine as _;

use crate::media::gif::{GifEncodeInput, GifEncodeResult, encode_gif_inner};
use crate::media::png::{PngCompressParams, PngCompressResult, compress_inner};
use crate::shell::AppError;
use crate::shell::response::CommandResponse;

/// PNG 压缩(无损 `OxiPNG` / 有损调色板量化)
///
/// # Errors
///
/// - base64 解码失败时返回 `AppError::Unknown`
/// - 内容非 PNG / 超过 64MB 时由核心返回对应错误
#[tauri::command]
pub async fn png_compress(
    base64: String,
    params: PngCompressParams,
) -> Result<CommandResponse<PngCompressResult>, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| AppError::Unknown(format!("invalid base64: {e}")))?;
    let result = tokio::task::spawn_blocking(move || compress_inner(&bytes, &params))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("join error: {e}")))??;
    Ok(CommandResponse::ok(result))
}

/// GIF 编码(视频转 GIF 的编码侧;帧数据由前端抽好后整体过 IPC)
///
/// # Errors
///
/// - 帧为空 / 尺寸或帧数超限 / 帧长度不符时由核心返回对应错误
#[tauri::command]
pub async fn gif_encode(
    input: GifEncodeInput,
) -> Result<CommandResponse<GifEncodeResult>, AppError> {
    let result = tokio::task::spawn_blocking(move || encode_gif_inner(&input))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("join error: {e}")))??;
    Ok(CommandResponse::ok(result))
}
