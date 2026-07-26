use futures::FutureExt;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use tokio::time::timeout;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::ToolOutput;
use crate::core::registry::ToolRegistry;
use crate::core::tool::{StreamEvent, StreamingTool, Tool, ToolMetadata};
use futures::stream::BoxStream;

/// 工具执行器:提供超时、取消、panic 隔离三重保护
pub struct ToolExecutor {
    registry: &'static ToolRegistry,
    default_timeout: Duration,
}

impl ToolExecutor {
    #[must_use]
    pub const fn new(registry: &'static ToolRegistry) -> Self {
        Self {
            registry,
            default_timeout: Duration::from_secs(5),
        }
    }

    /// 列出所有已注册工具的元数据
    #[must_use]
    pub fn list_tools(&self) -> Vec<ToolMetadata> {
        self.registry.list().iter().map(|m| (*m).clone()).collect()
    }

    /// 按 id 查找工具元数据
    #[must_use]
    pub fn get_tool(&self, id: &str) -> Option<ToolMetadata> {
        self.registry.get(id).map(|e| (*e.metadata).clone())
    }

    /// 启动流式工具执行,返回事件流
    ///
    /// # Errors
    ///
    /// - `ToolError::ToolNotFound`: 工具 ID 未在流式工具注册表中注册
    pub fn execute_stream(
        &self,
        tool_id: &str,
        input: ToolInput,
        ctx: &ToolContext,
    ) -> Result<BoxStream<'static, Result<StreamEvent, ToolError>>, ToolError> {
        use crate::core::registry::StreamingEntry;
        // inventory::iter::<T>() 返回实现 Iterator 的类型
        let mut iter = inventory::iter::<StreamingEntry>();
        let entry = iter
            .find(|e: &&StreamingEntry| e.id == tool_id)
            .ok_or_else(|| ToolError::ToolNotFound(tool_id.to_string()))?;
        // 通过构造函数指针创建流式工具实例
        let tool: Box<dyn StreamingTool> = (entry.ctor)();
        let stream = tool.execute_stream(input, ctx);
        Ok(stream)
    }

    /// 执行指定工具。
    ///
    /// # Errors
    ///
    /// - `ToolError::ToolNotFound`: 工具 ID 未注册
    /// - `ToolError::Timeout`: 执行超过元数据中声明的 `timeout_secs`
    /// - `ToolError::Cancelled`: 外部触发 `CancellationToken` 取消
    /// - `ToolError::Internal`: 工具 panic 或内部异常
    pub async fn execute(
        &self,
        tool_id: &str,
        input: ToolInput,
        ctx: ToolContext,
    ) -> Result<ToolOutput, ToolError> {
        let entry = self
            .registry
            .get(tool_id)
            .ok_or_else(|| ToolError::ToolNotFound(tool_id.to_string()))?;

        // 通过构造函数指针创建工具实例(工具应无状态,每次创建新实例)
        let tool = (entry.ctor)();
        let meta = tool.metadata();
        // timeout_secs 为 u32,需转成 u64 以匹配 Duration::from_secs 的入参类型
        let timeout_dur = meta
            .timeout_secs
            .map_or(self.default_timeout, |s| Duration::from_secs(u64::from(s)));

        self.execute_with_isolation(tool.as_ref(), input, ctx, timeout_dur)
            .await
    }

    /// 三重隔离执行:超时 + 取消 + panic 捕获
    ///
    /// - `timeout`: 工具执行超过 `timeout_dur` 则返回 `ToolError::Timeout`
    /// - `CancellationToken`: 外部触发取消则返回 `ToolError::Cancelled`
    /// - `catch_unwind`: 工具 panic 转为 `ToolError::Internal`,不污染运行时
    async fn execute_with_isolation(
        &self,
        tool: &dyn Tool,
        input: ToolInput,
        ctx: ToolContext,
        timeout_dur: Duration,
    ) -> Result<ToolOutput, ToolError> {
        let cancel = ctx.cancel_token.clone();

        // catch_unwind 包裹工具执行:panic 隔离
        // 使用 async move 确保 input/ctx 被移入异步块(避免借用捕获问题)
        let exec_fut = async move {
            let fut = tool.execute(input, &ctx);
            AssertUnwindSafe(fut).catch_unwind().await.map_err(|p| {
                // 优先按 &str 解析 panic 载荷,其次按 String,最后回退到通用提示
                let msg = p
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_string())
                    .or_else(|| {
                        p.downcast_ref::<String>()
                            .map(std::string::ToString::to_string)
                    })
                    .unwrap_or_else(|| "unknown panic".to_string());
                ToolError::Internal(format!("tool panicked: {msg}"))
            })?
        };

        tokio::select! {
            result = timeout(timeout_dur, exec_fut) => {
                result.unwrap_or(Err(ToolError::Timeout(timeout_dur)))
            }
            () = cancel.cancelled() => {
                Err(ToolError::Cancelled)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde_json::Value;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio_util::sync::CancellationToken;

    use super::ToolExecutor;
    use crate::core::context::{HistoryEntry, HistorySink, ToolContext};
    use crate::core::error::ToolError;
    use crate::core::input::ToolInput;
    use crate::core::output::ToolOutput;
    use crate::core::registry::ToolRegistry;
    use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
    use crate::register_tool;

    const SCHEMA: Value = Value::Null;

    static NORMAL_META: ToolMetadata = ToolMetadata {
        id: "exec_normal_tool",
        name: "Normal",
        category: ToolCategory::Formatter,
        icon: "circle",
        description: "normal test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    static SLOW_META: ToolMetadata = ToolMetadata {
        id: "exec_slow_tool",
        name: "Slow",
        category: ToolCategory::Formatter,
        icon: "clock",
        description: "slow test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(1),
        streaming_supported: false,
    };

    static PANIC_META: ToolMetadata = ToolMetadata {
        id: "exec_panic_tool",
        name: "Panic",
        category: ToolCategory::Formatter,
        icon: "alert",
        description: "panicking test tool",
        input_schema: &SCHEMA,
        output_schema: None,
        tags: &["test"],
        version: "0.1.0",
        timeout_secs: Some(5),
        streaming_supported: false,
    };

    struct NormalTool;
    impl NormalTool {
        fn new() -> Self {
            Self
        }
    }
    #[async_trait]
    impl Tool for NormalTool {
        fn metadata(&self) -> &'static ToolMetadata {
            &NORMAL_META
        }
        async fn execute(
            &self,
            input: ToolInput,
            _: &ToolContext,
        ) -> Result<ToolOutput, ToolError> {
            let text = input.text()?;
            Ok(ToolOutput {
                text: text.to_string(),
                ..Default::default()
            })
        }
    }
    register_tool!(NormalTool, &NORMAL_META);

    struct SlowTool;
    impl SlowTool {
        fn new() -> Self {
            Self
        }
    }
    #[async_trait]
    impl Tool for SlowTool {
        fn metadata(&self) -> &'static ToolMetadata {
            &SLOW_META
        }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok(ToolOutput::default())
        }
    }
    register_tool!(SlowTool, &SLOW_META);

    struct PanicTool;
    impl PanicTool {
        fn new() -> Self {
            Self
        }
    }
    #[async_trait]
    impl Tool for PanicTool {
        fn metadata(&self) -> &'static ToolMetadata {
            &PANIC_META
        }
        async fn execute(&self, _: ToolInput, _: &ToolContext) -> Result<ToolOutput, ToolError> {
            panic!("intentional test panic");
        }
    }
    register_tool!(PanicTool, &PANIC_META);

    fn make_ctx() -> ToolContext {
        ToolContext {
            cancel_token: CancellationToken::new(),
            config: Value::Null,
            history_sink: Arc::new(NoopSink),
        }
    }

    fn make_ctx_with_cancel(cancel: CancellationToken) -> ToolContext {
        ToolContext {
            cancel_token: cancel,
            config: Value::Null,
            history_sink: Arc::new(NoopSink),
        }
    }

    struct NoopSink;
    #[async_trait]
    impl HistorySink for NoopSink {
        async fn write(&self, _: HistoryEntry) -> Result<(), ToolError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_execute_success() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let input = ToolInput {
            text: Some("hello".into()),
            ..Default::default()
        };
        let result = executor
            .execute("exec_normal_tool", input, make_ctx())
            .await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().text, "hello");
    }

    #[tokio::test]
    async fn test_execute_tool_not_found() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor
            .execute("nonexistent_xyz", ToolInput::default(), make_ctx())
            .await;
        assert!(matches!(result, Err(ToolError::ToolNotFound(_))));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor
            .execute("exec_slow_tool", ToolInput::default(), make_ctx())
            .await;
        assert!(matches!(result, Err(ToolError::Timeout(_))));
    }

    #[tokio::test]
    async fn test_execute_cancelled() {
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancel_clone.cancel();
        });
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor
            .execute(
                "exec_slow_tool",
                ToolInput::default(),
                make_ctx_with_cancel(cancel),
            )
            .await;
        assert!(matches!(result, Err(ToolError::Cancelled)));
    }

    #[tokio::test]
    async fn test_execute_panic_isolation() {
        let registry = ToolRegistry::global();
        let executor = ToolExecutor::new(registry);
        let result = executor
            .execute("exec_panic_tool", ToolInput::default(), make_ctx())
            .await;
        match result {
            Err(ToolError::Internal(msg)) => {
                assert!(msg.contains("tool panicked"));
                assert!(msg.contains("intentional test panic"));
            }
            other => panic!("expected ToolError::Internal, got {:?}", other),
        }
    }
}
