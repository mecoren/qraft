// Shell 层 Updater 模块:更新检查的纯类型与构造函数
//
// 此模块仅依赖 serde,不依赖 Tauri 运行时,可在 `cargo test` 下编译与测试。
// `#[tauri::command]` 异步函数留在 `commands::app`(被 `#[cfg(not(test))]` 门控),
// 通过 `build_check_update_response` 委托到此模块的纯函数,实现可测试性。
//
// 架构一致性:与 `shell::response` 模块相同的设计模式(纯类型 + 不门控)。

use serde::{Deserialize, Serialize};

/// IPC 响应:检查更新结果
///
/// 字段使用 camelCase 序列化(与前端 TS 接口约定一致)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResponse {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// 内部辅助类型:从 updater 插件提取的更新信息
///
/// 仅用于 `build_check_update_response` 的输入,不跨 IPC 边界。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// 构造 `CheckUpdateResponse` 的纯函数
///
/// 将 updater 插件返回的 `Option<AvailableUpdate>` 转换为 IPC 响应。
/// 抽离为独立函数是为了便于单元测试(不依赖 Tauri 运行时)。
#[must_use]
pub fn build_check_update_response(
    current_version: String,
    update: Option<AvailableUpdate>,
) -> CheckUpdateResponse {
    match update {
        Some(u) => CheckUpdateResponse {
            available: true,
            version: Some(u.version),
            current_version,
            notes: u.notes,
            date: u.date,
        },
        None => CheckUpdateResponse {
            available: false,
            version: None,
            current_version,
            notes: None,
            date: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn check_update_response_serializes_no_update_correctly() {
        let resp = CheckUpdateResponse {
            available: false,
            version: None,
            current_version: "0.1.0".to_string(),
            notes: None,
            date: None,
        };
        let json = serde_json::to_value(&resp).expect("serialize should succeed");
        assert_eq!(json["available"], json!(false));
        assert_eq!(json["version"], json!(null));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!(null));
        assert_eq!(json["date"], json!(null));
    }

    #[test]
    fn check_update_response_serializes_update_available_correctly() {
        let resp = CheckUpdateResponse {
            available: true,
            version: Some("0.2.0".to_string()),
            current_version: "0.1.0".to_string(),
            notes: Some("Bug fixes".to_string()),
            date: Some("2026-08-01T00:00:00Z".to_string()),
        };
        let json = serde_json::to_value(&resp).expect("serialize should succeed");
        assert_eq!(json["available"], json!(true));
        assert_eq!(json["version"], json!("0.2.0"));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!("Bug fixes"));
        assert_eq!(json["date"], json!("2026-08-01T00:00:00Z"));
    }

    #[test]
    fn build_response_from_no_update_returns_available_false() {
        let resp = build_check_update_response("0.1.0".to_string(), None);
        assert!(!resp.available);
        assert!(resp.version.is_none());
    }

    #[test]
    fn build_response_from_update_returns_available_true() {
        let update = AvailableUpdate {
            version: "0.2.0".to_string(),
            notes: Some("fixes".to_string()),
            date: Some("2026-08-01".to_string()),
        };
        let resp = build_check_update_response("0.1.0".to_string(), Some(update));
        assert!(resp.available);
        assert_eq!(resp.version.as_deref(), Some("0.2.0"));
        assert_eq!(resp.notes.as_deref(), Some("fixes"));
    }
}
