use async_trait::async_trait;
use atomicwrites::{AtomicFile, OverwriteBehavior};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use crate::core::error::ToolError;
use crate::store::config_path as default_config_path;

/// 配置访问接口(异步,便于未来扩展)
#[async_trait]
pub trait ConfigStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Value>, ToolError>;
    async fn set(&self, key: &str, value: Value) -> Result<(), ToolError>;
    async fn get_all(&self) -> Result<UserConfig, ToolError>;
    async fn reset(&self, key: &str) -> Result<(), ToolError>;
}

/// 用户配置根结构
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserConfig {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub theme: ThemeConfig,
    #[serde(default)]
    pub shortcuts: ShortcutBinding,
    #[serde(default)]
    pub tool_prefs: HashMap<String, Value>,
    #[serde(default)]
    pub editor: EditorConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    #[serde(default)]
    pub naming_convention: NamingConventionConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingConventionConfig {
    #[serde(default)]
    pub enabled: Vec<String>,
    #[serde(default)]
    pub order: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GeneralConfig {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub font_size: u32,
    #[serde(default)]
    pub max_history: usize,
    #[serde(default)]
    pub confirm_on_clear: bool,
}

/// 界面语言默认值:与前端 DEFAULT_USER_CONFIG 对齐(zh-CN 优先现状)
fn default_language() -> String {
    "zh-CN".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ThemeConfig {
    #[serde(default)]
    pub mode: ThemeMode,
    #[serde(default)]
    pub accent_color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    Light,
    #[default]
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBinding {
    #[serde(default)]
    pub open_command_palette: String,
    #[serde(default)]
    pub toggle_sidebar: String,
    #[serde(default)]
    pub execute_tool: String,
    #[serde(default)]
    pub clear_input: String,
    #[serde(default)]
    pub copy_output: String,
    #[serde(default)]
    pub toggle_settings: String,
    #[serde(default)]
    pub switch_tool: String,
    #[serde(default)]
    pub open_history: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub close_panel: String,
    #[serde(default)]
    pub save_file: String,
    #[serde(default)]
    pub cycle_naming_case: String,
    #[serde(default)]
    pub toggle_case: String,
}

impl Default for ShortcutBinding {
    fn default() -> Self {
        Self {
            open_command_palette: "Ctrl+K".into(),
            toggle_sidebar: "Ctrl+B".into(),
            execute_tool: "Ctrl+Enter".into(),
            clear_input: "Ctrl+L".into(),
            copy_output: "Ctrl+Shift+C".into(),
            toggle_settings: "Ctrl+,".into(),
            switch_tool: "Ctrl+P".into(),
            open_history: "Ctrl+H".into(),
            search: "Ctrl+F".into(),
            close_panel: "Esc".into(),
            save_file: "Ctrl+S".into(),
            cycle_naming_case: "Ctrl+Shift+U".into(),
            toggle_case: "Ctrl+Shift+L".into(),
        }
    }
}

/// JSON 文件实现的 `ConfigStore`
///
/// 内存中维护 `UserConfig` 副本,通过 `RwLock` 保护并发读;
/// 写入时先更新内存再原子写入磁盘(atomicwrites),避免半写损坏。
pub struct JsonConfigStore {
    config: RwLock<UserConfig>,
    path: PathBuf,
}

impl JsonConfigStore {
    /// 用指定路径构造(测试用)
    ///
    /// 若文件存在则读取并解析;解析失败回退到默认配置(避免损坏文件阻塞启动)。
    #[must_use]
    #[allow(clippy::unwrap_used)]
    pub fn new(path: PathBuf) -> Self {
        let config = if path.exists() {
            let json = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&json).unwrap_or_default()
        } else {
            UserConfig::default()
        };
        Self {
            config: RwLock::new(config),
            path,
        }
    }

    /// 用默认路径加载
    #[must_use]
    pub fn load() -> Self {
        Self::new(default_config_path())
    }

    /// 将内存中的配置原子写入磁盘
    ///
    /// atomicwrites 保证写入要么完整成功要么文件保持原状,避免崩溃导致半写。
    fn persist(&self) -> Result<(), ToolError> {
        let config = self.config.read().clone();
        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| ToolError::Internal(format!("serialize config: {e}")))?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Internal(format!("create config dir: {e}")))?;
        }

        let af = AtomicFile::new(&self.path, OverwriteBehavior::AllowOverwrite);
        af.write(|f| f.write_all(json.as_bytes()))
            .map_err(|e| ToolError::Internal(format!("atomic write config: {e}")))
    }
}

