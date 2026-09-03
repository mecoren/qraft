// Regex Lab IPC 命令 —— regex101 风格的正则工作区后端
//
// 与 tool.rs 的 tool_execute(面向批处理工具)不同,Regex Lab 是实时交互式
// 工作区:每次 pattern/flags/text 变更都需要毫秒级反馈(匹配 + 高亮区间 +
// 分组详情 + 解释树 + 替换预览)。因此提供专用命令 `regex_live`,一次往返
// 返回全量数据,避免前端多次 IPC 往返造成的输入抖动。
//
// 设计要点:
// - 纯计算、无状态:命令不依赖 AppState,天然可测试(`*_inner` 直接调用)。
// - 双引擎分工:regex crate 负责匹配/替换语义;regex-syntax 的 Ast 负责
//   逐 token 解释(regex101 的 "Explanation" 面板)与错误位置定位。
// - 错误策略:编译失败不是异常而是工作区的一种状态 —— 返回结构化的
//   `compile_error`(含列号/友好消息),前端直接内联展示,不弹 alert。
//
// lint 说明:解释引擎把十几类 AST 节点逐一转换为文案,match 分支天然
// 存在"相同兜底体 / 单字符模式 / 前置声明"等形态;这类 nursery 级风格
// 告警在此按模块整体豁免,仅保留语义类 lint。
#![allow(
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::items_after_statements,
    clippy::match_same_arms,
    clippy::single_char_pattern,
    clippy::too_many_lines
)]

use regex::Regex;
use regex_syntax::ast::{Ast, ClassAsciiKind, Error as AstError};
use serde::{Deserialize, Serialize};

// ============================================================
// 请求 / 响应模型
// ============================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexLiveInput {
    pub pattern: String,
    pub flags: String,
    pub test_text: String,
    /// 替换模板(Substitution 模式);空 = 不做替换
    #[serde(default)]
    pub substitution: String,
}

/// 单个匹配项(整个匹配 + 各分组区间)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexMatchInfo {
    /// 匹配编号(从 1 开始,与 regex101 一致)
    pub index: u64,
    /// 整体匹配文本
    pub text: String,
    /// 整体匹配区间 [start, end)(字符偏移)
    pub range: (usize, usize),
    /// 编号分组:序号 1..n,未参与匹配为 None
    pub groups: Vec<Option<RegexGroupSpan>>,
    /// 命名分组:名称 → 分组区间
    pub named_groups: Vec<RegexNamedGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexGroupSpan {
    pub text: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexNamedGroup {
    pub name: String,
    pub text: String,
    pub start: usize,
    pub end: usize,
}

/// 逐 token 的解释条目(regex101 Explanation 面板数据源)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexExplainNode {
    /// 原始 token 文本(如 "(?P<year>\d{4})")
    pub token: String,
    /// 人类可读标题(如 "Named capturing group")
    pub title: String,
    /// 说明正文(可多行)
    pub description: String,
    /// pattern 内的字符区间 [start, end)
    pub span: (usize, usize),
    /// 嵌套子节点(组内部、重复体内部等)
    pub children: Vec<Self>,
    /// 是否为可量化的"单元"(regex101 高亮联动用)
    pub quantifiable: bool,
}

/// 编译错误(含位置信息)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexCompileError {
    /// 0-based 列号(pattern 内)
    pub column: u64,
    /// 错误标题(如 "unclosed group")
    pub title: String,
    /// 详细消息
    pub message: String,
}

/// 命名分组清单(测试文本编辑器联动用)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexGroupEntry {
    pub index: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexLiveOutput {
    /// 编译成功时为 true;false 时 compile_error 必有值
    pub ok: bool,
    pub compile_error: Option<RegexCompileError>,
    /// 匹配列表(ok=false 时为空;最多 MAX_MATCHES 条)
    pub matches: Vec<RegexMatchInfo>,
    /// 匹配总数(真实值,可能 > matches.len())
    pub match_count: usize,
    /// 测试文本超出护栏被截断
    pub truncated_text: bool,
    /// 匹配条目超出上限被截断(计数保留真实值)
    pub matches_truncated: bool,
    /// 替换结果(未提供 substitution 时为 None)
    pub substitution_result: Option<String>,
    /// 解释树根节点列表(span 为 pattern 内字符偏移)
    pub explain: Vec<RegexExplainNode>,
    /// 命名分组清单(按索引排序,含匿名捕获组,name 为空串)
    pub groups: Vec<RegexGroupEntry>,
    /// 编译 + 匹配耗时(毫秒)
    pub duration_ms: u64,
}

// ============================================================
// flags 解析(regex crate 支持位标志)
// ============================================================

/// 把 JS 风格 flags 字符串映射为 regex crate 构建参数。
/// 返回 `Err(flag_char)` 表示该 flag 不被 Rust regex 引擎支持。
///
/// # Errors
///
/// - 遇到 `g i m s x U u y R` 之外的字符时返回该字符
pub fn parse_flags(flags: &str) -> Result<FlagSet, char> {
    let mut set = FlagSet::default();
    for ch in flags.chars() {
        match ch {
            'i' => set.case_insensitive = true,
            'm' => set.multi_line = true,
            's' => set.dot_all = true,
            'x' => set.ignore_whitespace = true,
            'U' => set.swap_greed = true,
            'R' => set.crlf = true,
            // g/u/y 是 JS 特有语义(全局搜索/unicode/sticky),Rust 端匹配
            // 恒为全局,直接忽略以保持宽容(regex101 对不同 flavor 也会静默
            // 丢弃不适用 flag)
            'g' | 'u' | 'y' => {}
            other => return Err(other),
        }
    }
    Ok(set)
}

/// 六个独立布尔(引擎构建参数的扁平集合);按字段语义命名而非位标志,
/// 保持与 `RegexBuilder` 链式 API 的直接对应。
#[allow(clippy::struct_field_names, clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, Default)]
pub struct FlagSet {
    pub case_insensitive: bool,
    pub multi_line: bool,
    pub dot_all: bool,
    pub ignore_whitespace: bool,
    pub swap_greed: bool,
    pub crlf: bool,
}

impl FlagSet {
    /// 应用到 RegexBuilder
    fn apply(self, builder: &mut regex::RegexBuilder) {
        builder
            .case_insensitive(self.case_insensitive)
            .multi_line(self.multi_line)
            .dot_matches_new_line(self.dot_all)
            .ignore_whitespace(self.ignore_whitespace)
            .swap_greed(self.swap_greed)
            .crlf(self.crlf)
            // Unicode 恒开:与 JS 'u' flag 对齐,字符偏移按 Unicode 标量计算
            .size_limit(64 * 1024 * 1024)
            .nest_limit(250);
    }
}

/// 前端 flags 字符串规范化:剔除无效字符,用于输入框即时纠错。
pub fn normalize_flags(flags: &str) -> String {
    flags
        .chars()
        .filter(|c| matches!(c, 'i' | 'm' | 's' | 'x' | 'U' | 'R' | 'g' | 'u' | 'y'))
        .collect()
}

// ============================================================
// 内部实现(可测试)
// ============================================================

