# 05 - P0 工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 10 个 P0 工具的完整功能——每个工具包含 Rust 实现(Tool trait)、React UI 组件、单元测试,覆盖 JSON/Base64/JWT/UUID/Hash/Timestamp/Color/Regex/URL 等高频开发场景。

**Architecture:** 每个工具是 Rust Core 中的一个独立模块(实现 Tool trait),通过 inventory 编译期注册。前端每个工具有独立的 React 组件,通过 useTool hook 调用后端。工具间无耦合(jwt_parser 内部可复用 base64 逻辑,但不通过 ToolRegistry 调用,而是直接调用 base64 crate)。

**Tech Stack:** Rust + serde_json + base64 + url + jsonwebtoken + uuid + sha2 + sha3 + blake3 + md-5 + chrono + regex + hex + React 19 + shadcn/ui + react-hook-form + zod

**Depends on:** 02-rust-core-engine.md(Tool trait、ToolRegistry)、03-tauri-shell-layer.md(IPC Command)、04-react-ui-scaffold.md(ToolPanel、useTool hook)

---

## 总览

本子计划交付 10 个 P0 工具,共 12 个 Task:

| Task | 内容 | 步骤数 | 测试数(Rust/React) |
|------|------|--------|----------------------|
| Task 1 | UI 工具注册中心 `src/tools/registry.ts` | 7 | 0/3 |
| Task 2 | json_formatter(含 StreamingTool) | 16 | 9/3 |
| Task 3 | json_minifier | 13 | 6/3 |
| Task 4 | base64_codec | 13 | 7/3 |
| Task 5 | url_codec | 13 | 7/3 |
| Task 6 | jwt_parser | 13 | 7/3 |
| Task 7 | uuid_generator | 13 | 8/3 |
| Task 8 | hash_calculator(含 StreamingTool) | 16 | 9/3 |
| Task 9 | timestamp_converter | 13 | 9/3 |
| Task 10 | color_converter | 13 | 9/3 |
| Task 11 | regex_tester | 13 | 8/3 |
| Task 12 | 集成验证 | 8 | 4/2 |
| **合计** | | **~155** | **83 Rust + 32 React** |

### 关键约定

1. **TDD 5 步循环**:每个工具的 Rust 与 React 实现均遵循"写失败测试 → 验证失败 → 写实现 → 验证通过 → 提交"
2. **流式工具**:json_formatter(Task 2)与 hash_calculator(Task 8)额外实现 `StreamingTool` trait 并调用 `register_stream_tool!` 宏
3. **文件路径**:Rust 文件位于 `src-tauri/src/tools/<id>.rs`,React 组件位于 `src/tools/<PascalName>.tsx`
4. **错误码**:严格遵循 07-tool-catalog.md 中每个工具的 `errors` 字段
5. **测试覆盖**:每个工具至少 5 个 Rust 单元测试(覆盖正常/边界/错误/参数变体) + 3 个 React 测试(渲染/交互/错误显示)

### 前置依赖确认

执行本计划前,以下文件/接口必须已存在(由 02/03/04 子计划交付):

- `src-tauri/src/core/tool.rs` — `Tool`、`StreamingTool`、`ToolMetadata`、`ToolCategory`、`StreamEvent`
- `src-tauri/src/core/input.rs` — `ToolInput`(`text`/`file_path`/`params`)
- `src-tauri/src/core/output.rs` — `ToolOutput`(`text`/`extra`/`meta`/`alerts`)
- `src-tauri/src/core/error.rs` — `ToolError`(`InvalidInput`/`ParseFailed`/`Timeout`/`Cancelled`/`InputTooLarge`/`ToolNotFound`/`OutOfMemory`/`Internal`)
- `src-tauri/src/core/context.rs` — `ToolContext`、`HistorySink`
- `src-tauri/src/core/registry.rs` — `register_tool!`、`register_stream_tool!`、`ToolRegistry`
- `src-tauri/src/core/test_utils.rs` — `mock_context()`
- `src-tauri/src/tools/mod.rs` — 已声明(初始为空)
- `src/lib/ipc.ts` — `invokeCommand`、`CommandError`
- `src/hooks/useTool.ts` — `useTool(toolId)` hook
- `src/types/tool.ts` — `ToolInput`、`ToolOutput`、`ToolMetadata` TS 类型
- `src/components/ui/` — shadcn 组件(Button、Textarea、Select、Switch、Input、Label、ScrollArea、Tabs)

### Cargo.toml 新增依赖

在执行 Task 前先在 `src-tauri/Cargo.toml` 的 `[dependencies]` 添加:

```toml
# 工具实现依赖
base64 = "0.22"
url = "2.5"
jsonwebtoken = "9.3"
uuid = { version = "1.10", features = ["v4", "v7"] }
sha2 = "0.10"
sha3 = "0.10"
blake3 = "1.5"
md-5 = "0.10"
hex = "0.4"
chrono = { version = "0.4", features = ["serde"] }
regex = "1.10"
percent-encoding = "2.3"
```

### package.json 新增依赖

```bash
pnpm add react-hook-form zod @hookform/resolvers
```

---

## Task 1: 工具注册中心 — `src/tools/registry.ts`

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/tools/registry.test.ts`

- [ ] **Step 1.1: 写失败测试 — 空注册表与注册后获取**

Create `src/tools/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getToolComponent, registerTool, clearRegistry, type ToolProps } from './registry';
import type { ToolMetadata } from '@/types/tool';

describe('ToolRegistry (UI)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('returns null for unknown tool id', () => {
    expect(getToolComponent('unknown')).toBeNull();
  });

  it('returns registered component by tool id', () => {
    const Stub = () => <div>stub</div>;
    const meta: ToolMetadata = {
      id: 'stub',
      name: 'Stub',
      category: 'formatter',
      icon: 'braces',
      description: 'stub',
      input_schema: {},
      tags: ['stub'],
      version: '1.0.0',
      timeout_secs: null,
      streaming_supported: false,
    };
    registerTool('stub', Stub);
    const Comp = getToolComponent('stub');
    expect(Comp).toBe(Stub);
  });

  it('registerTool overwrites previous registration silently', () => {
    const A = () => <div>a</div>;
    const B = () => <div>b</div>;
    registerTool('over', A);
    registerTool('over', B);
    expect(getToolComponent('over')).toBe(B);
  });
});
```

- [ ] **Step 1.2: 运行测试验证失败**

Run: `pnpm test -- src/tools/registry.test.ts`
Expected: FAIL with "Cannot find module './registry'" 或 "getToolComponent is not a function"

- [ ] **Step 1.3: 写最小实现**

Create `src/tools/registry.ts`:

```typescript
import type { ComponentType } from 'react';
import type { ToolMetadata } from '@/types/tool';

/**
 * 工具 UI 组件的 props 契约。
 * 由 ToolPanel 在挂载工具组件时注入。
 */
export interface ToolProps {
  toolId: string;
  metadata: ToolMetadata;
}

type ToolComponent = ComponentType<ToolProps>;

// 全局 UI 工具注册表:toolId → React 组件。
// 与 Rust 端的 ToolRegistry 不同,这里只负责 UI 组件查找。
const REGISTRY = new Map<string, ToolComponent>();

/**
 * 注册工具 UI 组件。每个工具模块在文件末尾调用一次。
 * @param toolId 与 Rust 端 ToolMetadata.id 严格一致
 * @param component 渲染该工具界面的 React 组件
 */
export function registerTool(toolId: string, component: ToolComponent): void {
  REGISTRY.set(toolId, component);
}

/**
 * 按 toolId 查找已注册的 UI 组件。
 * @returns 找不到时返回 null,由 ToolPanel 回退到默认提示
 */
export function getToolComponent(toolId: string): ToolComponent | null {
  return REGISTRY.get(toolId) ?? null;
}

/**
 * 清空注册表(仅测试用,避免用例间污染)。
 */
export function clearRegistry(): void {
  REGISTRY.clear();
}
```

- [ ] **Step 1.4: 运行测试验证通过**

Run: `pnpm test -- src/tools/registry.test.ts`
Expected: PASS,3 个用例全部通过

- [ ] **Step 1.5: 类型检查与 lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: 无错误

- [ ] **Step 1.6: 提交**

```bash
git add src/tools/registry.ts src/tools/registry.test.ts
git commit -m "feat(ui): add tool registry for toolId → React component mapping"
```

- [ ] **Step 1.7: 验证 Task 1 完成**

确认:
- `src/tools/registry.ts` 存在且导出 `registerTool`、`getToolComponent`、`clearRegistry`、`ToolProps`
- `src/tools/registry.test.ts` 3 个测试通过

---

## Task 2: json_formatter

**Files:**
- Create: `src-tauri/src/tools/json_formatter.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/JsonFormatter.tsx`
- Create: `src/tools/JsonFormatter.test.tsx`
- Modify: `src/tools/registry.ts`(末尾注册)

**PRD 规格(07-tool-catalog.md):**
- params: `indent` (integer, 0-8, default 2)、`sort_keys` (bool, default false)
- errors: `ERR_INVALID_INPUT`、`ERR_PARSE_FAILED`、`ERR_INPUT_TOO_LARGE`
- streaming: true
- timeout_secs: 10

- [ ] **Step 2.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/json_formatter.rs`:

```rust
use async_trait::async_trait;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;
use crate::register_stream_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024; // 10MB

pub struct JsonFormatter;

impl JsonFormatter {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JsonFormatter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }

        let indent: u32 = input.param("indent").unwrap_or(2);
        let sort_keys: bool = input.param("sort_keys").unwrap_or(false);

        let start = Instant::now();
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| ToolError::ParseFailed(e.to_string()))?;

        let final_value = if sort_keys { sort_value(value) } else { value };

        let indent_str = " ".repeat(indent as usize);
        let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes());
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
        serde::Serialize::serialize(&final_value, &mut ser)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let out_text = String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?;
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

/// 递归对 JSON 对象的键做字典序排序,保持数组顺序与基本类型不变。
fn sort_value(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(mut map) => {
            let mut pairs: Vec<(String, Value)> = map.into_iter().collect();
            pairs.sort_by(|a, b| a.0.cmp(&b.0));
            let sorted: serde_json::Map<String, Value> = pairs.into_iter().collect();
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_value).collect()),
        other => other,
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "json_formatter",
    name: "JSON Formatter",
    category: ToolCategory::Formatter,
    icon: "braces",
    description: "Format, validate and pretty-print JSON with configurable indent and key sorting",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["json", "format", "validate", "pretty"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: true,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "JSON text to format" },
        "params": {
            "type": "object",
            "properties": {
                "indent": { "type": "integer", "default": 2, "minimum": 0, "maximum": 8 },
                "sort_keys": { "type": "boolean", "default": false }
            }
        }
    },
    "required": ["text"]
});

register_tool!(JsonFormatter, &METADATA);
register_stream_tool!(JsonFormatter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    fn make_input_with_params(text: &str, params: HashMap<String, serde_json::Value>) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_format_simple_json_default_indent() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n  \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_custom_indent_4() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(4));
        let input = make_input_with_params(r#"{"a":1}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{\n    \"a\": 1\n}");
    }

    #[tokio::test]
    async fn test_format_with_indent_0() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("indent".to_string(), json!(0));
        let input = make_input_with_params(r#"{"a":1,"b":2}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // indent=0 时 PrettyFormatter 仍会保留换行但无缩进
        assert!(output.text.contains("\"a\": 1"));
        assert!(!output.text.contains("    \"a\""));
    }

    #[tokio::test]
    async fn test_format_empty_object() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("{}");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{}");
    }

    #[tokio::test]
    async fn test_format_empty_array() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input("[]");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "[]");
    }

    #[tokio::test]
    async fn test_format_with_sort_keys_true() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("sort_keys".to_string(), json!(true));
        let input = make_input_with_params(r#"{"b":1,"a":2,"c":3}"#, params);

        let output = tool.execute(input, &ctx).await.unwrap();

        // 排序后 a 应在 b 之前
        let a_pos = output.text.find("\"a\"").unwrap();
        let b_pos = output.text.find("\"b\"").unwrap();
        assert!(a_pos < b_pos);
    }

    #[tokio::test]
    async fn test_format_invalid_json_returns_parse_failed() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{invalid}"#);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_format_input_too_large() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_format_includes_meta() {
        let tool = JsonFormatter::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        let meta = output.meta.expect("meta should be set");
        assert_eq!(meta.input_bytes, 9);
        assert!(meta.output_bytes > 0);
    }
}
```

- [ ] **Step 2.2: 运行测试验证失败**

Run: `cargo test -p qraft json_formatter -- --nocapture`
Expected: 编译失败,提示 `cannot find module` —— 因为 `tools/mod.rs` 尚未声明 `json_formatter`

- [ ] **Step 2.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,添加:

```rust
pub mod json_formatter;
```

- [ ] **Step 2.4: 运行测试验证通过**

Run: `cargo test -p qraft json_formatter -- --nocapture`
Expected: PASS,9 个测试全部通过

- [ ] **Step 2.5: 实现 StreamingTool**

在 `src-tauri/src/tools/json_formatter.rs` 文件末尾(`register_stream_tool!` 之后、`#[cfg(test)]` 之前)追加流式实现:

```rust
use crate::core::tool::{StreamingTool, StreamEvent};
use futures::stream::BoxStream;
use futures::StreamExt;

#[async_trait]
impl StreamingTool for JsonFormatter {
    /// 流式格式化:对超大 JSON(>10MB)按缓冲块解析。
    /// 当前实现采用"分块读取 + 一次性 serde_json 解析"的折中方案:
    ///  - 大输入无法整体放入 ToolInput.text(会被 InputTooLarge 拦截),故走 file_path 路径
    ///  - 这里读取文件、逐块进度回传、最终一次性序列化
    fn execute_stream(
        &self,
        input: ToolInput,
        _ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>> {
        let tool = JsonFormatter::new();
        Box::pin(async_stream::stream! {
            let file_path = match input.file_path.as_deref() {
                Some(p) => p.to_string(),
                None => {
                    yield Err(ToolError::InvalidInput(
                        "streaming requires file_path".to_string(),
                    ));
                    return;
                }
            };

            yield Ok(StreamEvent::Progress {
                percent: 10,
                message: "Reading file...".to_string(),
            });

            let bytes = match tokio::fs::read(&file_path).await {
                Ok(b) => b,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("read file failed: {}", e)));
                    return;
                }
            };

            yield Ok(StreamEvent::Progress {
                percent: 50,
                message: format!("Read {} bytes, parsing...", bytes.len()),
            });

            let text = match String::from_utf8(bytes) {
                Ok(t) => t,
                Err(e) => {
                    yield Err(ToolError::ParseFailed(format!("utf8 decode failed: {}", e)));
                    return;
                }
            };

            let mut new_input = input.clone();
            new_input.text = Some(text);
            new_input.file_path = None;

            // 复用同步 execute 的核心逻辑,绕过 InputTooLarge(流式不受 10MB 限制)
            let result = format_internal(&new_input).await;
            match result {
                Ok(output) => {
                    yield Ok(StreamEvent::Progress {
                        percent: 90,
                        message: "Formatted.".to_string(),
                    });
                    yield Ok(StreamEvent::Done { output });
                }
                Err(e) => yield Err(e),
            }
        })
    }
}

/// 流式路径专用的格式化函数,不做 InputTooLarge 检查。
async fn format_internal(input: &ToolInput) -> Result<ToolOutput, ToolError> {
    let text = input.text()?;
    let indent: u32 = input.param("indent").unwrap_or(2);
    let sort_keys: bool = input.param("sort_keys").unwrap_or(false);

    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ToolError::ParseFailed(e.to_string()))?;
    let final_value = if sort_keys { sort_value(value) } else { value };

    let indent_str = " ".repeat(indent as usize);
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes());
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    serde::Serialize::serialize(&final_value, &mut ser)
        .map_err(|e| ToolError::Internal(e.to_string()))?;
    let out_text = String::from_utf8(buf).map_err(|e| ToolError::Internal(e.to_string()))?;

    Ok(ToolOutput {
        text: out_text,
        extra: None,
        meta: Some(OutputMeta {
            duration_ms: 0,
            input_bytes: text.len(),
            output_bytes: 0,
        }),
        alerts: Vec::new(),
    })
}
```

