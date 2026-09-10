// src-tauri/tests/md_assets.rs
//
// Markdown 图片资产命令的文件名校验集成测试。
// 放在 tests/ 集成测试:lib.rs 的 commands 模块带 #[cfg(not(test))],
// 单元测试目标(lib)下不编译,集成测试目标以非 test cfg 构建 lib 故可引用。

#![allow(clippy::unwrap_used, clippy::expect_used)]

use qraft_lib::commands::md_assets::is_valid_asset_name;

/// 资产文件名白名单:合法名通过,路径穿越 / 非法扩展名 / 异常载荷拒绝
#[test]
fn md_asset_name_validation() {
    // 合法:后端生成的命名格式
    assert!(is_valid_asset_name("img-abc.png"));
    assert!(is_valid_asset_name("img-ABC_123.jpg"));
    assert!(is_valid_asset_name("img-f7e8d9c0b1a2.webp"));
    // 路径穿越与分隔符
    assert!(!is_valid_asset_name("../config.json"));
    assert!(!is_valid_asset_name("img/a.png"));
    assert!(!is_valid_asset_name("img\\a.png"));
    assert!(!is_valid_asset_name("img..png"));
    // 非白名单扩展名
    assert!(!is_valid_asset_name("img.exe"));
    assert!(!is_valid_asset_name("img.gif"));
    // 空名 / 超长
    assert!(!is_valid_asset_name(""));
    assert!(!is_valid_asset_name(&format!("{}.png", "a".repeat(130))));
}
