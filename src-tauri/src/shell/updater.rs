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
/// `updatePackageType`:不同平台打包产物使用不同的安装包格式,
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
/// `updateInstallMode`(installMode):同一份更新在不同平台上
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

/// Windows 安装类别(由运行时探测得出)
///
/// `detectWindowsInstallKind` 的产出:区分 MSI 安装版、NSIS 安装版与便携版,
/// 决定更新时使用哪种安装流程与提示文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsInstallKind {
    /// MSI 安装版(Program Files 系统级)
    Msi,
    /// NSIS 安装版(安装目录含卸载程序 `uninstall.exe`)
    Nsis,
    /// 便携版(zip 解压,无卸载程序、非系统目录)
    Portable,
}

/// 根据平台 + 当前安装类别解析"目标更新包类型"
///
/// `resolveUpdatePackageType`:
/// - Windows 按 `WindowsInstallKind` 映射(MSI → Msi、NSIS → Nsis、便携 → Portable)
/// - macOS / Linux 按各自打包产物返回对应类型
#[must_use]
pub const fn resolve_package_type(kind: WindowsInstallKind) -> PackageType {
    match kind {
        WindowsInstallKind::Msi => PackageType::Msi,
        WindowsInstallKind::Nsis => PackageType::Nsis,
        WindowsInstallKind::Portable => PackageType::Portable,
    }
}

/// 非 Windows 平台的默认更新包类型(macOS → `dmg`,Linux → `AppImage`)
#[must_use]
pub const fn platform_default_package_type() -> PackageType {
    #[cfg(target_os = "macos")]
    {
        PackageType::Dmg
    }
    #[cfg(target_os = "linux")]
    {
        PackageType::AppImage
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        PackageType::Archive
    }
}

/// 根据包类型解析对应的安装方式
///
/// `validateUpdatePackageForCurrentInstallMode` 的安装分支映射。
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
        InstallMode::WindowsMsi => "安装版(MSI)",
        InstallMode::WindowsNsis => "安装版(NSIS)",
        InstallMode::InPlace => "便携版(就地覆盖)",
        InstallMode::MacosDmg => "挂载 .dmg 安装",
        InstallMode::LinuxDeb => "dpkg 安装(.deb)",
    }
}

/// 探测当前 Windows 的安装类别(安装版 vs 便携版)
///
/// `detectWindowsInstallKind`:判据按优先级排列 ——
/// 1. NSIS 安装器(Tauri 默认,含 `currentUser` 每用户安装)会在安装目录放置
///    卸载程序 `uninstall.exe`,存在即判定为 NSIS 安装版;
/// 2. MSI 安装版默认安装到 `C:\Program Files\...`(系统级)或 `ProgramData`;
/// 3. 其余目录(zip 解压)判定为便携版。
#[cfg(target_os = "windows")]
#[must_use]
pub fn detect_windows_install_kind(exe_dir: &std::path::Path) -> WindowsInstallKind {
    // NSIS 安装器生成的卸载程序与主程序同级(文件名固定为 uninstall.exe)
    if exe_dir.join("uninstall.exe").is_file() {
        return WindowsInstallKind::Nsis;
    }
    let path = exe_dir.to_string_lossy().to_lowercase();
    if path.contains("\\program files") || path.contains("\\programdata") {
        WindowsInstallKind::Msi
    } else {
        WindowsInstallKind::Portable
    }
}