- [ ] **Step 2.6: 运行流式测试 + clippy**

Run: `cargo test -p qraft json_formatter -- --nocapture && cargo clippy -p qraft -- -D warnings`
Expected: 全部通过,无 warning

- [ ] **Step 2.7: 提交 Rust 实现**

```bash
git add src-tauri/src/tools/json_formatter.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:json_formatter): add Tool + StreamingTool implementation with 9 unit tests"
```

- [ ] **Step 2.8: 写失败 React 测试**

Create `src/tools/JsonFormatter.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JsonFormatter } from './JsonFormatter';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('JsonFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input textarea, indent select and format button', () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/paste json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /format/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with indent=2 by default on format click', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: '{\n  "a": 1\n}',
      meta: { input_bytes: 9, output_bytes: 13, duration_ms: 1 },
    });

    render(<JsonFormatter toolId="json_formatter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /format/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_formatter',
        input: { text: '{"a":1}', params: { indent: 2, sort_keys: false } },
      });
    });
  });

  it('displays error message when invoke fails with ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'unexpected token at position 1')
    );

    render(<JsonFormatter toolId="json_formatter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{invalid}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /format/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
      expect(screen.getByText(/unexpected token/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2.9: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/JsonFormatter.test.tsx`
Expected: FAIL with "Cannot find module './JsonFormatter'"

- [ ] **Step 2.10: 写 React 组件实现**

Create `src/tools/JsonFormatter.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface JsonFormatterParams {
  indent: number;
  sort_keys: boolean;
}

export function JsonFormatter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [indent, setIndent] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFormat() {
    setLoading(true);
    setError(null);
    try {
      const params: JsonFormatterParams = { indent, sort_keys: sortKeys };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>Input JSON</Label>
        <Textarea
          placeholder="Paste JSON here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="indent-select" className="text-xs">
              Indent
            </Label>
            <Select value={String(indent)} onValueChange={(v) => setIndent(Number(v))}>
              <SelectTrigger id="indent-select" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="sort-keys"
              checked={sortKeys}
              onCheckedChange={setSortKeys}
            />
            <Label htmlFor="sort-keys" className="text-xs">
              Sort keys
            </Label>
          </div>
          <Button onClick={handleFormat} disabled={loading || !text}>
            {loading ? 'Formatting...' : 'Format'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Output</Label>
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} → {output.meta.output_bytes} bytes ·{' '}
              {output.meta.duration_ms}ms
            </span>
          )}
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.11: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,在文件末尾的 `clearRegistry` 函数定义之后追加:

```typescript

// —— 工具注册(每个工具模块在此 register)——
import { JsonFormatter } from './JsonFormatter';
registerTool('json_formatter', JsonFormatter);
```

- [ ] **Step 2.12: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/JsonFormatter.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 2.13: lint + 类型检查**

Run: `pnpm lint && pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 2.14: 提交 React 实现**

```bash
git add src/tools/JsonFormatter.tsx src/tools/JsonFormatter.test.tsx src/tools/registry.ts
git commit -m "feat(tool:json_formatter): add React UI with indent/sort controls and error display"
```

- [ ] **Step 2.15: 集成冒烟**

Run: `pnpm tauri dev`
- 在 SideNav 点击 "JSON Formatter"
- 输入 `{"b":1,"a":2}`,indent=2,sort_keys=on
- 点 Format,确认输出按键名排序

- [ ] **Step 2.16: 验证 Task 2 完成**

确认:
- `src-tauri/src/tools/json_formatter.rs` 含 `Tool` + `StreamingTool` 实现,9 个 Rust 测试通过
- `src/tools/JsonFormatter.tsx` 渲染输入/输出/参数控件,3 个 React 测试通过
- `registry.ts` 已注册 `json_formatter`

---

## Task 3: json_minifier

**Files:**
- Create: `src-tauri/src/tools/json_minifier.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/JsonMinifier.tsx`
- Create: `src/tools/JsonMinifier.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** 无参数;输出 `text` 为压缩后 JSON;errors: `ERR_INVALID_INPUT`、`ERR_PARSE_FAILED`

- [ ] **Step 3.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/json_minifier.rs`:

```rust
use async_trait::async_trait;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024;

pub struct JsonMinifier;

impl JsonMinifier {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JsonMinifier {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }

        let start = Instant::now();
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| ToolError::ParseFailed(e.to_string()))?;

        let out_text = serde_json::to_string(&value)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "json_minifier",
    name: "JSON Minifier",
    category: ToolCategory::Formatter,
    icon: "minimize-2",
    description: "Minify JSON by removing whitespace",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["json", "minify", "compress"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "JSON text to minify" }
    },
    "required": ["text"]
});

register_tool!(JsonMinifier, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn test_minify_pretty_json() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("{\n  \"a\": 1,\n  \"b\": 2\n}");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, r#"{"a":1,"b":2}"#);
    }

    #[tokio::test]
    async fn test_minify_already_minified() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input(r#"{"a":1}"#);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, r#"{"a":1}"#);
    }

    #[tokio::test]
    async fn test_minify_empty_object() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("{ }");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "{}");
    }

    #[tokio::test]
    async fn test_minify_nested_array() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input("[\n  1,\n  2,\n  [3, 4]\n]");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "[1,2,[3,4]]");
    }

    #[tokio::test]
    async fn test_minify_invalid_json_returns_parse_failed() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let input = make_input(r#"{invalid}"#);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_minify_input_too_large() {
        let tool = JsonMinifier::new();
        let ctx = mock_context();
        let large = " ".repeat(MAX_INPUT_BYTES + 1);
        let input = make_input(&large);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }
}
```

- [ ] **Step 3.2: 运行测试验证失败**

Run: `cargo test -p qraft json_minifier -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 3.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod json_minifier;
```

- [ ] **Step 3.4: 运行测试验证通过**

Run: `cargo test -p qraft json_minifier -- --nocapture`
Expected: PASS,6 个测试通过

- [ ] **Step 3.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/json_minifier.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:json_minifier): add Tool implementation with 6 unit tests"
```

- [ ] **Step 3.6: 写失败 React 测试**

Create `src/tools/JsonMinifier.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JsonMinifier } from './JsonMinifier';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('JsonMinifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input textarea and minify button', () => {
    render(<JsonMinifier toolId="json_minifier" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/paste json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minify/i })).toBeInTheDocument();
  });

  it('calls tool_execute with text on minify click', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: '{"a":1,"b":2}',
      meta: { input_bytes: 20, output_bytes: 13, duration_ms: 0 },
    });

    render(<JsonMinifier toolId="json_minifier" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{\n  "a": 1,\n  "b": 2\n}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /minify/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'json_minifier',
        input: { text: '{\n  "a": 1,\n  "b": 2\n}', params: {} },
      });
    });
  });

  it('shows error alert on ParseFailed', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'trailing characters')
    );

    render(<JsonMinifier toolId="json_minifier" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste json/i), {
      target: { value: '{bad}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /minify/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/JsonMinifier.test.tsx`
Expected: FAIL,"Cannot find module './JsonMinifier'"

- [ ] **Step 3.8: 写 React 组件**

Create `src/tools/JsonMinifier.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

export function JsonMinifier({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleMinify() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params: {} },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>Input JSON</Label>
        <Textarea
          placeholder="Paste JSON here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <Button onClick={handleMinify} disabled={loading || !text}>
          {loading ? 'Minifying...' : 'Minify'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Output</Label>
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} → {output.meta.output_bytes} bytes ·{' '}
              {output.meta.duration_ms}ms
            </span>
          )}
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,在末尾追加:

```typescript
import { JsonMinifier } from './JsonMinifier';
registerTool('json_minifier', JsonMinifier);
```

- [ ] **Step 3.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/JsonMinifier.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 3.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/JsonMinifier.tsx src/tools/JsonMinifier.test.tsx src/tools/registry.ts
git commit -m "feat(tool:json_minifier): add React UI with error display"
```

- [ ] **Step 3.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "JSON Minifier",输入 `{ "a": 1 }`,点 Minify,确认输出 `{"a":1}`

- [ ] **Step 3.13: 验证 Task 3 完成**

确认:`json_minifier.rs` 6 个 Rust 测试、`JsonMinifier.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 4: base64_codec

**Files:**
- Create: `src-tauri/src/tools/base64_codec.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/Base64Codec.tsx`
- Create: `src/tools/Base64Codec.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** params: `action` (encode/decode, required)、`url_safe` (bool, default false);errors: `ERR_INVALID_INPUT`、`ERR_PARSE_FAILED`

- [ ] **Step 4.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/base64_codec.rs`:

```rust
use async_trait::async_trait;
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct Base64Codec;

impl Base64Codec {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for Base64Codec {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let action: String = input.param("action")?;
        let url_safe: bool = input.param("url_safe").unwrap_or(false);

        let start = Instant::now();
        let input_bytes = text.len();
        let out_text = match action.as_str() {
            "encode" => {
                let engine = if url_safe { &URL_SAFE } else { &STANDARD };
                engine.encode(text.as_bytes())
            }
            "decode" => {
                let engine = if url_safe { &URL_SAFE } else { &STANDARD };
                let bytes = engine
                    .decode(text.as_bytes())
                    .map_err(|e| ToolError::ParseFailed(e.to_string()))?;
                String::from_utf8(bytes)
                    .map_err(|e| ToolError::ParseFailed(format!("decoded bytes are not utf8: {}", e)))?
            }
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "action must be 'encode' or 'decode', got '{}'",
                    other
                )))
            }
        };
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "base64_codec",
    name: "Base64 Codec",
    category: ToolCategory::Encoder,
    icon: "binary",
    description: "Encode or decode Base64 (standard or URL-safe)",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["base64", "encode", "decode", "url-safe"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "Text to encode/decode" },
        "params": {
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["encode", "decode"], "default": "encode" },
                "url_safe": { "type": "boolean", "default": false }
            },
            "required": ["action"]
        }
    },
    "required": ["text", "params"]
});

register_tool!(Base64Codec, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str, action: &str, url_safe: bool) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("action".to_string(), json!(action));
        params.insert("url_safe".to_string(), json!(url_safe));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_encode_standard() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("hello", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "aGVsbG8=");
    }

    #[tokio::test]
    async fn test_encode_url_safe() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 包含字节 0xFB → 标准 base64 含 '+',URL-safe 含 '-'
        let input = make_input("\u{fb}", "encode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert!(output.text.contains('-'));
        assert!(!output.text.contains('+'));
        assert!(!output.text.contains('/'));
    }

    #[tokio::test]
    async fn test_decode_standard() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("aGVsbG8=", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello");
    }

    #[tokio::test]
    async fn test_decode_url_safe() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        // 标准 base64 "+w==" 对应 URL-safe "-w=="
        let input = make_input("-w==", "decode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "\u{fb}");
    }

    #[tokio::test]
    async fn test_encode_empty_string() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "");
    }

    #[tokio::test]
    async fn test_decode_invalid_base64_returns_parse_failed() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("!!!not-base64!!!", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_invalid_action_returns_invalid_input() {
        let tool = Base64Codec::new();
        let ctx = mock_context();
        let input = make_input("hello", "rot13", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
```

- [ ] **Step 4.2: 运行测试验证失败**

Run: `cargo test -p qraft base64_codec -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 4.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod base64_codec;
```

- [ ] **Step 4.4: 运行测试验证通过**

Run: `cargo test -p qraft base64_codec -- --nocapture`
Expected: PASS,7 个测试通过

- [ ] **Step 4.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/base64_codec.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:base64_codec): add Tool with encode/decode + url_safe, 7 unit tests"
```

- [ ] **Step 4.6: 写失败 React 测试**

Create `src/tools/Base64Codec.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Base64Codec } from './Base64Codec';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('Base64Codec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, output, action select and url_safe switch', () => {
    render(<Base64Codec toolId="base64_codec" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /url safe/i })).toBeInTheDocument();
  });

  it('calls tool_execute with action=encode by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({ text: 'aGVsbG8=' });

    render(<Base64Codec toolId="base64_codec" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: { text: 'hello', params: { action: 'encode', url_safe: false } },
      });
    });
  });

  it('shows error alert when decode fails', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid base64')
    );

    render(<Base64Codec toolId="base64_codec" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: '!!!' },
    });
    // 切换到 decode
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /decode/i }));
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 4.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/Base64Codec.test.tsx`
Expected: FAIL,"Cannot find module './Base64Codec'"

- [ ] **Step 4.8: 写 React 组件**

Create `src/tools/Base64Codec.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface Base64Params {
  action: 'encode' | 'decode';
  url_safe: boolean;
}

export function Base64Codec({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [action, setAction] = useState<'encode' | 'decode'>('encode');
  const [urlSafe, setUrlSafe] = useState(false);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleExecute() {
    setLoading(true);
    setError(null);
    try {
      const params: Base64Params = { action, url_safe: urlSafe };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>Input</Label>
        <Textarea
          placeholder="Enter text to encode/decode"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <div className="flex items-center gap-4">
          <Select value={action} onValueChange={(v) => setAction(v as 'encode' | 'decode')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="encode">Encode</SelectItem>
              <SelectItem value="decode">Decode</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="url-safe" checked={urlSafe} onCheckedChange={setUrlSafe} />
            <Label htmlFor="url-safe" className="text-xs">
              URL Safe
            </Label>
          </div>
          <Button onClick={handleExecute} disabled={loading || !text}>
            {loading ? 'Running...' : 'Execute'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Output</Label>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { Base64Codec } from './Base64Codec';
registerTool('base64_codec', Base64Codec);
```

- [ ] **Step 4.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/Base64Codec.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 4.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/Base64Codec.tsx src/tools/Base64Codec.test.tsx src/tools/registry.ts
git commit -m "feat(tool:base64_codec): add React UI with action/url_safe controls"
```

- [ ] **Step 4.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "Base64 Codec",输入 `hello`,action=encode,确认输出 `aGVsbG8=`

- [ ] **Step 4.13: 验证 Task 4 完成**

确认:`base64_codec.rs` 7 个 Rust 测试、`Base64Codec.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 5: url_codec

**Files:**
- Create: `src-tauri/src/tools/url_codec.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/UrlCodec.tsx`
- Create: `src/tools/UrlCodec.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** params: `action` (encode/decode, required)、`component` (bool, default false,use `encodeURIComponent` vs `encodeURI`);errors: `ERR_INVALID_INPUT`、`ERR_PARSE_FAILED`

- [ ] **Step 5.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/url_codec.rs`:

```rust
use async_trait::async_trait;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

/// encodeURI 保留字符: A-Z a-z 0-9 - _ . ! ~ * ' ( ) ; , / ? : @ & = + $ #
/// 参考 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURI
const ENCODE_URI_RESERVED: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'#')
    .add(b'{')
    .add(b'}')
    .add(b'|')
    .add(b'\\')
    .add(b'^')
    .add(b'[')
    .add(b']')
    .add(b'`');

/// encodeURIComponent 保留字符: A-Z a-z 0-9 - _ . ! ~ * ' ( )
/// 参考 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
const ENCODE_URI_COMPONENT_RESERVED: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub struct UrlCodec;

impl UrlCodec {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for UrlCodec {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let action: String = input.param("action")?;
        let component: bool = input.param("component").unwrap_or(false);

        let start = Instant::now();
        let input_bytes = text.len();
        let out_text = match action.as_str() {
            "encode" => {
                let set = if component {
                    ENCODE_URI_COMPONENT_RESERVED
                } else {
                    ENCODE_URI_RESERVED
                };
                utf8_percent_encode(text, set).to_string()
            }
            "decode" => percent_encoding::percent_decode_str(text)
                .decode_utf8()
                .map_err(|e| ToolError::ParseFailed(format!("decode failed: {}", e)))?
                .to_string(),
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "action must be 'encode' or 'decode', got '{}'",
                    other
                )))
            }
        };
        let output_bytes = out_text.len();

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "url_codec",
    name: "URL Encoder/Decoder",
    category: ToolCategory::Encoder,
    icon: "link",
    description: "Encode or decode URL (full URI or component)",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["url", "encode", "decode", "percent-encoding", "uri"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "Text to encode/decode" },
        "params": {
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["encode", "decode"], "default": "encode" },
                "component": { "type": "boolean", "default": false }
            },
            "required": ["action"]
        }
    },
    "required": ["text", "params"]
});