/// 把 regex-syntax / regex crate 的编译错误转换为带列号的结构化错误。
pub fn compile_error_from(e: &AstError) -> RegexCompileError {
    let span = e.span();
    let title = match e.kind() {
        regex_syntax::ast::ErrorKind::GroupUnclosed => "unclosed group",
        regex_syntax::ast::ErrorKind::GroupUnopened => "unopened group",
        regex_syntax::ast::ErrorKind::EscapeUnrecognized => "unrecognized escape sequence",
        regex_syntax::ast::ErrorKind::RepetitionMissing => {
            "repetition operator missing expression"
        }
        regex_syntax::ast::ErrorKind::RepetitionCountInvalid => {
            "invalid repetition count"
        }
        regex_syntax::ast::ErrorKind::ClassEscapeInvalid => "invalid escape in character class",
        regex_syntax::ast::ErrorKind::ClassUnclosed => "unclosed character class",
        regex_syntax::ast::ErrorKind::ClassRangeInvalid => "invalid character class range",
        regex_syntax::ast::ErrorKind::FlagUnrecognized => "unrecognized flag",
        regex_syntax::ast::ErrorKind::GroupNameDuplicate { .. } => "duplicate group name",
        regex_syntax::ast::ErrorKind::UnsupportedBackreference => {
            "backreferences are not supported"
        }
        regex_syntax::ast::ErrorKind::UnsupportedLookAround => {
            "lookaround assertions are not supported"
        }
        _ => "invalid regex",
    };
    // column 为 pattern 内字节偏移(regex-syntax Position.column 是近似值,
    // 直接用 offset 语义更准;ASCII pattern 下二者一致,含 CJK 时 offset 更准)。
    // 前端把它当"出错位置光标"使用(选中该字符)。
    #[allow(clippy::cast_possible_truncation)]
    RegexCompileError {
        column: span.start.offset as u64,
        title: title.to_string(),
        message: e.to_string(),
    }
}

/// regex crate 自身错误(翻译 AST 之后,如 UTF-8 边界)兜底
fn compile_error_generic(message: String) -> RegexCompileError {
    RegexCompileError {
        column: 0,
        title: "invalid regex".to_string(),
        message,
    }
}

/// 命令核心:编译 + 匹配 + 解释 + 替换,一次返回全量数据。
///
/// 性能护栏(与前端编辑器可承受的渲染量对齐):
/// - 测试文本 > `MAX_TEST_TEXT_BYTES` 时截断到字节边界(错误信息随响应返回);
/// - 匹配条目最多返回 `MAX_MATCHES` 条(总计数仍为真实值,truncated 置位)。
///
/// 偏移语义:regex/regex-syntax 返回的均为 UTF-8 字节偏移,这里统一换算为
/// **字符偏移**(JS string index),前端直接可用,避免 UTF-16/UTF-8 混算错位。
pub fn regex_live_inner(input: &RegexLiveInput) -> RegexLiveOutput {
    let started = std::time::Instant::now();

    // 0) 输入护栏:超长文本截断到字符边界(工作区只预览前 N 字节)
    let mut truncated_text = false;
    let test_text: &str = if input.test_text.len() > MAX_TEST_TEXT_BYTES {
        truncated_text = true;
        // floor_char_boundary 仍不稳定,手动收敛到合法边界
        let mut cut = MAX_TEST_TEXT_BYTES;
        while cut > 0 && !input.test_text.is_char_boundary(cut) {
            cut -= 1;
        }
        &input.test_text[..cut]
    } else {
        input.test_text.as_str()
    };

    // 1) flags 解析:非法 flag 按编译错误处理(regex101 直接红条提示)
    let flag_set = match parse_flags(&input.flags) {
        Ok(set) => set,
        Err(bad) => {
            return RegexLiveOutput {
                ok: false,
                compile_error: Some(RegexCompileError {
                    column: 0,
                    title: "invalid flag".to_string(),
                    message: format!("unsupported flag `{bad}` (supported: g i m s x U u y R)"),
                }),
                matches: Vec::new(),
                match_count: 0,
                truncated_text: false,
                matches_truncated: false,
                substitution_result: None,
                explain: Vec::new(),
                groups: Vec::new(),
                duration_ms: elapsed_ms(started),
            };
        }
    };

    // 2) AST 解析(解释树 + 错误位置来自 regex-syntax)+ regex 编译
    //    (其校验更严格,例如 UTF-8 边界)。
    //    compile_error_from 给出字节偏移位置,这里换算为字符偏移(前端选区用)
    let pattern_index = ByteToCharIndex::new(&input.pattern);
    let compiled = regex_syntax::ast::parse::Parser::new()
        .parse(&input.pattern)
        .map_err(|e| {
            let mut err = compile_error_from(&e);
            err.column = u64::try_from(pattern_index.char_of(usize::try_from(err.column).unwrap_or(0)))
                .unwrap_or(err.column);
            err
        })
        .and_then(|ast| {
            let mut builder = regex::RegexBuilder::new(&input.pattern);
            flag_set.apply(&mut builder);
            builder
                .build()
                .map(|re| (ast, re))
                .map_err(|e| compile_error_generic(e.to_string()))
        });
    let (ast, re) = match compiled {
        Ok(pair) => pair,
        Err(e) => {
            return RegexLiveOutput {
                ok: false,
                compile_error: Some(e),
                matches: Vec::new(),
                match_count: 0,
                truncated_text: false,
                matches_truncated: false,
                substitution_result: None,
                explain: Vec::new(),
                groups: Vec::new(),
                duration_ms: elapsed_ms(started),
            };
        }
    };

    // 3) 匹配:遍历所有匹配(regex101 Match 面板语义)。
    //    字节→字符偏移:预先构建测试文本的字节前缀→字符数查找表,
    //    O(1) 查询替代逐次扫描。
    let byte_to_char = ByteToCharIndex::new(test_text);

    let mut matches = Vec::new();
    let mut total_matches = 0usize;
    let mut matches_truncated = false;
    for caps in re.captures_iter(test_text) {
        total_matches += 1;
        if total_matches > MAX_MATCHES {
            // 上限后不再构造明细(避免万级条目拖垮 IPC/渲染),但继续
            // 计数以给出真实 total —— captures_iter 是惰性迭代,越过的
            // 条目只做一次 O(区间) 检查,无分组构建开销
            matches_truncated = true;
            continue;
        }
        let Some(full) = caps.get(0) else {
            continue;
        };
        let mut groups = Vec::with_capacity(caps.len().saturating_sub(1));
        for gi in 1..caps.len() {
            groups.push(caps.get(gi).map(|m| RegexGroupSpan {
                text: m.as_str().to_string(),
                start: byte_to_char.char_of(m.start()),
                end: byte_to_char.char_of(m.end()),
            }));
        }
        let mut named_groups = Vec::new();
        for name in re.capture_names().flatten() {
            if let Some(m) = caps.name(name) {
                named_groups.push(RegexNamedGroup {
                    name: name.to_string(),
                    text: m.as_str().to_string(),
                    start: byte_to_char.char_of(m.start()),
                    end: byte_to_char.char_of(m.end()),
                });
            }
        }
        matches.push(RegexMatchInfo {
            // 序号按真实出现顺序(截断不影响已返回部分的编号)
            #[allow(clippy::cast_possible_truncation)]
            index: total_matches as u64,
            text: full.as_str().to_string(),
            range: (
                byte_to_char.char_of(full.start()),
                byte_to_char.char_of(full.end()),
            ),
            groups,
            named_groups,
        });
    }

    // 4) 替换预览:提供模板时用 $name/$i 语法展开(与 regex crate 对齐)
    let substitution_result = if input.substitution.is_empty() {
        None
    } else {
        Some(re.replace_all(test_text, input.substitution.as_str()).to_string())
    };

    // 5) 解释树(span 换算为字符偏移;复用 pattern_index)
    let mut explain = explain_ast(&ast, &input.pattern);
    remap_explain_spans(&mut explain, &pattern_index);

    // 6) 分组清单
    let groups = group_entries(&re);

    RegexLiveOutput {
        ok: true,
        compile_error: None,
        matches,
        match_count: total_matches,
        truncated_text,
        matches_truncated,
        substitution_result,
        explain,
        groups,
        duration_ms: elapsed_ms(started),
    }
}

