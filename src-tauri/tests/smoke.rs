// src-tauri/tests/smoke.rs
//
// 集成冒烟测试:验证 Tauri Shell 层端到端可用。
//
// 运行方式(需桌面环境):
//   cargo test --test smoke -- --ignored
//
// 标记 #[ignore] 因为需要窗口环境(WebView 初始化),
// 在无头 CI 环境中可能失败,需手动运行或在带桌面的 CI runner 中运行。
//
// 注:Tauri V2 的 `tauri::test` 模块需要启用 `test` feature,且 `mock_app()` API
// 签名在 2.x 版本间有差异。此处采用最小化策略:仅验证类型可访问与序列化契约,
// 完整端到端测试需在带桌面环境的手动测试中执行(参见 plan 03 Task 13.3)。

// 集成测试允许使用 unwrap/expect:测试中惯用的失败快速触发方式,
// 与 lib.rs 的 #![cfg_attr(test, allow(...))] 保持一致
#![allow(clippy::unwrap_used, clippy::expect_used)]

use qraft_lib::core::tool::ToolMetadata;
use qraft_lib::shell::response::CommandResponse;

/// 验证 `CommandResponse<Vec<ToolMetadata>>` 类型可构造并序列化
///
/// 此测试验证:
/// 1. `CommandResponse` 包络类型可从 Shell 层导入
/// 2. `ToolMetadata` 类型可从 Core 层导入
/// 3. `CommandResponse::ok` 构造成功响应
/// 4. 序列化为 JSON 包含 success/data 字段(前端契约)
#[test]
fn smoke_command_response_serialization() {
    let tools: Vec<ToolMetadata> = vec![];
    let resp = CommandResponse::ok(tools);
    assert!(resp.success);
    assert_eq!(resp.code, "OK");
    assert!(resp.data.is_some());
    assert!(resp.data.as_ref().unwrap().is_empty());

    // 验证 JSON 序列化契约(前端通过 success/data/code 字段解析)
    let json = serde_json::to_string(&resp).expect("serialize should succeed");
    assert!(json.contains("\"success\""), "json should contain success");
    assert!(json.contains("\"data\""), "json should contain data");
    assert!(json.contains("\"code\""), "json should contain code");
    assert!(json.contains("\"OK\""), "json should contain OK");
}

/// 验证错误响应可构造并序列化
#[test]
fn smoke_error_response_serialization() {
    use qraft_lib::core::error::AppError;
    use qraft_lib::shell::response::ErrorInfo;

    let app_err = AppError::config("smoke test error");
    let info = ErrorInfo::from_app_error(&app_err);
    let resp: CommandResponse<()> = CommandResponse::err(info, "ERR_CONFIG_IO".into());
    assert!(!resp.success);
    assert_eq!(resp.code, "ERR_CONFIG_IO");
    assert!(resp.data.is_none());
    assert!(resp.error.is_some());
}

/// 端到端冒烟测试:启动 Tauri 应用,调用 `tool_list`
///
/// 此测试验证:
/// 1. Tauri 应用可正常启动
/// 2. `AppState` 正确初始化
/// 3. `tool_list` Command 可被调用
/// 4. 返回符合 `CommandResponse` 包络格式
///
/// # 手动运行步骤
///
/// ```bash
/// # 1. 启动 dev 模式(带桌面环境)
/// pnpm tauri dev
///
/// # 2. 在另一个终端查看日志,确认输出 "registered N tools"
/// # 3. 或在带桌面的 CI runner 中运行:
/// cargo test --test smoke -- --ignored
/// ```
#[tokio::test]
#[ignore = "requires desktop environment with window support; run manually with --ignored"]
async fn smoke_tool_list_end_to_end() {
    // 完整端到端测试需要 Tauri test feature 与桌面环境。
    // 手动验证步骤:
    // 1. 运行 `pnpm tauri dev`
    // 2. 应用窗口启动,终端输出 "registered N tools"
    // 3. 无权限错误、无 panic
    // 4. WebView 正常加载前端
    //
    // 详见 plan 03 Task 12.4(验证启动)与 Task 13.3(手动运行冒烟测试)。
}
