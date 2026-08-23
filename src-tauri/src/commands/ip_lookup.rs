// IP 归属地查询 IPC Command(薄封装)
//
// 具体实现位于 `crate::net::ip_lookup`(域名白名单 + 字段推导),
// 此处仅负责跨线程调度与响应包络。阻塞 HTTP 通过 spawn_blocking
// 执行,避免卡死 async runtime。

use crate::core::error::AppError;
use crate::net::ip_lookup::{IpLookupData, lookup};
use crate::shell::response::CommandResponse;

/// IPC Command:查询 IP 归属地/运营商信息
///
/// - `ip` 为 `None` / 空串时查询本机公网 IP(ip-api.com 按来源地址回显)
/// - 仅允许合法 IPv4/IPv6 文本(字符白名单校验,防 URL 注入)
///
/// # Errors
///
/// - 输入非法返回 `AppError::Forbidden`
/// - 网络失败或上游返回 fail 状态返回 `AppError::Unknown`
#[tauri::command]
pub async fn ip_lookup(ip: Option<String>) -> Result<CommandResponse<IpLookupData>, AppError> {
    tauri::async_runtime::spawn_blocking(move || lookup(ip.as_deref()))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("ip lookup join error: {e}")))?
        .map(CommandResponse::ok)
}