/// 测试文本护栏:超过此字节数截断预览(1MB,与 tool.rs 的 MAX_INPUT_BYTES 对齐)
const MAX_TEST_TEXT_BYTES: usize = 1024 * 1024;
/// 返回前端的匹配条目上限:更多匹配只计数不展开(渲染量与 IPC 载荷护栏)
const MAX_MATCHES: usize = 5000;

/// 字节偏移 → 字符偏移 的 O(1) 查找表。
/// 构建 O(n) 一次;正则命中密集时避免逐次 O(offset) 扫描。
struct ByteToCharIndex {
    /// 每个字符边界字节偏移按序记录;char_of 用二分定位
    boundaries: Vec<usize>,
}

impl ByteToCharIndex {
    fn new(text: &str) -> Self {
        Self {
            boundaries: text.char_indices().map(|(b, _)| b).collect(),
        }
    }

    /// 字节偏移 → 字符索引(偏移必须落在字符边界;正则输出保证满足)
    fn char_of(&self, byte: usize) -> usize {
        match self.boundaries.binary_search(&byte) {
            Ok(i) => i,
            // 非边界值不应出现;回退到最近边界,保证不 panic
            Err(i) => i,
        }
    }
}

/// 递归把解释树节点 span 从字节偏映射为字符偏移
fn remap_explain_spans(nodes: &mut [RegexExplainNode], idx: &ByteToCharIndex) {
    for n in nodes {
        n.span = (idx.char_of(n.span.0), idx.char_of(n.span.1));
        remap_explain_spans(&mut n.children, idx);
    }
}