register_tool!(UrlCodec, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str, action: &str, component: bool) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("action".to_string(), json!(action));
        params.insert("component".to_string(), json!(component));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_encode_uri_keeps_reserved() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("https://example.com/path?q=1&lang=zh", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        // encodeURI 不应编码 : / ? & = #
        assert_eq!(output.text, "https://example.com/path?q=1&lang=zh");
    }

    #[tokio::test]
    async fn test_encode_component_encodes_reserved() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("https://example.com", "encode", true);

        let output = tool.execute(input, &ctx).await.unwrap();

        // encodeURIComponent 应编码 : / .
        assert!(output.text.contains("%3A"));
        assert!(output.text.contains("%2F"));
    }

    #[tokio::test]
    async fn test_encode_space() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello world", "encode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello%20world");
    }

    #[tokio::test]
    async fn test_decode_percent_encoded() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello%20world%21", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "hello world!");
    }

    #[tokio::test]
    async fn test_decode_utf8() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("%E4%B8%AD%E6%96%87", "decode", false);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "中文");
    }

    #[tokio::test]
    async fn test_decode_invalid_percent_returns_parse_failed() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("%ZZ", "decode", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_invalid_action_returns_invalid_input() {
        let tool = UrlCodec::new();
        let ctx = mock_context();
        let input = make_input("hello", "escape", false);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
```

- [ ] **Step 5.2: 运行测试验证失败**

Run: `cargo test -p qraft url_codec -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 5.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod url_codec;
```

- [ ] **Step 5.4: 运行测试验证通过**

Run: `cargo test -p qraft url_codec -- --nocapture`
Expected: PASS,7 个测试通过

- [ ] **Step 5.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/url_codec.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:url_codec): add Tool with encode/decode + component flag, 7 unit tests"
```

- [ ] **Step 5.6: 写失败 React 测试**

Create `src/tools/UrlCodec.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UrlCodec } from './UrlCodec';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('UrlCodec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, output, action select and component switch', () => {
    render(<UrlCodec toolId="url_codec" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /component/i })).toBeInTheDocument();
  });

  it('calls tool_execute with action=encode, component=false by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({ text: 'hello%20world' });

    render(<UrlCodec toolId="url_codec" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'url_codec',
        input: { text: 'hello world', params: { action: 'encode', component: false } },
      });
    });
  });

  it('shows error alert when decode fails', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid percent encoding')
    );

    render(<UrlCodec toolId="url_codec" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: '%ZZ' },
    });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /decode/i }));
    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 5.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/UrlCodec.test.tsx`
Expected: FAIL,"Cannot find module './UrlCodec'"

- [ ] **Step 5.8: 写 React 组件**

Create `src/tools/UrlCodec.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface UrlParams {
  action: 'encode' | 'decode';
  component: boolean;
}

export function UrlCodec({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [action, setAction] = useState<'encode' | 'decode'>('encode');
  const [component, setComponent] = useState(false);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleExecute() {
    setLoading(true);
    setError(null);
    try {
      const params: UrlParams = { action, component };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>Input</Label>
        <Textarea
          placeholder="Enter text to encode/decode"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <div className="flex items-center gap-4">
          <Select value={action} onValueChange={(v) => setAction(v as 'encode' | 'decode')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="encode">Encode</SelectItem>
              <SelectItem value="decode">Decode</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="component" checked={component} onCheckedChange={setComponent} />
            <Label htmlFor="component" className="text-xs">
              Component
            </Label>
          </div>
          <Button onClick={handleExecute} disabled={loading || !text}>
            {loading ? 'Running...' : 'Execute'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Output</Label>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
            data-testid="output"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { UrlCodec } from './UrlCodec';
registerTool('url_codec', UrlCodec);
```

- [ ] **Step 5.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/UrlCodec.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 5.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/UrlCodec.tsx src/tools/UrlCodec.test.tsx src/tools/registry.ts
git commit -m "feat(tool:url_codec): add React UI with action/component controls"
```

- [ ] **Step 5.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "URL Encoder/Decoder",输入 `hello world`,action=encode,确认输出 `hello%20world`

- [ ] **Step 5.13: 验证 Task 5 完成**

确认:`url_codec.rs` 7 个 Rust 测试、`UrlCodec.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 6: jwt_parser

**Files:**
- Create: `src-tauri/src/tools/jwt_parser.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/JwtParser.tsx`
- Create: `src/tools/JwtParser.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** 输入 JWT 字符串;输出 `text` 为格式化的 header+payload JSON,`extra` 含 `header`/`payload`/`signature`/`expires_at`;errors: `ERR_INVALID_INPUT`、`ERR_PARSE_FAILED`;dependencies: base64(内部直接调 `base64` crate)

- [ ] **Step 6.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/jwt_parser.rs`:

```rust
use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct JwtParser;

impl JwtParser {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for JwtParser {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        let start = Instant::now();

        // JWT 形如 header.payload.signature,以 '.' 分隔
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 3 {
            return Err(ToolError::InvalidInput(format!(
                "JWT must have 3 segments separated by '.', got {}",
                parts.len()
            )));
        }

        let header_bytes = URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|e| ToolError::ParseFailed(format!("header base64 decode failed: {}", e)))?;
        let payload_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|e| ToolError::ParseFailed(format!("payload base64 decode failed: {}", e)))?;

        let header: Value = serde_json::from_slice(&header_bytes)
            .map_err(|e| ToolError::ParseFailed(format!("header is not valid JSON: {}", e)))?;
        let payload: Value = serde_json::from_slice(&payload_bytes)
            .map_err(|e| ToolError::ParseFailed(format!("payload is not valid JSON: {}", e)))?;

        // 计算 expires_at(若 payload 含 'exp' 标准 claim)
        let expires_at = payload
            .get("exp")
            .and_then(|v| v.as_i64())
            .map(|ts| {
                // 注意:JWT exp 是秒级时间戳,超出范围时返回 None
                DateTime::<Utc>::from_timestamp(ts, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| "invalid".to_string())
            });

        // text:格式化展示 header 与 payload
        let header_pretty = serde_json::to_string_pretty(&header)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let payload_pretty = serde_json::to_string_pretty(&payload)
            .map_err(|e| ToolError::Internal(e.to_string()))?;
        let out_text = format!(
            "Header:\n{}\n\nPayload:\n{}\n\nSignature:\n{}",
            header_pretty, payload_pretty, parts[2]
        );

        let mut extra = serde_json::Map::new();
        extra.insert("header".to_string(), header);
        extra.insert("payload".to_string(), payload);
        extra.insert("signature".to_string(), Value::String(parts[2].to_string()));
        if let Some(exp) = expires_at {
            extra.insert("expires_at".to_string(), Value::String(exp));
        }

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(Value::Object(extra)),
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "jwt_parser",
    name: "JWT Parser",
    category: ToolCategory::Parser,
    icon: "key-round",
    description: "Decode JWT header, payload and signature without verifying",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["jwt", "token", "auth", "decode"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "JWT token" }
    },
    "required": ["text"]
});

register_tool!(JwtParser, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    // 一个真实的 HS256 JWT(header={"alg":"HS256","typ":"JWT"}, payload={"sub":"1234567890","name":"John Doe","iat":1516239022})
    // 通过 https://jwt.io 生成的 token,签名不经验证
    const VALID_JWT: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    #[tokio::test]
    async fn test_parse_valid_jwt_header() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["header"]["alg"], "HS256");
        assert_eq!(extra["header"]["typ"], "JWT");
    }

    #[tokio::test]
    async fn test_parse_valid_jwt_payload() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["payload"]["sub"], "1234567890");
        assert_eq!(extra["payload"]["name"], "John Doe");
        assert_eq!(extra["payload"]["iat"], 1516239022);
    }

    #[tokio::test]
    async fn test_parse_valid_jwt_signature() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input(VALID_JWT);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(
            extra["signature"],
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        );
    }

    #[tokio::test]
    async fn test_parse_jwt_with_exp_returns_expires_at() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        // 构造 exp=1516239022 + 3600 的 JWT
        // header: eyJhbGciOiJIUzI1NiJ9  -> {"alg":"HS256"}
        // payload: eyJleHAiOjE1MTYyNDI2MjJ9  -> {"exp":1516242622}
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE1MTYyNDI2MjJ9.fakesignature";
        let input = make_input(jwt);

        let output = tool.execute(input, &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        // exp=1516242622 → 2018-01-18T...
        let exp = extra["expires_at"].as_str().unwrap();
        assert!(exp.starts_with("2018-"));
    }

    #[tokio::test]
    async fn test_parse_jwt_with_two_segments_returns_invalid_input() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input("only.two");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_parse_jwt_with_invalid_base64_returns_parse_failed() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        let input = make_input("!!!notbase64!!!.also.bad.signature");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_parse_jwt_payload_not_json_returns_parse_failed() {
        let tool = JwtParser::new();
        let ctx = mock_context();
        // payload base64 of "not json"
        let not_json_b64 = URL_SAFE_NO_PAD.encode(b"not json");
        let jwt = format!("eyJhbGciOiJIUzI1NiJ9.{}.sig", not_json_b64);
        let input = make_input(&jwt);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }
}
```

- [ ] **Step 6.2: 运行测试验证失败**

Run: `cargo test -p qraft jwt_parser -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 6.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod jwt_parser;
```

- [ ] **Step 6.4: 运行测试验证通过**

Run: `cargo test -p qraft jwt_parser -- --nocapture`
Expected: PASS,7 个测试通过

- [ ] **Step 6.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/jwt_parser.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:jwt_parser): add Tool decoding JWT header/payload/signature, 7 unit tests"
```

- [ ] **Step 6.6: 写失败 React 测试**

Create `src/tools/JwtParser.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JwtParser } from './JwtParser';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

