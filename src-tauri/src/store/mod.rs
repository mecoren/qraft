use directories::ProjectDirs;
use std::path::PathBuf;

pub mod config;
pub mod history;

/// 获取 Qraft 项目目录(配置基目录)
///
/// 项目目录由 directories crate 按跨平台规则解析:
/// - macOS: ~/Library/Application Support/Qraft
/// - Linux: ~/.config/qraft
/// - Windows: %APPDATA%\Qraft\config
///
/// # Panics
///
/// 当系统无法确定用户主目录时 panic(例如 HOME 环境变量未设置且无 fallback)。
/// 此种情况属于不可恢复的环境异常,应用启动时应立即失败。
#[must_use]
#[allow(clippy::expect_used)]
pub fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("dev", "qraft", "Qraft")
        .expect("Failed to determine project directories: home directory not found")
}

/// 配置基目录(跨平台)
#[must_use]
pub fn config_dir() -> PathBuf {
    project_dirs().config_dir().to_path_buf()
}

/// config.json 路径
#[must_use]
pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// history.jsonl 路径
#[must_use]
pub fn history_path() -> PathBuf {
    config_dir().join("history.jsonl")
}

/// workspace.json 路径
#[must_use]
pub fn workspace_path() -> PathBuf {
    config_dir().join("workspace.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_dirs_available() {
        let dirs = project_dirs();
        assert!(!dirs.config_dir().as_os_str().is_empty());
    }

    #[test]
    fn test_config_dir_nonempty() {
        let dir = config_dir();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn test_history_path_ends_with_jsonl() {
        let path = history_path();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "history.jsonl");
    }

    #[test]
    fn test_workspace_path_ends_with_json() {
        let path = workspace_path();
        assert_eq!(
            path.file_name().unwrap().to_str().unwrap(),
            "workspace.json"
        );
    }

    #[test]
    fn test_config_path_ends_with_config_json() {
        let path = config_path();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "config.json");
    }

    #[test]
    fn test_paths_consistent_across_calls() {
        let p1 = config_dir();
        let p2 = config_dir();
        assert_eq!(p1, p2);
    }

    #[test]
    fn test_all_paths_under_same_base() {
        let base = config_dir();
        assert!(history_path().starts_with(&base));
        assert!(workspace_path().starts_with(&base));
        assert!(config_path().starts_with(&base));
    }
}
