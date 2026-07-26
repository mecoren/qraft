use serde::{Serialize, ser::SerializeMap};
use std::time::Duration;
use thiserror::Error;

/// 工具执行错误
///
/// 所有工具的 execute 方法只返回 `ToolError`,不返回 `anyhow::Error`。
/// 前端可以根据错误码做精准的 UI 反馈。
#[derive(Debug, Clone, Error, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum ToolError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("parse failed: {0}")]
    ParseFailed(String),

    #[error("timeout after {0:?}")]
    Timeout(Duration),

    #[error("cancelled by user")]
    Cancelled,

    #[error("input too large: {size} bytes, max {max} bytes")]
    InputTooLarge { size: usize, max: usize },

    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("out of memory: {size} bytes, max {max} bytes")]
    OutOfMemory { size: usize, max: usize },

    #[error("internal error: {0}")]
    Internal(String),
}

impl ToolError {
    /// 错误码,用于前端国际化与精准提示
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput(_) => "ERR_INVALID_INPUT",
            Self::ParseFailed(_) => "ERR_PARSE_FAILED",
            Self::Timeout(_) => "ERR_TIMEOUT",
            Self::Cancelled => "ERR_CANCELLED",
            Self::InputTooLarge { .. } => "ERR_INPUT_TOO_LARGE",
            Self::ToolNotFound(_) => "ERR_TOOL_NOT_FOUND",
            Self::OutOfMemory { .. } => "ERR_OUT_OF_MEMORY",
            Self::Internal(_) => "ERR_INTERNAL",
        }
    }

    /// 是否可重试
    #[must_use]
    pub const fn is_retryable(&self) -> bool {
        matches!(self, Self::Timeout(_) | Self::Internal(_))
    }
}

/// 引擎层错误(注册、调度)
#[derive(Debug, Error, Serialize)]
pub enum EngineError {
    #[error("registry error: {0}")]
    RegistryError(String),

    #[error("executor error: {0}")]
    ExecutorError(String),

    #[error(transparent)]
    Tool(#[from] ToolError),

    #[error("tool not found: {0}")]
    ToolNotFound(String),
}

/// 应用层顶层错误
///
/// 跨越 IPC 边界传递给前端。由于包含 `std::io::Error` 与 `anyhow::Error`
/// (均未实现 `Serialize`),采用手动 `impl Serialize`,序列化格式为
/// `{ "kind": "<code>", "detail": "<display 或嵌套结构>" }`,
/// 与 `#[serde(tag = "kind", content = "detail")]` 语义等价。
#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Tool(ToolError),

    #[error(transparent)]
    Engine(#[from] EngineError),

    #[error("config error: {0}")]
    Config(String),

    #[error("history error: {0}")]
    History(String),

    #[error("io error: {0}")]
    Io(std::io::Error),

    #[error("permission denied: {0}")]
    Permission(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("internal error: {0}")]
    Internal(anyhow::Error),

    #[error("unknown error: {0}")]
    Unknown(String),
}

impl AppError {
    /// 错误码,用于前端国际化与精准提示
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Tool(e) => e.code(),
            Self::Engine(EngineError::Tool(_)) => "ERR_TOOL",
            Self::Engine(EngineError::RegistryError(_)) => "ERR_REGISTRY",
            Self::Engine(EngineError::ExecutorError(_)) => "ERR_EXECUTOR",
            Self::Engine(EngineError::ToolNotFound(_)) => "ERR_TOOL_NOT_FOUND",
            Self::Config(_) => "ERR_CONFIG_IO",
            Self::History(_) => "ERR_HISTORY_IO",
            Self::Io(_) => "ERR_FILE_IO",
            Self::Permission(_) | Self::Forbidden(_) => "ERR_PERMISSION_DENIED",
            Self::Internal(_) | Self::Unknown(_) => "ERR_INTERNAL",
        }
    }

    /// 从 String 构造 Config 错误的便捷方法
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    /// 从 String 构造 History 错误的便捷方法
    pub fn history(msg: impl Into<String>) -> Self {
        Self::History(msg.into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e)
    }
}

impl From<ToolError> for AppError {
    fn from(e: ToolError) -> Self {
        Self::Tool(e)
    }
}

