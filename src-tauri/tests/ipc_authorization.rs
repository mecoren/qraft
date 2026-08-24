//! IPC 层路径授权集成测试(Task 8 配套验证)
//!
//! 验证对象:`commands::tool::ensure_file_path_authorized` —— 同步
//! (`tool_execute_inner`)与流式(`tool_execute_stream_inner`)两条
//! IPC 路径共用的 `file_path` 安全门。
//!
//! 为什么放在集成测试而非 tool.rs 单测:`commands` 模块在 lib 的 `cfg(test)`
//! 构建中被条件编译排除(`lib.rs` 顶部注释:避免测试二进制链接 `WebView2` 原生
//! DLL;实测解除后测试进程以 `STATUS_ENTRYPOINT_NOT_FOUND` 启动即崩)。
//! 集成测试链接非 test 构建(含完整 commands 模块),可真实运行。
//!
//! 为什么测纯函数而非 `tool_execute_inner` 全函数:后者经 executor 的
//! dyn 分发把全部工具及其原生依赖拉入链接闭包,本机实测该类测试二进制
//! 在 CRT 静态初始化阶段即崩(`STATUS_ENTRYPOINT_NOT_FOUND`),无法运行;
//! 轻量符号(本函数、`AuthorizedPaths`、`tool_list`/`tool_cancel`)均可正常链接执行。
//! `_inner` 内的接线(校验先于 spawn / 先于工具查找)由代码位置与
//! 编译期检查保证。
//!
//! 流式路径补充说明:`tauri::AppHandle` 无 test feature 无法构造,
//! stream 版授权分支无法在本机端到端断言,同样由代码位置保证(spawn 前)。

#![allow(clippy::unwrap_used, clippy::expect_used)]

use qraft_lib::commands::fs::{AuthorizedPaths, fs_authorize_dropped_paths_inner};
use qraft_lib::commands::tool::ensure_file_path_authorized;

#[test]
fn rejects_path_outside_authorization_set() {
    let authorized = AuthorizedPaths::new();
    let err = ensure_file_path_authorized("C:/definitely/not/authorized.txt", &authorized)
        .unwrap_err();
    assert!(
        matches!(err, qraft_lib::AppError::Permission(_)),
        "expected permission error, got: {err:?}"
    );
    assert_eq!(err.code(), "ERR_PERMISSION_DENIED");
}

#[test]
fn allows_path_inside_authorized_subtree() {
    let authorized = AuthorizedPaths::new();
    authorized.authorize("C:/allowed/root");

    // 授权目录根本身与其子树内的路径均放行
    ensure_file_path_authorized("C:/allowed/root", &authorized).unwrap();
    ensure_file_path_authorized("C:/allowed/root/sub/a.txt", &authorized).unwrap();

    // 兄弟目录(组件级比较,不因前缀字符串相同而误放行)仍拒绝
    let err =
        ensure_file_path_authorized("C:/allowed/root2/a.txt", &authorized).unwrap_err();
    assert!(matches!(err, qraft_lib::AppError::Permission(_)));
}

#[test]
fn authorizes_existing_dropped_paths_and_skips_missing() {
    // 拖放与 dialog 选择同级的授权手势:存在的路径全部授权并返回类型,
    // 不存在的路径静默跳过(Task 9)
    let authorized = AuthorizedPaths::new();
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("a.txt");
    std::fs::write(&file, b"x").unwrap();

    let out = fs_authorize_dropped_paths_inner(
        vec![
            file.to_string_lossy().into_owned(),
            tmp.path().to_string_lossy().into_owned(),
            "Z:/__no_such__/ghost.txt".to_string(),
        ],
        &authorized,
    )
    .unwrap()
    .data
    .unwrap();

    assert_eq!(out.len(), 2);
    assert!(out.iter().any(|d| d.kind == "dir"));
    assert!(out.iter().any(|d| d.kind == "file"));
    assert!(authorized.is_path_allowed(&file.to_string_lossy()));
    assert!(!authorized.is_path_allowed("Z:/__no_such__/ghost.txt"));
}
