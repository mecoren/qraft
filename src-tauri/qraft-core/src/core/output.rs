use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 工具执行的输出
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolOutput {
    pub text: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<OutputMeta>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputMeta {
    pub duration_ms: u64,
    pub input_bytes: usize,
    pub output_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub level: AlertLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertLevel {
    Info,
    Warning,
    Error,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_default_output() {
        let out = ToolOutput::default();
        assert_eq!(out.text, "");
        assert!(out.extra.is_none());
        assert!(out.meta.is_none());
        assert!(out.alerts.is_empty());
    }

    #[test]
    fn test_serde_skip_none_fields() {
        let out = ToolOutput {
            text: "hi".into(),
            ..Default::default()
        };
        let v = serde_json::to_value(&out).unwrap();
        assert_eq!(v["text"], "hi");
        assert!(v.get("extra").is_none());
        assert!(v.get("meta").is_none());
        assert!(v.get("alerts").is_none());
    }

    #[test]
    fn test_alert_level_info_serde() {
        let alert = Alert {
            level: AlertLevel::Info,
            message: "ok".into(),
        };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v, json!({"level": "info", "message": "ok"}));
    }

    #[test]
    fn test_alert_level_warning_serde() {
        let alert = Alert {
            level: AlertLevel::Warning,
            message: "careful".into(),
        };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v["level"], "warning");
    }

    #[test]
    fn test_alert_level_error_serde() {
        let alert = Alert {
            level: AlertLevel::Error,
            message: "bad".into(),
        };
        let v = serde_json::to_value(&alert).unwrap();
        assert_eq!(v["level"], "error");
    }

    #[test]
    fn test_output_meta_serde() {
        let meta = OutputMeta {
            duration_ms: 42,
            input_bytes: 100,
            output_bytes: 200,
        };
        let v = serde_json::to_value(&meta).unwrap();
        assert_eq!(
            v,
            json!({"duration_ms": 42, "input_bytes": 100, "output_bytes": 200})
        );
    }

    #[test]
    fn test_full_output_serde() {
        let out = ToolOutput {
            text: "result".into(),
            extra: Some(json!({"count": 3})),
            meta: Some(OutputMeta {
                duration_ms: 5,
                input_bytes: 10,
                output_bytes: 20,
            }),
            alerts: vec![Alert {
                level: AlertLevel::Warning,
                message: "trimmed".into(),
            }],
        };
        let v = serde_json::to_value(&out).unwrap();
        assert_eq!(v["text"], "result");
        assert_eq!(v["extra"]["count"], 3);
        assert_eq!(v["meta"]["duration_ms"], 5);
        assert_eq!(v["alerts"][0]["level"], "warning");
    }

    #[test]
    fn test_alerts_not_serialized_when_empty() {
        let out = ToolOutput {
            text: "x".into(),
            alerts: vec![],
            ..Default::default()
        };
        let v = serde_json::to_value(&out).unwrap();
        assert!(v.get("alerts").is_none());
    }

    #[test]
    fn test_serde_roundtrip() {
        let out = ToolOutput {
            text: "hello".into(),
            extra: Some(json!({"k": "v"})),
            meta: None,
            alerts: vec![Alert {
                level: AlertLevel::Info,
                message: "done".into(),
            }],
        };
        let s = serde_json::to_string(&out).unwrap();
        let decoded: ToolOutput = serde_json::from_str(&s).unwrap();
        assert_eq!(decoded.text, "hello");
        assert_eq!(decoded.alerts.len(), 1);
    }
}