const VALID_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('JwtParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders JWT input textarea and parse button', () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/paste jwt token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /parse/i })).toBeInTheDocument();
  });

  it('displays header, payload, signature on successful parse', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: 'Header:\n{\n  "alg": "HS256"\n}\n\nPayload:\n{\n  "sub": "123"\n}',
      extra: {
        header: { alg: 'HS256', typ: 'JWT' },
        payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
        signature: 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      },
    });

    render(<JwtParser toolId="jwt_parser" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste jwt token/i), {
      target: { value: VALID_JWT },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await waitFor(() => {
      expect(screen.getByText(/Header/i)).toBeInTheDocument();
      expect(screen.getByText(/Payload/i)).toBeInTheDocument();
      expect(screen.getByText(/Signature/i)).toBeInTheDocument();
    });
  });

  it('shows error alert when JWT has only 2 segments', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_INVALID_INPUT', 'JWT must have 3 segments')
    );

    render(<JwtParser toolId="jwt_parser" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/paste jwt token/i), {
      target: { value: 'only.two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid input/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/JwtParser.test.tsx`
Expected: FAIL,"Cannot find module './JwtParser'"

- [ ] **Step 6.8: 写 React 组件**

Create `src/tools/JwtParser.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface JwtExtra {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  expires_at?: string;
}

export function JwtParser({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params: {} },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as JwtExtra | undefined;

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>JWT Token</Label>
        <Textarea
          placeholder="Paste JWT token here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 font-mono text-sm"
          data-testid="input"
        />
        <Button onClick={handleParse} disabled={loading || !text}>
          {loading ? 'Parsing...' : 'Parse'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Output</Label>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : extra ? (
          <ScrollArea className="flex-1 rounded-md border p-3 text-sm">
            <div className="space-y-3">
              <div>
                <div className="font-semibold">Header</div>
                <pre className="font-mono text-xs">{JSON.stringify(extra.header, null, 2)}</pre>
              </div>
              <div>
                <div className="font-semibold">Payload</div>
                <pre className="font-mono text-xs">{JSON.stringify(extra.payload, null, 2)}</pre>
              </div>
              <div>
                <div className="font-semibold">Signature</div>
                <code className="font-mono text-xs break-all">{extra.signature}</code>
              </div>
              {extra.expires_at && (
                <div>
                  <div className="font-semibold">Expires At</div>
                  <code className="font-mono text-xs">{extra.expires_at}</code>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <Textarea readOnly value="" className="flex-1 font-mono text-sm" data-testid="output" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { JwtParser } from './JwtParser';
registerTool('jwt_parser', JwtParser);
```

- [ ] **Step 6.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/JwtParser.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 6.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/JwtParser.tsx src/tools/JwtParser.test.tsx src/tools/registry.ts
git commit -m "feat(tool:jwt_parser): add React UI displaying header/payload/signature/expires_at"
```

- [ ] **Step 6.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "JWT Parser",粘贴一个真实 JWT,点 Parse,确认显示 header/payload/signature

- [ ] **Step 6.13: 验证 Task 6 完成**

确认:`jwt_parser.rs` 7 个 Rust 测试、`JwtParser.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 7: uuid_generator

**Files:**
- Create: `src-tauri/src/tools/uuid_generator.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/UuidGenerator.tsx`
- Create: `src/tools/UuidGenerator.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** params: `version` (v4/v7, default v4)、`count` (integer, 1-1000, default 1)、`uppercase` (bool, default false)、`hyphens` (bool, default true);输出 `text` 为每行一个 UUID

- [ ] **Step 7.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/uuid_generator.rs`:

```rust
use async_trait::async_trait;
use std::collections::HashMap;
use std::time::Instant;
use uuid::Uuid;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

pub struct UuidGenerator;

impl UuidGenerator {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for UuidGenerator {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let version: String = input.param("version").unwrap_or_else(|_| "v4".to_string());
        let count: i64 = input.param("count").unwrap_or(1);
        let uppercase: bool = input.param("uppercase").unwrap_or(false);
        let hyphens: bool = input.param("hyphens").unwrap_or(true);

        if count < 1 {
            return Err(ToolError::InvalidInput(format!(
                "count must be >= 1, got {}",
                count
            )));
        }
        if count > 1000 {
            return Err(ToolError::InvalidInput(format!(
                "count must be <= 1000, got {}",
                count
            )));
        }

        let start = Instant::now();
        let mut uuids: Vec<String> = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let uuid = match version.as_str() {
                "v4" => Uuid::new_v4(),
                "v7" => Uuid::now_v7(),
                other => {
                    return Err(ToolError::InvalidInput(format!(
                        "version must be 'v4' or 'v7', got '{}'",
                        other
                    )))
                }
            };
            let mut s = if hyphens {
                uuid.hyphenated().to_string()
            } else {
                uuid.simple().to_string()
            };
            if uppercase {
                s = s.to_uppercase();
            }
            uuids.push(s);
        }
        let out_text = uuids.join("\n");
        let output_bytes = out_text.len();
        let input_bytes = 0; // 无文本输入

        Ok(ToolOutput {
            text: out_text,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "uuid_generator",
    name: "UUID Generator",
    category: ToolCategory::Generator,
    icon: "fingerprint",
    description: "Generate v4 or v7 UUIDs in bulk with format options",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["uuid", "guid", "generate", "v4", "v7"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "params": {
            "type": "object",
            "properties": {
                "version": { "type": "string", "enum": ["v4", "v7"], "default": "v4" },
                "count": { "type": "integer", "default": 1, "minimum": 1, "maximum": 1000 },
                "uppercase": { "type": "boolean", "default": false },
                "hyphens": { "type": "boolean", "default": true }
            }
        }
    }
});

register_tool!(UuidGenerator, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_params_input(params: HashMap<String, serde_json::Value>) -> ToolInput {
        ToolInput {
            text: None,
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_generate_v4_single() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v4"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text.lines().count(), 1);
        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 36); // hyphenated form
        assert!(uuid.contains('-'));
    }

    #[tokio::test]
    async fn test_generate_v7_single() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v7"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 36);
        // v7 第一段前 3 字节是 unix_ts_ms,应是十六进制
        assert!(uuid.starts_with('0') || uuid.chars().next().unwrap().is_ascii_hexdigit());
    }

    #[tokio::test]
    async fn test_generate_count_10() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(10));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let lines: Vec<&str> = output.text.lines().collect();
        assert_eq!(lines.len(), 10);
        // 全部唯一
        let mut deduped = lines.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(deduped.len(), 10);
    }

    #[tokio::test]
    async fn test_generate_uppercase() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1));
        params.insert("uppercase".to_string(), json!(true));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert!(uuid.chars().any(|c| c.is_ascii_uppercase()));
        assert!(!uuid.chars().any(|c| c.is_ascii_lowercase() && c != '-'));
    }

    #[tokio::test]
    async fn test_generate_no_hyphens() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1));
        params.insert("hyphens".to_string(), json!(false));
        let input = make_params_input(params);

        let output = tool.execute(input, &ctx).await.unwrap();

        let uuid = output.text.trim();
        assert_eq!(uuid.len(), 32);
        assert!(!uuid.contains('-'));
    }

    #[tokio::test]
    async fn test_count_zero_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(0));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_count_above_1000_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("count".to_string(), json!(1001));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_invalid_version_returns_invalid_input() {
        let tool = UuidGenerator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("version".to_string(), json!("v8"));
        params.insert("count".to_string(), json!(1));
        let input = make_params_input(params);

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
```

- [ ] **Step 7.2: 运行测试验证失败**

Run: `cargo test -p qraft uuid_generator -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 7.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod uuid_generator;
```

- [ ] **Step 7.4: 运行测试验证通过**

Run: `cargo test -p qraft uuid_generator -- --nocapture`
Expected: PASS,8 个测试通过

- [ ] **Step 7.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/uuid_generator.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:uuid_generator): add Tool with v4/v7 + count + format options, 8 unit tests"
```

- [ ] **Step 7.6: 写失败 React 测试**

Create `src/tools/UuidGenerator.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UuidGenerator } from './UuidGenerator';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('UuidGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders version select, count input, switches and generate button', () => {
    render(<UuidGenerator toolId="uuid_generator" metadata={null as any} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /uppercase/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /hyphens/i })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /count/i })).toBeInTheDocument();
  });

  it('calls tool_execute with default v4 + count=1', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: '550e8400-e29b-41d4-a716-446655440000',
    });

    render(<UuidGenerator toolId="uuid_generator" metadata={null as any} />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'uuid_generator',
        input: {
          text: undefined,
          params: { version: 'v4', count: 1, uppercase: false, hyphens: true },
        },
      });
    });
  });

  it('displays generated UUIDs in output area', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: 'uuid1\nuuid2\nuuid3',
    });

    render(<UuidGenerator toolId="uuid_generator" metadata={null as any} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /count/i }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(screen.getByText(/uuid1/)).toBeInTheDocument();
      expect(screen.getByText(/uuid2/)).toBeInTheDocument();
      expect(screen.getByText(/uuid3/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 7.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/UuidGenerator.test.tsx`
Expected: FAIL,"Cannot find module './UuidGenerator'"

- [ ] **Step 7.8: 写 React 组件**

Create `src/tools/UuidGenerator.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface UuidParams {
  version: 'v4' | 'v7';
  count: number;
  uppercase: boolean;
  hyphens: boolean;
}

export function UuidGenerator({ toolId }: ToolProps) {
  const [version, setVersion] = useState<'v4' | 'v7'>('v4');
  const [count, setCount] = useState(1);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const params: UuidParams = { version, count, uppercase, hyphens };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text: undefined, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAll() {
    if (output?.text) {
      await navigator.clipboard.writeText(output.text);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Version</Label>
          <Select value={version} onValueChange={(v) => setVersion(v as 'v4' | 'v7')}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="v4">v4</SelectItem>
              <SelectItem value="v7">v7</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="count-input" className="text-xs">
            Count
          </Label>
          <Input
            id="count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-24"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="uppercase" checked={uppercase} onCheckedChange={setUppercase} />
          <Label htmlFor="uppercase" className="text-xs">
            Uppercase
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hyphens" checked={hyphens} onCheckedChange={setHyphens} />
          <Label htmlFor="hyphens" className="text-xs">
            Hyphens
          </Label>
        </div>
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate'}
        </Button>
        {output?.text && (
          <Button variant="secondary" onClick={handleCopyAll}>
            Copy All
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <ScrollArea className="flex-1 rounded-md border p-3 font-mono text-sm" data-testid="output">
        <pre className="whitespace-pre-wrap">{output?.text ?? ''}</pre>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 7.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { UuidGenerator } from './UuidGenerator';
registerTool('uuid_generator', UuidGenerator);
```

- [ ] **Step 7.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/UuidGenerator.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 7.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/UuidGenerator.tsx src/tools/UuidGenerator.test.tsx src/tools/registry.ts
git commit -m "feat(tool:uuid_generator): add React UI with version/count/format controls"
```

- [ ] **Step 7.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "UUID Generator",count=5,version=v4,点 Generate,确认输出 5 行 UUID

- [ ] **Step 7.13: 验证 Task 7 完成**

确认:`uuid_generator.rs` 8 个 Rust 测试、`UuidGenerator.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 8: hash_calculator

**Files:**
- Create: `src-tauri/src/tools/hash_calculator.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/HashCalculator.tsx`
- Create: `src/tools/HashCalculator.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格:** 输入 `text` 或 `file_path`(二选一,oneOf);params: `algorithm` (md5/sha1/sha256/sha512/blake3, required, default sha256);输出 `text` 为 hash hex;streaming: true;timeout_secs: 60

- [ ] **Step 8.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/hash_calculator.rs`:

```rust
use async_trait::async_trait;
use blake3::Hasher as Blake3Hasher;
use md5::Md5;
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;
use crate::register_stream_tool;

const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

pub struct HashCalculator;

impl HashCalculator {
    pub fn new() -> Self {
        Self
    }
}

/// 计算给定数据的哈希,返回小写 hex 字符串。
/// 算法选择通过字符串匹配,新增算法在此扩展即可。
fn hash_bytes(algorithm: &str, data: &[u8]) -> Result<String, ToolError> {
    use sha2::Digest;
    let hex_str = match algorithm {
        "md5" => {
            let mut h = Md5::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha1" => {
            let mut h = Sha1::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha256" => {
            let mut h = Sha256::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha512" => {
            let mut h = Sha512::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "blake3" => {
            let mut h = Blake3Hasher::new();
            h.update(data);
            h.finalize().to_hex().to_string()
        }
        other => {
            return Err(ToolError::InvalidInput(format!(
                "algorithm must be one of md5/sha1/sha256/sha512/blake3, got '{}'",
                other
            )))
        }
    };
    Ok(hex_str)
}

#[async_trait]
impl Tool for HashCalculator {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let algorithm: String = input.param("algorithm").unwrap_or_else(|_| "sha256".to_string());

        let start = Instant::now();
        let (data, input_bytes) = if let Some(text) = input.text.as_deref() {
            let bytes = text.len();
            if bytes > MAX_TEXT_BYTES {
                return Err(ToolError::InputTooLarge {
                    size: bytes,
                    max: MAX_TEXT_BYTES,
                });
            }
            (text.as_bytes().to_vec(), bytes)
        } else if let Some(path) = input.file_path.as_deref() {
            let bytes = tokio::fs::read(path)
                .await
                .map_err(|e| ToolError::Internal(format!("read file failed: {}", e)))?;
            let n = bytes.len();
            (bytes, n)
        } else {
            return Err(ToolError::InvalidInput(
                "either 'text' or 'file_path' must be provided".to_string(),
            ));
        };

        let hex_str = hash_bytes(&algorithm, &data)?;
        let output_bytes = hex_str.len();

        Ok(ToolOutput {
            text: hex_str,
            extra: None,
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "hash_calculator",
    name: "Hash Calculator",
    category: ToolCategory::Encoder,
    icon: "hash",
    description: "Compute MD5/SHA1/SHA256/SHA512/BLAKE3 hashes of text or files",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["hash", "md5", "sha256", "blake3", "checksum"],
    version: "1.0.0",
    timeout_secs: Some(60),
    streaming_supported: true,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "Text to hash" },
        "file_path": { "type": "string", "format": "file", "description": "Path to file to hash" },
        "params": {
            "type": "object",
            "properties": {
                "algorithm": {
                    "type": "string",
                    "enum": ["md5", "sha1", "sha256", "sha512", "blake3"],
                    "default": "sha256"
                }
            },
            "required": ["algorithm"]
        }
    },
    "oneOf": [
        { "required": ["text"] },
        { "required": ["file_path"] }
    ]
});

register_tool!(HashCalculator, &METADATA);
register_stream_tool!(HashCalculator, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_text_input(text: &str, algorithm: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!(algorithm));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    fn make_file_input(path: &str, algorithm: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!(algorithm));
        ToolInput {
            text: None,
            file_path: Some(path.to_string()),
            params,
        }
    }

    #[tokio::test]
    async fn test_hash_md5_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "md5");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text, "5d41402abc4b2a76b9719d911017c592");
    }

    #[tokio::test]
    async fn test_hash_sha256_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(
            output.text,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[tokio::test]
    async fn test_hash_blake3_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "blake3");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(output.text.len(), 64); // 32 bytes → 64 hex chars
        assert!(output.text.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_hash_empty_text() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("", "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        // SHA-256 of empty string
        assert_eq!(
            output.text,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn test_hash_text_too_large() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let large = "x".repeat(MAX_TEXT_BYTES + 1);
        let input = make_text_input(&large, "sha256");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InputTooLarge { .. })));
    }

    #[tokio::test]
    async fn test_hash_file_path_not_found_returns_internal() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_file_input("/nonexistent/file/path/xyz", "sha256");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::Internal(_))));
    }

    #[tokio::test]
    async fn test_hash_invalid_algorithm_returns_invalid_input() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let input = make_text_input("hello", "crc32");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_hash_no_input_returns_invalid_input() {
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let mut params = HashMap::new();
        params.insert("algorithm".to_string(), json!("sha256"));
        let input = ToolInput {
            text: None,
            file_path: None,
            params,
        };

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_hash_file_reads_content() {
        // 写一个临时文件,验证 hash 与相同内容的 text 路径一致
        let tool = HashCalculator::new();
        let ctx = mock_context();
        let temp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(temp.path(), "hello").unwrap();
        let input = make_file_input(temp.path().to_str().unwrap(), "sha256");

        let output = tool.execute(input, &ctx).await.unwrap();

        assert_eq!(
            output.text,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
```

> **注意:** 测试中使用了 `tempfile` crate,需在 `src-tauri/Cargo.toml` 的 `[dev-dependencies]` 添加 `tempfile = "3.10"`。

- [ ] **Step 8.2: 运行测试验证失败**

Run: `cargo test -p qraft hash_calculator -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 8.3: 在 mod.rs 声明模块 + 添加 dev-dependency**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod hash_calculator;
```

Modify `src-tauri/Cargo.toml` `[dev-dependencies]` 段添加:

```toml
tempfile = "3.10"
```

- [ ] **Step 8.4: 运行测试验证通过**

Run: `cargo test -p qraft hash_calculator -- --nocapture`
Expected: PASS,9 个测试通过

- [ ] **Step 8.5: 实现 StreamingTool**

在 `src-tauri/src/tools/hash_calculator.rs` 末尾(`register_stream_tool!` 之后、`#[cfg(test)]` 之前)追加:

```rust
use crate::core::tool::{StreamingTool, StreamEvent};
use futures::stream::BoxStream;
use tokio::io::AsyncReadExt;

#[async_trait]
impl StreamingTool for HashCalculator {
    /// 流式哈希:按 64KB 块读取文件,增量更新哈希状态,逐块回传进度。
    /// 适合超大文件(GB 级),内存占用恒定。
    fn execute_stream(
        &self,
        input: ToolInput,
        _ctx: &ToolContext,
    ) -> BoxStream<'static, Result<StreamEvent, ToolError>> {
        let algorithm: String = input.param("algorithm").unwrap_or_else(|_| "sha256".to_string());
        let file_path = input.file_path.clone();

        Box::pin(async_stream::stream! {
            let path = match file_path.as_deref() {
                Some(p) => p.to_string(),
                None => {
                    yield Err(ToolError::InvalidInput(
                        "streaming requires file_path".to_string(),
                    ));
                    return;
                }
            };

            let meta = match tokio::fs::metadata(&path).await {
                Ok(m) => m,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("stat file failed: {}", e)));
                    return;
                }
            };
            let total = meta.len();
            if total == 0 {
                yield Err(ToolError::InvalidInput("file is empty".to_string()));
                return;
            }

            yield Ok(StreamEvent::Progress {
                percent: 0,
                message: format!("Hashing {} bytes with {}...", total, algorithm),
            });

            let mut file = match tokio::fs::File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    yield Err(ToolError::Internal(format!("open file failed: {}", e)));
                    return;
                }
            };

            // 增量哈希:每个算法维护独立的状态机
            use sha2::Digest;
            let mut md5_state = if algorithm == "md5" { Some(Md5::new()) } else { None };
            let mut sha1_state = if algorithm == "sha1" { Some(Sha1::new()) } else { None };
            let mut sha256_state = if algorithm == "sha256" { Some(Sha256::new()) } else { None };
            let mut sha512_state = if algorithm == "sha512" { Some(Sha512::new()) } else { None };
            let mut blake3_state = if algorithm == "blake3" { Some(Blake3Hasher::new()) } else { None };

            if md5_state.is_none()
                && sha1_state.is_none()
                && sha256_state.is_none()
                && sha512_state.is_none()
                && blake3_state.is_none()
            {
                yield Err(ToolError::InvalidInput(format!(
                    "unknown algorithm: {}",
                    algorithm
                )));
                return;
            }

            let mut buf = vec![0u8; 64 * 1024];
            let mut read_total: u64 = 0;
            loop {
                let n = match file.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) => {
                        yield Err(ToolError::Internal(format!("read failed: {}", e)));
                        return;
                    }
                };
                let chunk = &buf[..n];
                if let Some(s) = md5_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha1_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha256_state.as_mut() { s.update(chunk); }
                if let Some(s) = sha512_state.as_mut() { s.update(chunk); }
                if let Some(s) = blake3_state.as_mut() { s.update(chunk); }
                read_total += n as u64;
                let percent = ((read_total as f64 / total as f64) * 100.0) as u8;
                yield Ok(StreamEvent::Progress {
                    percent,
                    message: format!("{}/{} bytes", read_total, total),
                });
            }

            let hex_str = if let Some(s) = md5_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha1_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha256_state { hex::encode(s.finalize()) }
                else if let Some(s) = sha512_state { hex::encode(s.finalize()) }
                else if let Some(s) = blake3_state { s.finalize().to_hex().to_string() }
                else { unreachable!() };

            yield Ok(StreamEvent::Done {
                output: ToolOutput {
                    text: hex_str,
                    extra: None,
                    meta: Some(OutputMeta {
                        duration_ms: 0,
                        input_bytes: total as usize,
                        output_bytes: 0,
                    }),
                    alerts: Vec::new(),
                },
            });
        })
    }
}
```

- [ ] **Step 8.6: 运行测试 + clippy**

Run: `cargo test -p qraft hash_calculator -- --nocapture && cargo clippy -p qraft -- -D warnings`
Expected: 全部通过

- [ ] **Step 8.7: 提交 Rust**

```bash
git add src-tauri/src/tools/hash_calculator.rs src-tauri/src/tools/mod.rs src-tauri/Cargo.toml
git commit -m "feat(tool:hash_calculator): add Tool + StreamingTool for md5/sha1/sha256/sha512/blake3"
```

- [ ] **Step 8.8: 写失败 React 测试**

Create `src/tools/HashCalculator.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashCalculator } from './HashCalculator';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('HashCalculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders algorithm select, text input and compute button', () => {
    render(<HashCalculator toolId="hash_calculator" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compute/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text + algorithm=sha256 by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });

    render(<HashCalculator toolId="hash_calculator" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /compute/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'hash_calculator',
        input: { text: 'hello', params: { algorithm: 'sha256' } },
      });
    });
  });

  it('shows error alert when invalid algorithm is used', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_INVALID_INPUT', "algorithm must be one of md5/sha1/sha256/sha512/blake3, got 'crc32'")
    );

    render(<HashCalculator toolId="hash_calculator" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter text/i), {
      target: { value: 'hello' },
    });
    // 切到不存在的算法这里用 mock 直接触发,实际 UI 只暴露 5 个选项,但 mock 失败仍走错误路径
    fireEvent.click(screen.getByRole('button', { name: /compute/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid input/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 8.9: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/HashCalculator.test.tsx`
Expected: FAIL,"Cannot find module './HashCalculator'"

- [ ] **Step 8.10: 写 React 组件**

Create `src/tools/HashCalculator.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface HashParams {
  algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3';
}

export function HashCalculator({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [algorithm, setAlgorithm] =
    useState<'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3'>('sha256');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);

  async function handleCompute() {
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const params: HashParams = { algorithm };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="algo-select" className="text-xs">
            Algorithm
          </Label>
          <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as typeof algorithm)}>
            <SelectTrigger id="algo-select" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="md5">MD5</SelectItem>
              <SelectItem value="sha1">SHA-1</SelectItem>
              <SelectItem value="sha256">SHA-256</SelectItem>
              <SelectItem value="sha512">SHA-512</SelectItem>
              <SelectItem value="blake3">BLAKE3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCompute} disabled={loading || !text}>
          {loading ? 'Computing...' : 'Compute'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1">
        <div className="flex flex-col gap-2">
          <Label>Input Text</Label>
          <Textarea
            placeholder="Enter text to hash..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 font-mono text-sm"
            data-testid="input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Hash</Label>
          {progress && (
            <div className="flex flex-col gap-1">
              <Progress value={progress.percent} />
              <span className="text-xs text-muted-foreground">{progress.message}</span>
            </div>
          )}
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : (
            <Textarea
              readOnly
              value={output?.text ?? ''}
              className="flex-1 font-mono text-sm break-all"
              data-testid="output"
            />
          )}
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} bytes · {output.meta.duration_ms}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.11: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { HashCalculator } from './HashCalculator';
registerTool('hash_calculator', HashCalculator);
```

- [ ] **Step 8.12: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/HashCalculator.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 8.13: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/HashCalculator.tsx src/tools/HashCalculator.test.tsx src/tools/registry.ts
git commit -m "feat(tool:hash_calculator): add React UI with algorithm select and progress display"
```

- [ ] **Step 8.14: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "Hash Calculator",输入 `hello`,algorithm=sha256,确认输出 `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`

- [ ] **Step 8.15: 流式验证(可选)**

`pnpm tauri dev` 中选择大文件(>100MB),通过 `tool_execute_stream` 调用,观察 Progress 事件按百分比更新

- [ ] **Step 8.16: 验证 Task 8 完成**

确认:`hash_calculator.rs` 含 `Tool` + `StreamingTool` 实现,9 个 Rust 测试、`HashCalculator.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 9: timestamp_converter

**Files:**
- Create: `src-tauri/src/tools/timestamp_converter.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/TimestampConverter.tsx`
- Create: `src/tools/TimestampConverter.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格(07-tool-catalog.md):**
- params: `timezone` (string, default "UTC", IANA timezone)、`format` (string, default "ISO 8601")
- 输入 `text` 为 Unix 时间戳(秒/毫秒)或日期字符串
- 输出 `text` 为多格式汇总,`extra` 含 `unix_seconds`/`unix_millis`/`iso8601`/`local`/`relative`
- errors: `ERR_INVALID_INPUT`(空输入或时区非法)、`ERR_PARSE_FAILED`(无法解析为时间)

- [ ] **Step 9.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/timestamp_converter.rs`:

```rust
use async_trait::async_trait;
use chrono::{DateTime, FixedOffset, Local, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 1024; // 时间戳输入很短

pub struct TimestampConverter;

impl TimestampConverter {
    pub fn new() -> Self {
        Self
    }
}

/// 解析输入文本为 UTC DateTime。
/// 支持三种自动识别策略:
///  1. 纯数字(10 位 → 秒,13 位 → 毫秒)
///  2. ISO 8601 / RFC 3339(含时区后缀)
///  3. 常见 `YYYY-MM-DD HH:MM:SS` 形式(按 UTC 解析)
fn parse_input(text: &str) -> Result<DateTime<Utc>, ToolError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ToolError::InvalidInput("text is empty".to_string()));
    }

    // 策略 1:纯数字 → Unix 时间戳
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        let n: i64 = trimmed
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("invalid timestamp number: {}", e)))?;
        // 13 位以上视为毫秒;10 位视为秒
        let secs = if trimmed.len() >= 13 {
            n / 1000
        } else {
            n
        };
        return DateTime::<Utc>::from_timestamp(secs, 0)
            .ok_or_else(|| ToolError::ParseFailed(format!("timestamp out of range: {}", secs)));
    }

    // 策略 2:RFC 3339 / ISO 8601(优先尝试,带时区)
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&Utc));
    }

    // 策略 3:`YYYY-MM-DD HH:MM:SS` 或 `YYYY-MM-DDTHH:MM:SS`(无时区,按 UTC)
    let candidates = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d",
    ];
    for fmt in candidates {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Ok(Utc.from_utc_datetime(&naive));
        }
        // 仅日期格式,NaiveDateTime 解析会失败,尝试 NaiveDate 路径
        if fmt.ends_with("%d") && !trimmed.contains(':') {
            if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, fmt) {
                let naive = date.and_hms_opt(0, 0, 0).unwrap();
                return Ok(Utc.from_utc_datetime(&naive));
            }
        }
    }

    Err(ToolError::ParseFailed(format!(
        "cannot parse '{}' as timestamp or date string",
        trimmed
    )))
}

/// 将 UTC 时间转换为指定时区的字符串。
/// timezone 为 IANA 名称(如 "Asia/Shanghai"),非法时回退到 UTC + 警告。
fn to_local_string(utc: DateTime<Utc>, timezone: &str) -> Result<String, ToolError> {
    if timezone == "UTC" || timezone.is_empty() {
        return Ok(utc.to_rfc3339());
    }
    // 优先尝试 chrono_tz 的 IANA 解析
    if let Ok(tz) = timezone.parse::<Tz>() {
        return Ok(utc.with_timezone(&tz).to_rfc3339());
    }
    // 再尝试固定偏移(+08:00 等)
    if let Ok(offset) = parse_fixed_offset(timezone) {
        return Ok(utc.with_timezone(&FixedOffset::east_opt(offset)).unwrap().to_rfc3339());
    }
    Err(ToolError::InvalidInput(format!(
        "unknown timezone: {}",
        timezone
    )))
}

/// 解析 `+08:00` / `-05:30` 形式的偏移为秒数。
fn parse_fixed_offset(s: &str) -> Result<i32, ()> {
    let bytes = s.as_bytes();
    if bytes.len() < 6 || (bytes[0] != b'+' && bytes[0] != b'-') {
        return Err(());
    }
    let sign: i32 = if bytes[0] == b'+' { 1 } else { -1 };
    let rest = &s[1..];
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 2 {
        return Err(());
    }
    let h: i32 = parts[0].parse().map_err(|_| ())?;
    let m: i32 = parts[1].parse().map_err(|_| ())?;
    Ok(sign * (h * 3600 + m * 60))
}

/// 计算相对当前时间的友好描述(英文,简化版)。
fn relative_description(utc: DateTime<Utc>) -> String {
    let now = Utc::now();
    let delta = now.signed_duration_since(utc);
    let secs = delta.num_seconds();
    if secs.abs() < 60 {
        return format!("{} seconds {}", secs.abs(), if secs >= 0 { "ago" } else { "from now" });
    }
    let mins = secs / 60;
    if mins.abs() < 60 {
        return format!("{} minutes {}", mins.abs(), if mins >= 0 { "ago" } else { "from now" });
    }
    let hours = mins / 60;
    if hours.abs() < 24 {
        return format!("{} hours {}", hours.abs(), if hours >= 0 { "ago" } else { "from now" });
    }
    let days = hours / 24;
    if days.abs() < 30 {
        return format!("{} days {}", days.abs(), if days >= 0 { "ago" } else { "from now" });
    }
    let months = days / 30;
    if months.abs() < 12 {
        return format!("{} months {}", months.abs(), if months >= 0 { "ago" } else { "from now" });
    }
    let years = days / 365;
    format!("{} years {}", years.abs(), if years >= 0 { "ago" } else { "from now" })
}

#[async_trait]
impl Tool for TimestampConverter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }
        let timezone: String = input.param("timezone").unwrap_or_else(|_| "UTC".to_string());

        let start = Instant::now();
        let utc = parse_input(&text)?;

        let unix_seconds = utc.timestamp();
        let unix_millis = utc.timestamp_millis();
        let iso8601 = utc.to_rfc3339();
        let local = to_local_string(utc, &timezone)?;
        let relative = relative_description(utc);

        // 文本输出:多行汇总便于复制
        let out_text = format!(
            "Unix (seconds): {}\nUnix (millis): {}\nISO 8601: {}\nLocal ({}): {}\nRelative: {}",
            unix_seconds, unix_millis, iso8601, timezone, local, relative
        );

        let mut extra = serde_json::Map::new();
        extra.insert("unix_seconds".into(), serde_json::json!(unix_seconds));
        extra.insert("unix_millis".into(), serde_json::json!(unix_millis));
        extra.insert("iso8601".into(), serde_json::Value::String(iso8601));
        extra.insert("local".into(), serde_json::Value::String(local));
        extra.insert("relative".into(), serde_json::Value::String(relative));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(serde_json::Value::Object(extra)),
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "timestamp_converter",
    name: "Timestamp Converter",
    category: ToolCategory::Converter,
    icon: "clock",
    description: "Convert between Unix timestamps and date strings across timezones",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["timestamp", "date", "time", "unix", "timezone"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "description": "Unix timestamp or date string" },
        "params": {
            "type": "object",
            "properties": {
                "timezone": { "type": "string", "default": "UTC", "description": "IANA timezone (e.g. Asia/Shanghai) or +08:00" },
                "format": { "type": "string", "default": "ISO 8601" }
            }
        }
    },
    "required": ["text"]
});

register_tool!(TimestampConverter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    fn make_input_with_tz(text: &str, tz: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("timezone".to_string(), json!(tz));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_convert_unix_seconds() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("1690272000");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1690272000);
        assert_eq!(extra["unix_millis"], 1690272000000i64);
        assert_eq!(extra["iso8601"], "2023-07-25T08:00:00+00:00");
    }

    #[tokio::test]
    async fn test_convert_unix_millis() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("1690272000000");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1690272000);
        assert_eq!(extra["unix_millis"], 1690272000000i64);
    }

    #[tokio::test]
    async fn test_convert_iso8601_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("2023-07-25T08:00:00Z");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1690272000);
    }

    #[tokio::test]
    async fn test_convert_date_string_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("2023-07-25 08:00:00");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1690272000);
    }

    #[tokio::test]
    async fn test_convert_with_iana_timezone() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "Asia/Shanghai");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        // 上海时区应显示 +08:00
        let local = extra["local"].as_str().unwrap();
        assert!(local.contains("+08:00"));
    }

    #[tokio::test]
    async fn test_convert_with_fixed_offset_timezone() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "-05:00");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let local = extra["local"].as_str().unwrap();
        assert!(local.contains("-05:00"));
    }

    #[tokio::test]
    async fn test_convert_invalid_string_returns_parse_failed() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("not a date");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_empty_returns_invalid_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("   ");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_invalid_timezone_returns_invalid_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "Mars/Olympus");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_includes_relative_description() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        // 用一个明确的历史时间(2 天前左右)
        let now_secs = Utc::now().timestamp() - 2 * 24 * 3600;
        let input = make_input(&now_secs.to_string());

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let rel = extra["relative"].as_str().unwrap();
        assert!(rel.contains("days ago"));
    }
}
```

> **注意:** 需在 `src-tauri/Cargo.toml` 添加 `chrono-tz = "0.9"`(在 `[dependencies]` 段)。

- [ ] **Step 9.2: 运行测试验证失败**

Run: `cargo test -p qraft timestamp_converter -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 9.3: 在 mod.rs 声明模块 + 添加依赖**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod timestamp_converter;
```

Modify `src-tauri/Cargo.toml` `[dependencies]` 段追加:

```toml
chrono-tz = "0.9"
```

- [ ] **Step 9.4: 运行测试验证通过**

Run: `cargo test -p qraft timestamp_converter -- --nocapture`
Expected: PASS,9 个测试通过

- [ ] **Step 9.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/timestamp_converter.rs src-tauri/src/tools/mod.rs src-tauri/Cargo.toml
git commit -m "feat(tool:timestamp_converter): add Tool with unix/date input + IANA timezone + relative"
```

- [ ] **Step 9.6: 写失败 React 测试**

Create `src/tools/TimestampConverter.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimestampConverter } from './TimestampConverter';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('TimestampConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, timezone select and convert button', () => {
    render(<TimestampConverter toolId="timestamp_converter" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter timestamp/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text and default UTC timezone', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: 'Unix (seconds): 1690272000',
      extra: {
        unix_seconds: 1690272000,
        unix_millis: 1690272000000,
        iso8601: '2023-07-25T08:00:00+00:00',
        local: '2023-07-25T08:00:00+00:00',
        relative: '2 days ago',
      },
    });

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter timestamp/i), {
      target: { value: '1690272000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'timestamp_converter',
        input: { text: '1690272000', params: { timezone: 'UTC' } },
      });
    });
  });

  it('shows error alert when input is unparseable', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "cannot parse 'hello' as timestamp")
    );

    render(<TimestampConverter toolId="timestamp_converter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter timestamp/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 9.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/TimestampConverter.test.tsx`
Expected: FAIL,"Cannot find module './TimestampConverter'"

- [ ] **Step 9.8: 写 React 组件**

Create `src/tools/TimestampConverter.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface TimestampParams {
  timezone: string;
}

interface TimestampExtra {
  unix_seconds: number;
  unix_millis: number;
  iso8601: string;
  local: string;
  relative: string;
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export function TimestampConverter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: TimestampParams = { timezone };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as TimestampExtra | undefined;

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="ts-input" className="text-xs">
            Input (Unix seconds / millis / date string)
          </Label>
          <Input
            id="ts-input"
            placeholder="Enter timestamp or date string..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-sm"
            data-testid="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tz-select" className="text-xs">
            Timezone
          </Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="tz-select" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleConvert} disabled={loading || !text}>
          {loading ? 'Converting...' : 'Convert'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {extra && (
        <ScrollArea className="flex-1 rounded-md border p-4" data-testid="output">
          <dl className="grid grid-cols-[180px_1fr_auto] gap-x-4 gap-y-3 text-sm">
            <dt className="font-semibold">Unix (seconds)</dt>
            <dd className="font-mono">{extra.unix_seconds}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(String(extra.unix_seconds))}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Unix (millis)</dt>
            <dd className="font-mono">{extra.unix_millis}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(String(extra.unix_millis))}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">ISO 8601</dt>
            <dd className="font-mono break-all">{extra.iso8601}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(extra.iso8601)}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Local ({timezone})</dt>
            <dd className="font-mono break-all">{extra.local}</dd>
            <dd>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => handleCopy(extra.local)}
              >
                Copy
              </button>
            </dd>

            <dt className="font-semibold">Relative</dt>
            <dd className="font-mono">{extra.relative}</dd>
            <dd />
          </dl>
        </ScrollArea>
      )}
    </div>
  );
}
```

- [ ] **Step 9.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { TimestampConverter } from './TimestampConverter';
registerTool('timestamp_converter', TimestampConverter);
```

- [ ] **Step 9.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/TimestampConverter.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 9.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/TimestampConverter.tsx src/tools/TimestampConverter.test.tsx src/tools/registry.ts
git commit -m "feat(tool:timestamp_converter): add React UI with timezone select and multi-format output"
```

- [ ] **Step 9.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "Timestamp Converter",输入 `1690272000`,timezone=Asia/Shanghai,确认输出含 `2023-07-25T16:00:00+08:00`

- [ ] **Step 9.13: 验证 Task 9 完成**

确认:`timestamp_converter.rs` 9 个 Rust 测试、`TimestampConverter.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 10: color_converter

**Files:**
- Create: `src-tauri/src/tools/color_converter.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/ColorConverter.tsx`
- Create: `src/tools/ColorConverter.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格(07-tool-catalog.md):**
- params: `from_format` (string enum: hex/rgb/hsl, default hex)
- 输入 `text` 为颜色值
- 输出 `text` 为 "all formats",`extra` 含 `hex`/`rgb`/`hsl`
- errors: `ERR_INVALID_INPUT`(from_format 非法)、`ERR_PARSE_FAILED`(text 不符合指定格式)

- [ ] **Step 10.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/color_converter.rs`:

```rust
use async_trait::async_trait;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 256; // 颜色字符串很短

pub struct ColorConverter;

impl ColorConverter {
    pub fn new() -> Self {
        Self
    }
}

/// RGB 结构体,内部统一表示。
/// 所有格式先解析为 Rgb,再从 Rgb 序列化为 hex/rgb/hsl 字符串。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

impl Rgb {
    fn to_hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    fn to_rgb_string(&self) -> String {
        format!("rgb({}, {}, {})", self.r, self.g, self.b)
    }

    /// 转 HSL。标准算法,参考 https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB
    fn to_hsl(&self) -> (f64, f64, f64) {
        let r = self.r as f64 / 255.0;
        let g = self.g as f64 / 255.0;
        let b = self.b as f64 / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        if (max - min).abs() < f64::EPSILON {
            // 灰度,色相与饱和度无意义
            return (0.0, 0.0, l * 100.0);
        }
        let d = max - min;
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min)
        };
        let h = if max == r {
            ((g - b) / d) % 6.0
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        let h_deg = h * 60.0;
        let h_norm = if h_deg < 0.0 { h_deg + 360.0 } else { h_deg };
        (h_norm, s * 100.0, l * 100.0)
    }

    fn to_hsl_string(&self) -> String {
        let (h, s, l) = self.to_hsl();
        format!("hsl({:.0}, {:.0}%, {:.0}%)", h, s, l)
    }
}