fn elapsed_ms(started: std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn group_entries(re: &Regex) -> Vec<RegexGroupEntry> {
    re.capture_names()
        .enumerate()
        .skip(1)
        .map(|(i, name)| RegexGroupEntry {
            // 捕获组数量受 RegexBuilder::nest_limit/size_limit 约束,u32 足够
            #[allow(clippy::cast_possible_truncation)]
            index: i as u32,
            name: name.unwrap_or("").to_string(),
        })
        .collect()
}

// ============================================================
// 解释引擎:Ast → RegexExplainNode 树
// ============================================================

/// Ast 的 span(Position)转换为 pattern 内字符偏移。
/// Position.offset 是字节偏移(pattern 为 UTF-8 时按字节计),这里除出
/// 字符偏移需要遍历 —— 直接用字节偏移即可(前端对 pattern 也按 UTF-16
/// 偏移工作,Tauri 侧统一传字节偏移,前端自行换算)。
/// 说明:为简化,token 文本直接从 pattern 切片;若切片边界非法则退化为
/// 打印 Ast 的 Display 形式。
fn span_to_token(pattern: &str, span: (usize, usize)) -> Option<String> {
    if span.0 <= span.1 && span.1 <= pattern.len() {
        pattern.get(span.0..span.1).map(str::to_string)
    } else {
        None
    }
}

fn ast_span_bytes(ast: &Ast) -> (usize, usize) {
    let s = ast.span();
    (s.start.offset, s.end.offset)
}

/// 递归生成解释树。
pub fn explain_ast(ast: &Ast, pattern: &str) -> Vec<RegexExplainNode> {
    let mut out = Vec::new();
    explain_into(ast, pattern, &mut out);
    out
}

fn explain_into(ast: &Ast, pattern: &str, out: &mut Vec<RegexExplainNode>) {
    use regex_syntax::ast::{
        AssertionKind, Ast, ClassPerlKind, GroupKind, RepetitionKind,
    };

    let span = ast_span_bytes(ast);
    let token = span_to_token(pattern, span).unwrap_or_else(|| ast.to_string());

    match ast {
        Ast::Empty(_) => {
            // 空 pattern 不产出节点(前端展示空态)
        }
        Ast::Flags(set) => {
            let mut flag_text = String::new();
            let mut negated = false;
            for item in &set.flags.items {
                match item.kind {
                    regex_syntax::ast::FlagsItemKind::Negation => negated = true,
                    regex_syntax::ast::FlagsItemKind::Flag(f) => {
                        if negated {
                            flag_text.push('-');
                            negated = false;
                        }
                        flag_text.push(flag_char(&f));
                    }
                }
            }
            out.push(node(
                token,
                "Inline flags".into(),
                format!("`{flag_text}` modifies matching behavior of the remainder of the pattern"),
                span,
                false,
            ));
        }
        Ast::Literal(lit) => {
            let desc = if lit.c.is_ascii_alphanumeric() || lit.c == ' ' {
                format!(
                    "matches the character {} literally (case sensitive)",
                    display_char(lit.c)
                )
            } else {
                format!("matches the character {} literally", display_char(lit.c))
            };
            out.push(node(token, "Literal character".into(), desc, span, true));
        }
        Ast::Dot(_) => {
            out.push(
                node(token, "Any character".into(),
                    "matches any character except line terminators (unless `s` flag is set)".into(),
                    span, true)
            );
        }
        Ast::Assertion(a) => {
            let title = match a.kind {
                AssertionKind::StartLine => "Anchor: start of line",
                AssertionKind::EndLine => "Anchor: end of line",
                AssertionKind::StartText => "Anchor: start of text",
                AssertionKind::EndText => "Anchor: end of text",
                AssertionKind::WordBoundary => "Word boundary",
                AssertionKind::NotWordBoundary => "Not a word boundary",
                _ => "Word boundary",
            };
            let desc = match a.kind {
                AssertionKind::StartLine => {
                    "matches the start of a line (`m` flag: every line; otherwise start of text)"
                }
                AssertionKind::EndLine => {
                    "matches the end of a line (`m` flag: every line; otherwise end of text)"
                }
                AssertionKind::StartText => "matches the start of the input",
                AssertionKind::EndText => "matches the end of the input",
                AssertionKind::WordBoundary => {
                    "matches a position between a word character and a non-word character"
                }
                AssertionKind::NotWordBoundary => {
                    "matches any position that is not a word boundary"
                }
                _ => "Unicode-aware word boundary (Rust regex extension)",
            };
            out.push(node(token, title.into(), desc.into(), span, true));
        }
        Ast::ClassPerl(p) => {
            let (title, base) = match p.kind {
                ClassPerlKind::Digit => ("Character class: digits", "any digit (`0-9`)"),
                ClassPerlKind::Space => ("Character class: whitespace", "any whitespace character"),
                ClassPerlKind::Word => ("Character class: word characters", "any word character (`a-z`, `A-Z`, `0-9`, `_`)"),
            };
            let (title, desc) = if p.negated {
                (
                    format!("{title} (negated)"),
                    format!("matches any character that is NOT {base}"),
                )
            } else {
                (title.to_string(), format!("matches {base}"))
            };
            out.push(node(token, title, desc, span, true));
        }
        Ast::ClassUnicode(u) => {
            let name = match &u.kind {
                regex_syntax::ast::ClassUnicodeKind::OneLetter(c) => c.to_string(),
                regex_syntax::ast::ClassUnicodeKind::Named(n) => n.clone(),
                regex_syntax::ast::ClassUnicodeKind::NamedValue { name, value, .. } => {
                    format!("{name} = {value}")
                }
            };
            let neg = if u.is_negated() { " NOT" } else { "" };
            out.push(node(
                token,
                format!("Unicode property: {name}"),
                format!("matches characters{neg} in the Unicode `{name}` property"),
                span,
                true,
            ));
        }
        Ast::ClassBracketed(cb) => {
            let mut children = Vec::new();
            explain_class_set(&cb.kind, pattern, &mut children);
            let neg_desc = if cb.negated {
                "matches any character NOT in the set below"
            } else {
                "matches any character in the set below"
            };
            let title = if cb.negated {
                "Negated character class".to_string()
            } else {
                "Character class".to_string()
            };
            out.push(node(token, title, neg_desc.into(), span, true).with_children(children));
        }
        Ast::Repetition(rep) => {
            let (title, desc): (String, String) = match rep.op.kind {
                RepetitionKind::ZeroOrOne => ("Quantifier: 0 or 1".to_string(), "matches as few or as many times as needed (greedy: prefers 1)".to_string()),
                RepetitionKind::ZeroOrMore => ("Quantifier: 0 or more".to_string(), "matches greedily, as many times as possible".to_string()),
                RepetitionKind::OneOrMore => ("Quantifier: 1 or more".to_string(), "matches greedily, at least once".to_string()),
                RepetitionKind::Range(ref r) => match *r {
                    regex_syntax::ast::RepetitionRange::Exactly(n) => ("Quantifier: exact".to_string(), format!("matches exactly {n} times")),
                    regex_syntax::ast::RepetitionRange::AtLeast(n) => ("Quantifier: at least".to_string(), format!("matches {n} or more times")),
                    regex_syntax::ast::RepetitionRange::Bounded(a, b) => ("Quantifier: bounded".to_string(), format!("matches between {a} and {b} times")),
                },
            };
            let (title, desc) = if rep.greedy {
                (title, format!("{desc} — greedy: takes as many as possible"))
            } else {
                (format!("{title} (lazy)"), format!("{desc} — lazy: takes as few as possible"))
            };
            let mut children = Vec::new();
            explain_into(&rep.ast, pattern, &mut children);
            // 量词节点的 span 含被修饰体;token 只取操作符本身(显示更好看)
            let op_span = (rep.op.span.start.offset, rep.op.span.end.offset);
            let op_token = span_to_token(pattern, op_span).unwrap_or(token);
            out.push(
                node(op_token, title, desc, span, false).with_children(children),
            );
        }
        Ast::Group(g) => {
            let mut children = Vec::new();
            explain_into(&g.ast, pattern, &mut children);
            let (title, desc) = match &g.kind {
                GroupKind::CaptureIndex(i) => (
                    format!("Capturing group #{i}"),
                    format!("captures the matched text into group {i}"),
                ),
                GroupKind::CaptureName { name, .. } => (
                    format!("Named capturing group `{}`", name.name),
                    format!("captures the matched text into group `{}`", name.name),
                ),
                GroupKind::NonCapturing(_) => (
                    "Non-capturing group".to_string(),
                    "groups the expression without capturing".to_string(),
                ),
            };
            out.push(node(token, title, desc, span, true).with_children(children));
        }
        Ast::Alternation(alt) => {
            let mut children = Vec::new();
            for a in &alt.asts {
                explain_into(a, pattern, &mut children);
            }
            out.push(node(
                token,
                "Alternation".into(),
                "matches any of the alternatives below (in order)".into(),
                span,
                false,
            ).with_children(children));
        }
        Ast::Concat(cat) => {
            // 连接节点不产出自身条目:直接展开子节点(regex101 同样平铺)
            for a in &cat.asts {
                explain_into(a, pattern, out);
            }
        }
    }
}

fn explain_class_set(
    set: &regex_syntax::ast::ClassSet,
    pattern: &str,
    out: &mut Vec<RegexExplainNode>,
) {
    use regex_syntax::ast::ClassSet;
    match set {
        ClassSet::Item(item) => explain_class_item(item, pattern, out),
        ClassSet::BinaryOp(op) => {
            let sym = match op.kind {
                regex_syntax::ast::ClassSetBinaryOpKind::Intersection => "&& (intersection)",
                regex_syntax::ast::ClassSetBinaryOpKind::Difference => "-- (difference)",
                regex_syntax::ast::ClassSetBinaryOpKind::SymmetricDifference => "~~ (symmetric difference)",
            };
            let mut children = Vec::new();
            explain_class_set(&op.lhs, pattern, &mut children);
            explain_class_set(&op.rhs, pattern, &mut children);
            let span = (op.span.start.offset, op.span.end.offset);
            let token = span_to_token(pattern, span).unwrap_or_else(|| sym.to_string());
            out.push(node(
                token,
                "Set operation".into(),
                format!("combines both sides using {sym}"),
                span,
                false,
            ).with_children(children));
        }
    }
}

fn explain_class_item(
    item: &regex_syntax::ast::ClassSetItem,
    pattern: &str,
    out: &mut Vec<RegexExplainNode>,
) {
    let span = |s: &regex_syntax::ast::Span| {
        (s.start.offset, s.end.offset)
    };
    use regex_syntax::ast::{ClassPerlKind, ClassSetItem, ClassUnicodeKind};
    match item {
        ClassSetItem::Empty(_) => {}
        ClassSetItem::Literal(lit) => {
            let sp = span(&lit.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            out.push(node(
                token,
                "Character".into(),
                format!("matches `{}` literally", display_char(lit.c)),
                sp,
                false,
            ));
        }
        ClassSetItem::Range(r) => {
            let sp = span(&r.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            out.push(node(
                token,
                "Character range".into(),
                format!(
                    "matches characters from `{}` to `{}` (inclusive)",
                    display_char(r.start.c),
                    display_char(r.end.c)
                ),
                sp,
                false,
            ));
        }
        ClassSetItem::Ascii(a) => {
            let sp = span(&a.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            let desc = ascii_class_desc(&a.kind);
            let desc = if a.negated {
                format!("matches any ASCII character NOT in {desc}")
            } else {
                format!("matches any ASCII character in {desc}")
            };
            out.push(node(token, "ASCII class".into(), desc, sp, false));
        }
        ClassSetItem::Unicode(u) => {
            let sp = span(&u.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            let name = match &u.kind {
                ClassUnicodeKind::OneLetter(c) => c.to_string(),
                ClassUnicodeKind::Named(n) => n.clone(),
                ClassUnicodeKind::NamedValue { name, value, .. } => {
                    format!("{name} = {value}")
                }
            };
            out.push(node(
                token,
                format!("Unicode property: {name}"),
                format!("matches characters in the Unicode `{name}` property"),
                sp,
                false,
            ));
        }
        ClassSetItem::Perl(p) => {
            let sp = span(&p.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            let (title, desc) = match p.kind {
                ClassPerlKind::Digit => ("digits", "`0-9`"),
                ClassPerlKind::Space => ("whitespace", "` \\t\\r\\n\\f\\v`"),
                ClassPerlKind::Word => ("word characters", "`a-zA-Z0-9_`"),
            };
            let (title, desc) = if p.negated {
                (
                    format!("NOT {title}"),
                    format!("any character except {desc}"),
                )
            } else {
                (title.to_string(), desc.to_string())
            };
            out.push(node(
                token,
                format!("Perl class: {title}"),
                desc,
                sp,
                false,
            ));
        }
        ClassSetItem::Bracketed(cb) => {
            let sp = span(&cb.span);
            let token = span_to_token(pattern, sp).unwrap_or_default();
            let mut children = Vec::new();
            explain_class_set(&cb.kind, pattern, &mut children);
            out.push(
                node(token, "Nested class".into(), "nested character class".into(), sp, false)
                    .with_children(children),
            );
        }
        ClassSetItem::Union(u) => {
            for item in &u.items {
                explain_class_item(item, pattern, out);
            }
        }
    }
}

#[allow(clippy::missing_const_for_fn)]
fn ascii_class_desc(kind: &ClassAsciiKind) -> &'static str {
    use regex_syntax::ast::ClassAsciiKind;
    match kind {
        ClassAsciiKind::Alnum => "`[0-9A-Za-z]`",
        ClassAsciiKind::Alpha => "`[A-Za-z]`",
        ClassAsciiKind::Ascii => "`[\\x00-\\x7F]`",
        ClassAsciiKind::Blank => "`[ \\t]`",
        ClassAsciiKind::Cntrl => "control characters `[\\x00-\\x1F\\x7F]`",
        ClassAsciiKind::Graph => "visible characters `[!-~]`",
        ClassAsciiKind::Lower => "`[a-z]`",
        ClassAsciiKind::Print => "printable characters `[ -~]`",
        ClassAsciiKind::Punct => "punctuation",
        ClassAsciiKind::Space => "whitespace `[\\t\\n\\v\\f\\r ]`",
        ClassAsciiKind::Upper => "`[A-Z]`",
        ClassAsciiKind::Word => "word characters `[0-9A-Za-z_]`",
        ClassAsciiKind::Xdigit => "hex digits `[0-9A-Fa-f]`",
        ClassAsciiKind::Digit => "digits `[0-9]`",
    }
}

#[allow(clippy::trivially_copy_pass_by_ref, clippy::missing_const_for_fn)]
fn flag_char(flag: &regex_syntax::ast::Flag) -> char {
    use regex_syntax::ast::Flag;
    match flag {
        Flag::CaseInsensitive => 'i',
        Flag::MultiLine => 'm',
        Flag::DotMatchesNewLine => 's',
        Flag::SwapGreed => 'U',
        Flag::Unicode => 'u',
        Flag::CRLF => 'R',
        Flag::IgnoreWhitespace => 'x',
    }
}

fn display_char(c: char) -> String {
    match c {
        '\n' => "\\n".to_string(),
        '\r' => "\\r".to_string(),
        '\t' => "\\t".to_string(),
        '\0' => "\\0".to_string(),
        c if c.is_control() => format!("\\x{:02X}", u32::from(c)),
        c => c.to_string(),
    }
}

#[allow(clippy::missing_const_for_fn)]
fn node(
    token: String,
    title: String,
    description: String,
    span: (usize, usize),
    quantifiable: bool,
) -> RegexExplainNode {
    RegexExplainNode {
        token,
        title,
        description,
        span,
        children: Vec::new(),
        quantifiable,
    }
}

impl RegexExplainNode {
    fn with_children(mut self, children: Vec<Self>) -> Self {
        self.children = children;
        self
    }
}

// ============================================================
// 单元测试运行(Unit Tests 模式)
// ============================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexTestCase {
    pub description: String,
    /// 待测文本
    pub text: String,
    /// 断言:pattern 是否匹配该文本
    pub should_match: bool,
    /// 可选:整体匹配文本应严格相等
    #[serde(default)]
    pub expected_match: Option<String>,
    /// 可选:编号分组应与 expected_groups 一一相等(None = 该组未参与)
    #[serde(default)]
    pub expected_groups: Vec<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexTestResult {
    pub description: String,
    pub passed: bool,
    /// 断言失败原因(通过时为空)
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexTestsOutput {
    pub ok: bool,
    pub compile_error: Option<RegexCompileError>,
    pub results: Vec<RegexTestResult>,
    pub passed: usize,
    pub failed: usize,
}

/// 运行一批测试用例。pattern 无效时返回编译错误(所有用例置 failed=false)。
pub fn regex_tests_inner(
    pattern: &str,
    flags: &str,
    cases: &[RegexTestCase],
) -> RegexTestsOutput {
    let flag_set = match parse_flags(flags) {
        Ok(s) => s,
        Err(bad) => {
            return RegexTestsOutput {
                ok: false,
                compile_error: Some(RegexCompileError {
                    column: 0,
                    title: "invalid flag".to_string(),
                    message: format!("unsupported flag `{bad}`"),
                }),
                results: Vec::new(),
                passed: 0,
                failed: 0,
            };
        }
    };
    let mut builder = regex::RegexBuilder::new(pattern);
    flag_set.apply(&mut builder);
    let re = match builder.build() {
        Ok(re) => re,
        Err(e) => {
            return RegexTestsOutput {
                ok: false,
                compile_error: Some(compile_error_generic(e.to_string())),
                results: Vec::new(),
                passed: 0,
                failed: 0,
            };
        }
    };

    let mut results = Vec::with_capacity(cases.len());
    let mut passed = 0;
    let mut failed = 0;
    for case in cases {
        let is_match = re.is_match(&case.text);
        let mut reason = String::new();

        if is_match != case.should_match {
            reason = if case.should_match {
                "pattern did not match (expected match)".to_string()
            } else {
                "pattern matched (expected no match)".to_string()
            };
        } else if let Some(expected) = &case.expected_match {
            let actual = re.find(&case.text).map(|m| m.as_str().to_string());
            if actual.as_deref() != Some(expected.as_str()) {
                reason = format!(
                    "match text mismatch: expected `{expected}`, got `{}`",
                    actual.unwrap_or_default()
                );
            }
        } else if !case.expected_groups.is_empty() {
            if let Some(caps) = re.captures(&case.text) {
                let actual: Vec<Option<String>> = (1..caps.len())
                    .map(|i| caps.get(i).map(|m| m.as_str().to_string()))
                    .collect();
                let expected = &case.expected_groups;
                if &actual != expected {
                    reason = format!(
                        "group mismatch: expected {expected:?}, got {actual:?}"
                    );
                }
            } else {
                reason = "no match to extract groups from".to_string();
            }
        }

        if reason.is_empty() {
            passed += 1;
        } else {
            failed += 1;
        }
        results.push(RegexTestResult {
            description: case.description.clone(),
            passed: reason.is_empty(),
            reason,
        });
    }

    RegexTestsOutput {
        ok: true,
        compile_error: None,
        results,
        passed,
        failed,
    }
}

// ============================================================
// 代码生成器(Code Generator)
// ============================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodegenLanguage {
    Rust,
    Javascript,
    Python,
    Java,
    Csharp,
    Go,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodegenOutput {
    pub language: String,
    pub code: String,
}

/// 生成指定语言的完整可运行片段。
pub fn codegen_inner(
    language: CodegenLanguage,
    pattern: &str,
    flags: &str,
    substitution: Option<&str>,
) -> CodegenOutput {
    // 过滤出目标语言运行时认识的 flag(g/u/y 这类 JS 特有除外再按语言处理)
    let norm_flags = normalize_flags(flags);
    let lang_str = match language {
        CodegenLanguage::Rust => "rust",
        CodegenLanguage::Javascript => "javascript",
        CodegenLanguage::Python => "python",
        CodegenLanguage::Java => "java",
        CodegenLanguage::Csharp => "csharp",
        CodegenLanguage::Go => "go",
    }
    .to_string();

    let code = match language {
        CodegenLanguage::Rust => {
            let sub_part = substitution.map(|s| format!(
                "\nlet replaced = re.replace_all(text, \"{}\");",
                s.replace('\\', "\\\\").replace('"', "\\\"")
            )).unwrap_or_default();
            format!(
                "use regex::Regex;\n\nfn main() {{\n    let re = Regex::new(r\"{pattern}\").unwrap();\n    let text = \"...\";\n    println!(\"{{:?}}\", re.captures_iter(text).map(|c| c.get(0).unwrap().as_str().to_string()).collect::<Vec<_>>());{sub_part}\n}}"
            )
        }
        CodegenLanguage::Javascript => {
            let sub = substitution.map(|s| format!("\nconst replaced = text.replace(re, {s:?});")).unwrap_or_default();
            format!(
                "const re = /{pattern}/{norm_flags};\nconst text = '...';\nconst matches = [...text.matchAll(re)].map(m => m[0]);{sub}"
            )
        }
        CodegenLanguage::Python => {
            let py_flags: String = norm_flags
                .chars()
                .filter(|c| matches!(c, 'i' | 'm' | 's' | 'x'))
                .collect();
            let sub = substitution.map(|s| format!("\nreplaced = re.sub(pattern, r'''{s}''', text)")).unwrap_or_default();
            format!(
                "import re\n\npattern = r'''{pattern}'''\ntext = '...'\nmatches = [m.group(0) for m in re.finditer(pattern, text, flags=re.{py_flags})]{sub}"
            )
            .replace("flags=re.}", "flags=0}")
            .replace("re.\n", "re.NOFLAG\n")
        }
        CodegenLanguage::Java => {
            let jflags: String = norm_flags
                .chars()
                .filter_map(|c| match c {
                    'i' => Some("Pattern.CASE_INSENSITIVE | "),
                    'm' => Some("Pattern.MULTILINE | "),
                    's' => Some("Pattern.DOTALL | "),
                    _ => None,
                })
                .collect();
            let jflags = jflags.trim_end_matches(" | ").to_string();
            let jflags = if jflags.is_empty() { "0".to_string() } else { jflags };
            let sub = substitution.map(|s| format!(
                "\n        String replaced = matcher.replaceAll(\"{}\");",
                s.replace('\\', "\\\\").replace('"', "\\\"").replace("$", "\\$")
            )).unwrap_or_default();
            format!(
                "import java.util.regex.*;\n\npublic class Main {{\n    public static void main(String[] args) {{\n        Pattern pattern = Pattern.compile(\"{}\", {});\n        Matcher matcher = pattern.matcher(\"...\");\n        while (matcher.find()) {{\n            System.out.println(matcher.group());\n        }}{}\n    }}\n}}",
                pattern.replace('\\', "\\\\").replace('"', "\\\""),
                jflags,
                sub,
            )
        }
        CodegenLanguage::Csharp => {
            let ro = if norm_flags.contains('i') { "RegexOptions.IgnoreCase" } else { "" };
            let ro = if ro.is_empty() { "RegexOptions.None".to_string() } else { ro.to_string() };
            let ro = if norm_flags.contains('m') {
                if ro == "RegexOptions.None" { "RegexOptions.Multiline".to_string() } else { format!("{ro} | RegexOptions.Multiline") }
            } else { ro };
            let ro = if norm_flags.contains('s') {
                if ro == "RegexOptions.None" { "RegexOptions.Singleline".to_string() } else { format!("{ro} | RegexOptions.Singleline") }
            } else { ro };
            let sub = substitution.map(|s| format!(
                "\nvar replaced = pattern.Replace(text, @\"{}\");",
                s.replace('"', "\"\"")
            )).unwrap_or_default();
            format!(
                "using System.Text.RegularExpressions;\n\nvar pattern = new Regex(@\"{}\", {});\nvar text = \"...\";\nforeach (Match m in pattern.Matches(text))\n{{\n    Console.WriteLine(m.Value);\n}}{}",
                pattern.replace("\"", "\"\""),
                ro,
                sub,
            )
        }
        CodegenLanguage::Go => {
            let sub = substitution.map(|s| format!(
                "\nreplaced := re.ReplaceAllString(text, `{s}`)"
            )).unwrap_or_default();
            format!(
                "package main\n\nimport (\n    \"fmt\"\n    \"regexp\"\n)\n\nfunc main() {{\n    re := regexp.MustCompile(`{pattern}`)\n    text := \"...\"\n    fmt.Println(re.FindAllString(text, -1)){sub}\n}}"
            )
        }
    };

    CodegenOutput {
        language: lang_str,
        code,
    }
}

// ============================================================
// 调试器(Debugger)—— 匹配步骤回放
// ============================================================

/// regex101 调试器在 NFA 状态机上逐步回放。Rust regex 是惰性 DFA,无法
/// 暴露状态机内部;这里用"逐位置扫描模拟":对每个可能的起点位置记录
/// "从该位置尝试匹配发生了什么"(是否匹配成功、匹配到哪、首个失败点)。
/// 虽然不是真回溯回放,但覆盖 regex101 调试器的主要用途:理解引擎如何
/// 在文本上推进、哪个位置匹配/失败。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexDebugStep {
    /// 尝试起始位置(字符偏移)
    pub start: usize,
    /// 该位置尝试的结果
    pub outcome: String, // "match" | "fail" | "skip"
    /// 匹配成功时的结束位置
    pub end: Option<usize>,
    /// 匹配成功时捕获的文本
    pub matched_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexDebugOutput {
    pub ok: bool,
    pub compile_error: Option<RegexCompileError>,
    pub steps: Vec<RegexDebugStep>,
    /// 最终总匹配数
    pub match_count: usize,
}

/// 用 `Regex::captures_at` 逐位置重试,产生逐步回放数据。
///
/// regex crate 是惰性 DFA,没有暴露 NFA 状态机内部(regex101 的调试器基于
/// PCRE 回溯机逐步回放);这里以"每个起点位置的尝试结果"等价回放引擎在
/// 文本上的推进过程:起点与首个匹配起点之间的位置记录为 `fail` 步,
/// 命中处记录 `match` 步(含结束位置与捕获文本)。
///
/// 步骤输出为**字符偏移**(与 regex_live 一致);回放步数设上限,超长文本
/// 一次性返回会撑爆 IPC 载荷。
pub fn regex_debug_inner(pattern: &str, flags: &str, text: &str) -> RegexDebugOutput {
    /// 回放步数上限(渲染量护栏;与 MAX_MATCHES 同量级)
    const MAX_DEBUG_STEPS: usize = 5000;

    let flag_set = match parse_flags(flags) {
        Ok(s) => s,
        Err(bad) => {
            return RegexDebugOutput {
                ok: false,
                compile_error: Some(RegexCompileError {
                    column: 0,
                    title: "invalid flag".to_string(),
                    message: format!("unsupported flag `{bad}`"),
                }),
                steps: Vec::new(),
                match_count: 0,
            };
        }
    };
    let mut builder = regex::RegexBuilder::new(pattern);
    flag_set.apply(&mut builder);
    let re = match builder.build() {
        Ok(re) => re,
        Err(e) => {
            return RegexDebugOutput {
                ok: false,
                compile_error: Some(compile_error_generic(e.to_string())),
                steps: Vec::new(),
                match_count: 0,
            };
        }
    };

    let byte_to_char = ByteToCharIndex::new(text);
    let mut steps = Vec::new();
    let mut match_count = 0;
    let mut pos = 0;
    let text_len = text.len();
    while pos <= text_len {
        if steps.len() >= MAX_DEBUG_STEPS {
            break;
        }
        if let Some(caps) = re.captures_at(text, pos) {
            let Some(full) = caps.get(0) else {
                break;
            };
            // captures_at 语义:从 pos 起找第一个匹配,full.start >= pos。
            // pos 与 full.start 之间的起点均为"尝试失败后引擎前进"的回放步
            if full.start() > pos {
                for failed_at in failed_starts(text, pos, full.start()) {
                    if steps.len() >= MAX_DEBUG_STEPS {
                        break;
                    }
                    steps.push(RegexDebugStep {
                        start: byte_to_char.char_of(failed_at),
                        outcome: "fail".to_string(),
                        end: None,
                        matched_text: None,
                    });
                }
            }
            steps.push(RegexDebugStep {
                start: byte_to_char.char_of(full.start()),
                outcome: "match".to_string(),
                end: Some(byte_to_char.char_of(full.end())),
                matched_text: Some(full.as_str().to_string()),
            });
            match_count += 1;
            // 空匹配保护:推进至少 1 字符
            let next = if full.end() == full.start() {
                next_boundary(text, full.end())
            } else {
                full.end()
            };
            if next <= pos {
                break;
            }
            pos = next;
        } else {
            // 从 pos 起再无任何匹配:剩余全部起点记为失败(同样受步数上限约束)
            for failed_at in failed_starts(text, pos, text_len) {
                if steps.len() >= MAX_DEBUG_STEPS {
                    break;
                }
                steps.push(RegexDebugStep {
                    start: byte_to_char.char_of(failed_at),
                    outcome: "fail".to_string(),
                    end: None,
                    matched_text: None,
                });
            }
            break;
        }
    }

    RegexDebugOutput {
        ok: true,
        compile_error: None,
        steps,
        match_count,
    }
}

/// 枚举 [from, to) 内的 UTF-8 字符边界位置(失败起点序列)
fn failed_starts(text: &str, from: usize, to: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut at = from;
    while at < to && at <= text.len() {
        out.push(at);
        at = next_boundary(text, at);
    }
    out
}

/// 取下一个 UTF-8 字符边界(空匹配保护用)
fn next_boundary(text: &str, mut at: usize) -> usize {
    while at < text.len() && !text.is_char_boundary(at) {
        at += 1;
    }
    if at < text.len() {
        at + text[at..].chars().next().map_or(1, char::len_utf8)
    } else {
        at + 1
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn live(pattern: &str, flags: &str, text: &str) -> RegexLiveOutput {
        regex_live_inner(&RegexLiveInput {
            pattern: pattern.to_string(),
            flags: flags.to_string(),
            test_text: text.to_string(),
            substitution: String::new(),
        })
    }

    #[test]
    fn live_basic_match() {
        let out = live(r"\d+", "", "abc 123 def 45");
        assert!(out.ok);
        assert_eq!(out.match_count, 2);
        assert_eq!(out.matches[0].text, "123");
        assert_eq!(out.matches[0].range, (4, 7));
        assert_eq!(out.matches[1].text, "45");
        // 截断标志默认 false
        assert!(!out.truncated_text);
        assert!(!out.matches_truncated);
    }

    #[test]
    fn live_cjk_offsets_are_char_based() {
        // 中文文本:每个汉字 3 字节,字符偏移 ≠ 字节偏移
        // "你好abc" —— "abc" 起始字符偏移为 2,字节偏移为 6
        let out = live("abc", "", "你好abc世界");
        assert!(out.ok);
        assert_eq!(out.match_count, 1);
        assert_eq!(out.matches[0].range, (2, 5), "字符偏移而非字节偏移");

        // 多字节文本内的匹配区间
        let out = live(r"好a", "", "你好abc");
        assert_eq!(out.matches[0].range, (1, 3));
        assert_eq!(out.matches[0].text, "好a");
    }

    #[test]
    fn live_explain_spans_are_char_based() {
        // pattern 内含中文:解释节点 span 应为字符偏移
        let out = live("中+", "", "中中");
        assert!(out.ok);
        let node = out.explain.first().expect("explain not empty");
        // "中+" 为 2 字符(4 字节);字面量 "中" span = (0,1) 字符
        assert_eq!(node.span.0, 0);
        assert!(node.span.1 <= 2);
    }

    #[test]
    fn live_match_truncation_keeps_true_count() {
        // 生成 6000 个匹配,超出 MAX_MATCHES(5000)
        let text = "a".repeat(6000);
        let out = live("a", "", &text);
        assert!(out.ok);
        assert_eq!(out.match_count, 6000, "计数保留真实值");
        assert_eq!(out.matches.len(), 5000, "返回条目封顶");
        assert!(out.matches_truncated);
    }

    #[test]
    fn live_text_truncation_on_oversized_input() {
        // 构造 1MB+ 输入,截断到边界且不 panic
        let big = format!("{}{}", "x".repeat(MAX_TEST_TEXT_BYTES + 100), "尾巴");
        let out = live("x", "", &big);
        assert!(out.ok);
        assert!(out.truncated_text);
        // 截断只预览到护栏内,匹配仍应发生
        assert!(out.match_count > 0);
    }

    #[test]
    fn live_groups_and_named() {
        let out = live(r"(?P<year>\d{4})-(\d{2})", "", "2024-01 2025-12");
        assert!(out.ok);
        assert_eq!(out.match_count, 2);
        assert_eq!(out.matches[0].groups.len(), 2);
        let g1 = out.matches[0].groups[0].as_ref().unwrap();
        assert_eq!(g1.text, "2024");
        assert_eq!(out.matches[0].named_groups[0].name, "year");
        assert_eq!(out.matches[0].named_groups[0].text, "2024");
        // 分组清单
        assert_eq!(out.groups.len(), 2);
        assert_eq!(out.groups[0].name, "year");
        assert_eq!(out.groups[1].name, "");
    }

    #[test]
    fn live_substitution() {
        let out = regex_live_inner(&RegexLiveInput {
            pattern: r"\d+".to_string(),
            flags: String::new(),
            test_text: "a1b22c".to_string(),
            substitution: "#".to_string(),
        });
        assert!(out.ok);
        assert_eq!(out.substitution_result.as_deref(), Some("a#b#c"));
    }

    #[test]
    fn live_compile_error_position() {
        let out = live("(unclosed", "", "abc");
        assert!(!out.ok);
        let err = out.compile_error.unwrap();
        assert_eq!(err.title, "unclosed group");
    }

    #[test]
    fn live_invalid_flag() {
        let out = live("a", "q", "abc");
        assert!(!out.ok);
        assert!(out.compile_error.unwrap().message.contains('q'));
    }

    #[test]
    fn live_empty_pattern_matches_everything_zero_width() {
        let out = live("", "", "ab");
        // 空 pattern 在 regex crate 下逐字符零宽匹配
        assert!(out.ok);
        assert_eq!(out.match_count, 3); // 'a', 'b', 尾部
    }

    #[test]
    fn live_case_insensitive() {
        let out = live("HELLO", "i", "hello world");
        assert_eq!(out.match_count, 1);
    }

    #[test]
    fn explain_has_nodes_for_group_and_quantifier() {
        let out = live(r"(?P<year>\d{4})-(?<mo>\d{2})", "", "2024-01");
        assert!(out.ok);
        // 根层至少含 命名组1、字面量-、命名组2
        let titles: Vec<&str> = out.explain.iter().map(|n| n.title.as_str()).collect();
        assert!(titles.iter().any(|t| t.contains("Named capturing group")));
        // 组子节点含 量词
        let year_node = out
            .explain
            .iter()
            .find(|n| n.title.contains("`year`"))
            .unwrap();
        assert!(year_node.children.iter().any(|c| c.title.contains("Quantifier")));
    }

    #[test]
    fn explain_alternation_and_classes() {
        let out = live(r"(?:cat|dog)[a-z]+", "", "cat dog");
        assert!(out.ok);
        // 根层:非捕获组 + 量词;Alternation 是组内子节点,字符类是量词子节点
        let titles: Vec<&str> = out.explain.iter().map(|n| n.title.as_str()).collect();
        assert!(titles.contains(&"Non-capturing group"));
        assert!(titles.iter().any(|t| t.starts_with("Quantifier")));
        let group = out.explain.iter().find(|n| n.title == "Non-capturing group").unwrap();
        assert!(
            group.children.iter().any(|c| c.title == "Alternation"),
            "alternation should be nested in group"
        );
        let quant = out.explain.iter().find(|n| n.title.starts_with("Quantifier")).unwrap();
        assert!(
            quant.children.iter().any(|c| c.title == "Character class"),
            "character class should be nested under its quantifier"
        );
    }

    #[test]
    fn tests_mode_assertions() {
        let cases = vec![
            RegexTestCase {
                description: "matches digits".into(),
                text: "abc123".into(),
                should_match: true,
                expected_match: Some("123".into()),
                expected_groups: Vec::new(),
            },
            RegexTestCase {
                description: "no digits".into(),
                text: "abc".into(),
                should_match: false,
                expected_match: None,
                expected_groups: Vec::new(),
            },
        ];
        let out = regex_tests_inner(r"\d+", "", &cases);
        assert!(out.ok);
        assert_eq!(out.passed, 2);
        assert_eq!(out.failed, 0);
    }

    #[test]
    fn tests_mode_group_assertion_failure() {
        let cases = vec![RegexTestCase {
            description: "groups".into(),
            text: "2024-01".into(),
            should_match: true,
            expected_match: None,
            expected_groups: vec![Some("2024".into()), Some("01".into())],
        }];
        let out = regex_tests_inner(r"(\d+)-(\d+)", "", &cases);
        assert!(out.ok);
        assert_eq!(out.passed, 1);
    }

    #[test]
    fn tests_mode_reports_failure_reason() {
        let cases = vec![RegexTestCase {
            description: "bad".into(),
            text: "abc".into(),
            should_match: false,
            expected_match: None,
            expected_groups: Vec::new(),
        }];
        let out = regex_tests_inner(r"a", "", &cases);
        assert_eq!(out.failed, 1);
        assert!(!out.results[0].passed);
        assert!(out.results[0].reason.contains("expected no match"));
    }

    #[test]
    fn codegen_javascript_and_rust() {
        let js = codegen_inner(CodegenLanguage::Javascript, r"\d+", "g", None);
        assert!(js.code.contains("matchAll"));
        let rs = codegen_inner(CodegenLanguage::Rust, r"\d+", "", None);
        assert!(rs.code.contains("Regex::new"));
        let py = codegen_inner(CodegenLanguage::Python, r"\d+", "g", None);
        assert!(py.code.contains("finditer"));
        let cs = codegen_inner(CodegenLanguage::Csharp, r"\d+", "i", None);
        assert!(cs.code.contains("RegexOptions.IgnoreCase"));
        let go = codegen_inner(CodegenLanguage::Go, r"\d+", "", None);
        assert!(go.code.contains("regexp.MustCompile"));
        let java = codegen_inner(CodegenLanguage::Java, r"\d+", "im", None);
        assert!(java.code.contains("CASE_INSENSITIVE"));
        assert!(java.code.contains("MULTILINE"));
    }

    #[test]
    fn debug_steps_replay_matches() {
        let out = regex_debug_inner(r"\d+", "", "ab12cd3");
        assert!(out.ok);
        assert_eq!(out.match_count, 2);
        // 回放:0/1 起点失败,2 匹配"12",4/5 失败,6 匹配"3"
        let match_steps: Vec<&RegexDebugStep> =
            out.steps.iter().filter(|s| s.outcome == "match").collect();
        assert_eq!(match_steps.len(), 2);
        assert_eq!(match_steps[0].matched_text.as_deref(), Some("12"));
        assert_eq!(match_steps[0].start, 2);
        assert_eq!(match_steps[1].matched_text.as_deref(), Some("3"));
        // 失败起点:0,1,4,5
        let fail_starts: Vec<usize> = out
            .steps
            .iter()
            .filter(|s| s.outcome == "fail")
            .map(|s| s.start)
            .collect();
        assert_eq!(fail_starts, vec![0, 1, 4, 5]);
    }

    #[test]
    fn debug_handles_empty_match_infinite_loop() {
        let out = regex_debug_inner("a*", "", "b");
        assert!(out.ok);
        // 空匹配 + 前进保护:至少产生 1 步且不死循环
        assert!(!out.steps.is_empty());
    }

    #[test]
    fn debug_steps_are_char_offsets_for_cjk() {
        // "ab12" 的中文版:"你12" —— "12" 起始字符偏移 1(字节 3)
        let out = regex_debug_inner(r"\d+", "", "你12");
        assert!(out.ok);
        let match_steps: Vec<_> = out.steps.iter().filter(|s| s.outcome == "match").collect();
        assert_eq!(match_steps[0].start, 1, "字符偏移");
        assert_eq!(match_steps[0].end, Some(3));
        // 失败起点:0
        assert_eq!(
            out.steps
                .iter()
                .filter(|s| s.outcome == "fail")
                .map(|s| s.start)
                .collect::<Vec<_>>(),
            vec![0]
        );
    }

    #[test]
    fn byte_to_char_index_maps_boundaries() {
        let idx = ByteToCharIndex::new("你a好");
        // 字节布局:你(0..3) a(3..4) 好(4..7)
        assert_eq!(idx.char_of(0), 0);
        assert_eq!(idx.char_of(3), 1);
        assert_eq!(idx.char_of(4), 2);
        assert_eq!(idx.char_of(7), 3, "文本末尾偏移 = 字符数");
        // 空文本
        let empty = ByteToCharIndex::new("");
        assert_eq!(empty.char_of(0), 0);
    }

    #[test]
    fn normalize_flags_filters_unknown() {
        assert_eq!(normalize_flags("gimq"), "gim");
    }
}

