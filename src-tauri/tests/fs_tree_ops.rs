//! 文件树三操作(新建 / 重命名 / 删除)集成测试
//!
//! 验证对象:`commands::fs::{fs_create_entry_inner, fs_rename_entry_inner,
//! fs_delete_entry_inner}` 的授权沙箱与冲突语义:
//! - 全部操作仅对已授权路径(精确授权或授权目录子树)生效
//! - 新建 / 重命名命中已存在目标时返回 `ERR_ALREADY_EXISTS`,绝不覆盖
//! - 删除非空目录拒绝(`ERR_FILE_UNSUPPORTED`),不做递归删除
//!
//! 为什么放在集成测试而非 `fs.rs` 单测:`commands` 模块在 lib 的
//! `cfg(test)` 构建中被条件编译排除(`lib.rs` 顶部注释:避免测试二进制
//! 链接 `WebView2` 原生 DLL),`fs.rs` 内的 `#[cfg(test)]` 单测不随
//! `cargo test --lib` 运行;集成测试链接非 test 构建,可真实执行
//! (同 `tests/fs_mtime_guard.rs` 的既有模式)。

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use qraft_lib::commands::fs::{
    AuthorizedPaths, fs_create_entry_inner, fs_delete_entry_inner, fs_rename_entry_inner,
};

#[tokio::test]
async fn tree_ops_create_rename_delete_roundtrip() {
    let dir = std::env::temp_dir().join("qraft_test_tree_ops");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let root = dir.to_string_lossy().into_owned();

    let paths = AuthorizedPaths::new();
    paths.authorize(&root);

    // 新建文件
    let file_path = format!("{root}/note.txt");
    let created = fs_create_entry_inner(&file_path, false, &paths)
        .await
        .unwrap();
    assert!(created.success);
    assert_eq!(created.data.unwrap(), file_path);
    // 重复新建同名文件 → ERR_ALREADY_EXISTS(不覆盖)
    let dup = fs_create_entry_inner(&file_path, false, &paths)
        .await
        .unwrap_err();
    assert_eq!(dup.code(), "ERR_ALREADY_EXISTS");

    // 新建目录 + 目录内新建文件(授权子树内)
    let sub = format!("{root}/sub");
    assert!(
        fs_create_entry_inner(&sub, true, &paths)
            .await
            .unwrap()
            .success
    );
    let inner = format!("{sub}/inner.md");
    assert!(
        fs_create_entry_inner(&inner, false, &paths)
            .await
            .unwrap()
            .success
    );

    // 重命名:文件(同目录)与目录(整棵子树随移)
    let renamed = format!("{root}/note-renamed.txt");
    let r = fs_rename_entry_inner(&file_path, &renamed, &paths)
        .await
        .unwrap();
    assert_eq!(r.data.unwrap(), renamed);
    let sub_renamed = format!("{root}/sub2");
    assert!(
        fs_rename_entry_inner(&sub, &sub_renamed, &paths)
            .await
            .unwrap()
            .success
    );
    // 原路径已随 rename 失效:对其再操作报 IO 错误
    assert!(
        fs_delete_entry_inner(&inner, &paths)
            .await
            .unwrap_err()
            .code()
            == "ERR_FILE_IO"
    );
    // rename 到已存在目标 → ERR_ALREADY_EXISTS
    for name in ["a.txt", "b.txt"] {
        assert!(
            fs_create_entry_inner(&format!("{root}/{name}"), false, &paths)
                .await
                .unwrap()
                .success
        );
    }
    let clash = fs_rename_entry_inner(&format!("{root}/a.txt"), &format!("{root}/b.txt"), &paths)
        .await
        .unwrap_err();
    assert_eq!(clash.code(), "ERR_ALREADY_EXISTS");

    // 删除:非空目录拒绝;清空后可删
    let occupied = fs_delete_entry_inner(&sub_renamed, &paths)
        .await
        .unwrap_err();
    assert_eq!(occupied.code(), "ERR_FILE_UNSUPPORTED");
    assert!(
        fs_delete_entry_inner(&format!("{sub_renamed}/inner.md"), &paths)
            .await
            .unwrap()
            .success
    );
    assert!(
        fs_delete_entry_inner(&sub_renamed, &paths)
            .await
            .unwrap()
            .success
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn tree_ops_reject_unauthorized_paths() {
    let paths = AuthorizedPaths::new();
    paths.authorize(r"C:\work\project");

    // 新建 / 重命名 / 删除 未授权路径一律拒绝
    assert_eq!(
        fs_create_entry_inner("/tmp/newfile.txt", false, &paths)
            .await
            .unwrap_err()
            .code(),
        "ERR_PERMISSION_DENIED"
    );
    assert_eq!(
        fs_rename_entry_inner("/tmp/a.txt", "/tmp/b.txt", &paths)
            .await
            .unwrap_err()
            .code(),
        "ERR_PERMISSION_DENIED"
    );
    assert_eq!(
        fs_delete_entry_inner("/tmp/a.txt", &paths)
            .await
            .unwrap_err()
            .code(),
        "ERR_PERMISSION_DENIED"
    );
    // rename 把条目移出沙箱(目标未授权)同样拒绝
    assert_eq!(
        fs_rename_entry_inner(r"C:\work\project\a.txt", r"C:\work\elsewhere.txt", &paths)
            .await
            .unwrap_err()
            .code(),
        "ERR_PERMISSION_DENIED"
    );
}