/// 解析 hex 字符串:`#rgb` / `#rrggbb` / `rgb` / `rrggbb`(大小写不敏感)
fn parse_hex(s: &str) -> Result<Rgb, ToolError> {
    let s = s.trim().trim_start_matches('#').to_lowercase();
    if !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ToolError::ParseFailed(format!(
            "invalid hex characters in '{}'",
            s
        )));
    }
    let (r, g, b) = match s.len() {
        3 => {
            // 简写 #abc → #aabbcc
            let r = u8::from_str_radix(&s[0..1].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex r: {}", e)))?;
            let g = u8::from_str_radix(&s[1..2].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex g: {}", e)))?;
            let b = u8::from_str_radix(&s[2..3].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex b: {}", e)))?;
            (r, g, b)
        }
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex r: {}", e)))?;
            let g = u8::from_str_radix(&s[2..4], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex g: {}", e)))?;
            let b = u8::from_str_radix(&s[4..6], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex b: {}", e)))?;
            (r, g, b)
        }
        n => {
            return Err(ToolError::ParseFailed(format!(
                "hex string must be 3 or 6 digits, got {}",
                n
            )));
        }
    };
    Ok(Rgb { r, g, b })
}

/// 解析 `rgb(r, g, b)`,允许空格灵活。
fn parse_rgb(s: &str) -> Result<Rgb, ToolError> {
    let trimmed = s.trim();
    let inner = trimmed
        .strip_prefix("rgb(")
        .and_then(|t| t.strip_suffix(')'))
        .ok_or_else(|| ToolError::ParseFailed(format!("expected 'rgb(r, g, b)', got '{}'", s)))?;
    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() != 3 {
        return Err(ToolError::ParseFailed(format!(
            "rgb() must have 3 components, got {}",
            parts.len()
        )));
    }
    let parse_comp = |p: &str| -> Result<u8, ToolError> {
        let n: i32 = p
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("rgb component '{}': {}", p, e)))?;
        if !(0..=255).contains(&n) {
            return Err(ToolError::ParseFailed(format!(
                "rgb component must be 0-255, got {}",
                n
            )));
        }
        Ok(n as u8)
    };
    Ok(Rgb {
        r: parse_comp(parts[0])?,
        g: parse_comp(parts[1])?,
        b: parse_comp(parts[2])?,
    })
}

/// 解析 `hsl(h, s%, l%)`,h: 0-360,s/l: 0-100。
fn parse_hsl(s: &str) -> Result<Rgb, ToolError> {
    let trimmed = s.trim();
    let inner = trimmed
        .strip_prefix("hsl(")
        .and_then(|t| t.strip_suffix(')'))
        .ok_or_else(|| ToolError::ParseFailed(format!("expected 'hsl(h, s%, l%)', got '{}'", s)))?;
    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() != 3 {
        return Err(ToolError::ParseFailed(format!(
            "hsl() must have 3 components, got {}",
            parts.len()
        )));
    }
    let h: f64 = parts[0]
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl hue: {}", e)))?;
    let s_pct: f64 = parts[1]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl saturation: {}", e)))?;
    let l_pct: f64 = parts[2]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl lightness: {}", e)))?;
    if !(0.0..=360.0).contains(&h) {
        return Err(ToolError::ParseFailed(format!(
            "hue must be 0-360, got {}",
            h
        )));
    }
    if !(0.0..=100.0).contains(&s_pct) || !(0.0..=100.0).contains(&l_pct) {
        return Err(ToolError::ParseFailed(format!(
            "saturation/lightness must be 0-100, got {} / {}",
            s_pct, l_pct
        )));
    }
    Ok(hsl_to_rgb(h, s_pct / 100.0, l_pct / 100.0))
}

/// HSL → RGB,标准算法。
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> Rgb {
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return Rgb { r: v, g: v, b: v };
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let hue_to_rgb = |p: f64, q: f64, mut t: f64| -> f64 {
        if t < 0.0 { t += 1.0; }
        if t > 1.0 { t -= 1.0; }
        if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
        if t < 0.5 { return q; }
        if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
        p
    };
    let h_norm = h / 360.0;
    let r = hue_to_rgb(p, q, h_norm + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h_norm);
    let b = hue_to_rgb(p, q, h_norm - 1.0 / 3.0);
    Rgb {
        r: (r * 255.0).round() as u8,
        g: (g * 255.0).round() as u8,
        b: (b * 255.0).round() as u8,
    }
}

fn parse_color(text: &str, from_format: &str) -> Result<Rgb, ToolError> {
    match from_format {
        "hex" => parse_hex(text),
        "rgb" => parse_rgb(text),
        "hsl" => parse_hsl(text),
        other => Err(ToolError::InvalidInput(format!(
            "from_format must be 'hex', 'rgb' or 'hsl', got '{}'",
            other
        ))),
    }
}

#[async_trait]
impl Tool for ColorConverter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }
        let from_format: String =
            input.param("from_format").unwrap_or_else(|_| "hex".to_string());

        let start = Instant::now();
        let rgb = parse_color(&text, &from_format)?;
        let hex = rgb.to_hex();
        let rgb_str = rgb.to_rgb_string();
        let hsl_str = rgb.to_hsl_string();

        let out_text = format!("HEX: {}\nRGB: {}\nHSL: {}", hex, rgb_str, hsl_str);

        let mut extra = serde_json::Map::new();
        extra.insert("hex".into(), serde_json::Value::String(hex));
        extra.insert("rgb".into(), serde_json::Value::String(rgb_str));
        extra.insert("hsl".into(), serde_json::Value::String(hsl_str));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(serde_json::Value::Object(extra)),
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "color_converter",
    name: "Color Converter",
    category: ToolCategory::Converter,
    icon: "palette",
    description: "Convert colors between HEX, RGB and HSL formats",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["color", "hex", "rgb", "hsl", "converter"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "description": "color value" },
        "params": {
            "type": "object",
            "properties": {
                "from_format": {
                    "type": "string",
                    "enum": ["hex", "rgb", "hsl"],
                    "default": "hex"
                }
            }
        }
    },
    "required": ["text"]
});

