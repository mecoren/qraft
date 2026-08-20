// Shell 层 Updater 模块:更新检查的纯类型与构造函数
//
// 此模块仅依赖 serde,不依赖 Tauri 运行时,可在 `cargo test` 下编译与测试。
// `#[tauri::command]` 异步函数留在 `commands::app`(被 `#[cfg(not(test))]` 门控),
// 通过 `build_check_update_response` 委托到此模块的纯函数,实现可测试性。
//
// 架构一致性:与 `shell::response` 模块相同的设计模式(纯类型 + 不门控)。

use serde::{Deserialize, Serialize};

/// 安装包类型
///
/// 对应 `GoNavi` 的 `updatePackageType`:不同平台打包产物使用不同的安装包格式,
/// 更新时需要匹配"当前安装方式"才能正确安装(端口版可就地覆盖,安装版需调用
/// 系统安装器)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackageType {
    /// Windows MSI 安装包(wix),用 `msiexec /i` 安装
    Msi,
    /// Windows NSIS 安装包(.exe 安装器),双击运行
    Nsis,
    /// Windows 便携版(.zip 解压即用,就地覆盖)
    Portable,
    /// macOS 磁盘映像(.dmg,挂载后复制 .app)
    Dmg,
    /// macOS 应用压缩包(.app.tar.gz,就地解压覆盖)
    AppArchive,
    /// Linux AppImage(单文件可执行,chmod +x 替换)
    AppImage,
    /// Linux Debian 包(.deb,dpkg -i 安装)
    Deb,
    /// 通用压缩包(.tar.gz,就地解压覆盖)
    Archive,
}

/// 安装方式(平台相关的安装动作)
///
/// 对应 `GoNavi` 的 `updateInstallMode`(installMode):同一份更新在不同平台上
/// 触发不同的安装流程。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallMode {
    /// Windows: `msiexec /i <pkg>.msi` 静默安装
    WindowsMsi,
    /// Windows: 运行 NSIS 安装器(`<pkg>.exe /S`)
    WindowsNsis,
    /// 就地解压覆盖(便携版/压缩包/AppImage)
    InPlace,
    /// macOS: 挂载 dmg 并复制 .app 到 /Applications
    MacosDmg,
    /// Linux: `sudo dpkg -i <pkg>.deb`
    LinuxDeb,
}

/// 根据平台 + 当前安装模式解析"目标更新包类型"
///
/// 参考 `GoNavi` `resolveUpdatePackageType`:
/// - Windows 通过 marker 文件(见 `is_msi_install`)区分 MSI 安装版与便携版
/// - macOS / Linux 按各自打包产物返回对应类型
#[must_use]
pub const fn resolve_package_type(current_is_msi: bool) -> PackageType {
    #[cfg(target_os = "windows")]
    {
        if current_is_msi {
            PackageType::Msi
        } else {
            PackageType::Portable
        }
    }
    #[cfg(target_os = "macos")]
    {
        PackageType::Dmg
    }
    #[cfg(target_os = "linux")]
    {
        PackageType::AppImage
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        PackageType::Archive
    }
}

/// 根据包类型解析对应的安装方式
///
/// 参考 `GoNavi` `validateUpdatePackageForCurrentInstallMode` 的安装分支映射。
#[must_use]
pub const fn resolve_install_mode(pkg: PackageType) -> InstallMode {
    match pkg {
        PackageType::Msi => InstallMode::WindowsMsi,
        PackageType::Nsis => InstallMode::WindowsNsis,
        PackageType::Portable
        | PackageType::AppArchive
        | PackageType::AppImage
        | PackageType::Archive => InstallMode::InPlace,
        PackageType::Dmg => InstallMode::MacosDmg,
        PackageType::Deb => InstallMode::LinuxDeb,
    }
}

/// 安装方式的人类可读描述(展示在前端)
#[must_use]
pub const fn install_mode_label(mode: InstallMode) -> &'static str {
    match mode {
        InstallMode::WindowsMsi => "MSI 安装(系统级)",
        InstallMode::WindowsNsis => "NSIS 安装器",
        InstallMode::InPlace => "就地覆盖(portable)",
        InstallMode::MacosDmg => "挂载 .dmg 安装",
        InstallMode::LinuxDeb => "dpkg 安装(.deb)",
    }
}

