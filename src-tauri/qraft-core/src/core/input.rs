use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::collections::HashMap;

use crate::core::error::ToolError;

/// 工具执行的输入
///
/// - text 是主输入(用户粘贴/输入的文本)
/// - params 是工具特定参数(如 Base64 的 `url_safe` 开关)
/// - `file_path` 用于文件类工具,与 text 二选一
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,

    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, Value>,
}

impl ToolInput {
    /// 获取 text 字段。
    ///
    /// # Errors
    ///
    /// 当 `text` 为 `None` 时返回 `ToolError::InvalidInput`。
    pub fn text(&self) -> Result<&str, ToolError> {
        self.text
            .as_deref()
            .ok_or_else(|| ToolError::InvalidInput("missing 'text' field".into()))
    }

    /// 获取 `file_path` 字段。
    ///
    /// # Errors
    ///
    /// 当 `file_path` 为 `None` 时返回 `ToolError::InvalidInput`。
    pub fn file_path(&self) -> Result<&str, ToolError> {
        self.file_path
            .as_deref()
            .ok_or_else(|| ToolError::InvalidInput("missing 'file_path' field".into()))
    }

    /// 按 key 取参数并反序列化为 T。
    ///
    /// # Errors
    ///
    /// 当 key 不存在或类型不匹配时返回 `ToolError::InvalidInput`。
    pub fn param<T: DeserializeOwned>(&self, key: &str) -> Result<T, ToolError> {
        let v = self
            .params
            .get(key)
            .ok_or_else(|| ToolError::InvalidInput(format!("missing param '{key}'")))?;
        serde_json::from_value(v.clone())
            .map_err(|e| ToolError::InvalidInput(format!("invalid param '{key}': {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_default_input() {
        let input = ToolInput::default();
        assert!(input.text.is_none());
        assert!(input.file_path.is_none());
        assert!(input.params.is_empty());
    }

    #[test]
    fn test_text_ok() {
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        assert_eq!(input.text().unwrap(), "hello");
    }

    #[test]
    fn test_text_err_when_missing() {
        let input = ToolInput::default();
        let err = input.text().unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_file_path_ok() {
        let input = ToolInput {
            file_path: Some("/tmp/x.txt".into()),
            ..Default::default()
        };
        assert_eq!(input.file_path().unwrap(), "/tmp/x.txt");
    }

    #[test]
    fn test_file_path_err_when_missing() {
        let input = ToolInput::default();
        let err = input.file_path().unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_param_ok() {
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        let input = ToolInput {
            params,
            ..Default::default()
        };
        let indent: u32 = input.param("indent").unwrap();
        assert_eq!(indent, 4);
    }

    #[test]
    fn test_param_missing() {
        let input = ToolInput::default();
        let err = input.param::<u32>("indent").unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
        assert!(err.to_string().contains("indent"));
    }

    #[test]
    fn test_param_wrong_type() {
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!("not_a_number"));
        let input = ToolInput {
            params,
            ..Default::default()
        };
        let err = input.param::<u32>("indent").unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[test]
    fn test_serde_roundtrip() {
        let mut params = HashMap::new();
        params.insert("flag".to_string(), json!(true));
        let input = ToolInput {
            text: Some("hello".into()),
            file_path: None,
            params,
        };
        let json_str = serde_json::to_string(&input).unwrap();
        let decoded: ToolInput = serde_json::from_str(&json_str).unwrap();
        assert_eq!(decoded.text().unwrap(), "hello");
        assert!(decoded.param::<bool>("flag").unwrap());
    }

    #[test]
    fn test_skip_serializing_if() {
        let input = ToolInput::default();
        let v = serde_json::to_value(&input).unwrap();
        assert!(v.get("text").is_none());
        assert!(v.get("file_path").is_none());
        assert!(v.get("params").is_none());
    }
}