/// 过滤 Release 正文中的英文样板句
///
/// `sanitizeReleaseNotes`:tauri-action 自动生成的 Release 说明会附带一行
/// 英文引导语(如 "See the assets below to download and install this version."),
/// 对中文界面是噪音。逐行剔除包含该样板关键词的行,清洗后为空则返回 `None`
/// (前端据此隐藏更新说明区块)。
#[must_use]
fn sanitize_notes(notes: &str) -> Option<String> {
    let cleaned: Vec<&str> = notes
        .lines()
        .filter(|line| !line.to_lowercase().contains("see the assets"))
        .collect();
    let trimmed = cleaned.join("\n").trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
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
    /// 当前平台对应的目标安装包类型(`updatePackageType`)
    pub package_type: Option<PackageType>,
    /// 当前平台/安装方式对应的安装动作(`updateInstallMode`)
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
/// 将 updater 插件返回的 `Option<AvailableUpdate>` 转换为 IPC 响应;
/// `package_type` 由调用方按平台/安装类别预先解析(见
/// `detect_windows_install_kind` + `resolve_package_type`,或
/// `platform_default_package_type`)。
/// 抽离为独立函数是为了便于单元测试(不依赖 Tauri 运行时)。
#[must_use]
pub fn build_check_update_response(
    current_version: String,
    update: Option<AvailableUpdate>,
    package_type: PackageType,
) -> CheckUpdateResponse {
    match update {
        Some(u) => {
            let mode = resolve_install_mode(package_type);
            CheckUpdateResponse {
                available: true,
                version: Some(u.version),
                current_version,
                notes: u.notes.as_deref().and_then(sanitize_notes),
                date: u.date,
                package_type: Some(package_type),
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
            install_mode_label: Some("安装版(MSI)".to_string()),
        };
        let json = serde_json::to_value(&resp).expect("serialize should succeed");
        assert_eq!(json["available"], json!(true));
        assert_eq!(json["version"], json!("0.2.0"));
        assert_eq!(json["currentVersion"], json!("0.1.0"));
        assert_eq!(json["notes"], json!("Bug fixes"));
        assert_eq!(json["date"], json!("2026-08-01T00:00:00Z"));
        assert_eq!(json["packageType"], json!("msi"));
        assert_eq!(json["installMode"], json!("windows-msi"));
        assert_eq!(json["installModeLabel"], json!("安装版(MSI)"));
    }

    #[test]
    fn build_response_from_no_update_returns_available_false() {
        let resp = build_check_update_response("0.1.0".to_string(), None, PackageType::Portable);
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
        let resp =
            build_check_update_response("0.1.0".to_string(), Some(update), PackageType::Portable);
        assert!(resp.available);
        assert_eq!(resp.version.as_deref(), Some("0.2.0"));
        assert_eq!(resp.notes.as_deref(), Some("fixes"));
        assert!(resp.install_mode.is_some());
        assert!(resp.install_mode_label.is_some());
    }

    #[test]
    fn resolve_package_type_maps_install_kinds() {
        // Windows 安装类别 → 更新包类型一一对应
        assert_eq!(
            resolve_package_type(WindowsInstallKind::Msi),
            PackageType::Msi
        );
        assert_eq!(
            resolve_package_type(WindowsInstallKind::Nsis),
            PackageType::Nsis
        );
        assert_eq!(
            resolve_package_type(WindowsInstallKind::Portable),
            PackageType::Portable
        );
    }

    #[test]
    fn resolve_install_mode_maps_nsis_correctly() {
        // NSIS 安装版 → WindowsNsis 安装方式(非就地覆盖)
        assert_eq!(
            resolve_install_mode(PackageType::Nsis),
            InstallMode::WindowsNsis
        );
    }

    #[test]
    fn sanitize_notes_strips_upstream_boilerplate() {
        // tauri-action 生成的英文样板句应被剔除;纯样板 → None(前端隐藏说明区)
        assert_eq!(
            sanitize_notes("See the assets below to download and install this version."),
            None
        );
        // 混合内容:仅剔除样板行,保留正文
        let mixed = "See the assets below to download and install this version.\n\n- 修复若干问题\n- 新增工具";
        assert_eq!(
            sanitize_notes(mixed).as_deref(),
            Some("- 修复若干问题\n- 新增工具")
        );
        // 纯中文正文原样保留
        assert_eq!(
            sanitize_notes("- 修复若干问题").as_deref(),
            Some("- 修复若干问题")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detect_windows_install_kind_by_uninstaller() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("qraft_detect_test_{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        // 无卸载程序 + 非系统目录 → 便携版
        assert_eq!(
            detect_windows_install_kind(&dir),
            WindowsInstallKind::Portable
        );
        // 存在 uninstall.exe → NSIS 安装版
        fs::write(dir.join("uninstall.exe"), b"").expect("write uninstaller stub");
        assert_eq!(detect_windows_install_kind(&dir), WindowsInstallKind::Nsis);
        // 系统目录(无卸载程序)→ MSI 安装版
        assert_eq!(
            detect_windows_install_kind(std::path::Path::new("C:\\Program Files\\Qraft")),
            WindowsInstallKind::Msi
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
