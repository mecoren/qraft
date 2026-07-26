// Shell 层统一响应包络
//
// 所有 IPC Command 返回 `Result<CommandResponse<T>, AppError>`,
// 前端通过 `success` 字段判断成败,通过 `data` 取数据,通过 `error` 取详情。

use serde::{Deserialize, Serialize};

use crate::shell::AppError;

/// 统一响应包络
///
/// 注意:此处不在类型参数上写 `T: Serialize` bound,因为 `#[derive(Serialize,
/// Deserialize)]` 会自动生成对应的 where 子句;若在此重复声明,会触发
/// `clippy::trait_duplication_in_bounds` 警告。各 `impl` 块按需声明 bound 即可。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ErrorInfo>,
    pub code: String,
}

/// 错误信息(前端可读)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    /// 错误种类(对应 `AppError::code()`)
    pub kind: String,
    /// 错误详情(序列化后的 `AppError` detail)
    pub detail: String,
    /// 用户可读的错误消息
    pub message: String,
}

impl<T: Serialize> CommandResponse<T> {
    /// 构造成功响应
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            code: "OK".to_string(),
        }
    }

    /// 构造失败响应
    #[must_use]
    pub const fn err(error: ErrorInfo, code: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
            code,
        }
    }
}

impl<T: Serialize + Default> CommandResponse<T> {
    /// 构造成功响应但不携带数据(用于 void 返回)
    #[must_use]
    pub fn ok_empty() -> Self {
        Self {
            success: true,
            data: Some(T::default()),
            error: None,
            code: "OK".to_string(),
        }
    }
}

impl ErrorInfo {
    /// 从 `AppError` 构造 `ErrorInfo`
    ///
    /// 简化策略:detail 与 message 均取 `to_string()`,
    /// 避免对 `anyhow::Error` / `io::Error` 强制要求 Clone。
    #[must_use]
    pub fn from_app_error(e: &AppError) -> Self {
        Self {
            kind: e.code().to_string(),
            detail: e.to_string(),
            message: e.to_string(),
        }
    }

    #[must_use]
    pub fn new(
        kind: impl Into<String>,
        detail: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            kind: kind.into(),
            detail: detail.into(),
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize)]
    struct TestData {
        name: String,
        value: i32,
    }

    #[test]
    fn test_ok_serialization() {
        let data = TestData {
            name: "test".into(),
            value: 42,
        };
        let resp = CommandResponse::ok(data);
        let json = serde_json::to_string(&resp).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["success"], true);
        assert_eq!(value["code"], "OK");
        assert_eq!(value["data"]["name"], "test");
        assert_eq!(value["data"]["value"], 42);
        assert!(value["error"].is_null());
    }

    #[test]
    fn test_err_serialization() {
        let error_info = ErrorInfo::new("ERR_TOOL_NOT_FOUND", "tool_id: missing", "工具不存在");
        let resp: CommandResponse<TestData> =
            CommandResponse::err(error_info, "ERR_TOOL_NOT_FOUND".into());
        let json = serde_json::to_string(&resp).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["success"], false);
        assert_eq!(value["code"], "ERR_TOOL_NOT_FOUND");
        assert!(value["data"].is_null());
        assert_eq!(value["error"]["kind"], "ERR_TOOL_NOT_FOUND");
        assert_eq!(value["error"]["message"], "工具不存在");
    }

    #[test]
    fn test_ok_empty_for_unit() {
        let resp: CommandResponse<()> = CommandResponse::ok_empty();
        assert!(resp.success);
        assert_eq!(resp.code, "OK");
        assert!(resp.data.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_camel_case_serialization() {
        let error_info = ErrorInfo::new("ERR_X", "d", "m");
        let resp: CommandResponse<String> = CommandResponse::err(error_info, "ERR_X".into());
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\""));
        assert!(json.contains("\"error\""));
    }

    #[test]
    fn test_error_info_new() {
        let info = ErrorInfo::new("ERR_TIMEOUT", "5s", "执行超时");
        assert_eq!(info.kind, "ERR_TIMEOUT");
        assert_eq!(info.detail, "5s");
        assert_eq!(info.message, "执行超时");
    }

    #[test]
    fn test_from_app_error_tool() {
        use crate::core::error::ToolError;
        let app_err = AppError::Tool(ToolError::ToolNotFound("xxx".into()));
        let info = ErrorInfo::from_app_error(&app_err);
        assert_eq!(info.kind, "ERR_TOOL_NOT_FOUND");
        assert!(info.detail.contains("xxx"));
    }

    #[test]
    fn test_from_app_error_config() {
        let app_err = AppError::config("key missing");
        let info = ErrorInfo::from_app_error(&app_err);
        assert_eq!(info.kind, "ERR_CONFIG_IO");
        assert_eq!(info.message, "key missing");
    }
}
