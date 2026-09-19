//! 字节保存路径(`fs_save_bytes` / `fs_save_bytes_to_path`)的原子写集成测试
//!
//! 验证对象:`commands::fs::save_bytes_to_path` —— 另存为 / PDF 与 Office 写回
//! 都经它落盘,目标文件可能已存在(覆盖保存),故走 `media::fs_write` 的
//! 临时文件 + rename 替换,而不是就地截断写。
//!
//! 为什么放在集成测试:`commands` 模块在 lib 的 `cfg(test)` 构建里被条件编译
//! 排除,`fs.rs` 内的 `#[cfg(test)]` 单测不随 `cargo test --lib` 运行;集成测试
//! 链接非 test 构建才能真实执行(同 `tests/fs_mtime_guard.rs` 的既有模式)。

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use qraft_lib::commands::fs::save_bytes_to_path;

/// 目标同目录内残留的原子写临时文件数(前缀 `.…qraft-tmp-`)
fn temp_residue(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(std::result::Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".qraft-tmp-"))
        .collect()
}

/// 新建与覆盖写都落到目标内容,且用户目录不留临时文件
#[tokio::test]
async fn byte_save_replaces_content_without_temp_residue() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("payload.bin");
    let path_str = path.to_str().unwrap();

    // 首次创建:目标此前不存在
    save_bytes_to_path(path_str, &[0x00, 0x01, 0x02, 0xFF])
        .await
        .expect("create should succeed");
    assert_eq!(std::fs::read(&path).unwrap(), vec![0x00, 0x01, 0x02, 0xFF]);
    assert!(temp_residue(dir.path()).is_empty());

    // 覆盖保存:旧内容整份被替换,不留半截也不留临时文件
    save_bytes_to_path(path_str, b"second-version")
        .await
        .expect("overwrite should succeed");
    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"second-version".to_vec(),
        "覆盖写应完整替换旧内容"
    );
    assert!(temp_residue(dir.path()).is_empty());
}

/// 写入失败(父目录不存在)时回传 `ERR_FILE_IO`,且不凭空造出目标文件
#[tokio::test]
async fn byte_save_failure_leaves_no_target() {
    let dir = tempfile::tempdir().unwrap();
    let missing_parent = dir.path().join("no-such-dir");
    let path = missing_parent.join("x.bin");

    let err = save_bytes_to_path(path.to_str().unwrap(), b"x")
        .await
        .unwrap_err();
    assert_eq!(err.code(), "ERR_FILE_IO");
    assert!(!path.exists(), "失败不应创建目标文件");
    assert!(temp_residue(dir.path()).is_empty());
}
