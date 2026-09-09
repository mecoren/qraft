//! 保存前 mtime 校验集成测试(数据安全闭环:外部修改保护)
//!
//! 验证对象:`commands::fs::fs_write_file_encoded_inner` 的 `expected_mtime`
//! 可选参数——前端编辑器在打开文件时记录 mtime,保存时带上做「乐观并发
//! 控制」:磁盘文件已被外部程序(Git checkout、其它编辑器等)修改时
//! 拒绝写入,返回 `ERR_FILE_MODIFIED` + 磁盘当前 mtime,由前端弹
//! 「覆盖 / 对比 / 重新加载」三选,避免静默覆盖外部改动。
//!
//! 为什么放在集成测试而非 `fs.rs` 单测:`commands` 模块在 lib 的
//! `cfg(test)` 构建中被条件编译排除(`lib.rs` 顶部注释:避免测试二进制
//! 链接 `WebView2` 原生 DLL),`fs.rs` 内的 `#[cfg(test)]` 单测不随
//! `cargo test --lib` 运行;集成测试链接非 test 构建,可真实执行
//! (同 `tests/ipc_authorization.rs` 的既有模式)。

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::SystemTime;

use qraft_lib::commands::fs::{AuthorizedPaths, fs_write_file_encoded_inner};
use qraft_lib::core::error::AppError;

/// 读取文件 mtime(epoch 毫秒);与 `file_mtime_ms` 内部函数同源,
/// 测试侧经 metadata 直接取值,避免测试依赖被测物实现
async fn mtime_ms(path: &str) -> u64 {
    let meta = tokio::fs::metadata(path).await.unwrap();
    u64::try_from(
        meta.modified()
            .unwrap()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

fn temp_file(name: &str, content: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(name);
    std::fs::write(&path, content).unwrap();
    path
}

/// 外部修改后保存:期望 mtime 过时 → 拒绝写入并返回 `ERR_FILE_MODIFIED`
#[tokio::test]
async fn rejects_overwrite_when_file_modified_externally() {
    let path = temp_file("qraft_it_mtime_conflict.txt", "original");
    let path_str = path.to_str().unwrap();

    let authorized = AuthorizedPaths::new();
    authorized.authorize(path_str);

    // 打开时刻记录的 mtime,随后外部程序改写文件
    let opened_mtime = mtime_ms(path_str).await;
    std::fs::write(&path, "externally modified").unwrap();

    let err =
        fs_write_file_encoded_inner(path_str, "mine", "utf-8", Some(opened_mtime), &authorized)
            .await
            .unwrap_err();
    assert_eq!(err.code(), "ERR_FILE_MODIFIED");
    match &err {
        AppError::FileModified { mtime_ms: current } => {
            let current = *current;
            assert!(
                current >= opened_mtime,
                "detail should carry current disk mtime"
            );
        }
        other => panic!("expected FileModified, got {other:?}"),
    }
    // 磁盘内容未被覆盖:外部修改完好保留
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "externally modified"
    );

    let _ = std::fs::remove_file(&path);
}

/// mtime 一致(无人外部修改)→ 正常写入
#[tokio::test]
async fn writes_when_mtime_matches() {
    let path = temp_file("qraft_it_mtime_ok.txt", "original");
    let path_str = path.to_str().unwrap();

    let authorized = AuthorizedPaths::new();
    authorized.authorize(path_str);

    let opened_mtime = mtime_ms(path_str).await;
    let resp =
        fs_write_file_encoded_inner(path_str, "mine", "utf-8", Some(opened_mtime), &authorized)
            .await
            .unwrap();
    assert!(resp.success);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine");

    let _ = std::fs::remove_file(&path);
}

/// 不带 `expected_mtime`(缺省):保持既有调用方语义,直接覆盖
#[tokio::test]
async fn writes_without_expected_mtime_by_default() {
    let path = temp_file("qraft_it_mtime_absent.txt", "original");
    let path_str = path.to_str().unwrap();

    let authorized = AuthorizedPaths::new();
    authorized.authorize(path_str);
    std::fs::write(&path, "externally modified").unwrap();

    let resp = fs_write_file_encoded_inner(path_str, "mine", "utf-8", None, &authorized)
        .await
        .unwrap();
    assert!(resp.success);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine");

    let _ = std::fs::remove_file(&path);
}

/// 文件在打开后被删除:带 `expected_mtime` 保存应报错(而非静默新建空文件)
#[tokio::test]
async fn errors_when_file_deleted_since_open() {
    let path = temp_file("qraft_it_mtime_deleted.txt", "original");
    let path_str = path.to_str().unwrap();

    let authorized = AuthorizedPaths::new();
    authorized.authorize(path_str);

    let opened_mtime = mtime_ms(path_str).await;
    std::fs::remove_file(&path).unwrap();

    let err =
        fs_write_file_encoded_inner(path_str, "mine", "utf-8", Some(opened_mtime), &authorized)
            .await
            .unwrap_err();
    // 文件不存在:io::NotFound → ERR_FILE_IO(不误报为 mtime 冲突)
    assert_eq!(err.code(), "ERR_FILE_IO");

    let _ = std::fs::remove_file(&path);
}

/// 期望 mtime 相同但内容不同无法由 mtime 判定——语义边界:
/// mtime 分辨率不足时(同毫秒内外部写入),校验放行属已知边界,
/// 起步档以「尽最大努力检测」为准(与 `VSCode` 轻量方案一致)。
#[tokio::test]
async fn same_mtime_writes_treated_as_unmodified() {
    let path = temp_file("qraft_it_mtime_same.txt", "original");
    let path_str = path.to_str().unwrap();

    let authorized = AuthorizedPaths::new();
    authorized.authorize(path_str);

    let opened_mtime = mtime_ms(path_str).await;
    let resp =
        fs_write_file_encoded_inner(path_str, "mine", "utf-8", Some(opened_mtime), &authorized)
            .await
            .unwrap();
    assert!(resp.success);

    let _ = std::fs::remove_file(&path);
}
