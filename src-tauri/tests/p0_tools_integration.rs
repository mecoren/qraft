//! P0 工具集成测试:验证 10 个工具均已被 inventory 收录到 `ToolRegistry`。
//! 这是对子计划 05 整体交付的回归测试,任何工具被误删或未声明 mod 都会被发现。
//!
//! 注:json_minifier 自从改为纯前端工具后不再以 Rust 实现,已从 P0 列表中移除。

use qraft_lib::core::registry::ToolRegistry;

const P0_TOOL_IDS: &[&str] = &[
    "json_formatter",
    "base64_codec",
    "url_codec",
    "jwt_parser",
    "uuid_generator",
    "hash_calculator",
    "timestamp_converter",
    "color_converter",
    "regex_tester",
];

#[test]
fn test_all_p0_tools_registered() {
    let registry = ToolRegistry::global();
    let registered_ids: Vec<&str> = registry.list().iter().map(|m| m.id).collect();

    for tool_id in P0_TOOL_IDS {
        assert!(
            registered_ids.contains(tool_id),
            "missing P0 tool registration: {tool_id}"
        );
    }
}

#[test]
fn test_p0_tool_ids_unique() {
    let registry = ToolRegistry::global();
    let mut ids: Vec<&str> = registry.list().iter().map(|m| m.id).collect();
    ids.sort_unstable();
    let original = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), original, "duplicate tool ids detected");
}

#[test]
fn test_p0_tool_metadata_complete() {
    let registry = ToolRegistry::global();
    for meta in registry.list() {
        assert!(!meta.id.is_empty(), "tool id empty");
        assert!(!meta.name.is_empty(), "tool name empty for {}", meta.id);
        assert!(
            !meta.description.is_empty(),
            "tool description empty for {}",
            meta.id
        );
        assert!(!meta.tags.is_empty(), "tool tags empty for {}", meta.id);
        assert!(
            !meta.version.is_empty(),
            "tool version empty for {}",
            meta.id
        );
    }
}

#[test]
fn test_streaming_tools_marked_correctly() {
    let registry = ToolRegistry::global();
    let streaming_ids: Vec<&str> = registry
        .list()
        .iter()
        .filter(|m| m.streaming_supported)
        .map(|m| m.id)
        .collect();

    // json_formatter 与 hash_calculator 必须声明 streaming_supported = true
    assert!(
        streaming_ids.contains(&"json_formatter"),
        "json_formatter should be streaming"
    );
    assert!(
        streaming_ids.contains(&"hash_calculator"),
        "hash_calculator should be streaming"
    );
}