register_tool!(ColorConverter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str, from_format: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("from_format".to_string(), json!(from_format));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_convert_hex_six_digits() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
        assert_eq!(extra["rgb"], "rgb(255, 87, 51)");
    }

    #[tokio::test]
    async fn test_convert_hex_three_digits() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#abc", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#aabbcc");
        assert_eq!(extra["rgb"], "rgb(170, 187, 204)");
    }

    #[tokio::test]
    async fn test_convert_hex_without_hash() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("ff5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
    }

    #[tokio::test]
    async fn test_convert_rgb_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("rgb(255, 87, 51)", "rgb");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
        assert_eq!(extra["rgb"], "rgb(255, 87, 51)");
    }

    #[tokio::test]
    async fn test_convert_hsl_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        // hsl(0, 100%, 50%) 应为纯红 #ff0000
        let input = make_input("hsl(0, 100%, 50%)", "hsl");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff0000");
        assert_eq!(extra["rgb"], "rgb(255, 0, 0)");
    }

    #[tokio::test]
    async fn test_convert_hsl_gray() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        // hsl(0, 0%, 50%) 应为 #808080
        let input = make_input("hsl(0, 0%, 50%)", "hsl");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#808080");
    }

    #[tokio::test]
    async fn test_convert_invalid_hex_returns_parse_failed() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#xyz", "hex");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_rgb_out_of_range_returns_parse_failed() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("rgb(300, 0, 0)", "rgb");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_invalid_from_format_returns_invalid_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff5733", "cmyk");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_hex_uppercase_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#FF5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        // 输出统一小写
        assert_eq!(extra["hex"], "#ff5733");
    }
}
```

- [ ] **Step 10.2: 运行测试验证失败**

Run: `cargo test -p qraft color_converter -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 10.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod color_converter;
```

- [ ] **Step 10.4: 运行测试验证通过**

Run: `cargo test -p qraft color_converter -- --nocapture`
Expected: PASS,9 个测试通过

- [ ] **Step 10.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/color_converter.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:color_converter): add Tool with hex/rgb/hsl parsing and conversion, 9 unit tests"
```

