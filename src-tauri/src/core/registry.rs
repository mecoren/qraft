use std::collections::HashMap;
use std::sync::OnceLock;

use crate::core::tool::{StreamingTool, Tool, ToolMetadata};

/// 工具注册条目(inventory 收集单元)
///
/// 注意:`inventory::submit!` 要求值可在静态上下文常量求值,
/// 因此存储 `ctor: fn() -> Box<dyn Tool>`(函数指针是 const),
/// 而非 `Box<dyn Tool>`(`Box::new` 不是 const)。
/// 工具按需构造,工具应是无状态的(execute 是纯函数式)。
pub struct ToolEntry {
    pub ctor: fn() -> Box<dyn Tool>,
    pub metadata: &'static ToolMetadata,
}

inventory::collect!(ToolEntry);

/// 全局工具注册表
pub struct ToolRegistry {
    by_id: HashMap<&'static str, &'static ToolEntry>,
}

impl ToolRegistry {
    /// 初始化全局注册表(应用启动时调用一次)
    ///
    /// # Panics
    ///
    /// 重复的工具 ID 属于编译期编程错误,此处 panic 是正确行为(快速失败)。
    #[allow(clippy::panic, clippy::missing_panics_doc)]
    pub fn global() -> &'static Self {
        static REGISTRY: OnceLock<ToolRegistry> = OnceLock::new();
        REGISTRY.get_or_init(|| {
            let mut by_id = HashMap::new();
            for entry in inventory::iter::<ToolEntry> {
                assert!(
                    by_id.insert(entry.metadata.id, entry).is_none(),
                    "duplicate tool id: {}",
                    entry.metadata.id
                );
            }
            Self { by_id }
        })
    }

    /// 按 id 查找工具
    #[must_use]
    pub fn get(&self, id: &str) -> Option<&'static ToolEntry> {
        self.by_id.get(id).copied()
    }

    /// 列出所有工具元数据
    #[must_use]
    pub fn list(&self) -> Vec<&'static ToolMetadata> {
        self.by_id.values().map(|e| e.metadata).collect()
    }
}

/// 流式工具注册条目
pub struct StreamingEntry {
    pub id: &'static str,
    pub ctor: fn() -> Box<dyn StreamingTool>,
}

inventory::collect!(StreamingEntry);

/// 工具自注册宏
///
/// 通过定义一个局部构造函数再取其函数指针,确保 `inventory::submit!`
/// 在静态上下文中可常量求值(`Box::new` 本身不是 const)。
///
/// 使用 `const _: () = { ... };` 包裹,使每次调用定义的 `ctor` 函数
/// 位于独立的匿名作用域,避免同一模块内多次调用导致命名冲突。
#[macro_export]
macro_rules! register_tool {
    ($tool_ty:ty, $metadata:expr) => {
        const _: () = {
            fn ctor() -> Box<dyn $crate::core::tool::Tool> {
                Box::new(<$tool_ty>::new())
            }
            inventory::submit! {
                $crate::core::registry::ToolEntry {
                    ctor,
                    metadata: $metadata,
                }
            }
        };
    };
}

/// 流式工具自注册宏
#[macro_export]
macro_rules! register_stream_tool {
    ($tool_ty:ty, $metadata:expr) => {
        const _: () = {
            fn ctor() -> Box<dyn $crate::core::tool::StreamingTool> {
                Box::new(<$tool_ty>::new())
            }
            inventory::submit! {
                $crate::core::registry::StreamingEntry {
                    id: $metadata.id,
                    ctor,
                }
            }
        };
    };
}

#[cfg(test)]
mod tests {
    use super::ToolRegistry;
    use async_trait::async_trait;
    use serde_json::Value;

    use crate::core::context::ToolContext;
    use crate::core::error::ToolError;
    use crate::core::input::ToolInput;
    use crate::core::output::ToolOutput;
    use crate::core::tool::{Tool, ToolCategory, ToolMetadata};

    const DUMMY_SCHEMA: Value = Value::Null;

    static DUMMY_METADATA: ToolMetadata = ToolMetadata {
        id: "dummy_test_tool",
        name: "Dummy Test Tool",
        category: ToolCategory::Formatter,
        icon: "circle",
        description: "dummy for registry test",
        input_schema: &DUMMY_SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    struct DummyTool;

    impl DummyTool {
        fn new() -> Self {
            Self
        }
    }

    #[async_trait]
    impl Tool for DummyTool {
        fn metadata(&self) -> &'static ToolMetadata {
            &DUMMY_METADATA
        }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            Ok(ToolOutput::default())
        }
    }

    register_tool!(DummyTool, &DUMMY_METADATA);

    #[test]
    fn test_global_registry_singleton() {
        let r1 = ToolRegistry::global();
        let r2 = ToolRegistry::global();
        // 同一静态地址
        assert!(std::ptr::eq(r1, r2));
    }

    #[test]
    fn test_get_found() {
        let registry = ToolRegistry::global();
        let entry = registry.get("dummy_test_tool");
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().metadata.id, "dummy_test_tool");
    }

    #[test]
    fn test_get_not_found() {
        let registry = ToolRegistry::global();
        assert!(registry.get("nonexistent_tool_xyz").is_none());
    }

    #[test]
    fn test_list_contains_dummy() {
        let registry = ToolRegistry::global();
        let list = registry.list();
        assert!(list.iter().any(|m| m.id == "dummy_test_tool"));
    }

    #[test]
    fn test_tool_id_unique() {
        let registry = ToolRegistry::global();
        let list = registry.list();
        let mut ids: Vec<_> = list.iter().map(|m| m.id).collect();
        let original_len = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), original_len, "duplicate tool ids detected");
    }
}
