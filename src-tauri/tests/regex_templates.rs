// src-tauri/tests/regex_templates.rs
//
// Regex Lab 常用模板库的引擎守卫集成测试。
// 模板数据单一来源是 src/lib/regex-templates.json(前端 Regex Lab 模板页签
// 与本测试共读)。此处用与工具执行引擎同一套编译入口(parse_flags +
// RegexBuilder)逐条验证:
//   1. flags 可被 parse_flags 接受(g/i/m/s/x/U/R 之外拒绝)
//   2. pattern 可在 Rust regex 引擎编译 —— 后向引用、环视等 Rust regex
//      不支持的特性会在源头暴露,而非等用户点击模板才报编译错误
//   3. 模板在自带样本文本上至少命中一次(保证模板语义可用、样本可复现)

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use qraft_lib::regex_lab::parse_flags;
use serde::Deserialize;

#[derive(Deserialize)]
struct TemplateEntry {
    pattern: String,
    flags: String,
    #[serde(rename = "tplKey")]
    tpl_key: String,
    sample: String,
}

#[derive(Deserialize)]
struct TemplateCategory {
    templates: Vec<TemplateEntry>,
}

#[derive(Deserialize)]
struct TemplateFile {
    categories: Vec<TemplateCategory>,
}

const TEMPLATE_JSON: &str = include_str!("../../src/lib/regex-templates.json");

fn load_templates() -> TemplateFile {
    serde_json::from_str(TEMPLATE_JSON).expect("regex-templates.json 结构合法")
}

/// 全部模板必须可在 Rust regex 引擎编译,且 flags 全部可解析
#[test]
fn all_templates_compile_in_rust_regex() {
    let file = load_templates();
    assert!(
        !file.categories.is_empty(),
        "模板库不应为空(否则 JSON 路径或解析断裂)"
    );
    let total: usize = file.categories.iter().map(|c| c.templates.len()).sum();
    assert!(total >= 20, "模板库收录量异常偏少:{total}");

    for cat in &file.categories {
        for tpl in &cat.templates {
            let flags = parse_flags(&tpl.flags)
                .unwrap_or_else(|ch| panic!("flags {:?} 含不支持字符 {ch:?}", tpl.flags));
            let mut builder = regex::RegexBuilder::new(&tpl.pattern);
            flags.apply(&mut builder);
            builder.build().unwrap_or_else(|e| {
                panic!("[{}] pattern {:?} 编译失败:{e}", tpl.tpl_key, tpl.pattern)
            });
        }
    }
}

/// 每个模板在自带样本上至少命中一次(样本即效果演示,不命中则模板或样本已失效)
#[test]
fn every_template_matches_its_sample() {
    let file = load_templates();
    for cat in &file.categories {
        for tpl in &cat.templates {
            let flags = parse_flags(&tpl.flags).expect("flags 已由上一测试守卫");
            let mut builder = regex::RegexBuilder::new(&tpl.pattern);
            flags.apply(&mut builder);
            let re = builder.build().expect("pattern 已由上一测试守卫");
            assert!(
                re.is_match(&tpl.sample),
                "[{}] 在样本文本上无任何命中,pattern={:?} sample={:?}",
                tpl.tpl_key,
                tpl.pattern,
                tpl.sample
            );
        }
    }
}
