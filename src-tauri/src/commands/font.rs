// 系统字体枚举 IPC Command
//
// 使用 Windows DirectWrite API 枚举系统字体,按 family 去重返回。
// 仅 Windows 平台可用,其他平台返回空列表。
//
// 设计说明:
// - 返回 `Vec<FontInfo>` 而非 `CommandResponse<Vec<FontInfo>>`,与 wait-home 一致,
//   前端 `invoke<FontInfo[]>('list_system_fonts')` 直接拿数组,无需解包
// - `FontInfo` 字段使用 camelCase 序列化,与前端 TypeScript 接口对齐
// - 失败时返回 `AppError::Internal`,前端 fonts.ts 已兜底返回空数组

use serde::Serialize;

use crate::shell::AppError;

/// 系统字体信息
///
/// 字段使用 camelCase 序列化,与前端 `FontInfo` 接口对齐:
/// - `family` → `family`(CSS font-family 使用)
/// - `display_name` → `displayName`(UI 展示)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    /// CSS font-family 使用的字体族名
    pub family: String,
    /// UI 展示用的字体名称
    pub display_name: String,
}

/// 枚举系统所有可用字体(按 family 去重)
///
/// # Errors
///
/// - Windows 平台:DirectWrite API 调用失败时返回 `AppError::Internal`
/// - 非 Windows 平台:恒返回空列表,不会报错
#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<FontInfo>, AppError> {
    enumerate_fonts()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("enumerate fonts failed: {e}")))
}

// ============ 平台实现 ============

#[cfg(target_os = "windows")]
mod win {
    use std::collections::HashSet;

    use windows::Win32::Graphics::DirectWrite::{
        DWRITE_FACTORY_TYPE_SHARED, DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection,
        IDWriteFontFamily, IDWriteLocalizedStrings,
    };

    /// 枚举系统字体(Windows DirectWrite 实现)
    ///
    /// 流程:
    /// 1. 创建 DirectWrite 共享工厂(进程内单例,系统字体缓存)
    /// 2. 获取系统字体集合
    /// 3. 遍历所有 family,读取本地化名称的首条(en-us 或系统默认)
    /// 4. 按 family 去重,按 `display_name` 不区分大小写排序
    pub fn enumerate() -> windows::core::Result<Vec<super::FontInfo>> {
        // 1. 创建 DirectWrite 工厂(共享模式,系统级缓存)
        let factory: IDWriteFactory =
            unsafe { DWriteCreateFactory::<IDWriteFactory>(DWRITE_FACTORY_TYPE_SHARED)? };

        // 2. 获取系统字体集合
        //    `check_for_updates=false` 避免每次调用都触发字体缓存重建
        let mut collection: Option<IDWriteFontCollection> = None;
        unsafe { factory.GetSystemFontCollection(&raw mut collection, false)? };
        // GetSystemFontCollection 成功路径下保证写入 Some;
        // 但类型签名是 Option,用 let-else 显式处理 None 兜底,避免 unwrap 警告
        let Some(collection) = collection else {
            return Ok(Vec::new());
        };

        // 3. 遍历字体族,收集名称并按 family 去重
        let count = unsafe { collection.GetFontFamilyCount() };
        let mut fonts = Vec::with_capacity(count as usize);
        let mut seen = HashSet::new();

        for i in 0..count {
            // 单个 family 读取失败时跳过,不中断整个枚举
            let family: IDWriteFontFamily = match unsafe { collection.GetFontFamily(i) } {
                Ok(f) => f,
                Err(_) => continue,
            };

            // 获取字体族本地化名称列表
            let names: IDWriteLocalizedStrings = match unsafe { family.GetFamilyNames() } {
                Ok(n) => n,
                Err(_) => continue,
            };

            // 取首条名称(en-us 或系统默认 locale),DirectWrite 的 family name
            // 可直接用作 CSS font-family
            let name = read_first_string(&names);

            // 按 family 去重,空名跳过(防御性:理论上不会出现)
            if !name.is_empty() && seen.insert(name.clone()) {
                fonts.push(super::FontInfo {
                    family: name.clone(),
                    display_name: name,
                });
            }
        }

        // 4. 按显示名排序(不区分大小写),提升 UI 可读性
        fonts.sort_by(|a, b| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        });

        Ok(fonts)
    }

    /// 读取本地化字符串的首条(index 0)
    ///
    /// DirectWrite 的 `IDWriteLocalizedStrings` 可能包含多个 locale 的名称,
    /// 首条通常为 en-us 或系统默认 locale,足够用于字体选择 UI。
    fn read_first_string(names: &IDWriteLocalizedStrings) -> String {
        let count = unsafe { names.GetCount() };
        if count == 0 {
            return String::new();
        }
        let length = unsafe { names.GetStringLength(0).unwrap_or(0) };
        if length == 0 {
            return String::new();
        }
        // 预分配 buffer 容量(length+1)以容纳可能的 null 终止符
        let mut buffer = vec![0u16; (length + 1) as usize];
        // GetString 签名可能为 (&self, index, buffer: &mut [u16]) 或
        // (&self, index, PWSTR, size),用 &mut slice 方式调用以兼容新版 windows crate
        let _ = unsafe { names.GetString(0, &mut buffer) };
        String::from_utf16_lossy(&buffer[..length as usize])
    }
}

#[cfg(target_os = "windows")]
fn enumerate_fonts() -> windows::core::Result<Vec<FontInfo>> {
    win::enumerate()
}

// ──────────────────────────────────────────────
// 非 Windows 平台:返回空列表
// ──────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
fn enumerate_fonts() -> Result<Vec<FontInfo>, String> {
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_font_info_serializes_camel_case() {
        let info = FontInfo {
            family: "Microsoft YaHei".into(),
            display_name: "微软雅黑".into(),
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["family"], "Microsoft YaHei");
        assert_eq!(v["displayName"], "微软雅黑");
        // 不应出现 snake_case 字段
        assert!(v.get("display_name").is_none());
    }

    #[test]
    fn test_list_system_fonts_returns_vector_on_non_windows() {
        // 非 Windows 平台:enumerate_fonts 恒返回空 Vec
        // Windows 平台:此测试在 CI 上可能命中真实字体枚举,断言仅检查类型
        let result = enumerate_fonts();
        assert!(result.is_ok());
        let fonts = result.unwrap();
        // 不强制断言长度:CI 环境字体数量不可预测
        let _ = fonts;
    }
}