/// 探测当前 Windows 安装是否为 MSI 安装版
///
/// 参考 `GoNavi` 的 `windowsMSIInstallMarker`:区分「系统安装版(MSI)」与「便携版」。
/// `GoNavi` 通过同级 marker 文件标识;此处采用等价的零配置判据 —— MSI 默认安装到
/// `C:\Program Files\...`(系统级、需管理员权限升级),而 NSIS(`currentUser`)与
/// 便携版位于 `%LOCALAPPDATA%` 或任意目录,属就地覆盖类。据此决定更新包类型与
/// 安装方式提示。
#[cfg(target_os = "windows")]
#[must_use]
pub fn is_msi_install(exe_dir: &std::path::Path) -> bool {
    let path = exe_dir.to_string_lossy().to_lowercase();
    path.contains("\\program files") || path.contains("\\programdata")
}

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
    /// 当前平台对应的目标安装包类型(参考 `GoNavi` `updatePackageType`)
    pub package_type: Option<PackageType>,
    /// 当前平台/安装方式对应的安装动作(参考 `GoNavi` `updateInstallMode`)
    pub install_mode: Option<InstallMode>,
    /// 安装方式的人类可读描述,前端直接展示
    pub install_mode_label: Option<String>,
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
    current_is_msi: bool,
) -> CheckUpdateResponse {
    match update {
        Some(u) => {
            let pkg = resolve_package_type(current_is_msi);
            let mode = resolve_install_mode(pkg);
            CheckUpdateResponse {
                available: true,
                version: Some(u.version),
                current_version,
                notes: u.notes,
                date: u.date,
                package_type: Some(pkg),
                install_mode: Some(mode),
                install_mode_label: Some(install_mode_label(mode).to_string()),
            }
        }
        None => CheckUpdateResponse {
            available: false,
            version: None,
            current_version,
            notes: None,
            date: None,
            package_type: None,
            install_mode: None,
            install_mode_label: None,
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
            package_type: None,
            install_mode: None,
            install_mode_label: None,
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
            package_type: Some(PackageType::Msi),
            install_mode: Some(InstallMode::WindowsMsi),
            install_mode_label: Some("MSI 安装(系统级)".to_string()),
        };
        let json = serde_json::to_value(&resp).expect("serialize should succeed");
        assert_eq!(json["available"], json!(true));
        assert_eq!(json["version"], json!("0.2.0"));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!("Bug fixes"));
        assert_eq!(json["date"], json!("2026-08-01T00:00:00Z"));
        assert_eq!(json["packageType"], json!("msi"));
        assert_eq!(json["installMode"], json!("windows-msi"));
        assert_eq!(json["installModeLabel"], json!("MSI 安装(系统级)"));
    }

    #[test]
    fn build_response_from_no_update_returns_available_false() {
        let resp = build_check_update_response("0.1.0".to_string(), None, false);
        assert!(!resp.available);
        assert!(resp.version.is_none());
        assert!(resp.package_type.is_none());
    }

    #[test]
    fn build_response_from_update_returns_available_true() {
        let update = AvailableUpdate {
            version: "0.2.0".to_string(),
            notes: Some("fixes".to_string()),
            date: Some("2026-08-01".to_string()),
        };
        let resp = build_check_update_response("0.1.0".to_string(), Some(update), false);
        assert!(resp.available);
        assert_eq!(resp.version.as_deref(), Some("0.2.0"));
        assert_eq!(resp.notes.as_deref(), Some("fixes"));
        assert!(resp.install_mode.is_some());
        assert!(resp.install_mode_label.is_some());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn resolve_package_type_respects_msi_marker() {
        // Windows:marker 区分 MSI 安装版与便携版
        assert_eq!(resolve_package_type(true), PackageType::Msi);
        assert_eq!(resolve_package_type(false), PackageType::Portable);
        assert_ne!(resolve_package_type(true), resolve_package_type(false));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn resolve_package_type_ignores_msi_marker_on_non_windows() {
        // 非 Windows 平台:marker 被忽略,两种入参返回相同的平台包类型
        assert_eq!(resolve_package_type(true), resolve_package_type(false));
    }
}
