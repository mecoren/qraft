# Qraft PRD 项目 — 长期记忆

## 项目定位
本地开发工具箱，对标 DevToys。技术栈：Rust + Tauri V2 + React 19 + TypeScript + shadcn/ui + Vite + pnpm + cargo + Tailwind CSS。
文档体系位于 `prd/`（20 篇 Markdown + `INDEX.md`）。

## 三层架构（单向依赖）
Rust Core → Tauri Shell → React UI；IPC 用 `invoke` / `listen`。

## 关键约定（已审查确认，落地于 P0/P1 修正）
- **异步 trait**：`Tool` / `StreamingTool` / `ConfigStore` 均依赖 `async_trait ^0.1`。
- **配置基目录单一来源**：`directories::ProjectDirs::from("dev", "qraft", "Qraft")`，配置/历史/工作区文件均置于其 `config_dir()` 下（历史 `.jsonl`、工作区 `.json`）。曾出现三套不一致写法，已统一。
- **错误层级**：`ToolError`（thiserror，`serde tag="kind"`），错误码 `ERR_*`；统一响应包络 `CommandResponse<T>`。变体含 `ToolNotFound(String)`、`OutOfMemory { size, max }`，对应 `ERR_TOOL_NOT_FOUND` / `ERR_OUT_OF_MEMORY`。
- **流式机制**：`StreamingTool::execute_stream` 返回 `BoxStream<Result<StreamEvent, ToolError>>`；`StreamEvent` = Progress/Chunk/Done/Error。注册用 `register_stream_tool!` 提交到 `StreamingEntry`（`inventory::collect!`）。Tauri 侧 `tool_chunk { taskId, text }` 对应 `StreamEvent::Chunk`。

## 待办（P2，未处理）
- 20 篇 `author: [wait]` 占位；`03` 中 `hash` 等 crate 版本 `latest`→`^`；`config_get` 返回类型含糊；`16` cancel taskId 注明仅流式适用。
