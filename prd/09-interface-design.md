---
title: 接口设计
version: v1.0
last_updated: 2026-07-25
author: [wait]
audience: 一年经验的开发者
---

## 目录

- [1. 背景与目的](#1-背景与目的)
- [2. 核心概念](#2-核心概念)
- [3. 详细设计](#3-详细设计)
  - [3.1 IPC Command 规范](#31-ipc-command-规范)
  - [3.2 统一响应包络](#32-统一响应包络)
  - [3.3 Command 完整清单](#33-command-完整清单)
  - [3.4 Rust 公共 Trait 接口](#34-rust-公共-trait-接口)
  - [3.5 错误码定义](#35-错误码定义)
  - [3.6 版本管理策略](#36-版本管理策略)
- [4. 关键流程](#4-关键流程)
  - [4.1 工具调用请求/响应示例](#41-工具调用请求响应示例)
  - [4.2 配置读写请求/响应示例](#42-配置读写请求响应示例)
  - [4.3 历史记录请求/响应示例](#43-历史记录请求响应示例)
  - [4.4 事件订阅示例](#44-事件订阅示例)
- [5. 设计决策记录](#5-设计决策记录)
  - [5.1 响应包络设计](#51-响应包络设计)
  - [5.2 命令命名风格](#52-命令命名风格)
  - [5.3 版本管理策略](#53-版本管理策略)
- [6. 注意事项与约束](#6-注意事项与约束)
- [7. 相关文档](#7-相关文档)

---

## 1. 背景与目的

Qraft 的 UI 与 Rust Core 通过 Tauri IPC 通信。IPC 接口是两层之间的唯一桥梁，其设计直接影响：

1. **类型安全**：跨语言边界的接口必须有明确契约
2. **错误处理**：错误码统一，前端可精准提示
3. **可演化**：接口能向后兼容地演进
4. **调试友好**：请求/响应结构清晰，便于排查问题

本文档的目标：

1. **定义所有 IPC Command**：名称、参数、返回值
2. **统一响应格式**：所有 Command 遵循同一包络
3. **错误码标准化**：跨工具、跨场景的错误码统一
4. **版本管理**：接口如何随版本演进

---

## 2. 核心概念

| 概念 | 定义 |
|------|------|
| Command | Tauri 中跨进程可调用的 Rust 函数，用 `#[tauri::command]` 标注 |
| Event | Rust 主动推送给 WebView 的消息 |
| 响应包络 | 所有 Command 返回值的统一外层结构 |
| 错误码 | 标识错误类型的字符串常量，如 `ERR_INVALID_INPUT` |
| 接口版本 | Command 集合的版本号，用于兼容性管理 |

---

## 3. 详细设计

### 3.1 IPC Command 规范

#### 命名规范

| 规则 | 示例 |
|------|------|
| snake_case 命名 | `tool_execute` |
| `<domain>_<action>` 格式 | `config_get` / `history_list` |
| 避免缩写 | `clipboard_read` 而非 `cb_read` |
| 动词在前 | `tool_execute` 而非 `tool_run` |

#### 参数规范

- 所有参数通过结构体传递，避免位置参数
- 参数名 camelCase（前端友好），Rust 用 `#[serde(rename_all = "camelCase")]`
- 必填参数不可省略，可选参数用 `Option<T>` + `#[serde(default)]`

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecuteArgs {
    pub tool_id: String,
    pub input: ToolInput,
}
```

### 3.2 统一响应包络

所有 Command 的返回值都包装在统一结构中：

```rust
// src-tauri/src/commands/mod.rs

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<CommandError>,
    pub meta: Option<ResponseMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,        // "ERR_INVALID_INPUT"
    pub message: String,     // 用户可读的错误信息
    pub details: Option<serde_json::Value>,  // 额外细节
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
    pub duration_ms: u64,
    pub version: &'static str,  // 接口版本
}
```

TypeScript 等价：

```typescript
export interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: CommandError;
  meta?: ResponseMeta;
}

export interface CommandError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ResponseMeta {
  durationMs: number;
  version: string;
}
```

#### 前端 IPC 封装

```typescript
// src/lib/ipc.ts

import { invoke } from '@tauri-apps/api/core';

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const response = await invoke<CommandResponse<T>>(command, args);

  if (!response.success) {
    const err = response.error!;
    throw new CommandError(err.code, err.message, err.details);
  }

  return response.data!;
}

export class CommandError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CommandError';
  }
}
```

使用示例：

```typescript
// 调用工具
try {
  const result = await invokeCommand<ToolOutput>('tool_execute', {
    toolId: 'json_formatter',
    input: { text: '{"a":1}' }
  });
  console.log(result.text);
} catch (e) {
  if (e instanceof CommandError) {
    showToast(`[${e.code}] ${e.message}`);
  }
}
```

### 3.3 Command 完整清单

#### Tool 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `tool_list` | 无 | `Vec<ToolMetadata>` | 列出所有已注册工具 |
| `tool_metadata` | `toolId: String` | `ToolMetadata` | 查询单个工具元数据 |
| `tool_execute` | `toolId, input: ToolInput` | `ToolOutput` | 执行工具 |
| `tool_execute_stream` | `toolId, filePath: String` | `String`（任务 ID） | 启动流式工具执行 |
| `tool_cancel` | `taskId: String` | `bool` | 取消流式任务 |

#### Config 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `config_get` | `key?: String` | `Value` 或 `UserConfig` | 获取配置（全量或单字段） |
| `config_set` | `key: String, value: Value` | `bool` | 设置单字段配置 |
| `config_reset` | `key: String` | `bool` | 重置单字段为默认 |
| `config_export` | 无 | `String`（JSON） | 导出全部配置 |
| `config_import` | `json: String` | `bool` | 导入配置 |

#### History 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `history_list` | `limit?, offset?, toolId?` | `Vec<HistoryEntry>` | 列出历史记录 |
| `history_get` | `id: String` | `HistoryEntry` | 获取单条历史 |
| `history_delete` | `id: String` | `bool` | 删除单条历史 |
| `history_clear` | `toolId?: String` | `bool` | 清空历史（可选按工具） |
| `history_search` | `query: String, limit?` | `Vec<HistoryEntry>` | 搜索历史 |

#### Favorite 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `favorite_add` | `toolId, group?` | `bool` | 添加收藏 |
| `favorite_remove` | `toolId` | `bool` | 移除收藏 |
| `favorite_list` | `group?` | `Vec<Favorite>` | 列出收藏 |
| `favorite_move` | `toolId, toGroup?, sortOrder?` | `bool` | 移动收藏 |

#### Preset 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `preset_save` | `toolId, name, params` | `String`（preset ID） | 保存预设 |
| `preset_list` | `toolId` | `Vec<ToolPreset>` | 列出工具的预设 |
| `preset_delete` | `presetId` | `bool` | 删除预设 |

#### Clipboard 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `clipboard_read` | 无 | `String` | 读取剪贴板文本 |
| `clipboard_write` | `text: String` | `bool` | 写入剪贴板 |

#### File System 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `fs_read_file` | `path: String` | `String` | 读取文本文件 |
| `fs_write_file` | `path, content: String` | `bool` | 写入文本文件 |
| `fs_pick_open` | `filters?: Vec<Filter>` | `Option<String>` | 文件选择对话框（打开） |
| `fs_pick_save` | `filters?: Vec<Filter>` | `Option<String>` | 文件选择对话框（保存） |

#### Workspace 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `workspace_get` | 无 | `Workspace` | 获取当前工作区 |
| `workspace_save` | `workspace: Workspace` | `bool` | 保存工作区 |
| `workspace_clear` | 无 | `bool` | 清空工作区 |

#### App 命令

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `app_version` | 无 | `String` | 获取应用版本 |
| `app_open_external` | `url: String` | `bool` | 用系统浏览器打开 URL |
| `app_check_update` | 无 | `Option<UpdateInfo>` | 检查更新 |

### 3.4 Rust 公共 Trait 接口

Core 层定义若干 trait，Shell 层注入具体实现：

```rust
// src-tauri/src/core/context.rs

use std::sync::Arc;
use async_trait::async_trait;

/// 配置访问接口
#[async_trait]
pub trait ConfigStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<serde_json::Value, ConfigError>;
    async fn set(&self, key: &str, value: serde_json::Value) -> Result<(), ConfigError>;
    async fn get_all(&self) -> Result<UserConfig, ConfigError>;
}

/// 历史记录接口
#[async_trait]
pub trait HistoryStore: Send + Sync {
    async fn add(&self, entry: HistoryEntry) -> Result<(), HistoryError>;
    async fn list(&self, filter: HistoryFilter) -> Result<Vec<HistoryEntry>, HistoryError>;
    async fn delete(&self, id: &str) -> Result<(), HistoryError>;
    async fn clear(&self, tool_id: Option<&str>) -> Result<(), HistoryError>;
    async fn search(&self, query: &str, limit: usize) -> Result<Vec<HistoryEntry>, HistoryError>;
}

/// 历史记录写入 sink（轻量接口，工具用）
pub trait HistorySink: Send + Sync {
    fn write(&self, entry: HistoryEntry);
}

/// 文件系统接口
#[async_trait]
pub trait FileSystem: Send + Sync {
    async fn read_file(&self, path: &str) -> Result<String, FsError>;
    async fn write_file(&self, path: &str, content: &str) -> Result<(), FsError>;
    async fn pick_open(&self, filters: Vec<FileFilter>) -> Result<Option<String>, FsError>;
    async fn pick_save(&self, filters: Vec<FileFilter>) -> Result<Option<String>, FsError>;
}

/// 剪贴板接口
#[async_trait]
pub trait Clipboard: Send + Sync {
    async fn read(&self) -> Result<String, ClipboardError>;
    async fn write(&self, text: &str) -> Result<(), ClipboardError>;
}
```

### 3.5 错误码定义

| 错误码 | 含义 | HTTP 类比 |
|--------|------|-----------|
| `ERR_INVALID_INPUT` | 输入参数无效 | 400 |
| `ERR_PARSE_FAILED` | 解析失败（JSON/Base64 等） | 422 |
| `ERR_TOOL_NOT_FOUND` | 工具 ID 不存在 | 404 |
| `ERR_TIMEOUT` | 工具执行超时 | 408 |
| `ERR_CANCELLED` | 用户取消执行 | 499 |
| `ERR_INPUT_TOO_LARGE` | 输入超过大小限制 | 413 |
| `ERR_INTERNAL` | 内部错误（含 panic） | 500 |
| `ERR_PERMISSION_DENIED` | 权限拒绝 | 403 |
| `ERR_FILE_NOT_FOUND` | 文件不存在 | 404 |
| `ERR_FILE_TOO_LARGE` | 文件超过大小限制 | 413 |
| `ERR_CONFIG_INVALID` | 配置无效 | 422 |
| `ERR_CONFIG_MIGRATION_FAILED` | 配置迁移失败 | 500 |
| `ERR_HISTORY_EMPTY` | 历史记录为空 | 404 |
| `ERR_PRESET_NOT_FOUND` | 预设不存在 | 404 |
| `ERR_UPDATE_CHECK_FAILED` | 更新检查失败 | 503 |

### 3.6 版本管理策略

#### 接口版本

Qraft 的 Command 接口整体版本化，版本号在 `ResponseMeta.version` 中返回：

- v0.1（MVP）：初始接口集
- v1.0：可能新增 Command，不破坏现有 Command
- v2.0：可能引入破坏性变更，需迁移

#### 兼容性策略

| 变更类型 | 兼容性 | 处理方式 |
|----------|--------|----------|
| 新增 Command | 兼容 | 直接添加 |
| 新增可选参数 | 兼容 | `#[serde(default)]` |
| 新增返回字段 | 兼容 | 前端忽略未知字段 |
| 删除 Command | 破坏 | 提前 1 个 major 版本 deprecated 警告 |
| 修改参数名 | 破坏 | 新增 Command，保留旧版 |
| 修改返回结构 | 破坏 | 新增 Command v2 |

破坏性变更通过新增 Command（如 `tool_execute_v2`）实现，旧 Command 保留 1 个 major 版本后删除。

---

## 4. 关键流程

### 4.1 工具调用请求/响应示例

**请求**：

```json
// invoke('tool_execute', { toolId: 'json_formatter', input: {...} })
{
  "toolId": "json_formatter",
  "input": {
    "text": "{\"a\":1,\"b\":2}",
    "params": {
      "indent": 2,
      "sort_keys": false
    }
  }
}
```

**响应（成功）**：

```json
{
  "success": true,
  "data": {
    "text": "{\n  \"a\": 1,\n  \"b\": 2\n}",
    "meta": {
      "durationMs": 5,
      "inputBytes": 15,
      "outputBytes": 22
    },
    "alerts": []
  },
  "error": null,
  "meta": {
    "durationMs": 8,
    "version": "0.1.0"
  }
}
```

**响应（失败）**：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERR_PARSE_FAILED",
    "message": "unexpected token at line 1 column 5",
    "details": {
      "line": 1,
      "column": 5
    }
  },
  "meta": {
    "durationMs": 2,
    "version": "0.1.0"
  }
}
```

### 4.2 配置读写请求/响应示例

**读取配置**：

```json
// invoke('config_get', { key: 'theme' })
{
  "key": "theme"
}
```

```json
// 响应
{
  "success": true,
  "data": {
    "mode": "dark",
    "accentColor": "#3b82f6"
  },
  "meta": { "durationMs": 1, "version": "0.1.0" }
}
```

**写入配置**：

```json
// invoke('config_set', { key: 'theme.mode', value: 'light' })
{
  "key": "theme.mode",
  "value": "light"
}
```

```json
{
  "success": true,
  "data": true,
  "meta": { "durationMs": 3, "version": "0.1.0" }
}
```

### 4.3 历史记录请求/响应示例

**列出历史**：

```json
// invoke('history_list', { limit: 10, offset: 0 })
{
  "limit": 10,
  "offset": 0
}
```

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "toolId": "json_formatter",
      "timestamp": "2026-07-25T08:00:00Z",
      "inputSummary": {
        "textPreview": "{\"a\":1,\"b\":2}",
        "textBytes": 15,
        "params": { "indent": 2 },
        "redacted": false
      },
      "outputSummary": {
        "textPreview": "{\n  \"a\": 1,\n  \"b\": 2\n}",
        "textBytes": 22,
        "redacted": false
      },
      "success": true,
      "durationMs": 5
    }
  ],
  "meta": { "durationMs": 12, "version": "0.1.0" }
}
```

### 4.4 事件订阅示例

Rust 侧推送事件：

```rust
// 配置变更广播
app_handle.emit("config_changed", &ConfigChangedPayload {
    key: "theme.mode".to_string(),
    old_value: "dark".to_string(),
    new_value: "light".to_string(),
})?;
```

前端订阅：

```typescript
import { listen } from '@tauri-apps/api/event';

interface ConfigChangedPayload {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

const unlisten = await listen<ConfigChangedPayload>('config_changed', (event) => {
  console.log(`Config ${event.payload.key} changed`);
  useConfigStore.getState().update(event.payload.key, event.payload.newValue);
});

// 组件卸载时取消订阅
useEffect(() => {
  return () => { unlisten(); };
}, []);
```

#### 事件清单

| 事件名 | Payload | 触发时机 |
|--------|---------|----------|
| `config_changed` | `{ key, oldValue, newValue }` | 配置写入成功后 |
| `history_added` | `HistoryEntry` | 历史记录写入后 |
| `tool_progress` | `{ taskId, processed, total }` | 流式工具进度更新 |
| `tool_completed` | `{ taskId, output }` | 流式工具完成 |
| `tool_failed` | `{ taskId, error }` | 流式工具失败 |
| `update_available` | `UpdateInfo` | 检测到新版本 |

---

## 5. 设计决策记录

### 5.1 响应包络设计

| 方案 | 优点 | 缺点 |
|------|------|------|
| **统一包络**（选定） | 错误处理一致、含 meta | 字段冗余 |
| 裸返回 + 错误抛 | 简洁 | 错误处理不一致 |
| 分两接口（success/fail） | 类型清晰 | API 数量翻倍 |

**决策理由**：统一包络让前端的错误处理逻辑可复用，meta 含 durationMs 便于性能监控。字段冗余在桌面应用场景可忽略。

### 5.2 命令命名风格

| 风格 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| **snake_case**（选定） | `tool_execute` | Rust 原生 | 前端需转换 |
| camelCase | `toolExecute` | 前端友好 | Rust 不自然 |
| kebab-case | `tool-execute` | URL 风格 | 不符合任一语言习惯 |

**决策理由**：Tauri Command 在 Rust 侧定义，snake_case 是 Rust 惯例。前端通过 `invoke('tool_execute')` 调用时也用 snake_case，保持一致。参数用 camelCase 是为了前端友好，Rust 侧用 `#[serde(rename_all = "camelCase")]` 适配。

### 5.3 版本管理策略

| 方案 | 优点 | 缺点 |
|------|------|------|
| **整体版本**（选定） | 简单 | 单个 Command 变更需整体升版 |
| 按 Command 版本 | 灵活 | 复杂，前端需跟踪每 Command 版本 |
| URL 式版本前缀 | REST 风格 | Tauri 不支持路径参数 |

**决策理由**：Qraft 是单机应用，接口数量有限（约 30 个），整体版本管理足够。`ResponseMeta.version` 让前端可检测兼容性。

---

## 6. 注意事项与约束

### 6.1 参数大小限制

| Command 类型 | 参数大小限制 |
|--------------|--------------|
| 普通 Command | 单参数 < 1 MB |
| 工具执行（text 输入） | < 10 MB |
| 工具执行（file_path 输入） | 文件大小 < 1 GB |
| 配置导入 | < 1 MB |

超限返回 `ERR_INPUT_TOO_LARGE`。

### 6.2 并发调用约束

| Command | 并发限制 |
|---------|----------|
| `tool_execute` | 同一工具并发上限 1（避免 CPU 争抢） |
| `config_set` | 串行（避免写冲突） |
| `history_add` | 无限制（内部 Mutex 保护） |
| `clipboard_write` | 串行（系统 API 限制） |

### 6.3 安全约束

> 📌 **项目实际**
>
> 1. `fs_*` 命令必须经过权限校验，仅允许用户显式选择的路径
> 2. `clipboard_*` 命令需要用户显式触发，不自动调用
> 3. `app_open_external` 仅允许 https:// 协议
> 4. 所有 Command 在 `capabilities/` 中声明，未声明的 Command 前端无法调用

详见 [13-security.md](./13-security.md)。

### 6.4 [待补充: IPC 性能基准]

当前未测量 IPC 调用开销。需要：

- 测量单次 invoke 的 RTT（应在 1ms 内）
- 测量大参数（1MB）传递的序列化开销
- 评估是否需要二进制序列化（MessagePack）

详见 [12-performance.md](./12-performance.md)。

---

## 7. 相关文档

- [02-glossary.md](./02-glossary.md) — 术语表（Command / Event / IPC 等定义）
- [04-system-architecture.md](./04-system-architecture.md) — 系统架构（IPC 通信机制）
- [05-rust-core-engine.md](./05-rust-core-engine.md) — Rust 核心引擎（Tool trait 接口）
- [08-data-model.md](./08-data-model.md) — 数据模型（Command 传递的数据结构）
- [10-error-handling.md](./10-error-handling.md) — 错误处理（错误码与错误传播）
- [13-security.md](./13-security.md) — 安全机制（Command 权限校验）
- [16-state-management.md](./16-state-management.md) — 状态管理（前端如何调用 Command）
