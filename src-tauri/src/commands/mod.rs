// Shell 层 IPC Command 模块
//
// 每个 command 函数委托给一个 `_inner` 内部函数,内部函数接收 `&AppState` 等普通引用,
// 可在单元测试中直接调用,无需 Tauri 运行时。

pub mod app;
pub mod clipboard;
pub mod config;
pub mod font;
pub mod fs;
pub mod history;
pub mod image;
pub mod tool;