#[async_trait]
impl ConfigStore for JsonConfigStore {
    async fn get(&self, key: &str) -> Result<Option<Value>, ToolError> {
        let config = self.config.read().clone();
        let mut value = serde_json::to_value(&config)
            .map_err(|e| ToolError::Internal(format!("serialize config: {e}")))?;
        // 按点号路径逐级下钻,任一段缺失即返回 None
        for segment in key.split('.') {
            if segment.is_empty() {
                continue;
            }
            match value.get(segment) {
                Some(v) => value = v.clone(),
                None => return Ok(None),
            }
        }
        if value.is_null() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    }

    async fn set(&self, key: &str, value: Value) -> Result<(), ToolError> {
        {
            let mut config = self.config.write();
            let mut root = serde_json::to_value(&*config)
                .map_err(|e| ToolError::Internal(format!("serialize config: {e}")))?;

            let segments: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
            if segments.is_empty() {
                return Err(ToolError::InvalidInput("empty config key".into()));
            }

            // 遍历到倒数第二段,每段必须存在且为对象
            let mut current = &mut root;
            for seg in &segments[..segments.len() - 1] {
                current = current.get_mut(*seg).ok_or_else(|| {
                    ToolError::InvalidInput(format!("invalid config path: {key}"))
                })?;
            }
            // segments 已在上方 is_empty 检查中保证非空,直接取末位元素
            let last = segments[segments.len() - 1];
            if let Some(obj) = current.as_object_mut() {
                obj.insert(last.to_string(), value);
            } else {
                return Err(ToolError::InvalidInput(format!(
                    "config path not an object: {key}"
                )));
            }

            *config = serde_json::from_value(root)
                .map_err(|e| ToolError::Internal(format!("deserialize config: {e}")))?;
        }
        self.persist()
    }

    async fn get_all(&self) -> Result<UserConfig, ToolError> {
        Ok(self.config.read().clone())
    }

    async fn reset(&self, key: &str) -> Result<(), ToolError> {
        // 取默认配置中对应路径的值,再 set 回当前配置
        let default_config = UserConfig::default();
        let default_value = serde_json::to_value(&default_config)
            .map_err(|e| ToolError::Internal(format!("serialize default: {e}")))?;
        let mut value = default_value;
        for segment in key.split('.') {
            if segment.is_empty() {
                continue;
            }
            value = value.get(segment).cloned().unwrap_or(Value::Null);
        }
        self.set(key, value).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn temp_config_path() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        (dir, path)
    }

    #[tokio::test]
    async fn test_get_nonexistent_key_returns_none() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        let result = store.get("nonexistent.key").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_set_and_get_top_level() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store
            .set("theme", json!({"mode": "dark", "accent_color": "#3b82f6"}))
            .await
            .unwrap();
        let val = store.get("theme").await.unwrap().unwrap();
        assert_eq!(val["mode"], "dark");
    }

    #[tokio::test]
    async fn test_set_and_get_nested_path() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store.set("theme.mode", json!("light")).await.unwrap();
        let val = store.get("theme.mode").await.unwrap().unwrap();
        assert_eq!(val, "light");
    }

    #[tokio::test]
    async fn test_get_all_default() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        let config = store.get_all().await.unwrap();
        assert_eq!(config.version, 0);
        assert_eq!(config.general.font_size, 0);
    }

    #[tokio::test]
    async fn test_reset_to_default() {
        let (_tmp, path) = temp_config_path();
        let store = JsonConfigStore::new(path);
        store.set("theme.mode", json!("light")).await.unwrap();
        assert!(store.get("theme.mode").await.unwrap().is_some());
        store.reset("theme.mode").await.unwrap();
        // reset 后 theme.mode 回到默认(ThemeMode::default() = Dark,序列化为 "dark")
        let val = store.get("theme.mode").await.unwrap().unwrap();
        assert_eq!(val, json!("dark"));
    }

    #[tokio::test]
    async fn test_persist_across_instances() {
        let (_tmp, path) = temp_config_path();
        {
            let store = JsonConfigStore::new(path.clone());
            store.set("general.language", json!("zh")).await.unwrap();
        }
        // 新实例加载同一文件
        let store2 = JsonConfigStore::new(path);
        let val = store2.get("general.language").await.unwrap().unwrap();
        assert_eq!(val, "zh");
    }

    #[tokio::test]
    async fn test_concurrent_set_safe() {
        let (_tmp, path) = temp_config_path();
        let store = std::sync::Arc::new(JsonConfigStore::new(path));
        let mut handles = vec![];
        for i in 0..5 {
            let s = store.clone();
            handles.push(tokio::spawn(async move {
                s.set("general.font_size", json!(i)).await
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }
        // 文件应可读且为有效 JSON
        let val = store.get("general.font_size").await.unwrap().unwrap();
        assert!(val.is_number());
    }
}
