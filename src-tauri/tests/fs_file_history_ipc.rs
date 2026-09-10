//! 文件本地历史三命令(`fs_file_history_list/get/clear`)的 IPC 契约集成测试
//!
//! 验证对象:`commands::fs` 的 `fs_file_history_*_inner` 纯逻辑层——
//! 前端编辑器「历史版本」对话框的三条 IPC 背后的授权门禁与数据口径:
//! - 路径必须在授权集合中(与读取同一信任级:历史内容源于磁盘旧版),
//!   未授权路径三条命令一律 `ERR_PERMISSION_DENIED`,且不触碰历史数据
//! - list 返回新→旧元数据数组,`fs_file_history_get` 返回 base64,
//!   base64 解回即快照原文(字节级,兼容非 UTF-8)
//! - 快照 id 非法(路径穿越防御:仅纯数字)报 `ERR_FILE_IO`
//! - clear 删除桶目录,之后 list 返回空数组且幂等
//!
//! 为什么放在集成测试而非 `fs.rs` 单测:`commands` 模块在 lib 的
//! `cfg(test)` 构建中被条件编译排除(`lib.rs` 顶部注释:避免测试二进制
//! 链接 `WebView2` 原生 DLL),`fs.rs` 内的 `#[cfg(test)]` 单测不随
//! `cargo test --lib` 运行;集成测试链接非 test 构建,可真实执行
//! (同 `tests/fs_mtime_guard.rs` 的既有模式)。

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use base64::Engine as _;
use qraft_lib::commands::fs::{
    AuthorizedPaths, fs_file_history_clear_inner, fs_file_history_get_inner,
    fs_file_history_list_inner,
};
use qraft_lib::store::file_history::FileHistoryStore;

/// 构造「磁盘有旧内容 + 一条历史快照」的夹具:返回(`history`,`path`,`root`)
///
/// 快照经 `snapshot_before_write` 产生(与真实保存动线同源),
/// 保证元数据(id/字节数)与磁盘快照内容一致。
fn setup_with_snapshot(tag: &str) -> (FileHistoryStore, String, std::path::PathBuf) {
    let history_root = std::env::temp_dir().join(format!("qraft_it_history_ipc_{tag}"));
    let _ = std::fs::remove_dir_all(&history_root);
    let store = FileHistoryStore::new(history_root.clone());

    let path = std::env::temp_dir().join(format!("qraft_it_history_ipc_{tag}.txt"));
    std::fs::write(&path, "v1").unwrap();
    store
        .snapshot_before_write(path.to_str().unwrap(), 2_000)
        .unwrap();
    std::fs::write(&path, "v2").unwrap();

    (store, path.to_string_lossy().into_owned(), history_root)
}

/// 三条命令对未授权路径一律拒绝,且门禁先于数据操作(快照完好)
#[test]
fn history_commands_reject_unauthorized_path() {
    let (history, path, root) = setup_with_snapshot("unauth");

    let denied = AuthorizedPaths::new(); // 空授权集合:路径必不在其中
    let err = fs_file_history_list_inner(&path, &denied, &history).unwrap_err();
    assert_eq!(err.code(), "ERR_PERMISSION_DENIED");
    let err = fs_file_history_get_inner(&path, "2000", &denied, &history).unwrap_err();
    assert_eq!(err.code(), "ERR_PERMISSION_DENIED");
    let err = fs_file_history_clear_inner(&path, &denied, &history).unwrap_err();
    assert_eq!(err.code(), "ERR_PERMISSION_DENIED");

    // 被拒的 clear 未删数据:授权后 list 仍能读到快照
    let allowed = AuthorizedPaths::new();
    allowed.authorize(&path);
    let list = fs_file_history_list_inner(&path, &allowed, &history)
        .unwrap()
        .data
        .unwrap();
    assert_eq!(list.len(), 1, "snapshot must survive denied access");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir_all(&root);
}

/// list → get 往返:list 给出元数据,get 的 base64 解码即快照原文
#[test]
fn list_then_get_roundtrips_snapshot_bytes() {
    let (history, path, root) = setup_with_snapshot("roundtrip");

    let authorized = AuthorizedPaths::new();
    authorized.authorize(&path);

    let list = fs_file_history_list_inner(&path, &authorized, &history)
        .unwrap()
        .data
        .unwrap();
    assert_eq!(list.len(), 1);
    let meta = &list[0];
    assert_eq!(meta.id, "2000");
    assert_eq!(meta.saved_at_ms, 2_000);
    assert_eq!(meta.original_bytes, 2); // "v1"

    let b64 = fs_file_history_get_inner(&path, &meta.id, &authorized, &history)
        .unwrap()
        .data
        .unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .unwrap();
    assert_eq!(String::from_utf8(bytes).unwrap(), "v1");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir_all(&root);
}

/// get 对非法快照 id 报 `ERR_FILE_IO`(id 白名单:仅纯数字,防路径穿越)
#[test]
fn get_rejects_malformed_snapshot_id() {
    let (history, path, root) = setup_with_snapshot("badid");

    let authorized = AuthorizedPaths::new();
    authorized.authorize(&path);

    // "../meta.json" 之类非纯数字 id 一律拒绝,而非拼路径读任意文件;
    // "9999" 是纯数字但不存在,同样按「版本已丢失」报错
    for bad_id in ["", "../meta.json", "2000.exe", "9999"] {
        let err = fs_file_history_get_inner(&path, bad_id, &authorized, &history).unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_IO", "id {bad_id:?}");
    }

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir_all(&root);
}

/// clear 删除全部快照,之后 list 返回空数组(幂等:再 clear 不报错)
#[test]
fn clear_removes_snapshots_then_list_is_empty() {
    let (history, path, root) = setup_with_snapshot("clear");

    let authorized = AuthorizedPaths::new();
    authorized.authorize(&path);

    fs_file_history_clear_inner(&path, &authorized, &history).unwrap();
    let list = fs_file_history_list_inner(&path, &authorized, &history)
        .unwrap()
        .data
        .unwrap();
    assert!(list.is_empty());

    // 幂等:桶目录已不存在,再清一次仍成功
    fs_file_history_clear_inner(&path, &authorized, &history).unwrap();

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir_all(&root);
}