// 手动实现 Serialize:将 io::Error / anyhow::Error 转为 Display 字符串
// 格式与 serde(tag="kind", content="detail") 等价
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("kind", self.code())?;
        match self {
            Self::Tool(e) => {
                map.serialize_entry("detail", e)?;
            }
            Self::Engine(e) => {
                map.serialize_entry("detail", &e.to_string())?;
            }
            Self::Config(s)
            | Self::History(s)
            | Self::Permission(s)
            | Self::Forbidden(s)
            | Self::Unknown(s) => {
                map.serialize_entry("detail", s)?;
            }
            Self::Io(e) => {
                map.serialize_entry("detail", &e.to_string())?;
            }
            Self::Internal(e) => {
                map.serialize_entry("detail", &format!("{e:#}"))?;
            }
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_invalid_input_code() {
        let err = ToolError::InvalidInput("missing field".into());
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_invalid_input_display() {
        let err = ToolError::InvalidInput("missing field".into());
        assert!(err.to_string().contains("missing field"));
    }

    #[test]
    fn test_parse_failed_code() {
        let err = ToolError::ParseFailed("unexpected token".into());
        assert_eq!(err.code(), "ERR_PARSE_FAILED");
        assert!(err.to_string().contains("unexpected token"));
    }

    #[test]
    fn test_timeout_code_and_display() {
        let err = ToolError::Timeout(Duration::from_secs(5));
        assert_eq!(err.code(), "ERR_TIMEOUT");
        assert!(err.to_string().contains("5s"));
    }

    #[test]
    fn test_cancelled_serde() {
        let err = ToolError::Cancelled;
        assert_eq!(err.code(), "ERR_CANCELLED");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "cancelled"}));
    }

    #[test]
    fn test_tool_not_found_serde() {
        let err = ToolError::ToolNotFound("xxx".into());
        assert_eq!(err.code(), "ERR_TOOL_NOT_FOUND");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "tool_not_found", "detail": "xxx"}));
    }

    #[test]
    fn test_input_too_large_serde() {
        let err = ToolError::InputTooLarge { size: 100, max: 50 };
        assert_eq!(err.code(), "ERR_INPUT_TOO_LARGE");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(
            v,
            json!({"kind": "input_too_large", "detail": {"size": 100, "max": 50}})
        );
    }

    #[test]
    fn test_out_of_memory_code() {
        let err = ToolError::OutOfMemory {
            size: 1024,
            max: 512,
        };
        assert_eq!(err.code(), "ERR_OUT_OF_MEMORY");
    }

    #[test]
    fn test_internal_code_and_serde() {
        let err = ToolError::Internal("boom".into());
        assert_eq!(err.code(), "ERR_INTERNAL");
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v, json!({"kind": "internal", "detail": "boom"}));
    }

    #[test]
    fn test_engine_error_from_tool_error() {
        let tool_err = ToolError::InvalidInput("bad".into());
        let engine_err: EngineError = tool_err.into();
        assert!(matches!(
            engine_err,
            EngineError::Tool(ToolError::InvalidInput(_))
        ));
    }

    #[test]
    fn test_engine_error_tool_not_found() {
        let err = EngineError::ToolNotFound("missing".into());
        assert!(err.to_string().contains("missing"));
    }

    #[test]
    fn test_app_error_tool_variant() {
        let tool_err = ToolError::InvalidInput("bad".into());
        let app_err = AppError::Tool(tool_err);
        assert_eq!(app_err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_app_error_config_variant() {
        let err = AppError::config("key not found");
        assert_eq!(err.code(), "ERR_CONFIG_IO");
        assert!(err.to_string().contains("key not found"));
    }

    #[test]
    fn test_app_error_history_variant() {
        let err = AppError::history("io failed");
        assert_eq!(err.code(), "ERR_HISTORY_IO");
    }

    #[test]
    fn test_app_error_io_variant() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        assert_eq!(app_err.code(), "ERR_FILE_IO");
    }

    #[test]
    fn test_app_error_forbidden_variant() {
        let err = AppError::Forbidden("url scheme not allowed".into());
        assert_eq!(err.code(), "ERR_PERMISSION_DENIED");
    }

    #[test]
    fn test_app_error_internal_from_anyhow() {
        let err: AppError = anyhow::anyhow!("boom").into();
        assert_eq!(err.code(), "ERR_INTERNAL");
    }

    #[test]
    fn test_app_error_serialize_config() {
        let err = AppError::Config("key not found".into());
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "ERR_CONFIG_IO");
        assert_eq!(v["detail"], "key not found");
    }

    #[test]
    fn test_app_error_serialize_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let err: AppError = io_err.into();
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "ERR_FILE_IO");
        assert!(v["detail"].is_string());
    }

    #[test]
    fn test_app_error_serialize_tool() {
        let err = AppError::Tool(ToolError::ParseFailed("bad json".into()));
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "ERR_PARSE_FAILED");
        assert!(v["detail"].is_object());
    }
}