- [ ] **Step 10.6: 写失败 React 测试**

Create `src/tools/ColorConverter.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColorConverter } from './ColorConverter';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('ColorConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input, format select and convert button', () => {
    render(<ColorConverter toolId="color_converter" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter color/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text and from_format=hex by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: 'HEX: #ff5733\nRGB: rgb(255, 87, 51)\nHSL: hsl(11, 100%, 60%)',
      extra: {
        hex: '#ff5733',
        rgb: 'rgb(255, 87, 51)',
        hsl: 'hsl(11, 100%, 60%)',
      },
    });

    render(<ColorConverter toolId="color_converter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter color/i), {
      target: { value: '#ff5733' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'color_converter',
        input: { text: '#ff5733', params: { from_format: 'hex' } },
      });
    });
  });

  it('shows error alert when input is invalid hex', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', "invalid hex characters in 'xyz'")
    );

    render(<ColorConverter toolId="color_converter" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter color/i), {
      target: { value: '#xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 10.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/ColorConverter.test.tsx`
Expected: FAIL,"Cannot find module './ColorConverter'"

- [ ] **Step 10.8: 写 React 组件**

Create `src/tools/ColorConverter.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface ColorParams {
  from_format: 'hex' | 'rgb' | 'hsl';
}

interface ColorExtra {
  hex: string;
  rgb: string;
  hsl: string;
}

export function ColorConverter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [fromFormat, setFromFormat] = useState<'hex' | 'rgb' | 'hsl'>('hex');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: ColorParams = { from_format: fromFormat };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as ColorExtra | undefined;

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="color-input" className="text-xs">
            Color value
          </Label>
          <Input
            id="color-input"
            placeholder="Enter color value..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-sm"
            data-testid="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="format-select" className="text-xs">
            From format
          </Label>
          <Select
            value={fromFormat}
            onValueChange={(v) => setFromFormat(v as 'hex' | 'rgb' | 'hsl')}
          >
            <SelectTrigger id="format-select" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hex">HEX</SelectItem>
              <SelectItem value="rgb">RGB</SelectItem>
              <SelectItem value="hsl">HSL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleConvert} disabled={loading || !text}>
          {loading ? 'Converting...' : 'Convert'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {extra && (
        <div className="grid grid-cols-2 gap-4 flex-1" data-testid="output">
          <div className="flex flex-col gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold text-muted-foreground">Preview</div>
              <div
                className="mt-2 h-24 rounded-md border"
                style={{ backgroundColor: extra.hex }}
                aria-label={`color swatch ${extra.hex}`}
              />
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="grid grid-cols-[60px_1fr_auto] gap-x-3 gap-y-2">
                <span className="font-semibold">HEX</span>
                <code className="font-mono">{extra.hex}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.hex)}
                >
                  Copy
                </button>
                <span className="font-semibold">RGB</span>
                <code className="font-mono">{extra.rgb}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.rgb)}
                >
                  Copy
                </button>
                <span className="font-semibold">HSL</span>
                <code className="font-mono">{extra.hsl}</code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => handleCopy(extra.hsl)}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          <Textarea
            readOnly
            value={output?.text ?? ''}
            className="flex-1 font-mono text-sm"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { ColorConverter } from './ColorConverter';
registerTool('color_converter', ColorConverter);
```

- [ ] **Step 10.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/ColorConverter.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 10.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/ColorConverter.tsx src/tools/ColorConverter.test.tsx src/tools/registry.ts
git commit -m "feat(tool:color_converter): add React UI with format select and color preview"
```

- [ ] **Step 10.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "Color Converter",输入 `#ff5733`,from_format=hex,确认输出含 `rgb(255, 87, 51)` 与色块预览

- [ ] **Step 10.13: 验证 Task 10 完成**

确认:`color_converter.rs` 9 个 Rust 测试、`ColorConverter.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 11: regex_tester

**Files:**
- Create: `src-tauri/src/tools/regex_tester.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Create: `src/tools/RegexTester.tsx`
- Create: `src/tools/RegexTester.test.tsx`
- Modify: `src/tools/registry.ts`

**PRD 规格(07-tool-catalog.md):**
- params: `pattern` (string, required)、`flags` (string, default "", 支持 gim)
- 输入 `text` 为待匹配文本
- 输出 `text` 为匹配汇总,`extra` 含 `matches` 数组(每项 `match`/`index`/`groups`)与 `match_count`
- errors: `ERR_INVALID_INPUT`(pattern 缺失)、`ERR_PARSE_FAILED`(正则编译失败)

- [ ] **Step 11.1: 写失败 Rust 测试**

Create `src-tauri/src/tools/regex_tester.rs`:

```rust
use async_trait::async_trait;
use regex::RegexBuilder;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 1024 * 1024; // 1MB

pub struct RegexTester;

impl RegexTester {
    pub fn new() -> Self {
        Self
    }
}

/// 解析 JS 风格的 flags 字符串(g/i/m/s/x),应用到 RegexBuilder。
/// Rust regex 不支持 'g'(总是返回所有匹配),因此 'g' 被识别但不映射到 builder。
fn apply_flags(builder: &mut RegexBuilder, flags: &str) {
    for ch in flags.chars() {
        match ch {
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            'x' => {
                builder.ignore_whitespace(true);
            }
            'g' | 'u' | 'y' => {
                // JS 特有 flag,Rust 端语义不同,接受但忽略
            }
            _ => {} // 未知 flag 忽略,不报错(宽容策略)
        }
    }
}

#[async_trait]
impl Tool for RegexTester {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }
        let pattern: String = input.param("pattern")?;
        if pattern.is_empty() {
            return Err(ToolError::InvalidInput("pattern must not be empty".to_string()));
        }
        let flags: String = input.param("flags").unwrap_or_default();

        let start = Instant::now();
        let mut builder = RegexBuilder::new(&pattern);
        apply_flags(&mut builder, &flags);
        let re = builder
            .build()
            .map_err(|e| ToolError::ParseFailed(format!("regex compile error: {}", e)))?;

        // 始终返回所有匹配(等同于 JS 中带 g flag 的行为)
        let mut matches_arr: Vec<Value> = Vec::new();
        for caps in re.captures_iter(&text) {
            // caps[0] 是整体匹配
            let full = caps.get(0).unwrap();
            let mut groups: Vec<Value> = Vec::new();
            for i in 1..caps.len() {
                if let Some(m) = caps.get(i) {
                    groups.push(Value::String(m.as_str().to_string()));
                } else {
                    groups.push(Value::Null);
                }
            }
            matches_arr.push(serde_json::json!({
                "match": full.as_str().to_string(),
                "index": full.start(),
                "groups": groups,
            }));
        }
        let match_count = matches_arr.len() as u64;

        let out_text = format!(
            "Pattern: /{}/{}\nMatches: {}\n\n{}",
            pattern,
            flags,
            match_count,
            matches_arr
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    let s = m["match"].as_str().unwrap_or("");
                    let idx = m["index"].as_u64().unwrap_or(0);
                    format!("#{} @{}: \"{}\"", i + 1, idx, s)
                })
                .collect::<Vec<_>>()
                .join("\n")
        );

        let mut extra = serde_json::Map::new();
        extra.insert("matches".into(), Value::Array(matches_arr));
        extra.insert("match_count".into(), serde_json::json!(match_count));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(Value::Object(extra)),
            meta: Some(OutputMeta {
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "regex_tester",
    name: "Regex Tester",
    category: ToolCategory::Parser,
    icon: "regex",
    description: "Test regex patterns against input text with capture groups",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["regex", "pattern", "match", "test"],
    version: "1.0.0",
    timeout_secs: Some(10),
    streaming_supported: false,
};

static JSON_SCHEMA: serde_json::Value = serde_json::json!({
    "type": "object",
    "properties": {
        "text": { "type": "string", "format": "textarea", "description": "test text" },
        "params": {
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "regex pattern" },
                "flags": { "type": "string", "default": "", "description": "gim flags" }
            },
            "required": ["pattern"]
        }
    },
    "required": ["text", "params"]
});

register_tool!(RegexTester, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;

    fn make_input(text: &str, pattern: &str, flags: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("pattern".to_string(), json!(pattern));
        params.insert("flags".to_string(), json!(flags));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_simple_match() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello world", "world", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 1);
        let m = &extra["matches"][0];
        assert_eq!(m["match"], "world");
        assert_eq!(m["index"], 6);
    }

    #[tokio::test]
    async fn test_global_flag_finds_all() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("foo bar foo baz foo", "foo", "g");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 3);
    }

    #[tokio::test]
    async fn test_case_insensitive_flag() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("Hello HELLO hello", "hello", "gi");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 3);
    }

    #[tokio::test]
    async fn test_capture_groups() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // (\w+)\s+(\w+) 匹配 word pair
        let input = make_input("hello world", r"(\w+)\s+(\w+)", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let m = &extra["matches"][0];
        assert_eq!(m["match"], "hello world");
        assert_eq!(m["groups"][0], "hello");
        assert_eq!(m["groups"][1], "world");
    }

    #[tokio::test]
    async fn test_multiline_flag() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // 默认 ^ 匹配整个输入开头;开启 m 后 ^ 匹配每行开头
        let input = make_input("line1\nline2", "^line", "gm");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 2);
    }

    #[tokio::test]
    async fn test_no_matches_returns_empty_array() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello world", "xyz", "");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["match_count"], 0);
        assert_eq!(extra["matches"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_invalid_pattern_returns_parse_failed() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        // 未闭合的分组
        let input = make_input("hello", "(unclosed", "");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_empty_pattern_returns_invalid_input() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = make_input("hello", "", "");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_pattern_missing_returns_invalid_input() {
        let tool = RegexTester::new();
        let ctx = mock_context();
        let input = ToolInput {
            text: Some("hello".to_string()),
            file_path: None,
            params: HashMap::new(),
        };

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }
}
```

- [ ] **Step 11.2: 运行测试验证失败**

Run: `cargo test -p qraft regex_tester -- --nocapture`
Expected: 编译失败,`cannot find module`

- [ ] **Step 11.3: 在 mod.rs 声明模块**

Modify `src-tauri/src/tools/mod.rs`,追加:

```rust
pub mod regex_tester;
```

- [ ] **Step 11.4: 运行测试验证通过**

Run: `cargo test -p qraft regex_tester -- --nocapture`
Expected: PASS,8 个测试通过

- [ ] **Step 11.5: clippy + 提交 Rust**

Run: `cargo clippy -p qraft -- -D warnings`

```bash
git add src-tauri/src/tools/regex_tester.rs src-tauri/src/tools/mod.rs
git commit -m "feat(tool:regex_tester): add Tool with pattern/flags + capture groups, 8 unit tests"
```

- [ ] **Step 11.6: 写失败 React 测试**

Create `src/tools/RegexTester.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegexTester } from './RegexTester';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
}));

describe('RegexTester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pattern input, flags input, test textarea and test button', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as any} />);
    expect(screen.getByPlaceholderText(/enter regex pattern/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/flags/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter test text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test/i })).toBeInTheDocument();
  });

  it('calls tool_execute with pattern, flags and text', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as any).mockResolvedValue({
      text: 'Pattern: /world/g\nMatches: 1',
      extra: {
        matches: [{ match: 'world', index: 6, groups: [] }],
        match_count: 1,
      },
    });

    render(<RegexTester toolId="regex_tester" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter regex pattern/i), {
      target: { value: 'world' },
    });
    fireEvent.change(screen.getByPlaceholderText(/flags/i), {
      target: { value: 'g' },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter test text/i), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'regex_tester',
        input: {
          text: 'hello world',
          params: { pattern: 'world', flags: 'g' },
        },
      });
    });
  });

  it('shows error alert when pattern is invalid', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as any).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'regex compile error: unclosed group')
    );

    render(<RegexTester toolId="regex_tester" metadata={null as any} />);
    fireEvent.change(screen.getByPlaceholderText(/enter regex pattern/i), {
      target: { value: '(unclosed' },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter test text/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(screen.getByText(/parse failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 11.7: 运行 React 测试验证失败**

Run: `pnpm test -- src/tools/RegexTester.test.tsx`
Expected: FAIL,"Cannot find module './RegexTester'"

- [ ] **Step 11.8: 写 React 组件**

Create `src/tools/RegexTester.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface RegexParams {
  pattern: string;
  flags: string;
}

interface RegexMatch {
  match: string;
  index: number;
  groups: (string | null)[];
}

interface RegexExtra {
  matches: RegexMatch[];
  match_count: number;
}

