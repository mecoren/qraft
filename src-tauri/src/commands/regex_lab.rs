// Regex Lab IPC Command 包装
//
// 纯逻辑(匹配 / 解释 / 替换 / 单测 / 代码生成 / 调试)位于 `crate::regex_lab`,
// 该模块不设 `#[cfg(not(test))]` 门控,单测随 `cargo test` 正常运行;
// 这里只保留 `#[tauri::command]` 薄壳(与 commands/tool.rs 同层职责)。

pub use crate::regex_lab::{
    CodegenLanguage, CodegenOutput, RegexCompileError, RegexDebugOutput, RegexLiveInput,
    RegexLiveOutput, RegexTestCase, RegexTestsOutput,
};

use crate::regex_lab::{codegen_inner, regex_debug_inner, regex_live_inner, regex_tests_inner};
use crate::shell::response::CommandResponse;
use crate::shell::AppError;

/// 实时正则工作区:一次返回 匹配+解释+替换+分组+耗时
///
/// # Errors
///
/// 恒返回 `Ok`:编译失败以 `RegexLiveOutput.ok=false` 表达,不走 Err 通道。
#[tauri::command]
pub async fn regex_live(input: RegexLiveInput) -> Result<CommandResponse<RegexLiveOutput>, AppError> {
    Ok(CommandResponse::ok(regex_live_inner(&input)))
}

/// 运行单元测试集
///
/// # Errors
///
/// 恒返回 `Ok`:编译失败以 `RegexTestsOutput.compile_error` 表达,不走 Err 通道。
#[tauri::command]
pub async fn regex_tests(
    pattern: String,
    flags: String,
    cases: Vec<RegexTestCase>,
) -> Result<CommandResponse<RegexTestsOutput>, AppError> {
    Ok(CommandResponse::ok(regex_tests_inner(
        &pattern, &flags, &cases,
    )))
}

/// 生成指定语言的代码片段
///
/// # Errors
///
/// 恒返回 `Ok`(纯字符串生成,不失败)。
#[tauri::command]
pub async fn regex_codegen(
    language: CodegenLanguage,
    pattern: String,
    flags: String,
    substitution: Option<String>,
) -> Result<CommandResponse<CodegenOutput>, AppError> {
    Ok(CommandResponse::ok(codegen_inner(
        language,
        &pattern,
        &flags,
        substitution.as_deref(),
    )))
}

/// 匹配调试回放
///
/// # Errors
///
/// 恒返回 `Ok`:编译失败以 `RegexDebugOutput.compile_error` 表达,不走 Err 通道。
#[tauri::command]
pub async fn regex_debug(
    pattern: String,
    flags: String,
    text: String,
) -> Result<CommandResponse<RegexDebugOutput>, AppError> {
    Ok(CommandResponse::ok(regex_debug_inner(
        &pattern, &flags, &text,
    )))
}