export function RegexTester({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTest() {
    setLoading(true);
    setError(null);
    try {
      const params: RegexParams = { pattern, flags };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as RegexExtra | undefined;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="grid grid-cols-[1fr_120px_auto] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pattern-input" className="text-xs">
            Pattern
          </Label>
          <Input
            id="pattern-input"
            placeholder="Enter regex pattern..."
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="font-mono text-sm"
            data-testid="pattern"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="flags-input" className="text-xs">
            Flags
          </Label>
          <Input
            id="flags-input"
            placeholder="flags"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <Button onClick={handleTest} disabled={loading || !pattern || !text}>
          {loading ? 'Testing...' : 'Test'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1">
        <div className="flex flex-col gap-2">
          <Label>Test text</Label>
          <Textarea
            placeholder="Enter test text..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 font-mono text-sm"
            data-testid="input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Matches</Label>
            {extra && (
              <span className="text-xs text-muted-foreground">
                {extra.match_count} match{extra.match_count === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : extra ? (
            <ScrollArea className="flex-1 rounded-md border p-3" data-testid="output">
              <ul className="space-y-2 text-sm">
                {extra.matches.map((m, i) => (
                  <li key={i} className="border-b pb-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{i + 1} @{m.index}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                        {m.match}
                      </code>
                    </div>
                    {m.groups.length > 0 && (
                      <div className="mt-1 pl-4 text-xs text-muted-foreground">
                        groups:{' '}
                        {m.groups.map((g, gi) => (
                          <span key={gi} className="font-mono">
                            [{gi + 1}]={g ?? '<none>'}{' '}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
                {extra.matches.length === 0 && (
                  <li className="text-sm text-muted-foreground">No matches found.</li>
                )}
              </ul>
            </ScrollArea>
          ) : (
            <Textarea readOnly value="" className="flex-1 font-mono text-sm" data-testid="output" />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.9: 在 registry.ts 注册**

Modify `src/tools/registry.ts`,末尾追加:

```typescript
import { RegexTester } from './RegexTester';
registerTool('regex_tester', RegexTester);
```

- [ ] **Step 11.10: 运行 React 测试验证通过**

Run: `pnpm test -- src/tools/RegexTester.test.tsx`
Expected: PASS,3 个测试通过

- [ ] **Step 11.11: lint + 提交 React**

Run: `pnpm lint && pnpm tsc --noEmit`

```bash
git add src/tools/RegexTester.tsx src/tools/RegexTester.test.tsx src/tools/registry.ts
git commit -m "feat(tool:regex_tester): add React UI with pattern/flags inputs and match list"
```

- [ ] **Step 11.12: 集成冒烟**

Run: `pnpm tauri dev`,在 SideNav 点击 "Regex Tester",输入 pattern=`\d+`,flags=`g`,text=`a1 b22 c333`,确认输出 3 个匹配(1 / 22 / 333)

- [ ] **Step 11.13: 验证 Task 11 完成**

确认:`regex_tester.rs` 8 个 Rust 测试、`RegexTester.test.tsx` 3 个 React 测试通过,registry 已注册

---

## Task 12: 集成验证

**Files:**
- Create: `src-tauri/tests/p0_tools_integration.rs`
- Create: `src/tools/registry.integration.test.ts`
- Modify: `src-tauri/src/tools/mod.rs`(确保 10 个工具都已声明)

**目标:** 验证 10 个 P0 工具在 Rust 与 React 双端均完整注册,所有单元测试通过,UI 可在 `pnpm tauri dev` 中正常使用。

- [ ] **Step 12.1: 写 Rust 集成测试 — 所有 P0 工具已注册**

Create `src-tauri/tests/p0_tools_integration.rs`:

```rust
//! P0 工具集成测试:验证 10 个工具均已被 inventory 收录到 ToolRegistry。
//! 这是对子计划 05 整体交付的回归测试,任何工具被误删或未声明 mod 都会被发现。

use qraft::core::registry::ToolRegistry;

const P0_TOOL_IDS: &[&str] = &[
    "json_formatter",
    "json_minifier",
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
            registered_ids.iter().any(|id| *id == *tool_id),
            "missing P0 tool registration: {}",
            tool_id
        );
    }
}

#[test]
fn test_p0_tool_ids_unique() {
    let registry = ToolRegistry::global();
    let mut ids: Vec<&str> = registry.list().iter().map(|m| m.id).collect();
    ids.sort();
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
        assert!(!meta.description.is_empty(), "tool description empty for {}", meta.id);
        assert!(!meta.tags.is_empty(), "tool tags empty for {}", meta.id);
        assert!(!meta.version.is_empty(), "tool version empty for {}", meta.id);
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
        streaming_ids.iter().any(|id| *id == "json_formatter"),
        "json_formatter should be streaming"
    );
    assert!(
        streaming_ids.iter().any(|id| *id == "hash_calculator"),
        "hash_calculator should be streaming"
    );
}
```

- [ ] **Step 12.2: 运行集成测试验证通过**

Run: `cargo test -p qraft --test p0_tools_integration -- --nocapture`
Expected: PASS,4 个测试通过

若失败,逐个确认 `src-tauri/src/tools/mod.rs` 中是否已声明所有 10 个模块:

```rust
pub mod json_formatter;
pub mod json_minifier;
pub mod base64_codec;
pub mod url_codec;
pub mod jwt_parser;
pub mod uuid_generator;
pub mod hash_calculator;
pub mod timestamp_converter;
pub mod color_converter;
pub mod regex_tester;
```

- [ ] **Step 12.3: 写 React 注册表集成测试**

Create `src/tools/registry.integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getToolComponent } from './registry';

// 必须在 import registry.ts 之后再 import 各工具,而 registry.ts 末尾已 import 所有工具,
// 因此这里只需 import 一次 registry 模块即可触发全部注册。
import './registry';

const P0_TOOL_IDS = [
  'json_formatter',
  'json_minifier',
  'base64_codec',
  'url_codec',
  'jwt_parser',
  'uuid_generator',
  'hash_calculator',
  'timestamp_converter',
  'color_converter',
  'regex_tester',
] as const;

describe('P0 工具 UI 注册集成测试', () => {
  it('registers all 10 P0 tool components', () => {
    for (const id of P0_TOOL_IDS) {
      const Comp = getToolComponent(id);
      expect(Comp, `tool UI not registered: ${id}`).not.toBeNull();
    }
  });

  it('registers 10 distinct components', () => {
    const seen = new Set();
    for (const id of P0_TOOL_IDS) {
      const Comp = getToolComponent(id);
      // 每个 id 对应不同组件(以函数引用区分)
      seen.add(Comp);
    }
    expect(seen.size).toBe(P0_TOOL_IDS.length);
  });
});
```

- [ ] **Step 12.4: 运行 React 集成测试验证通过**

Run: `pnpm test -- src/tools/registry.integration.test.ts`
Expected: PASS,2 个测试通过

- [ ] **Step 12.5: 跑全量 Rust 测试 + clippy**

Run: `cargo test -p qraft -- --nocapture && cargo clippy -p qraft -- -D warnings`
Expected: 所有单元测试 + 集成测试全部通过,无 clippy 警告

- [ ] **Step 12.6: 跑全量 React 测试 + lint + 类型检查**

Run: `pnpm test && pnpm lint && pnpm tsc --noEmit`
Expected: 所有 Vitest 测试通过,无 lint 错误,无 TypeScript 错误

- [ ] **Step 12.7: 端到端冒烟**

Run: `pnpm tauri dev`

依次在 SideNav 中切换到 10 个工具,各执行一次典型输入并确认输出正确:

| 工具 | 典型输入 | 期望输出 |
|------|----------|----------|
| json_formatter | `{"b":1,"a":2}` indent=2 sort=on | 按键名排序的 pretty JSON |
| json_minifier | `{ "a": 1 }` | `{"a":1}` |
| base64_codec | `hello`,encode | `aGVsbG8=` |
| url_codec | `hello world`,encode | `hello%20world` |
| jwt_parser | jwt.io 示例 token | header + payload + signature |
| uuid_generator | v4,count=5 | 5 行 UUID |
| hash_calculator | `hello`,sha256 | `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` |
| timestamp_converter | `1690272000`,tz=Asia/Shanghai | `2023-07-25T16:00:00+08:00` |
| color_converter | `#ff5733`,hex | `rgb(255, 87, 51)` + 色块预览 |
| regex_tester | `\d+` flags=g text=`a1 b22` | 2 个匹配 |

- [ ] **Step 12.8: 验证 Task 12 完成 + 提交**

确认:
- `p0_tools_integration.rs` 4 个 Rust 集成测试通过
- `registry.integration.test.ts` 2 个 React 集成测试通过
- 全量 Rust + React 测试通过
- 10 个工具在 `pnpm tauri dev` 中均能正常工作

```bash
git add src-tauri/tests/p0_tools_integration.rs src/tools/registry.integration.test.ts
git commit -m "test(p0): add integration tests verifying all 10 P0 tools registered"
```

---

## Self-Review

### 1. Spec 覆盖核对

对照 `07-tool-catalog.md` 中列出的 10 个 P0 工具,逐一确认在计划中有对应 Task:

| 工具 ID | 对应 Task | Rust 测试数 | React 测试数 | 流式 | 备注 |
|---------|-----------|------------|--------------|------|------|
| json_formatter | Task 2 | 9 | 3 | ✅ | 含 sort_keys / indent 参数 |
| json_minifier | Task 3 | 6 | 3 | ❌ | 无参数 |
| base64_codec | Task 4 | 7 | 3 | ❌ | encode/decode + url_safe |
| url_codec | Task 5 | 7 | 3 | ❌ | encodeURI/encodeURIComponent |
| jwt_parser | Task 6 | 7 | 3 | ❌ | 不验证签名,内部直接调 base64 crate |
| uuid_generator | Task 7 | 8 | 3 | ❌ | v4/v7 + count + uppercase + hyphens |
| hash_calculator | Task 8 | 9 | 3 | ✅ | md5/sha1/sha256/sha512/blake3 + 文件路径 |
| timestamp_converter | Task 9 | 9 | 3 | ❌ | unix 秒/毫秒 + 日期字符串 + IANA 时区 |
| color_converter | Task 10 | 9 | 3 | ❌ | hex/rgb/hsl 互转 |
| regex_tester | Task 11 | 8 | 3 | ❌ | pattern + gim flags + 捕获组 |
| **合计** | | **79** | **30** | 2 个 | |

覆盖完整,所有 10 个工具均有对应的 Rust 实现 + React UI + 测试。

### 2. 占位符扫描

逐项检查每个 Task 是否存在占位符("TBD"、"TODO"、"implement later"、"Similar to Task N"、"Add appropriate error handling" 等):

- ✅ 所有 Rust 实现都给出了完整代码(含结构体、trait 实现、metadata、register 宏、测试)
- ✅ 所有 React 组件都给出了完整 JSX(含 state、handler、错误显示)
- ✅ 所有测试都给出了具体的 `assert_eq!` / `expect()` 断言,而非"write tests for the above"
- ✅ 所有命令都给出了具体 Run 指令 + Expected 期望输出
- ✅ 没有出现"Similar to Task N, repeat the code"——每个工具的实现都独立展示

### 3. 类型一致性

跨 Task 检查类型与命名是否一致:

| 类型/符号 | 定义位置 | 使用位置 | 一致性 |
|-----------|----------|----------|--------|
| `Tool` trait | Task 2 引用 `crate::core::tool::Tool` | Tasks 2-11 全部引用 | ✅ 一致 |
| `ToolMetadata` 字段(id/name/category/icon/description/input_schema/output_schema/tags/version/timeout_secs/streaming_supported) | Task 2 首次使用 | 所有后续 Task 沿用相同字段集 | ✅ 一致 |
| `ToolCategory` 变体(Formatter/Encoder/Generator/Parser/Converter/Comparator) | 由 05-rust-core-engine.md §3.1 定义 | Task 2/3=Formatter,Task 4/5/8=Encoder,Task 6/11=Parser,Task 7=Generator,Task 9/10=Converter | ✅ 全部合法 |
| `ToolInput` 字段(text/file_path/params) | 由 08-data-model.md §3.1 定义 | 所有 Task 中 `make_input` 辅助函数均使用相同结构 | ✅ 一致 |
| `ToolOutput` 字段(text/extra/meta/alerts) | 由 08-data-model.md §3.1 定义 | 所有 Task 返回 `ToolOutput { text, extra, meta: Some(...), alerts: Vec::new() }` | ✅ 一致 |
| `ToolError` 变体(InvalidInput/ParseFailed/InputTooLarge/Internal) | 由 05-rust-core-engine.md 定义 | 所有 Task 使用相同变体命名 | ✅ 一致 |
| `register_tool!` 宏 | Task 2 引用 `crate::register_tool` | Tasks 2-11 全部引用 | ✅ 一致 |
| `register_stream_tool!` 宏 | Task 2/8 引用 `crate::register_stream_tool` | 仅 Task 2 与 Task 8 使用,与 PRD 流式标记一致 | ✅ 一致 |
| `ToolProps` 接口(toolId/metadata) | Task 1 定义 | Tasks 2-11 所有 React 组件签名 `({ toolId }: ToolProps)` | ✅ 一致 |
| `invokeCommand` 签名 | Tasks 2-11 全部以 `invokeCommand<ToolOutput>('tool_execute', { toolId, input: { text, params } })` 调用 | ✅ 一致 |
| `CommandError` 错误码(ERR_INVALID_INPUT/ERR_PARSE_FAILED/ERR_INPUT_TOO_LARGE) | 由 PRD 定义 | 所有 React 测试中使用相同错误码字符串 | ✅ 一致 |
| Cargo.toml 新增依赖(base64/url/jsonwebtoken/uuid/sha2/sha3/blake3/md-5/hex/chrono/regex/percent-encoding/chrono-tz) | 由"前置依赖"段集中声明 + Task 8/9 补充 tempfile/chrono-tz | 各 Task 引用对应 crate | ✅ 一致 |

### 4. 风险与边界条件

已识别并在测试中覆盖的边界条件:

- **超大输入**:Tasks 2/3/8/9/10/11 均有 `InputTooLarge` 测试
- **空输入**:Tasks 2/3/9/11 均有空字符串/空 pattern 的 `InvalidInput` 测试
- **非法参数**:Tasks 4/5/7/8/10/11 均有非法 action/version/algorithm/from_format/pattern 的 `InvalidInput` 测试
- **解析失败**:所有解析类工具(Tasks 2/3/4/5/6/9/10/11)均有 `ParseFailed` 测试
- **边界值**:Task 7 测试 count=0/count=1001;Task 10 测试 rgb(300,0,0) 越界;Task 9 测试 13 位毫秒 vs 10 位秒
- **大小写/空格容错**:Task 10 测试 `#FF5733` 大写输入;Task 9 测试 `"  1690272000  "` 带空格输入
- **多字节字符**:Task 5 测试 `%E4%B8%AD%E6%96%87` 解码为"中文"

### 5. 提交规范核对

所有 Task 的 git commit message 遵循 `feat(tool:<id>): <description>` 格式,集成测试为 `test(p0): <description>`。每个 Task 至少 2 次提交(Rust 一次、React 一次),Task 2/8(流式工具)额外多一次。

---

## 执行建议

**Plan complete and saved to `d:\DevTools\project\qraft\prd\plans\05-p0-tools.md`. Two execution options:**

**1. Subagent-Driven(推荐)** - 每个 Task 派发独立 subagent,Task 间做 review,迭代快。适合本计划:每个 Task 是独立的工具,互不依赖(除了 Task 12 集成验证依赖前 11 个)。

**2. Inline Execution** - 在当前会话内按 Task 顺序执行,带 checkpoint review。

**建议选择:** Subagent-Driven,因为:
- Task 1 必须最先完成(其他 Task 都需修改 `registry.ts`)
- Tasks 2-11 之间无依赖,可并行(但都依赖 Task 1)
- Task 12 必须最后执行,验证所有前序 Task

执行顺序拓扑:
```
Task 1 → Tasks 2-11(可并行)→ Task 12
```