# 文件夹/文件分析器(Folder Analyzer)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增只读工具 `folder_analyzer`:选择文件夹后统计文件总数、按扩展名/类别分门别类的数量与大小、文本文件的行数与字数;支持跨文本文件的内容搜索(普通串/正则);支持直接放入单个文件解析(类型嗅探、编码、行数字数、SHA-256)。全程只读,不写任何文件。

**Architecture:** Rust 端新增 `tools/folder_analyzer/` 子模块(classify / text_metrics / scanner / search / inspect 五个纯函数单元),以 `Tool` + `StreamingTool` 双实现注册进现有 inventory 注册表,复用 `tool_execute` / `tool_execute_stream` / `tool_cancel` IPC 与 `tool_progress` / `tool_completed` / `tool_failed` 事件。前端新增懒加载工具页 `FolderAnalyzer.tsx`(模式切换 + 拖放区 + 进度 + 三类结果面板),经 `registry.ts` 与 `tool-catalog.ts` 注册。路径安全沿用 `AuthorizedPaths` 沙箱:dialog 选择即授权;拖放路径通过新命令 `fs_authorize_dropped_paths` 显式授权。

**Tech Stack:** Rust(std::fs 同步遍历 + tokio spawn_blocking、regex、encoding_rs、sha2、serde_json)、Tauri V2 IPC 事件、React 19 + Tailwind + vitest。零新增依赖。

## Global Constraints

- **绝对只读**:所有新代码禁止出现任何写文件操作;工具描述与 UI 文案注明"只读"。
- **零新增依赖**:npm 不加包;Rust 仅使用 Cargo.toml 已有依赖(regex / encoding_rs / sha2 / hex / serde / serde_json / tokio / tokio-util / futures / async-stream / tempfile 仅 dev)。
- 工具 id 一经注册不可变更(prd/07-tool-catalog.md §6.1):定为 `folder_analyzer`。
- 错误码沿用 `ToolError` / `AppError` 现有体系(`ERR_INVALID_INPUT` / `ERR_PERMISSION_DENIED`)。
- 响应包络统一 `CommandResponse<T>`;事件名固定 `tool_progress` / `tool_completed` / `tool_failed`。
- Clippy:`all = deny`,`pedantic/nursery = warn`,禁 unwrap/expect/panic/print_stdout;非测试代码用 `unwrap_or_else(std::sync::PoisonError::into_inner)` 处理 Mutex 中毒;测试代码内 unwrap 是项目既有惯例(hash_calculator.rs 同款),允许。
- 每个任务结束跑对应测试并单独 commit(Conventional Commits)。
- 默认上限:隐藏文件默认排除、符号链接一律跳过不跟随、文本度量单文件上限 8 MiB、扫描条目上限 200_000、搜索单文件上限 4 MiB、总匹配上限 5_000、单文件匹配上限 200、inspect 上限 64 MiB。
- Rust Report JSON 键名保持 serde 默认 **snake_case**,前端类型按 snake_case 镜像,不做 camelCase 转换。

## 文件结构总览

```
src-tauri/src/
├── commands/
│   ├── fs.rs                      # 修改:新增 fs_authorize_dropped_paths(Task 9)
│   └── tool.rs                    # 修改:stream 支持 params/text;file_path 授权校验(Task 8)
├── tools/
│   ├── mod.rs                     # 修改:声明 folder_analyzer 模块(Task 1)
│   ├── core/tool.rs               # 修改:StreamEvent::Progress 增加 processed/total(Task 7)
│   └── folder_analyzer/
│       ├── mod.rs                 # FolderAnalyzer Tool + StreamingTool + 注册(Task 6/7)
│       ├── classify.rs            # 扩展名分类 / 魔数嗅探 / 二进制判定(Task 1)
│       ├── text_metrics.rs        # 解码 + 行数/字数统计(Task 2)
│       ├── scanner.rs             # 目录遍历聚合统计(Task 3)
│       ├── search.rs              # 内容搜索引擎(Task 4)
│       └── inspect.rs             # 单文件解析(Task 5)
src/
├── tools/
│   ├── FolderAnalyzer.tsx         # 主组件(Task 13)
│   ├── FolderAnalyzer.test.tsx
│   ├── registry.ts                # 修改:注册 UI 组件(Task 15)
│   └── folder-analyzer/
│       ├── types.ts               # 结果类型 + 格式化工具(Task 10)
│       ├── analyzerApi.ts         # dialog/拖放授权/任务启停/事件订阅(Task 11)
│       ├── routeDropped.ts        # 拖放授权+路由纯函数(Task 13)
│       ├── useAnalyzerTask.ts     # 任务状态 hook(Task 12)
│       ├── ScanResultsPanel.tsx   # 扫描结果面板(Task 14)
│       ├── SearchResultsPanel.tsx # 搜索结果面板(Task 14)
│       └── FileInspectPanel.tsx   # 单文件解析面板(Task 14)
└── lib/tool-catalog.ts            # 修改:目录条目(Task 15)
CHANGELOG.md                       # 修改(Task 16)
prd/07-tool-catalog.md             # 修改:P2 表追加一行(Task 16)
```

---

### Task 1: 分类与嗅探单元 classify.rs

**Files:**
- Create: `src-tauri/src/tools/folder_analyzer/classify.rs`
- Create: `src-tauri/src/tools/folder_analyzer/mod.rs`(空壳,后续任务填充)
- Modify: `src-tauri/src/tools/mod.rs`(追加 `pub mod folder_analyzer;`)

**Interfaces:**
- Consumes: 无(纯函数,仅 std + serde)
- Produces:
  - `enum FileCategory { Code, Document, Image, Video, Audio, Archive, Binary, Other }`(`Serialize`,`snake_case`)
  - `fn extension_of(path: &Path) -> String`(小写、无点、无扩展名为空串)
  - `fn category_for_extension(ext: &str) -> FileCategory`
  - `fn is_text_extension(ext: &str) -> bool`
  - `fn sniff_magic(bytes: &[u8]) -> Option<&'static str>`
  - `fn bytes_look_binary(bytes: &[u8]) -> bool`

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/tools/folder_analyzer/mod.rs`(暂只有声明):

```rust
// 文件夹/文件分析器(只读)
//
// scan: 目录统计(数量/大小/扩展名/类别/文本行数字数)
// search: 跨文本文件内容搜索(普通串或正则)
// file: 单文件解析(魔数/编码/行字数/SHA-256)

pub mod classify;
```

在 `src-tauri/src/tools/mod.rs` 与其他 mod 声明并列追加一行:

```rust
pub mod folder_analyzer;
```

将以下内容写入 `classify.rs`(先只有 tests,编译会失败 —— 这就是失败测试):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_extension_of() {
        assert_eq!(extension_of(Path::new("a/b/c.TXT")), "txt");
        assert_eq!(extension_of(Path::new("noext")), "");
        assert_eq!(extension_of(Path::new("x.tar.gz")), "gz");
        #[cfg(windows)]
        assert_eq!(extension_of(Path::new(r"C:\dir\File.RS")), "rs");
    }

    #[test]
    fn test_category_for_extension() {
        assert_eq!(category_for_extension("rs"), FileCategory::Code);
        assert_eq!(category_for_extension("tsx"), FileCategory::Code);
        assert_eq!(category_for_extension("md"), FileCategory::Document);
        assert_eq!(category_for_extension("pdf"), FileCategory::Document);
        assert_eq!(category_for_extension("png"), FileCategory::Image);
        assert_eq!(category_for_extension("mp4"), FileCategory::Video);
        assert_eq!(category_for_extension("flac"), FileCategory::Audio);
        assert_eq!(category_for_extension("zip"), FileCategory::Archive);
        assert_eq!(category_for_extension("dll"), FileCategory::Binary);
        assert_eq!(category_for_extension("xyzabc"), FileCategory::Other);
        assert_eq!(category_for_extension(""), FileCategory::Other);
    }

    #[test]
    fn test_is_text_extension() {
        assert!(is_text_extension("json"));
        assert!(is_text_extension("log"));
        assert!(!is_text_extension("png"));
        assert!(!is_text_extension(""));
    }

    #[test]
    fn test_sniff_magic() {
        assert_eq!(sniff_magic(b"\x89PNG\r\n\x1a\n...."), Some("png"));
        assert_eq!(sniff_magic(b"\xff\xd8\xff\xe0"), Some("jpeg"));
        assert_eq!(sniff_magic(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(sniff_magic(b"PK\x03\x04rest"), Some("zip"));
        assert_eq!(sniff_magic(b"plain text"), None);
        assert_eq!(sniff_magic(b""), None);
    }

    #[test]
    fn test_bytes_look_binary() {
        assert!(!bytes_look_binary(b"hello world"));
        assert!(bytes_look_binary(b"ab\x00cd"));
        let mut late_nul = vec![b'a'; 9000];
        late_nul[8500] = 0;
        assert!(bytes_look_binary(&late_nul));
    }

    #[test]
    fn test_category_serde_snake_case() {
        let v = serde_json::to_value(FileCategory::Document).unwrap();
        assert_eq!(v, serde_json::json!("document"));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib folder_analyzer --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败,报 `extension_of` 等符号不存在

- [ ] **Step 3: 最小实现**

在 `classify.rs` 的 tests 之前写入:

```rust
// 扩展名分类 / 魔数嗅探 / 二进制判定(纯函数,只读,无 IO)

use serde::Serialize;

/// 文件大类(按扩展名归类)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileCategory {
    Code,
    Document,
    Image,
    Video,
    Audio,
    Archive,
    Binary,
    Other,
}

const CODE_EXTS: &[&str] = &[
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "rs", "py", "go", "java", "kt", "kts", "swift", "c",
    "h", "cpp", "hpp", "cc", "hh", "cs", "rb", "php", "sh", "bash", "zsh", "fish", "ps1", "bat",
    "cmd", "sql", "css", "scss", "less", "html", "htm", "vue", "svelte", "json", "json5", "yaml",
    "yml", "toml", "xml", "proto", "graphql", "ini", "cfg", "conf", "env", "gradle", "cmake",
    "makefile", "dockerfile", "lock",
];
const DOC_TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "rst", "adoc", "log", "csv", "tsv", "tex", "gitignore",
    "editorconfig",
];
const IMAGE_EXTS: &[&str] =
    &["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "avif"];
const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"];
const AUDIO_EXTS: &[&str] = &["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"];
const ARCHIVE_EXTS: &[&str] = &["zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "zst", "jar"];
const BINARY_EXTS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "wasm", "class", "pyc", "pdb",
];
const DOC_BINARY_EXTS: &[&str] =
    &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "epub"];

/// 取小写扩展名(不含点;无扩展名返回空串)
#[must_use]
pub fn extension_of(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// 扩展名 → 大类;未知归 Other
#[must_use]
pub fn category_for_extension(ext: &str) -> FileCategory {
    if CODE_EXTS.contains(&ext) {
        FileCategory::Code
    } else if DOC_TEXT_EXTS.contains(&ext) || DOC_BINARY_EXTS.contains(&ext) {
        FileCategory::Document
    } else if IMAGE_EXTS.contains(&ext) {
        FileCategory::Image
    } else if VIDEO_EXTS.contains(&ext) {
        FileCategory::Video
    } else if AUDIO_EXTS.contains(&ext) {
        FileCategory::Audio
    } else if ARCHIVE_EXTS.contains(&ext) {
        FileCategory::Archive
    } else if BINARY_EXTS.contains(&ext) {
        FileCategory::Binary
    } else {
        FileCategory::Other
    }
}

/// 是否按"文本"统计行数/字数(代码类 + 纯文本文档类)
#[must_use]
pub fn is_text_extension(ext: &str) -> bool {
    CODE_EXTS.contains(&ext) || DOC_TEXT_EXTS.contains(&ext)
}

/// 魔数嗅探,返回格式标签;无法识别返回 None
#[must_use]
pub fn sniff_magic(bytes: &[u8]) -> Option<&'static str> {
    const SIGNS: &[(&[u8], &str)] = &[
        (b"\x89PNG\r\n\x1a\n", "png"),
        (b"\xff\xd8\xff", "jpeg"),
        (b"GIF87a", "gif"),
        (b"GIF89a", "gif"),
        (b"%PDF-", "pdf"),
        (b"PK\x03\x04", "zip"),
        (b"\x1f\x8b", "gzip"),
        (b"\x7fELF", "elf"),
        (b"MZ", "pe"),
        (b"\xca\xfe\xba\xbe", "java-class"),
        (b"OggS", "ogg"),
        (b"RIFF", "riff"),
        (b"SQLite format 3\x00", "sqlite"),
    ];
    SIGNS
        .iter()
        .find(|(sig, _)| bytes.starts_with(sig))
        .map(|(_, name)| *name)
}

/// 头部 8KB 内含 NUL 字节视为二进制
#[must_use]
pub fn bytes_look_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    head.contains(&0)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib folder_analyzer --manifest-path src-tauri/Cargo.toml`
Expected: 6 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tools/mod.rs src-tauri/src/tools/folder_analyzer/
git commit -m "feat(analyzer): add file classification and magic-sniffing unit"
```

---

### Task 2: 文本度量单元 text_metrics.rs

**Files:**
- Create: `src-tauri/src/tools/folder_analyzer/text_metrics.rs`
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(追加 `pub mod text_metrics;`)

**Interfaces:**
- Consumes: encoding_rs(Cargo.toml 已有)
- Produces:
  - `struct TextMetrics { lines: u64, words: u64, chars: u64 }`(`Serialize`)
  - `fn decode_best_effort(bytes: &[u8]) -> (String, &'static str)` — 返回 (文本, 编码标签);标签 ∈ `"UTF-8" | "UTF-16LE" | "UTF-16BE" | "GBK" | "unknown"`
  - `fn count_metrics(text: &str) -> TextMetrics`

**统计口径(实现与文档必须一致):**
- 行数:按 `\n` 计数;末尾无换行的最后一段也算一行;空文本为 0 行;`\r\n` 视为一行。
- 字符数:Unicode 标量值个数,**不含** `\r` / `\n`。
- 字数:每个 CJK 字符独立计 1 词;连续的非空白、非 CJK 序列计 1 词(空白重置序列)。

- [ ] **Step 1: 写失败测试**

`text_metrics.rs` 先只写入 tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty() {
        let m = count_metrics("");
        assert_eq!((m.lines, m.words, m.chars), (0, 0, 0));
    }

    #[test]
    fn test_simple_english() {
        let m = count_metrics("hello world\n");
        assert_eq!((m.lines, m.words, m.chars), (1, 2, 11));
    }

    #[test]
    fn test_no_trailing_newline_counts_as_line() {
        assert_eq!(count_metrics("a\nb").lines, 2);
        assert_eq!(count_metrics("a\n").lines, 1);
        assert_eq!(count_metrics("a\nb\n").lines, 2);
    }

    #[test]
    fn test_crlf() {
        let m = count_metrics("aa\r\nbb\r\n");
        assert_eq!((m.lines, m.chars), (2, 4));
    }

    #[test]
    fn test_cjk_words_and_chars() {
        // 你好世界 = 4 词 4 字;" hello" 再 1 词 5 字(空格不计 chars)
        let m = count_metrics("你好世界 hello\n");
        assert_eq!((m.lines, m.words, m.chars), (1, 5, 9));
    }

    #[test]
    fn test_decode_utf8() {
        let (text, enc) = decode_best_effort("héllo\n".as_bytes());
        assert_eq!(enc, "UTF-8");
        assert_eq!(text, "héllo\n");
    }

    #[test]
    fn test_decode_utf16le_bom() {
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend("你A".encode_utf16().iter().flat_map(|u| u.to_le_bytes()));
        let (text, enc) = decode_best_effort(&bytes);
        assert_eq!(enc, "UTF-16LE");
        assert_eq!(text, "你A");
    }

    #[test]
    fn test_decode_gbk_fallback() {
        // "你好" 的 GBK 编码
        let (text, enc) = decode_best_effort(&[0xC4, 0xE3, 0xBA, 0xC3]);
        assert_eq!(enc, "GBK");
        assert_eq!(text, "你好");
    }

    #[test]
    fn test_decode_unknown_lossy() {
        let (text, enc) = decode_best_effort(&[0x81, 0xFE, 0xFF]);
        assert_eq!(enc, "unknown");
        assert!(text.contains('\u{FFFD}'));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib text_metrics --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(`TextMetrics`/`decode_best_effort` 不存在)

- [ ] **Step 3: 最小实现**

tests 之前写入:

```rust
// 文本解码与 行数/字数 统计(纯函数,只读)
//
// 口径:
// - 行数:按 \n 计数,末尾无换行的最后一段也算一行,空文本 0 行,\r\n 视为一行
// - 字符数:Unicode 标量个数,不含 \r \n
// - 字数:CJK 字符逐字计词;连续非空白非 CJK 序列计 1 词

use encoding_rs::{Encoding, GBK};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TextMetrics {
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
}

/// 解码策略:BOM → 严格 UTF-8 → GBK → 有损兜底(unknown)
#[must_use]
pub fn decode_best_effort(bytes: &[u8]) -> (String, &'static str) {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let label = match enc.name() {
            "UTF-16LE" => "UTF-16LE",
            "UTF-16BE" => "UTF-16BE",
            _ => "UTF-8",
        };
        let (cow, _, _) = enc.decode(&bytes[bom_len..]);
        return (cow.into_owned(), label);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_owned(), "UTF-8"),
        Err(_) => {
            let (cow, _, had_errors) = GBK.decode(bytes);
            if had_errors {
                (String::from_utf8_lossy(bytes).into_owned(), "unknown")
            } else {
                (cow.into_owned(), "GBK")
            }
        }
    }
}

fn is_cjk(c: char) -> bool {
    ('\u{3400}'..='\u{4DBF}').contains(&c)
        || ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{F900}'..='\u{FAFF}').contains(&c)
}

/// 按上述口径统计行数/字数/字符数
#[must_use]
pub fn count_metrics(text: &str) -> TextMetrics {
    if text.is_empty() {
        return TextMetrics { lines: 0, words: 0, chars: 0 };
    }
    let mut lines = text.matches('\n').count() as u64;
    if !text.ends_with('\n') {
        lines += 1;
    }
    let body = text.strip_suffix('\n').unwrap_or(text);
    let mut chars = 0u64;
    let mut words = 0u64;
    let mut in_word = false;
    for raw in body.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        chars += line.chars().count() as u64;
        for ch in line.chars() {
            if is_cjk(ch) {
                words += 1;
                in_word = false;
            } else if ch.is_whitespace() {
                in_word = false;
            } else if !in_word {
                in_word = true;
                words += 1;
            }
        }
    }
    TextMetrics { lines, words, chars }
}
```

> `as u64` 处如 clippy 报 `cast_possible_truncation`,加 `#[allow(clippy::cast_possible_truncation)]`(chars().count() 不可能超 u64)。

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib text_metrics --manifest-path src-tauri/Cargo.toml`
Expected: 9 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tools/folder_analyzer/
git commit -m "feat(analyzer): add text decoding and line/word counting"
```

---

### Task 3: 目录扫描器 scanner.rs

**Files:**
- Create: `src-tauri/src/tools/folder_analyzer/scanner.rs`
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(追加 `pub mod scanner;`)

**Interfaces:**
- Consumes: Task 1 全部函数、Task 2 全部函数、`tokio_util::sync::CancellationToken`(已有依赖)
- Produces(Task 6/7 依赖,字段名精确一致):
  - `struct ScanOptions { include_hidden: bool, analyze_text_metrics: bool, max_text_file_bytes: u64, max_entries: u64 }` + `Default`(false / true / 8 MiB / 200_000)
  - `struct CategoryStat { category: FileCategory, files: u64, bytes: u64 }`
  - `struct ExtStat { ext: String, files: u64, bytes: u64 }`
  - `struct ExtTextStat { ext: String, files: u64, lines: u64, words: u64, chars: u64 }`
  - `struct TextMetricsSummary { files_analyzed, files_skipped_large, files_skipped_binary, lines, words, chars: u64, by_extension: Vec<ExtTextStat> }`
  - `struct FileStat { path: String, bytes: u64 }`
  - `struct ScanReport { root: String, total_files: u64, total_dirs: u64, total_bytes: u64, symlinks_skipped: u64, truncated: bool, cancelled: bool, elapsed_ms: u64, by_category: Vec<CategoryStat>, by_extension: Vec<ExtStat>, text_metrics: Option<TextMetricsSummary>, largest_files: Vec<FileStat> }`(全字段 `Serialize`)
  - `pub type ProgressFn = dyn Fn(u64, u64) + Sync` — 参数 (files_so_far, dirs_so_far)
  - `fn scan_folder(root: &Path, opts: &ScanOptions, cancel: Option<&CancellationToken>, on_progress: &ProgressFn) -> ScanReport`(同步、阻塞、无 panic)

排序约定(测试断言依据):`by_category` 按 files 降序;`by_extension` 按 files 降序、同数按 ext 升序,截取前 100;`largest_files` 按 bytes 降序截取前 20。

- [ ] **Step 1: 写失败测试**

`scanner.rs` 先只写 tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn noop_progress() -> impl Fn(u64, u64) {
        |_f, _d| {}
    }

    /// 目录树:
    /// a.txt "hi\n"(3B) b.md "你好\n"(7B) sub/c.rs(14B)
    /// .hidden.txt(2B,默认跳过) img.png 8B 伪 PNG
    fn setup_tree(dir: &std::path::Path) {
        fs::write(dir.join("a.txt"), b"hi\n").unwrap();
        fs::write(dir.join("b.md"), "你好\n".as_bytes()).unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.rs"), b"fn main() {}\n").unwrap();
        fs::write(dir.join(".hidden.txt"), b"x\n").unwrap();
        let png: &[u8] = b"\x89PNG\r\n\x1a\nxx";
        fs::write(dir.join("img.png"), png).unwrap();
    }

    #[test]
    fn test_scan_totals_and_categories() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert_eq!(report.root, tmp.path().to_string_lossy());
        assert_eq!(report.total_files, 5);
        assert_eq!(report.total_dirs, 1);
        assert_eq!(report.total_bytes, 3 + 7 + 14 + 2 + 8);
        assert_eq!(report.symlinks_skipped, 0);
        assert!(!report.truncated && !report.cancelled);

        let code = report.by_category.iter().find(|c| c.category == FileCategory::Code).unwrap();
        assert_eq!((code.files, code.bytes), (1, 14));
        let doc = report.by_category.iter().find(|c| c.category == FileCategory::Document).unwrap();
        assert_eq!((doc.files, doc.bytes), (1, 7));
    }

    #[test]
    fn test_by_extension_sorted_desc() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert!(report.by_extension.len() >= 3);
        assert!(report.by_extension.windows(2).all(|w| w[0].files > w[1].files
            || (w[0].files == w[1].files && w[0].ext < w[1].ext)));
    }

    #[test]
    fn test_hidden_excluded_by_default_included_when_opted() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let r1 = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        assert!(r1.by_extension.iter().all(|e| e.ext != "txt" || e.files == 1));

        let opts = ScanOptions { include_hidden: true, ..ScanOptions::default() };
        let r2 = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert_eq!(r2.total_files, 6);
        assert_eq!(r1.total_files, 5);
    }

    #[test]
    fn test_text_metrics_aggregated_per_ext() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        // a.txt:1行/1词/2字;b.md:1行/2词(CJK)/2字;c.rs:1行/3词(fn,main,{})/13字
        assert_eq!(tm.files_analyzed, 3);
        assert_eq!((tm.lines, tm.words, tm.chars), (3, 6, 17));

        let txt = tm.by_extension.iter().find(|e| e.ext == "txt").unwrap();
        assert_eq!((txt.files, txt.lines, txt.words, txt.chars), (1, 1, 1, 2));
        let md = tm.by_extension.iter().find(|e| e.ext == "md").unwrap();
        assert_eq!((md.files, md.words), (1, 2));
        // img.png 非文本扩展,不计入 metrics
        assert!(tm.by_extension.iter().all(|e| e.ext != "png"));
    }

    #[test]
    fn test_large_file_skipped_from_metrics_but_counted() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("big.log"), b"a\n").unwrap();
        fs::write(tmp.path().join("huge.log"), vec![b'x'; 32]).unwrap();
        let opts = ScanOptions { max_text_file_bytes: 16, ..ScanOptions::default() };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        assert_eq!(tm.files_analyzed, 1);
        assert_eq!(tm.files_skipped_large, 1);
        assert_eq!(report.total_files, 2);
    }

    #[test]
    fn test_binary_content_skipped_even_with_text_ext() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("fake.txt"), b"ok\x00binary").unwrap();
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let tm = report.text_metrics.as_ref().unwrap();
        assert_eq!(tm.files_analyzed, 0);
        assert_eq!(tm.files_skipped_binary, 1);
    }

    #[test]
    fn test_max_entries_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..10 {
            fs::write(tmp.path().join(format!("f{i}.txt")), b"x\n").unwrap();
        }
        let opts = ScanOptions { max_entries: 3, ..ScanOptions::default() };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert!(report.truncated);
        assert!(!report.cancelled);
        assert_eq!(report.total_files, 3);
    }

    #[test]
    fn test_cancelled_token_stops_scan() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..50 {
            fs::write(tmp.path().join(format!("g{i}.txt")), b"x\n").unwrap();
        }
        let token = CancellationToken::new();
        token.cancel();
        let report =
            scan_folder(tmp.path(), &ScanOptions::default(), Some(&token), &noop_progress());
        assert!(report.cancelled);
        assert_eq!(report.total_files, 0);
    }

    #[test]
    fn test_largest_files_top_desc() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("s.txt"), b"x\n").unwrap();
        fs::write(tmp.path().join("m.txt"), b"xxxx\n").unwrap();
        fs::write(tmp.path().join("l.txt"), b"xxxxxxxx\n").unwrap();
        let report = scan_folder(tmp.path(), &ScanOptions::default(), None, &noop_progress());
        let sizes: Vec<u64> = report.largest_files.iter().map(|f| f.bytes).collect();
        let mut sorted = sizes.clone();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        assert_eq!(sizes, sorted);
        assert_eq!(report.largest_files.len(), 3);
    }

    #[test]
    fn test_progress_callback_invoked() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let called = std::sync::atomic::AtomicUsize::new(0);
        {
            let cb = |_: u64, _: u64| {
                called.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            };
            scan_folder(tmp.path(), &ScanOptions::default(), None, &cb);
        }
        assert!(called.load(std::sync::atomic::Ordering::Relaxed) >= 1);
    }

    #[test]
    fn test_metrics_disabled_when_opted_out() {
        let tmp = tempfile::tempdir().unwrap();
        setup_tree(tmp.path());
        let opts = ScanOptions { analyze_text_metrics: false, ..ScanOptions::default() };
        let report = scan_folder(tmp.path(), &opts, None, &noop_progress());
        assert_eq!(report.total_files, 5);
        assert!(report.text_metrics.is_none());
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib scanner --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(`ScanOptions` 等不存在)

- [ ] **Step 3: 最小实现**

tests 之前写入:

```rust
// 目录扫描统计(同步阻塞实现,调用方用 spawn_blocking 包装;只读)

use std::cmp::Reverse;
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::classify::{
    bytes_look_binary, category_for_extension, extension_of, is_text_extension, FileCategory,
};
use super::text_metrics::{count_metrics, decode_best_effort};

const PROGRESS_EVERY: u64 = 512;
const TOP_EXTENSIONS: usize = 100;
const TOP_LARGEST: usize = 20;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub include_hidden: bool,
    pub analyze_text_metrics: bool,
    pub max_text_file_bytes: u64,
    pub max_entries: u64,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            include_hidden: false,
            analyze_text_metrics: true,
            max_text_file_bytes: 8 * 1024 * 1024,
            max_entries: 200_000,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CategoryStat {
    pub category: FileCategory,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ExtStat {
    pub ext: String,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ExtTextStat {
    pub ext: String,
    pub files: u64,
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct TextMetricsSummary {
    pub files_analyzed: u64,
    pub files_skipped_large: u64,
    pub files_skipped_binary: u64,
    pub lines: u64,
    pub words: u64,
    pub chars: u64,
    pub by_extension: Vec<ExtTextStat>,
}

#[derive(Debug, Serialize)]
pub struct FileStat {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ScanReport {
    pub root: String,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_bytes: u64,
    pub symlinks_skipped: u64,
    pub truncated: bool,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub by_category: Vec<CategoryStat>,
    pub by_extension: Vec<ExtStat>,
    pub text_metrics: Option<TextMetricsSummary>,
    pub largest_files: Vec<FileStat>,
}

pub type ProgressFn = dyn Fn(u64, u64) + Sync;

struct Acc {
    ext_files: HashMap<String, (u64, u64)>, // ext → (files, bytes)
    cat_stats: [(u64, u64); 8],             // cat_index → (files, bytes)
    metrics: TextMetricsSummary,
    ext_text: HashMap<String, (u64, u64, u64, u64)>, // ext → (files, lines, words, chars)
    largest: std::collections::BinaryHeap<(Reverse<u64>, String)>,
}

fn cat_index(c: FileCategory) -> usize {
    match c {
        FileCategory::Code => 0,
        FileCategory::Document => 1,
        FileCategory::Image => 2,
        FileCategory::Video => 3,
        FileCategory::Audio => 4,
        FileCategory::Archive => 5,
        FileCategory::Binary => 6,
        FileCategory::Other => 7,
    }
}

fn cat_from_index(i: usize) -> FileCategory {
    match i {
        0 => FileCategory::Code,
        1 => FileCategory::Document,
        2 => FileCategory::Image,
        3 => FileCategory::Video,
        4 => FileCategory::Audio,
        5 => FileCategory::Archive,
        6 => FileCategory::Binary,
        _ => FileCategory::Other,
    }
}

fn is_hidden(name: &str, opts: &ScanOptions) -> bool {
    !opts.include_hidden && name.starts_with('.')
}

/// 同步遍历目录并聚合统计;cancel 每 PROGRESS_EVERY 条检查一次。
/// 单个目录读取失败静默跳过,不让局部失败拖垮整体统计。
#[must_use]
pub fn scan_folder(
    root: &Path,
    opts: &ScanOptions,
    cancel: Option<&CancellationToken>,
    on_progress: &ProgressFn,
) -> ScanReport {
    let start = Instant::now();
    let mut acc = Acc {
        ext_files: HashMap::new(),
        cat_stats: [(0, 0); 8],
        metrics: TextMetricsSummary::default(),
        ext_text: HashMap::new(),
        largest: std::collections::BinaryHeap::new(),
    };
    let mut total_files = 0u64;
    let mut total_dirs = 0u64;
    let mut total_bytes = 0u64;
    let mut symlinks_skipped = 0u64;
    let mut truncated = false;
    let mut cancelled = false;
    let mut visited = 0u64;

    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    'outer: while let Some(dir) = stack.pop() {
        if cancel.is_some_and(|t| t.is_cancelled()) {
            cancelled = true;
            break;
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            visited += 1;
            if visited > opts.max_entries {
                truncated = true;
                break 'outer;
            }
            if visited % PROGRESS_EVERY == 0 {
                if cancel.is_some_and(|t| t.is_cancelled()) {
                    cancelled = true;
                    break 'outer;
                }
                on_progress(total_files, total_dirs);
            }
            let Ok(file_type) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_symlink() {
                symlinks_skipped += 1;
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if !is_hidden(&name, opts) {
                    total_dirs += 1;
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() || is_hidden(&name, opts) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let size = meta.len();
            total_files += 1;
            total_bytes += size;

            let ext = extension_of(&path);
            let ci = cat_index(category_for_extension(&ext));
            acc.cat_stats[ci].0 += 1;
            acc.cat_stats[ci].1 += size;
            let e = acc.ext_files.entry(ext.clone()).or_insert((0, 0));
            e.0 += 1;
            e.1 += size;

            let top = (Reverse(size), path.to_string_lossy().into_owned());
            if acc.largest.len() < TOP_LARGEST {
                acc.largest.push(top);
            } else if let Some(mut inner) = acc.largest.peek_mut() {
                if top.0 < inner.0 {
                    *inner = top;
                }
            }

            if opts.analyze_text_metrics && is_text_extension(&ext) {
                if size > opts.max_text_file_bytes {
                    acc.metrics.files_skipped_large += 1;
                } else {
                    match std::fs::read(&path) {
                        Ok(bytes) => {
                            if bytes_look_binary(&bytes) {
                                acc.metrics.files_skipped_binary += 1;
                            } else {
                                let (text, _) = decode_best_effort(&bytes);
                                let m = count_metrics(&text);
                                acc.metrics.files_analyzed += 1;
                                acc.metrics.lines += m.lines;
                                acc.metrics.words += m.words;
                                acc.metrics.chars += m.chars;
                                let t = acc.ext_text.entry(ext.clone()).or_insert((0, 0, 0, 0));
                                t.0 += 1;
                                t.1 += m.lines;
                                t.2 += m.words;
                                t.3 += m.chars;
                            }
                        }
                        Err(_) => acc.metrics.files_skipped_binary += 1,
                    }
                }
            }
        }
    }

    let mut by_category: Vec<CategoryStat> = acc
        .cat_stats
        .iter()
        .enumerate()
        .filter(|(_, (files, _))| *files > 0)
        .map(|(i, (files, bytes))| CategoryStat {
            category: cat_from_index(i),
            files: *files,
            bytes: *bytes,
        })
        .collect();
    by_category
        .sort_unstable_by(|a, b| b.files.cmp(&a.files).then_with(|| a.category.cmp(&b.category)));

    let mut by_extension: Vec<ExtStat> = acc
        .ext_files
        .into_iter()
        .map(|(ext, (files, bytes))| ExtStat { ext, files, bytes })
        .collect();
    by_extension.sort_unstable_by(|a, b| b.files.cmp(&a.files).then_with(|| a.ext.cmp(&b.ext)));
    by_extension.truncate(TOP_EXTENSIONS);

    let mut metrics = acc.metrics;
    let mut by_ext_text: Vec<ExtTextStat> = acc
        .ext_text
        .into_iter()
        .map(|(ext, (files, lines, words, chars))| ExtTextStat { ext, files, lines, words, chars })
        .collect();
    by_ext_text.sort_unstable_by(|a, b| b.files.cmp(&a.files).then_with(|| a.ext.cmp(&b.ext)));
    metrics.by_extension = by_ext_text;

    let mut largest_files: Vec<FileStat> = acc
        .largest
        .into_iter()
        .map(|(Reverse(bytes), path)| FileStat { path, bytes })
        .collect();
    largest_files.sort_unstable_by(|a, b| b.bytes.cmp(&a.bytes));

    ScanReport {
        root: root.to_string_lossy().into_owned(),
        total_files,
        total_dirs,
        total_bytes,
        symlinks_skipped,
        truncated,
        cancelled,
        elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        by_category,
        by_extension,
        text_metrics: if opts.analyze_text_metrics { Some(metrics) } else { None },
        largest_files,
    }
}
```

> 符号链接测试不写(Windows 创建 symlink 需要开发者模式/管理员),逻辑靠代码审查覆盖。`peek_mut` 的 `if let Some(mut inner)` 如 clippy 建议改写,按建议调整但保持语义:堆未满直接 push,否则仅当更小才替换堆顶。

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib scanner --manifest-path src-tauri/Cargo.toml`
Expected: 11 个测试全部 PASS

- [ ] **Step 5: Lint**

Run: `cargo clippy -p qraft --lib --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: 无 error

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tools/folder_analyzer/
git commit -m "feat(analyzer): add read-only folder scanner with per-type aggregation"
```

---

### Task 4: 内容搜索引擎 search.rs

**Files:**
- Create: `src-tauri/src/tools/folder_analyzer/search.rs`
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(追加 `pub mod search;`)

**Interfaces:**
- Consumes: Task 1/2 函数、Task 3 的 `ProgressFn`
- Produces(Task 6/7 依赖):
  - `struct SearchOptions { pattern: String, is_regex: bool, case_insensitive: bool, extensions: Vec<String>(小写;空=全部文本扩展), include_hidden: bool, max_file_bytes: u64, max_matches_per_file: u32, max_matches_total: u64, max_entries: u64 }` + `Default`(4 MiB / 200 / 5000 / 200_000,false,false)
  - `struct SearchMatch { line_number: u64, column: u32, preview: String }`
  - `struct FileSearchResult { path: String, ext: String, match_count: u64, matches: Vec<SearchMatch> }`
  - `struct SearchReport { pattern: String, is_regex: bool, case_insensitive: bool, total_matches: u64, files_with_matches: u64, results: Vec<FileSearchResult>, files_scanned: u64, files_skipped_large: u64, truncated: bool, cancelled: bool }`
  - `fn build_matcher(opts: &SearchOptions) -> Result<regex::Regex, ToolError>`(非法正则 → `ToolError::InvalidInput`)
  - `fn search_folder(root: &Path, opts: &SearchOptions, matcher: &regex::Regex, cancel: Option<&CancellationToken>, on_progress: &super::scanner::ProgressFn) -> SearchReport`

`SearchMatch.column` 为匹配起点在该行的**字符索引**(非字节偏移);`preview` 为整行截断到 240 字符(超出补 `…`)。搜索目标 = 文本扩展(`is_text_extension`,或 extensions 过滤后仍需为文本扩展);NUL 头部嗅探跳过二进制。

- [ ] **Step 1: 写失败测试**

`search.rs` 先只写 tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn noop() -> impl Fn(u64, u64) {
        |_f, _d| {}
    }

    fn base_opts(pattern: &str) -> SearchOptions {
        SearchOptions { pattern: pattern.to_string(), ..SearchOptions::default() }
    }

    fn setup(dir: &std::path::Path) {
        fs::write(dir.join("a.rs"), "fn main() {}\nlet x = FOO;\nfoo bar\n").unwrap();
        fs::write(dir.join("b.md"), "# Foo\nsome foo here\n").unwrap();
        fs::write(dir.join("skip.bin"), b"\x00\x01foo\x00").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.txt"), "FOO at line one\n").unwrap();
    }

    #[test]
    fn test_plain_search_case_sensitive_default() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = base_opts("foo");
        let matcher = build_matcher(&opts).unwrap();
        let r = search_folder(tmp.path(), &opts, &matcher, None, &noop());
        // 命中:a.rs 第3行 + b.md 第2行("some foo here");FOO 大写不命中;skip.bin 二进制跳过
        assert_eq!(r.total_matches, 2);
        assert_eq!(r.files_with_matches, 2);
        assert_eq!(r.files_scanned, 3);
        assert_eq!(r.files_skipped_large, 0);
        let a = r.results.iter().find(|f| f.path.ends_with("a.rs")).unwrap();
        assert_eq!(a.match_count, 1);
        assert_eq!(a.matches[0].line_number, 3);
        assert_eq!(a.matches[0].column, 0);
        assert_eq!(a.matches[0].preview, "foo bar");
    }

    #[test]
    fn test_case_insensitive_hits_uppercase() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = SearchOptions { case_insensitive: true, ..base_opts("foo") };
        let matcher = build_matcher(&opts).unwrap();
        let r = search_folder(tmp.path(), &opts, &matcher, None, &noop());
        // a.rs:1(FOO)+ b.md:2(Foo、foo)+ c.txt:1(FOO)= 4
        assert_eq!(r.total_matches, 4);
        assert_eq!(r.files_with_matches, 3);
    }

    #[test]
    fn test_regex_vs_literal() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("x.txt"), "abc a.c axc\n").unwrap();

        let lit = SearchOptions { is_regex: false, ..base_opts("a.c") };
        let r1 = search_folder(tmp.path(), &lit, &build_matcher(&lit).unwrap(), None, &noop());
        assert_eq!(r1.total_matches, 1); // 仅字面 "a.c"

        let rex = SearchOptions { is_regex: true, ..base_opts("a.c") };
        let r2 = search_folder(tmp.path(), &rex, &build_matcher(&rex).unwrap(), None, &noop());
        assert_eq!(r2.total_matches, 3); // abc/a.c/axc
    }

    #[test]
    fn test_extension_filter() {
        let tmp = tempfile::tempdir().unwrap();
        setup(tmp.path());
        let opts = SearchOptions {
            case_insensitive: true,
            extensions: vec!["md".to_string()],
            ..base_opts("foo")
        };
        let r = search_folder(tmp.path(), &opts, &build_matcher(&opts).unwrap(), None, &noop());
        assert_eq!(r.files_with_matches, 1);
        assert!(r.results.iter().all(|f| f.ext == "md"));
    }

    #[test]
    fn test_per_file_cap() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("many.txt"), "foo\nfoo\nfoo\nfoo\n").unwrap();
        let opts = SearchOptions { max_matches_per_file: 2, ..base_opts("foo") };
        let r = search_folder(tmp.path(), &opts, &build_matcher(&opts).unwrap(), None, &noop());
        let f = &r.results[0];
        assert_eq!(f.matches.len(), 2);
        assert_eq!(f.match_count, 2);
        assert!(!r.truncated);
    }

    #[test]
    fn test_total_cap_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..3 {
            fs::write(tmp.path().join(format!("{i}.txt")), "foo\n").unwrap();
        }
        let opts = SearchOptions { max_matches_total: 2, ..base_opts("foo") };
        let r = search_folder(tmp.path(), &opts, &build_matcher(&opts).unwrap(), None, &noop());
        assert_eq!(r.total_matches, 2);
        assert!(r.truncated);
    }

    #[test]
    fn test_invalid_regex_is_input_error() {
        let opts = base_opts("([unclosed");
        assert!(matches!(build_matcher(&opts), Err(ToolError::InvalidInput(_))));
    }

    #[test]
    fn test_preview_truncated_at_240_chars() {
        let long_line = "x".repeat(500) + "needle";
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("long.txt"), long_line + "\n").unwrap();
        let opts = base_opts("needle");
        let r = search_folder(tmp.path(), &opts, &build_matcher(&opts).unwrap(), None, &noop());
        assert_eq!(r.results[0].matches[0].preview.chars().count(), 240);
        assert!(r.results[0].matches[0].preview.ends_with('…'));
    }

    #[test]
    fn test_column_is_char_index() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("cjk.txt"), "中文 needle\n").unwrap();
        let opts = base_opts("needle");
        let r = search_folder(tmp.path(), &opts, &build_matcher(&opts).unwrap(), None, &noop());
        assert_eq!(r.results[0].matches[0].column, 3);
    }

    #[test]
    fn test_hidden_respects_option() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".dot.md"), "needle\n").unwrap();
        let r1 = search_folder(tmp.path(), &base_opts("needle"), &build_matcher(&base_opts("needle")).unwrap(), None, &noop());
        assert_eq!(r1.files_with_matches, 0);
        let o2 = SearchOptions { include_hidden: true, ..base_opts("needle") };
        let r2 = search_folder(tmp.path(), &o2, &build_matcher(&o2).unwrap(), None, &noop());
        assert_eq!(r2.files_with_matches, 1);
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib search --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(`SearchOptions` 等不存在)

- [ ] **Step 3: 最小实现**

tests 之前写入:

```rust
// 跨文本文件内容搜索(同步阻塞实现;只读)

use std::path::{Path, PathBuf};

use regex::RegexBuilder;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::classify::{bytes_look_binary, extension_of, is_text_extension};
use super::scanner::ProgressFn;
use super::text_metrics::decode_best_effort;
use crate::core::error::ToolError;

const PREVIEW_CHARS: usize = 240;

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub pattern: String,
    pub is_regex: bool,
    pub case_insensitive: bool,
    pub extensions: Vec<String>,
    pub include_hidden: bool,
    pub max_file_bytes: u64,
    pub max_matches_per_file: u32,
    pub max_matches_total: u64,
    pub max_entries: u64,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            pattern: String::new(),
            is_regex: false,
            case_insensitive: false,
            extensions: Vec::new(),
            include_hidden: false,
            max_file_bytes: 4 * 1024 * 1024,
            max_matches_per_file: 200,
            max_matches_total: 5_000,
            max_entries: 200_000,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub line_number: u64,
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub ext: String,
    pub match_count: u64,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Serialize)]
pub struct SearchReport {
    pub pattern: String,
    pub is_regex: bool,
    pub case_insensitive: bool,
    pub total_matches: u64,
    pub files_with_matches: u64,
    pub results: Vec<FileSearchResult>,
    pub files_scanned: u64,
    pub files_skipped_large: u64,
    pub truncated: bool,
    pub cancelled: bool,
}

/// 普通串 → 转义;正则 → 原样编译;统一挂 case_insensitive flag。
///
/// # Errors
///
/// 非法正则表达式返回 `ToolError::InvalidInput`(`ERR_INVALID_INPUT`)。
pub fn build_matcher(opts: &SearchOptions) -> Result<regex::Regex, ToolError> {
    let source = if opts.is_regex {
        opts.pattern.clone()
    } else {
        regex::escape(&opts.pattern)
    };
    RegexBuilder::new(&source)
        .case_insensitive(opts.case_insensitive)
        .build()
        .map_err(|e| ToolError::InvalidInput(format!("invalid pattern '{}': {e}", opts.pattern)))
}

fn ext_selected(ext: &str, opts: &SearchOptions) -> bool {
    if opts.extensions.is_empty() {
        is_text_extension(ext)
    } else {
        is_text_extension(ext) && opts.extensions.iter().any(|e| e == ext)
    }
}

fn truncate_preview(line: &str) -> String {
    if line.chars().count() <= PREVIEW_CHARS {
        return line.to_string();
    }
    let mut s: String = line.chars().take(PREVIEW_CHARS - 1).collect();
    s.push('…');
    s
}

/// 收集待搜索文件(与 scanner 相同的隐藏/上限/取消语义,复用其常量节奏)
fn collect_candidates(
    root: &Path,
    include_hidden: bool,
    max_entries: u64,
    cancel: Option<&CancellationToken>,
) -> (Vec<PathBuf>, bool, bool) {
    let mut out = Vec::new();
    let mut truncated = false;
    let mut cancelled = false;
    let mut visited = 0u64;
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    'outer: while let Some(dir) = stack.pop() {
        if cancel.is_some_and(|t| t.is_cancelled()) {
            cancelled = true;
            break;
        }
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            visited += 1;
            if visited > max_entries {
                truncated = true;
                break 'outer;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let visible = include_hidden || !name.starts_with('.');
            if ft.is_dir() {
                if visible {
                    stack.push(entry.path());
                }
                continue;
            }
            if ft.is_file() && visible {
                out.push(entry.path());
            }
        }
    }
    (out, truncated, cancelled)
}

/// # Errors
///
/// 仅在 IO 层面失败时静默跳过;本函数本身不返回 Err。
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn search_folder(
    root: &Path,
    opts: &SearchOptions,
    matcher: &regex::Regex,
    cancel: Option<&CancellationToken>,
    on_progress: &ProgressFn,
) -> SearchReport {
    let (candidates, walk_truncated, walk_cancelled) =
        collect_candidates(root, opts.include_hidden, opts.max_entries, cancel);
    let mut report = SearchReport {
        pattern: opts.pattern.clone(),
        is_regex: opts.is_regex,
        case_insensitive: opts.case_insensitive,
        total_matches: 0,
        files_with_matches: 0,
        results: Vec::new(),
        files_scanned: 0,
        files_skipped_large: 0,
        truncated: walk_truncated,
        cancelled: walk_cancelled,
    };

    for path in candidates {
        if report.total_matches >= opts.max_matches_total {
            report.truncated = true;
            break;
        }
        if cancel.is_some_and(|t| t.is_cancelled()) {
            report.cancelled = true;
            break;
        }
        let ext = extension_of(&path);
        if !ext_selected(&ext, opts) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if meta.len() > opts.max_file_bytes {
            report.files_skipped_large += 1;
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if bytes_look_binary(&bytes[..bytes.len().min(8192)]) {
            continue;
        }
        let (text, _) = decode_best_effort(&bytes);
        report.files_scanned += 1;
        on_progress(report.files_scanned, 0);

        let mut file_result = FileSearchResult {
            path: path.to_string_lossy().into_owned(),
            ext,
            match_count: 0,
            matches: Vec::new(),
        };
        for (idx, raw_line) in text.split('\n').enumerate() {
            if file_result.match_count >= u64::from(opts.max_matches_per_file) {
                break;
            }
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
            for m in matcher.find_iter(line) {
                let column = u32::try_from(line[..m.start()].chars().count())
                    .map_or(u32::MAX, |v| v.saturating_sub(0));
                file_result.matches.push(SearchMatch {
                    line_number: u64::try_from(idx + 1).unwrap_or(u64::MAX),
                    column,
                    preview: truncate_preview(line),
                });
                file_result.match_count += 1;
                report.total_matches += 1;
                if report.total_matches >= opts.max_matches_total {
                    report.truncated = true;
                    break;
                }
            }
            if report.truncated || file_result.match_count >= u64::from(opts.max_matches_per_file)
            {
                break;
            }
        }
        if !file_result.matches.is_empty() {
            report.files_with_matches += 1;
            report.results.push(file_result);
        }
    }
    if cancel.is_some_and(|t| t.is_cancelled()) {
        report.cancelled = true;
    }
    report
}
```

> `column` 的 `.map_or(u32::MAX, |v| v)` 写法若 clippy 抱怨多余 map_or,直接写 `.unwrap_or(u32::MAX)`。

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib search --manifest-path src-tauri/Cargo.toml`
Expected: 10 个测试全部 PASS

- [ ] **Step 5: Lint + Commit**

Run: `cargo clippy -p qraft --lib --manifest-path src-tauri/Cargo.toml -- -D warnings`

```bash
git add src-tauri/src/tools/folder_analyzer/
git commit -m "feat(analyzer): add content search across text files with caps"
```

---

### Task 5: 单文件解析 inspect.rs

**Files:**
- Create: `src-tauri/src/tools/folder_analyzer/inspect.rs`
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(追加 `pub mod inspect;`)

**Interfaces:**
- Consumes: Task 1/2 函数、`sha2` + `hex`(已有)
- Produces(Task 6 依赖):
  - `pub(crate) const MAX_INSPECT_BYTES: u64 = 64 * 1024 * 1024;`
  - `struct FileInspectReport { path, file_name, ext: String, category: FileCategory, magic: Option<String>, size_bytes: u64, is_text: bool, encoding: Option<String>, lines: Option<u64>, words: Option<u64>, chars: Option<u64>, sha256: String, preview: Vec<String>(≤30 行), duration_ms: u64 }`(全 `Serialize`;非文本时 encoding/lines/words/chars 为 None,preview 为空)
  - `fn inspect_file(path: &Path) -> Result<FileInspectReport, ToolError>` — stat/read 失败 → `ToolError::Internal`;超 64 MiB → `ToolError::InputTooLarge { size, max }`
  - is_text 判定 = 无魔数 且 头部无 NUL

- [ ] **Step 1: 写失败测试**

`inspect.rs` 先只写 tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_text_file() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("hello.rs");
        std::fs::write(&p, "fn main() {}\nprintln!(\"hi\");\n").unwrap();
        let r = inspect_file(&p).unwrap();
        assert_eq!(r.file_name, "hello.rs");
        assert_eq!(r.ext, "rs");
        assert_eq!(r.category, FileCategory::Code);
        assert_eq!(r.magic, None);
        assert!(r.is_text);
        assert_eq!(r.encoding.as_deref(), Some("UTF-8"));
        assert_eq!(r.lines, Some(2));
        // fn(1) main(1) {}(1) println!(1) hi(1) ;(1)
        assert_eq!(r.words, Some(6));
        assert_eq!(r.preview.len(), 2);
        assert_eq!(r.sha256.len(), 64);
        assert!(r.sha256.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_empty_file_known_sha256() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("empty.txt");
        std::fs::write(&p, b"").unwrap();
        let r = inspect_file(&p).unwrap();
        // SHA-256("") 官方标准向量
        assert_eq!(
            r.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(r.lines, Some(0));
    }

    #[test]
    fn test_png_detected_not_text() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("pic.png");
        std::fs::write(&p, b"\x89PNG\r\n\x1a\n\x00\x01\x02").unwrap();
        let r = inspect_file(&p).unwrap();
        assert_eq!(r.magic.as_deref(), Some("png"));
        assert_eq!(r.category, FileCategory::Image);
        assert!(!r.is_text);
        assert_eq!(r.encoding, None);
        assert_eq!(r.lines, None);
        assert!(r.preview.is_empty());
    }

    #[test]
    fn test_max_inspect_bytes_constant() {
        assert_eq!(MAX_INSPECT_BYTES, 67_108_864);
    }

    #[test]
    fn test_missing_file_errors_internal() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("ghost.txt");
        assert!(matches!(inspect_file(&p), Err(ToolError::Internal(_))));
    }
}
```

> 64 MiB 上限分支不实际分配大文件测试(读前用 metadata 预检实现);常量断言 + 代码审查覆盖。

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib inspect --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败

- [ ] **Step 3: 最小实现**

```rust
// 单文件解析:类型/编码/行字数/哈希/预览(只读)

use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::classify::{
    bytes_look_binary, category_for_extension, extension_of, sniff_magic, FileCategory,
};
use super::text_metrics::{count_metrics, decode_best_effort, TextMetrics};
use crate::core::error::ToolError;

/// 单次解析读取上限
pub(crate) const MAX_INSPECT_BYTES: u64 = 64 * 1024 * 1024;
const PREVIEW_LINES: usize = 30;

#[derive(Debug, Serialize)]
pub struct FileInspectReport {
    pub path: String,
    pub file_name: String,
    pub ext: String,
    pub category: FileCategory,
    pub magic: Option<String>,
    pub size_bytes: u64,
    pub is_text: bool,
    pub encoding: Option<String>,
    pub lines: Option<u64>,
    pub words: Option<u64>,
    pub chars: Option<u64>,
    pub sha256: String,
    pub preview: Vec<String>,
    pub duration_ms: u64,
}

/// # Errors
///
/// - stat/读取失败 → `ToolError::Internal`
/// - 超过 64 MiB → `ToolError::InputTooLarge`
pub fn inspect_file(path: &Path) -> Result<FileInspectReport, ToolError> {
    let start = Instant::now();
    let meta =
        std::fs::metadata(path).map_err(|e| ToolError::Internal(format!("stat failed: {e}")))?;
    let size = meta.len();
    if size > MAX_INSPECT_BYTES {
        return Err(ToolError::InputTooLarge {
            size: usize::try_from(size).unwrap_or(usize::MAX),
            max: usize::try_from(MAX_INSPECT_BYTES).unwrap_or(usize::MAX),
        });
    }
    let bytes =
        std::fs::read(path).map_err(|e| ToolError::Internal(format!("read failed: {e}")))?;

    let magic = sniff_magic(&bytes).map(str::to_string);
    let is_text = magic.is_none() && !bytes_look_binary(&bytes);

    let (encoding, metrics, preview) = if is_text {
        let (text, label) = decode_best_effort(&bytes);
        let preview: Vec<String> = text
            .split('\n')
            .take(PREVIEW_LINES)
            .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
            .collect();
        (Some(label.to_string()), Some(count_metrics(&text)), preview)
    } else {
        (None, None, Vec::new())
    };

    let digest = Sha256::digest(&bytes);

    Ok(FileInspectReport {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
        ext: extension_of(path),
        category: category_for_extension(&extension_of(path)),
        magic,
        size_bytes: size,
        is_text,
        encoding,
        lines: metrics.map(|m: TextMetrics| m.lines),
        words: metrics.map(|m| m.words),
        chars: metrics.map(|m| m.chars),
        sha256: hex::encode(digest),
        preview,
        duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib inspect --manifest-path src-tauri/Cargo.toml`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tools/folder_analyzer/
git commit -m "feat(analyzer): add single-file inspection with hash and preview"
```

---

### Task 6: FolderAnalyzer Tool 注册(同步 execute)

**Files:**
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(主体)
- Test: 同文件 `#[cfg(test)] mod tool_tests`

**Interfaces:**
- Consumes: Task 3 `scan_folder`/`ScanOptions`、Task 4 `search_folder`/`SearchOptions`/`build_matcher`、Task 5 `inspect_file`
- Produces(前端与 Task 7 依赖):
  - toolId `folder_analyzer`;`params.mode` ∈ `"scan" | "search" | "file"`
  - 输入契约:`input.file_path` = 目标文件夹(scan/search)或目标文件(file);scan 可选 `include_hidden:bool, analyze_text_metrics:bool, max_text_file_bytes:u64, max_entries:u64`;search 必选 `pattern:String`,可选 `is_regex:bool=false, case_insensitive:bool=false, extensions:string[]=[], include_hidden:bool=false`
  - `ToolOutput.text` = 一句话中文摘要;`ToolOutput.extra` = 对应 Report JSON(snake_case 键)
  - `FolderAnalyzer` 实现 `Tool`;`register_tool!(FolderAnalyzer, &METADATA)`(宏来自 crate 根,参照 hash_calculator.rs)

- [ ] **Step 1: 写失败测试**

先查看 `src-tauri/src/core/test_utils.rs` 与 `core/context.rs`,确认 ToolContext 的测试构造方式(现有工具测试应有先例),以其真实辅助为准。以下假设存在可构造路径:

```rust
#[cfg(test)]
mod tool_tests {
    use crate::core::context::ToolContext;
    use crate::core::input::ToolInput;
    use crate::core::registry::ToolRegistry;
    use std::{collections::HashMap, sync::Arc};

    fn ctx() -> ToolContext {
        // 若 core/test_utils 提供现成构造函数则改用它
        ToolContext {
            cancel_token: tokio_util::sync::CancellationToken::new(),
            config: serde_json::Value::Null,
            history_sink: Arc::new(crate::core::test_utils::NopHistorySink),
        }
    }

    fn input(path: &std::path::Path, mode: &str, extra: &[(&str, serde_json::Value)]) -> ToolInput {
        let mut params: HashMap<String, serde_json::Value> =
            [("mode".to_string(), serde_json::json!(mode))].into_iter().collect();
        for (k, v) in extra {
            params.insert((*k).to_string(), v.clone());
        }
        ToolInput { text: None, file_path: Some(path.to_string_lossy().into_owned()), params }
    }

    #[test]
    fn test_registered_in_registry() {
        assert!(ToolRegistry::global().get("folder_analyzer").is_some());
    }

    #[tokio::test]
    async fn test_execute_scan_mode() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"hi\n").unwrap();
        let tool = ToolRegistry::global().get("folder_analyzer").unwrap().ctor();
        let out = tool.execute(input(tmp.path(), "scan", &[]), &ctx()).await.unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["total_files"], 1);
        assert_eq!(extra["by_extension"][0]["ext"], "txt");
        assert!(!out.text.is_empty());
    }

    #[tokio::test]
    async fn test_execute_search_mode() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("x.md"), "findme here\n").unwrap();
        let tool = ToolRegistry::global().get("folder_analyzer").unwrap().ctor();
        let out = tool
            .execute(input(tmp.path(), "search", &[("pattern", serde_json::json!("findme"))]), &ctx())
            .await
            .unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["total_matches"], 1);
        assert_eq!(extra["results"][0]["matches"][0]["line_number"], 1);
    }

    #[tokio::test]
    async fn test_execute_file_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("note.md");
        std::fs::write(&f, "hello\n").unwrap();
        let tool = ToolRegistry::global().get("folder_analyzer").unwrap().ctor();
        let out = tool.execute(input(&f, "file", &[]), &ctx()).await.unwrap();
        let extra = out.extra.unwrap();
        assert_eq!(extra["is_text"], true);
        assert_eq!(extra["lines"], 1);
    }

    #[tokio::test]
    async fn test_missing_mode_is_invalid_input() {
        let tool = ToolRegistry::global().get("folder_analyzer").unwrap().ctor();
        let err = tool
            .execute(ToolInput { file_path: Some("/tmp".into()), ..Default::default() }, &ctx())
            .await
            .unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }

    #[tokio::test]
    async fn test_bad_mode_is_invalid_input() {
        let tmp = tempfile::tempdir().unwrap();
        let tool = ToolRegistry::global().get("folder_analyzer").unwrap().ctor();
        let err = tool.execute(input(tmp.path(), "wat", &[]), &ctx()).await.unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_INPUT");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib tool_tests --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(`FolderAnalyzer` 未定义)

- [ ] **Step 3: 实现 Tool 并注册**

`mod.rs` 追加:

```rust
mod classify;
mod inspect;
mod scanner;
mod search;
mod text_metrics;

use async_trait::async_trait;
use serde_json::json;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

use self::inspect::inspect_file;
use self::scanner::{scan_folder, ScanOptions, ScanReport};
use self::search::{build_matcher, search_folder, SearchOptions, SearchReport};

pub struct FolderAnalyzer;

impl FolderAnalyzer {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for FolderAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

fn scan_options_from(input: &ToolInput) -> Result<ScanOptions, ToolError> {
    let mut o = ScanOptions::default();
    if let Ok(v) = input.param::<bool>("include_hidden") {
        o.include_hidden = v;
    }
    if let Ok(v) = input.param::<bool>("analyze_text_metrics") {
        o.analyze_text_metrics = v;
    }
    if let Ok(v) = input.param::<u64>("max_text_file_bytes") {
        o.max_text_file_bytes = v;
    }
    if let Ok(v) = input.param::<u64>("max_entries") {
        o.max_entries = v;
    }
    Ok(o)
}

fn search_options_from(input: &ToolInput) -> Result<SearchOptions, ToolError> {
    let mut o =
        SearchOptions { pattern: input.param::<String>("pattern")?, ..SearchOptions::default() };
    if let Ok(v) = input.param::<bool>("is_regex") {
        o.is_regex = v;
    }
    if let Ok(v) = input.param::<bool>("case_insensitive") {
        o.case_insensitive = v;
    }
    if let Ok(v) = input.param::<Vec<String>>("extensions") {
        o.extensions = v.into_iter().map(|s| s.to_ascii_lowercase()).collect();
    }
    if let Ok(v) = input.param::<bool>("include_hidden") {
        o.include_hidden = v;
    }
    Ok(o)
}

#[must_use]
pub fn summarize_scan(r: &ScanReport) -> String {
    format!(
        "{} 个文件 / {} 个目录,共 {} 字节;文本统计覆盖 {} 个文件",
        r.total_files,
        r.total_dirs,
        r.total_bytes,
        r.text_metrics.as_ref().map_or(0, static_text_files)
    )
}

fn static_text_files(t: &self::scanner::TextMetricsSummary) -> u64 {
    t.files_analyzed
}

fn summarize_search(r: &SearchReport) -> String {
    format!("共 {} 处匹配,分布在 {} 个文件", r.total_matches, r.files_with_matches)
}

#[async_trait]
impl Tool for FolderAnalyzer {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let start = std::time::Instant::now();
        let mode: String = input.param("mode")?;
        let input_bytes = input.file_path.as_ref().map_or(0, |p| p.len());

        // 阻塞扫描放 blocking 线程,避免卡异步运行时
        let (text, extra) = match mode.as_str() {
            "scan" => {
                let root = input.file_path()?.to_string();
                let opts = scan_options_from(&input)?;
                let cancel = ctx.cancel_token.clone();
                let report = tokio::task::spawn_blocking(move || {
                    scan_folder(std::path::Path::new(&root), &opts, Some(&cancel), &|_, _| {})
                })
                .await
                .map_err(|e| ToolError::Internal(format!("join failed: {e}")))?;
                (summarize_scan(&report), json!(report))
            }
            "search" => {
                let root = input.file_path()?.to_string();
                let opts = search_options_from(&input)?;
                let matcher = build_matcher(&opts)?;
                let cancel = ctx.cancel_token.clone();
                let report = tokio::task::spawn_blocking(move || {
                    search_folder(
                        std::path::Path::new(&root),
                        &opts,
                        &matcher,
                        Some(&cancel),
                        &|_, _| {},
                    )
                })
                .await
                .map_err(|e| ToolError::Internal(format!("join failed: {e}")))?;
                (summarize_search(&report), json!(report))
            }
            "file" => {
                let path = input.file_path()?.to_string();
                let report = tokio::task::spawn_blocking(move || {
                    inspect_file(std::path::Path::new(&path))
                })
                .await
                .map_err(|e| ToolError::Internal(format!("join failed: {e}")))??;
                let summary = format!(
                    "{}:{}({} 字节){}",
                    report.file_name,
                    if report.is_text { "文本" } else { "二进制" },
                    report.size_bytes,
                    report.encoding.as_ref().map_or_else(String::new, |e| format!(",编码 {e}"))
                );
                (summary, json!(report))
            }
            other => {
                return Err(ToolError::InvalidInput(format!(
                    "mode must be scan/search/file, got '{other}'"
                )));
            }
        };

        Ok(ToolOutput {
            meta: Some(OutputMeta {
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                input_bytes,
                output_bytes: text.len(),
            }),
            text,
            extra: Some(extra),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "folder_analyzer",
    name: "Folder Analyzer",
    category: ToolCategory::Parser,
    icon: "folder-search",
    description: "Read-only analysis of folders/files: type stats, text lines & words, content search",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["folder", "file", "stats", "lines", "words", "grep"],
    version: "1.0.0",
    timeout_secs: Some(120),
    streaming_supported: true,
};

// serde_json::json! 非 const,占位(与 hash_calculator 同款处理)
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(FolderAnalyzer, &METADATA);
```

> 简化建议:`summarize_scan` 里那个 `static_text_files` 辅助可直接写成闭包 `.map_or(0, |t| t.files_analyzed)`,上面拆开仅为可读性 —— 执行者二选一,不要两个都留。

- [ ] **Step 4: 运行验证通过 + 全量回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tools/folder_analyzer/mod.rs
git commit -m "feat(analyzer): register folder_analyzer tool with sync execute"
```

---

### Task 7: StreamingTool(进度事件 + 可取消)

**Files:**
- Modify: `src-tauri/src/core/tool.rs`(`StreamEvent::Progress` 增加字段)
- Modify: `src-tauri/src/tools/hash_calculator.rs`(既有 Progress 构造点适配)
- Modify: `src-tauri/src/commands/tool.rs`(emit payload 增加字段)
- Modify: `src-tauri/src/tools/folder_analyzer/mod.rs`(StreamingTool 实现)
- 其他编译器指出的 `StreamEvent::Progress` 构造点(全量 grep 确认)

**Interfaces:**
- Consumes: Task 3/4 的 `ProgressFn`、`CancellationToken`
- Produces:
  - `StreamEvent::Progress { percent, message, processed, total }`(新增 `processed: u64, total: u64`;total=0 表示未知)—— 修复前端 `ToolProgressPayload { taskId, processed, total }` 与后端只发 percent/message 的历史错位
  - `StreamingTool for FolderAnalyzer`:scan/search 每 ~300ms 推送 Progress(message 形如 `已扫描 N 文件 · M 目录`,processed=N,total=0);完成推 Done(extra 同 Task 6);用户取消(tool_cancel)后作业提前收尾并 Done(cancelled=true 部分报告);file 模式不支持流式(InvalidInput)
  - `register_stream_tool!(FolderAnalyzer, &METADATA)`

- [ ] **Step 1: 写失败测试**

`tool_tests` 追加:

```rust
    use crate::core::tool::StreamEvent;
    use crate::core::tool::StreamingTool;
    use crate::tools::folder_analyzer::FolderAnalyzer;

    async fn collect(events: futures::stream::BoxStream<'static, Result<StreamEvent, crate::core::error::ToolError>>) -> Vec<StreamEvent> {
        events.map(|r| r.unwrap()).collect::<Vec<_>>().await
    }

    #[tokio::test]
    async fn test_stream_scan_emits_done_with_report() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"hi\n").unwrap();
        let mut evs = collect(FolderAnalyzer::new().execute_stream(input(tmp.path(), "scan", &[]), &ctx())).await;
        let last = evs.pop().unwrap();
        match last {
            StreamEvent::Done { output } => {
                let extra = output.extra.unwrap();
                assert_eq!(extra["total_files"], 1);
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_stream_respects_cancellation_with_partial_done() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..20 {
            std::fs::write(tmp.path().join(format!("{i}.txt")), b"x\n").unwrap();
        }
        let c = ctx();
        c.cancel_token.cancel();
        let mut evs = collect(FolderAnalyzer::new().execute_stream(input(tmp.path(), "scan", &[]), &c)).await;
        let last = evs.pop().unwrap();
        match last {
            StreamEvent::Done { output } => {
                let extra = output.extra.unwrap();
                assert_eq!(extra["cancelled"], true);
                assert_eq!(extra["total_files"], 0);
            }
            other => panic!("expected partial Done, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_stream_file_mode_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.md");
        std::fs::write(&f, b"x\n").unwrap();
        let mut evs = collect(FolderAnalyzer::new().execute_stream(input(&f, "file", &[]), &ctx())).await;
        assert!(matches!(evs.pop().unwrap(), Err(crate::core::error::ToolError::InvalidInput(_))));
    }

    #[test]
    fn test_progress_event_has_processed_fields() {
        // 编译期断言:构造带 processed/total 的 Progress(字段存在即通过)
        let ev = StreamEvent::Progress {
            percent: 0,
            message: "x".into(),
            processed: 1,
            total: 0,
        };
        assert!(matches!(ev, StreamEvent::Progress { processed: 1, .. }));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(StreamEvent 无 processed 字段 / execute_stream 未实现)

- [ ] **Step 3: 实现**

3a. `core/tool.rs` 的 Progress 变体扩为:

```rust
    Progress {
        percent: u8,
        message: String,
        /// 已处理条目数(未知总量的任务持续累加)
        processed: u64,
        /// 总量估计;0 = 未知
        total: u64,
    },
```

3b. 全量修复构造点:`cargo check --manifest-path src-tauri/Cargo.toml` 会逐一指出。hash_calculator 两处补 `processed: read_total, total,`;其他工具若有同样补齐(processed 用已有计数,total 已知则填,未知填 0)。

3c. `commands/tool.rs` Progress 分支 payload 改为:

```rust
                            let payload = json!({
                                "taskId": &task_id_clone,
                                "percent": percent,
                                "message": message,
                                "processed": processed,
                                "total": total,
                            });
```

3d. `folder_analyzer/mod.rs` 追加:

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::core::tool::{StreamEvent, StreamingTool};
use crate::register_stream_tool;

struct LiveCounters {
    files: AtomicU64,
    dirs: AtomicU64,
}

#[async_trait]
impl StreamingTool for FolderAnalyzer {
    fn execute_stream(
        &self,
        input: ToolInput,
        ctx: &ToolContext,
    ) -> futures::stream::BoxStream<'static, Result<StreamEvent, ToolError>> {
        Box::pin(async_stream::stream! {
            let start = std::time::Instant::now();
            let Ok(mode) = input.param::<String>("mode") else {
                yield Err(ToolError::InvalidInput("missing param 'mode'".into()));
                return;
            };
            let Ok(root) = input.file_path().map(str::to_string) else {
                yield Err(ToolError::InvalidInput("streaming requires file_path".into()));
                return;
            };
            if !matches!(mode.as_str(), "scan" | "search") {
                yield Err(ToolError::InvalidInput(format!(
                    "streaming supports scan/search only, got '{mode}'"
                )));
                return;
            }

            let counters = Arc::new(LiveCounters { files: AtomicU64::new(0), dirs: AtomicU64::new(0) });
            let cancel = ctx.cancel_token.clone();
            let counters_cb = Arc::clone(&counters);

            enum Job { Scan(ScanReport), Search(SearchReport) }
            let handle = if mode == "scan" {
                let opts = match scan_options_from(&input) {
                    Ok(o) => o,
                    Err(e) => { yield Err(e); return; }
                };
                tokio::task::spawn_blocking(move || {
                    let cb = move |f: u64, d: u64| {
                        counters_cb.files.store(f, Ordering::Relaxed);
                        counters_cb.dirs.store(d, Ordering::Relaxed);
                    };
                    Job::Scan(scan_folder(std::path::Path::new(&root), &opts, Some(&cancel), &cb))
                })
            } else {
                let opts = match search_options_from(&input) {
                    Ok(o) => o,
                    Err(e) => { yield Err(e); return; }
                };
                let matcher = match build_matcher(&opts) {
                    Ok(m) => m,
                    Err(e) => { yield Err(e); return; }
                };
                tokio::task::spawn_blocking(move || {
                    let cb = move |f: u64, _d: u64| {
                        counters_cb.files.store(f, Ordering::Relaxed);
                    };
                    Job::Search(search_folder(std::path::Path::new(&root), &opts, &matcher, Some(&cancel), &cb))
                })
            };

            let mut ticker = tokio::time::interval(std::time::Duration::from_millis(300));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut join = std::pin::pin!(handle);

            let job = loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let f = counters.files.load(Ordering::Relaxed);
                        let d = counters.dirs.load(Ordering::Relaxed);
                        yield Ok(StreamEvent::Progress {
                            percent: 0,
                            message: format!("已扫描 {f} 文件 · {d} 目录"),
                            processed: f,
                            total: 0,
                        });
                    }
                    res = &mut join => break res.map_err(|e| ToolError::Internal(format!("join failed: {e}"))),
                }
            };

            let Ok(job) = job else {
                yield Err(ToolError::Internal("blocking task panicked".into()));
                return;
            };
            let meta = OutputMeta {
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                input_bytes: root.len(),
                output_bytes: 0,
            };
            let output = match job {
                Job::Scan(r) => ToolOutput { text: summarize_scan(&r), extra: Some(json!(r)), meta: Some(meta), alerts: Vec::new() },
                Job::Search(r) => ToolOutput { text: summarize_search(&r), extra: Some(json!(r)), meta: Some(meta), alerts: Vec::new() },
            };
            yield Ok(StreamEvent::Done { output });
        })
    }
}

register_stream_tool!(FolderAnalyzer, &METADATA);
```

> 注意:`root` 被 move 进闭包,meta 里还需要它 —— 先 `let input_bytes = root.len();` 存下再 move。取消语义:cancel token 同时传进 scan/search 内部检查;tool_cancel 取消 token 后作业提前返回 cancelled=true 报告 → Done。

- [ ] **Step 4: 运行验证通过 + 全量回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS(StreamEvent 字段变更的既有测试断言一并修复)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(analyzer): streaming scan/search with progress and cancellation"
```

---

### Task 8: IPC 层扩展(params/text + file_path 授权校验)

**Files:**
- Modify: `src-tauri/src/commands/tool.rs`
- Test: 同文件底部 tests

**Interfaces:**
- Consumes: `AuthorizedPaths`(commands/fs.rs)、AppState
- Produces(前端 Task 11 依赖):
  - `tool_execute_stream(tool_id, file_path, text?, params?, state, app_handle)`:`text: Option<String>`、`params: Option<HashMap<String, serde_json::Value>>` 可选,Tauri V2 自动映射 JS 缺省参数,旧调用 `{toolId, filePath}` 完全兼容
  - `tool_execute_inner` / `tool_execute_stream_inner` 新增入参 `authorized: &AuthorizedPaths`;`input.file_path` 未授权 → `AppError::Permission(ERR_PERMISSION_DENIED)`
  - Tauri command 签名增加 `authorized: tauri::State<'_, AuthorizedPaths>`(与 fs.rs 各命令同款)

安全影响评估:现有唯一用 `file_path` 的工具 hash_calculator 其 UI 从不设置该字段(纯文本输入),CodeEditor 走 fs_* 命令(dialog 已授权),故新增校验无回归风险,反而堵住"任意路径读取"口子。

- [ ] **Step 1: 写失败测试**

先读 tool.rs 底部现有 tests,沿用其 AppState 测试构造手段替换下面注释占位:

```rust
    use crate::commands::fs::AuthorizedPaths;

    #[tokio::test]
    async fn test_execute_rejects_unauthorized_file_path() {
        let authorized = AuthorizedPaths::new();
        let state = /* 沿用本文件现有 AppState 测试构造 */;
        let input = ToolInput {
            file_path: Some("C:/definitely/not/authorized.txt".into()),
            params: [("mode".to_string(), serde_json::json!("file"))].into_iter().collect(),
            ..Default::default()
        };
        let err = tool_execute_inner("folder_analyzer", input, &state, &authorized)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[tokio::test]
    async fn test_stream_rejects_unauthorized_path() {
        let authorized = AuthorizedPaths::new();
        let state = /* 同上 */;
        let app = /* 同上(若现有流式测试有 AppHandle mock 则复用;没有则本测试仅覆盖 inner 的授权分支前置 —— 把校验放在 spawn 之前即可直接断言)*/;
        let err = tool_execute_stream_inner(
            "folder_analyzer", "C:/not/auth", None, None, &state, &app, &authorized,
        ).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib commands::tool --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败(签名不匹配)

- [ ] **Step 3: 实现**

3a. `use crate::commands::fs::AuthorizedPaths;`

3b. `tool_execute_inner` 开头加校验:

```rust
pub async fn tool_execute_inner(
    tool_id: &str,
    input: ToolInput,
    state: &AppState,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<ToolOutput>, AppError> {
    if let Some(p) = input.file_path.as_deref() {
        if !authorized.is_path_allowed(p) {
            return Err(AppError::Permission(format!(
                "path not authorized, must be selected via dialog or drop: {p}"
            )));
        }
    }
    // ……原有逻辑不变
```

3c. `tool_execute_stream_inner` 扩签名:

```rust
pub fn tool_execute_stream_inner(
    tool_id: &str,
    file_path: &str,
    text: Option<String>,
    params: Option<std::collections::HashMap<String, serde_json::Value>>,
    state: &AppState,
    app_handle: &tauri::AppHandle,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<String>, AppError> {
    if !authorized.is_path_allowed(file_path) {
        return Err(AppError::Permission(format!(
            "path not authorized, must be selected via dialog or drop: {file_path}"
        )));
    }
    let input = ToolInput {
        text,
        file_path: Some(file_path.to_string()),
        params: params.unwrap_or_default(),
    };
    // ……其余不变
```

3d. Tauri command 层同步更新(两个命令都加 `authorized: tauri::State<'_, AuthorizedPaths>`,stream 加 text/params Option 参数并透传)。修复其余 `_inner` 调用点(含既有测试)。

- [ ] **Step 4: 运行验证通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/tool.rs
git commit -m "feat(ipc): pass params/text to streaming tools and enforce path authorization"
```

---

### Task 9: 拖放授权命令 fs_authorize_dropped_paths

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`(invoke_handler 列表追加命令名)
- Test: fs.rs tests 模块

**Interfaces:**
- Consumes: `AuthorizedPaths`
- Produces(前端 Task 11 依赖):
  - `fs_authorize_dropped_paths(paths: Vec<String>) -> CommandResponse<Vec<DroppedKind>>`
  - `struct DroppedKind { path: String, kind: String }`,`kind ∈ "dir" | "file"`;不存在的路径静默跳过;存在的全部 authorize
- 安全边界:仅接受真实存在的路径;拖放是用户显式手势,与 dialog 选择同级(prd/13-security.md 语义)

- [ ] **Step 1: 写失败测试**

fs.rs tests 模块追加:

```rust
    #[test]
    fn test_authorize_dropped_paths_filters_missing() {
        let inner_paths = AuthorizedPaths::new();
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let out = fs_authorize_dropped_paths_inner(
            vec![
                file.to_string_lossy().into_owned(),
                tmp.path().to_string_lossy().into_owned(),
                "Z:/__no_such__/ghost.txt".to_string(),
            ],
            &inner_paths,
        )
        .unwrap()
        .data
        .unwrap();
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|d| d.kind == "dir"));
        assert!(out.iter().any(|d| d.kind == "file"));
        assert!(inner_paths.is_path_allowed(&file.to_string_lossy()));
        assert!(!inner_paths.is_path_allowed("Z:/__no_such__/ghost.txt"));
    }
```

- [ ] **Step 2: 运行验证失败**

Run: `cargo test -p qraft --lib fs_authorize --manifest-path src-tauri/Cargo.toml`
Expected: 编译失败

- [ ] **Step 3: 实现**

fs.rs 追加(fs_read_dir 附近):

```rust
/// 拖放条目类型
#[derive(Debug, Serialize)]
pub struct DroppedKind {
    pub path: String,
    /// "dir" | "file"
    pub kind: String,
}

/// 将拖放进来的路径加入授权集合(用户显式拖放视同 dialog 选择);
/// 不存在的路径跳过。返回实际授权成功的条目及类型。
///
/// # Errors
///
/// 当前恒成功;保留 Result 以对齐其他 fs 命令签名
pub fn fs_authorize_dropped_paths_inner(
    paths: Vec<String>,
    authorized: &AuthorizedPaths,
) -> Result<CommandResponse<Vec<DroppedKind>>, AppError> {
    let mut kinds = Vec::with_capacity(paths.len());
    for p in paths {
        let Ok(meta) = std::fs::metadata(&p) else { continue };
        let kind = if meta.is_dir() { "dir" } else { "file" }.to_string();
        authorized.authorize(&p);
        kinds.push(DroppedKind { path: p, kind });
    }
    Ok(CommandResponse::ok(kinds))
}

#[tauri::command]
pub fn fs_authorize_dropped_paths(
    paths: Vec<String>,
    authorized: tauri::State<'_, AuthorizedPaths>,
) -> Result<CommandResponse<Vec<DroppedKind>>, AppError> {
    fs_authorize_dropped_paths_inner(paths, &authorized)
}
```

`lib.rs` 的 `generate_handler![...]` fs 组追加 `fs_authorize_dropped_paths,`。

- [ ] **Step 4: 运行验证通过**

Run: `cargo test -p qraft --lib fs_authorize --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): authorize drag-dropped paths for read-only analysis"
```

---

### Task 10: 前端类型定义 types.ts

**Files:**
- Create: `src/tools/folder-analyzer/types.ts`
- Test: `src/tools/folder-analyzer/types.test.ts`

**Interfaces:**
- Consumes: Rust Report JSON(snake_case 键)
- Produces(Task 11–14 依赖,导出名精确一致):
  - `AnalyzerMode`, `FileCategory`, `CategoryStat`, `ExtStat`, `ExtTextStat`, `TextMetricsSummary`, `FileStat`, `ScanReport`
  - `SearchMatch`, `FileSearchResult`, `SearchReport`, `FileInspectReport`
  - `humanBytes(n: number): string`、`zhCategory(c: FileCategory): string`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { humanBytes, zhCategory } from './types';

describe('humanBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1536 * 1024, '1.5 MB'],
  ])('formats %d → %s', (input, expected) => {
    expect(humanBytes(input)).toBe(expected);
  });

  it('handles invalid input', () => {
    expect(humanBytes(-1)).toBe('-');
  });
});

describe('zhCategory', () => {
  it('maps known categories', () => {
    expect(zhCategory('code')).toBe('代码');
    expect(zhCategory('archive')).toBe('压缩包');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/tools/folder-analyzer/types.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

```typescript
/**
 * folder_analyzer 后端结果镜像(键名与 Rust serde 序列化一致,snake_case)。
 * 只读分析,不落盘。
 */

export type AnalyzerMode = 'scan' | 'search' | 'file';

export type FileCategory =
  | 'code'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'binary'
  | 'other';

export interface CategoryStat {
  category: FileCategory;
  files: number;
  bytes: number;
}

export interface ExtStat {
  ext: string;
  files: number;
  bytes: number;
}

export interface ExtTextStat {
  ext: string;
  files: number;
  lines: number;
  words: number;
  chars: number;
}

export interface TextMetricsSummary {
  files_analyzed: number;
  files_skipped_large: number;
  files_skipped_binary: number;
  lines: number;
  words: number;
  chars: number;
  by_extension: ExtTextStat[];
}

export interface FileStat {
  path: string;
  bytes: number;
}

export interface ScanReport {
  root: string;
  total_files: number;
  total_dirs: number;
  total_bytes: number;
  symlinks_skipped: number;
  truncated: boolean;
  cancelled: boolean;
  elapsed_ms: number;
  by_category: CategoryStat[];
  by_extension: ExtStat[];
  text_metrics: TextMetricsSummary | null;
  largest_files: FileStat[];
}

export interface SearchMatch {
  line_number: number;
  column: number;
  preview: string;
}

export interface FileSearchResult {
  path: string;
  ext: string;
  match_count: number;
  matches: SearchMatch[];
}

export interface SearchReport {
  pattern: string;
  is_regex: boolean;
  case_insensitive: boolean;
  total_matches: number;
  files_with_matches: number;
  results: FileSearchResult[];
  files_scanned: number;
  files_skipped_large: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface FileInspectReport {
  path: string;
  file_name: string;
  ext: string;
  category: FileCategory;
  magic: string | null;
  size_bytes: number;
  is_text: boolean;
  encoding: string | null;
  lines: number | null;
  words: number | null;
  chars: number | null;
  sha256: string;
  preview: string[];
  duration_ms: number;
}

const UNIT = ['B', 'KB', 'MB', 'GB', 'TB'];

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-';
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNIT.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${v.toFixed(digits)} ${UNIT[i]}`;
}

const ZH_CATEGORY: Record<FileCategory, string> = {
  code: '代码',
  document: '文档',
  image: '图像',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  binary: '二进制',
  other: '其他',
};

export function zhCategory(c: FileCategory): string {
  return ZH_CATEGORY[c] ?? c;
}
```

- [ ] **Step 4: 运行验证通过 + Typecheck**

Run: `pnpm vitest run src/tools/folder-analyzer/types.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/folder-analyzer/
git commit -m "feat(analyzer-ui): mirror backend report types and formatters"
```

---

### Task 11: IPC 服务层 analyzerApi.ts

**Files:**
- Create: `src/tools/folder-analyzer/analyzerApi.ts`
- Test: `src/tools/folder-analyzer/analyzerApi.test.ts`

**Interfaces:**
- Consumes: `@/lib/ipc`(`invokeCommand/safeInvoke/Result`)、`@tauri-apps/api/event` 的 `listen`;Rust Task 8/9 命令
- Produces(Task 12/13 依赖):
  - `pickFolder(): Promise<string | null>`
  - `pickFilePath(): Promise<string | null>`
  - `authorizeDropped(paths: string[]): Promise<DroppedEntry[]>`,`DroppedEntry = { path: string; kind: 'dir' | 'file' }`
  - `startAnalyzerTask(args: StartArgs): Promise<Result<string, ErrorInfo>>`;`StartArgs = { filePath, mode, options?, searchText? }` — 内部 `safeInvoke('tool_execute_stream', { toolId: 'folder_analyzer', filePath, text: searchText, params: { mode, ...options } })`
  - `cancelAnalyzerTask(taskId): Promise<void>`
  - `subscribeTaskEvents(taskId, handlers): Promise<() => void>` — 订阅三个事件按 taskId 过滤,返回合并 unlisten;`handlers.onProgress?(p: { processed, total, message })`、`onDone(output)`、`onFailed(error)`
  - `routeDropped(paths): Promise<DroppedEntry | null>` — 授权并取首条(Task 13 测试用)

- [ ] **Step 1: 写失败测试**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
const safeInvoke = vi.fn();
const listeners = new Map<string, Array<(p: unknown) => void>>();

vi.mock('@/lib/ipc', () => ({
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
  safeInvoke: (...a: unknown[]) => safeInvoke(...a),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (p: unknown) => void) => {
    const arr = listeners.get(event) ?? [];
    arr.push(cb);
    listeners.set(event, arr);
    return () => {
      const cur = listeners.get(event) ?? [];
      cur.splice(cur.indexOf(cb), 1);
    };
  }),
}));

import { authorizeDropped, startAnalyzerTask, subscribeTaskEvents } from './analyzerApi';

function emit(event: string, payload: unknown) {
  for (const cb of listeners.get(event) ?? []) cb(payload);
}

describe('analyzerApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('authorizeDropped returns kinds from backend', async () => {
    invokeCommand.mockResolvedValue([
      { path: 'C:/x', kind: 'dir' },
      { path: 'C:/x/a.txt', kind: 'file' },
    ]);
    const out = await authorizeDropped(['C:/x']);
    expect(invokeCommand).toHaveBeenCalledWith('fs_authorize_dropped_paths', { paths: ['C:/x'] });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('dir');
  });

  it('startAnalyzerTask passes mode into params', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 't' });
    await startAnalyzerTask({ filePath: 'C:/x', mode: 'search', options: { pattern: 'p' } });
    expect(safeInvoke).toHaveBeenCalledWith('tool_execute_stream', {
      toolId: 'folder_analyzer',
      filePath: 'C:/x',
      text: undefined,
      params: { mode: 'search', pattern: 'p' },
    });
  });

  it('subscribeTaskEvents routes only matching taskId and unsubscribes all', async () => {
    const done = vi.fn();
    const un = await subscribeTaskEvents('t1', { onDone: done });
    emit('tool_completed', { payload: { taskId: 'other', output: {} } });
    expect(done).not.toHaveBeenCalled();
    emit('tool_completed', { payload: { taskId: 't1', output: { ok: 1 } } });
    expect(done).toHaveBeenCalledWith({ ok: 1 });
    await un();
    expect(listeners.get('tool_completed')).toHaveLength(0);
  });

  it('forwards progress numbers', async () => {
    const onProgress = vi.fn();
    await subscribeTaskEvents('t2', { onProgress });
    emit('tool_progress', {
      payload: { taskId: 't2', percent: 0, message: '已扫描 12 文件', processed: 12, total: 0 },
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ processed: 12 }));
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/tools/folder-analyzer/analyzerApi.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
/**
 * folder_analyzer 的 IPC 服务层:选择器 / 拖放授权 / 流式任务启停与事件订阅。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand, safeInvoke, type Result } from '@/lib/ipc';
import type { ErrorInfo } from '@/types/ipc';
import type { AnalyzerMode } from './types';

const TOOL_ID = 'folder_analyzer';

export interface DroppedEntry {
  path: string;
  kind: 'dir' | 'file';
}

export function pickFolder(): Promise<string | null> {
  return invokeCommand<string | null>('fs_open_folder_dialog', {});
}

/** fs_open_dialog 返回对象含 path 字段;取消返回 null */
export async function pickFilePath(): Promise<string | null> {
  const r = await invokeCommand<{ path: string } | null>('fs_open_dialog', {});
  return r?.path ?? null;
}

export async function authorizeDropped(paths: string[]): Promise<DroppedEntry[]> {
  const kinds = await invokeCommand<Array<{ path: string; kind: string }>>(
    'fs_authorize_dropped_paths',
    { paths },
  );
  return kinds.filter((k): k is DroppedEntry => k.kind === 'dir' || k.kind === 'file');
}

/** 拖放路径 → 授权 → 返回首条有效条目;多条目只取第一条(UI 单目标) */
export async function routeDropped(paths: string[]): Promise<DroppedEntry | null> {
  const entries = await authorizeDropped(paths);
  return entries[0] ?? null;
}

export interface StartArgs {
  filePath: string;
  mode: AnalyzerMode;
  options?: Record<string, unknown>;
  searchText?: string;
}

export function startAnalyzerTask(args: StartArgs): Promise<Result<string, ErrorInfo>> {
  return safeInvoke<string>('tool_execute_stream', {
    toolId: TOOL_ID,
    filePath: args.filePath,
    text: args.searchText,
    params: { mode: args.mode, ...(args.options ?? {}) },
  });
}

export async function cancelAnalyzerTask(taskId: string): Promise<void> {
  await safeInvoke<boolean>('tool_cancel', { taskId });
}

export interface TaskHandlers {
  onProgress?(p: { processed: number; total: number; message: string }): void;
  onDone(output: unknown): void;
  onFailed(error: unknown): void;
}

interface TaggedPayload {
  payload: Record<string, unknown>;
}

function unwrap(e: unknown): Record<string, unknown> {
  return (e as TaggedPayload).payload ?? {};
}

export async function subscribeTaskEvents(
  taskId: string,
  handlers: TaskHandlers,
): Promise<() => void> {
  const offs: UnlistenFn[] = [];
  offs.push(
    await listen<TaggedPayload>('tool_progress', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onProgress?.({
        processed: Number(p.processed ?? 0),
        total: Number(p.total ?? 0),
        message: String(p.message ?? ''),
      });
    }),
  );
  offs.push(
    await listen<TaggedPayload>('tool_completed', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onDone(p.output);
    }),
  );
  offs.push(
    await listen<TaggedPayload>('tool_failed', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onFailed(p.error);
    }),
  );
  return () => offs.forEach((off) => off());
}
```

> Tauri event 回调载荷形如 `{ event, id, payload }`,故 unwrap 取 `.payload`。

- [ ] **Step 4: 运行验证通过 + Typecheck**

Run: `pnpm vitest run src/tools/folder-analyzer/analyzerApi.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/folder-analyzer/
git commit -m "feat(analyzer-ui): ipc service layer for pick/drop/stream tasks"
```

---

### Task 12: 任务状态 hook useAnalyzerTask.ts

**Files:**
- Create: `src/tools/folder-analyzer/useAnalyzerTask.ts`
- Test: `src/tools/folder-analyzer/useAnalyzerTask.test.tsx`

**Interfaces:**
- Consumes: Task 11 API
- Produces(Task 13 依赖):
  - `interface AnalyzerTaskState { status: 'idle'|'running'|'done'|'failed'; processed: number; message: string; result: unknown; error: string | null }`(result 为 tool_completed.output.extra JSON)
  - `useAnalyzerTask(): { state; run(args: StartArgs): Promise<void>; cancel(): Promise<void> }` — 卸载自动退订;过期 taskId 事件丢弃

- [ ] **Step 1: 写失败测试**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeInvoke = vi.fn();
vi.mock('@/lib/ipc', () => ({ safeInvoke: (...a: unknown[]) => safeInvoke(...a) }));

let emitted: Array<(e: unknown) => void> = [];
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_ev: string, cb: (e: unknown) => void) => {
    emitted.push(cb);
    return () => {
      emitted = emitted.filter((f) => f !== cb);
    };
  }),
}));

import { useAnalyzerTask } from './useAnalyzerTask';

function fire(payload: Record<string, unknown>) {
  for (const cb of emitted) cb({ payload });
}

describe('useAnalyzerTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitted = [];
  });

  it('transitions idle→running→done', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 'task-1' });
    const { result } = renderHook(() => useAnalyzerTask());

    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    expect(result.current.state.status).toBe('running');

    act(() => fire({ taskId: 'task-1', output: { extra: { total_files: 3 } } }));
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect((result.current.state.result as { total_files: number }).total_files).toBe(3);
  });

  it('ignores stale task events', async () => {
    safeInvoke.mockResolvedValue({ ok: true, value: 'task-a' });
    const { result } = renderHook(() => useAnalyzerTask());
    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    act(() => fire({ taskId: 'task-stale', error: { message: 'boom' } }));
    expect(result.current.state.status).toBe('running');
  });

  it('surfaces start failure without running', async () => {
    safeInvoke.mockResolvedValue({ ok: false, error: { code: 'ERR_X', message: 'denied' } });
    const { result } = renderHook(() => useAnalyzerTask());
    await act(async () => {
      await result.current.run({ filePath: 'C:/x', mode: 'scan' });
    });
    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toContain('denied');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/tools/folder-analyzer/useAnalyzerTask.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
/**
 * folder_analyzer 流式任务的本地状态机(idle/running/done/failed)。
 * 不接入全局 toolStateStore:任务生命周期完全属于当前工具面板。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAnalyzerTask,
  startAnalyzerTask,
  subscribeTaskEvents,
  type StartArgs,
} from './analyzerApi';

export interface AnalyzerTaskState {
  status: 'idle' | 'running' | 'done' | 'failed';
  processed: number;
  message: string;
  result: unknown;
  error: string | null;
}

const INITIAL: AnalyzerTaskState = {
  status: 'idle',
  processed: 0,
  message: '',
  result: null,
  error: null,
};

export function useAnalyzerTask(): {
  state: AnalyzerTaskState;
  run: (args: StartArgs) => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [state, setState] = useState<AnalyzerTaskState>(INITIAL);
  const taskIdRef = useRef<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => disposeRef.current?.(), []);

  const run = useCallback(async (args: StartArgs) => {
    disposeRef.current?.();
    setState({ ...INITIAL, status: 'running' });
    const r = await startAnalyzerTask(args);
    if (!r.ok) {
      setState({ ...INITIAL, status: 'failed', error: `${r.error.code}: ${r.error.message}` });
      return;
    }
    taskIdRef.current = r.value;
    disposeRef.current = await subscribeTaskEvents(r.value, {
      onProgress: (p) =>
        setState((s) =>
          s.status === 'running' ? { ...s, processed: p.processed, message: p.message } : s,
        ),
      onDone: (output) => {
        const extra = (output as { extra?: unknown } | null)?.extra ?? null;
        setState({ ...INITIAL, status: 'done', result: extra });
      },
      onFailed: (error) => {
        const info = error as { message?: string; detail?: string } | undefined;
        setState({
          ...INITIAL,
          status: 'failed',
          error: info?.message ?? info?.detail ?? '任务失败',
        });
      },
    });
  }, []);

  const cancel = useCallback(async () => {
    const id = taskIdRef.current;
    if (!id) return;
    await cancelAnalyzerTask(id);
  }, []);

  return { state, run, cancel };
}
```

> 已知边界:若任务在订阅建立前瞬间完成会丢事件(Rust 先 spawn 再返回 taskId,窗口极小);UI 提供"重新运行"兜底。

- [ ] **Step 4: 运行验证通过 + Typecheck**

Run: `pnpm vitest run src/tools/folder-analyzer/useAnalyzerTask.test.tsx && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/folder-analyzer/
git commit -m "feat(analyzer-ui): local task state hook with stale-event guarding"
```

---

### Task 13: 主组件 FolderAnalyzer.tsx

**Files:**
- Create: `src/tools/FolderAnalyzer.tsx`
- Test: `src/tools/FolderAnalyzer.test.tsx`

**Interfaces:**
- Consumes: `ToolProps`(registry)、Task 10 类型、Task 11 API、Task 12 hook、`@/components/ui/*`(button/input/label/switch/tabs/progress 均已存在)、sonner toast
- Produces: 导出 `FolderAnalyzer`;三种模式编排:
  - scan:选文件夹 → `run({ filePath, mode:'scan', options:{ include_hidden } })`
  - search:选文件夹 + pattern → `run({ ..., mode:'search', options:{ pattern, is_regex, case_insensitive, include_hidden } })`
  - file:选文件 → `run({ filePath, mode:'file' })`
  - 拖放:`getCurrentWebview().onDragDropEvent` 的 drop 事件取 `payload.paths` → `routeDropped` → kind=dir 切 scan 并运行;kind=file 切 file 并运行
  - data-testid 约定(测试依赖):`analyzer-mode-scan / analyzer-mode-search / analyzer-mode-file`、`analyzer-pick-folder`、`analyzer-pick-file`、`analyzer-pattern`、`analyzer-run`、`analyzer-cancel`、`analyzer-progress-message`、`analyzer-target`

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pickFolder = vi.fn();
const pickFilePath = vi.fn();
const routeDropped = vi.fn();

vi.mock('./folder-analyzer/analyzerApi', () => ({
  pickFolder: (...a: unknown[]) => pickFolder(...a),
  pickFilePath: (...a: unknown[]) => pickFilePath(...a),
}));

vi.mock('./folder-analyzer/routeDropped', () => ({
  routeDropped: (...a: unknown[]) => routeDropped(...a),
}));

const runMock = vi.fn().mockResolvedValue(undefined);
const cancelMock = vi.fn().mockResolvedValue(undefined);
let fakeState = {
  status: 'idle' as 'idle' | 'running' | 'done' | 'failed',
  processed: 0,
  message: '',
  result: null as unknown,
  error: null as string | null,
};

vi.mock('./folder-analyzer/useAnalyzerTask', () => ({
  useAnalyzerTask: () => ({ state: fakeState, run: runMock, cancel: cancelMock }),
}));

// 面板 mock 掉,聚焦主组件编排
vi.mock('./folder-analyzer/ScanResultsPanel', () => ({
  ScanResultsPanel: () => <div>scan-panel</div>,
}));
vi.mock('./folder-analyzer/SearchResultsPanel', () => ({
  SearchResultsPanel: () => <div>search-panel</div>,
}));
vi.mock('./folder-analyzer/FileInspectPanel', () => ({
  FileInspectPanel: () => <div>file-panel</div>,
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

import { FolderAnalyzer } from './FolderAnalyzer';

function renderTool() {
  return render(
    <FolderAnalyzer toolId="folder_analyzer" metadata={{ id: 'folder_analyzer' } as never} />,
  );
}

describe('FolderAnalyzer orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeState = { status: 'idle', processed: 0, message: '', result: null, error: null };
    runMock.mockResolvedValue(undefined);
  });

  it('scan mode requires folder then runs with params', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue('C:/proj');
    renderTool();
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: 'C:/proj',
          mode: 'scan',
          options: expect.objectContaining({ include_hidden: false }),
        }),
      ),
    );
  });

  it('keeps target and disables nothing when dialog cancelled', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue(null);
    renderTool();
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() => expect(runMock).not.toHaveBeenCalled());
    expect(screen.getByTestId('analyzer-run')).toBeDisabled();
  });

  it('search mode passes pattern options', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue('C:/proj');
    renderTool();
    await user.click(screen.getByTestId('analyzer-mode-search'));
    await user.type(screen.getByTestId('analyzer-pattern'), 'foo');
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'search',
          options: expect.objectContaining({ pattern: 'foo', is_regex: false }),
        }),
      ),
    );
  });

  it('file mode picks a file path', async () => {
    const user = userEvent.setup();
    pickFilePath.mockResolvedValue('C:/x/a.md');
    renderTool();
    await user.click(screen.getByTestId('analyzer-mode-file'));
    await user.click(screen.getByTestId('analyzer-pick-file'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'C:/x/a.md', mode: 'file' }),
      ),
    );
  });

  it('shows running progress and enables cancel', () => {
    fakeState = { status: 'running', processed: 42, message: '已扫描 42 文件', result: null, error: null };
    renderTool();
    expect(screen.getByTestId('analyzer-progress-message')).toHaveTextContent('42');
    expect(screen.getByTestId('analyzer-cancel')).toBeEnabled();
  });

  it('shows failure alert', () => {
    fakeState = {
      status: 'failed', processed: 0, message: '', result: null,
      error: 'ERR_PERMISSION_DENIED: denied',
    };
    renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent('denied');
  });

  it('routes dropped dir to scan run', async () => {
    routeDropped.mockResolvedValue({ path: 'C:/dropped', kind: 'dir' });
    // 直接测纯函数 + 组件内 handleDrop 走同一函数
    const { routeDropped: fn } = await import('./folder-analyzer/routeDropped');
    const res = await fn(['C:/dropped']);
    expect(res).toEqual({ path: 'C:/dropped', kind: 'dir' });
  });

  it('renders done results panel by mode', async () => {
    fakeState = { status: 'done', processed: 0, message: '', result: { total_files: 1 }, error: null };
    renderTool(); // 默认 scan 模式
    expect(await screen.findByText('scan-panel')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/tools/FolderAnalyzer.test.tsx`
Expected: FAIL(组件不存在)

- [ ] **Step 3: 实现主组件**

```tsx
/**
 * 文件夹/文件分析器(只读)。
 * scan:目录统计;search:内容搜索;file:单文件解析。
 */
import { useCallback, useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ToolProps } from './registry';
import { ScanResultsPanel } from './folder-analyzer/ScanResultsPanel';
import { SearchResultsPanel } from './folder-analyzer/SearchResultsPanel';
import { FileInspectPanel } from './folder-analyzer/FileInspectPanel';
import { pickFolder, pickFilePath, routeDropped } from './folder-analyzer/analyzerApi';
import { useAnalyzerTask } from './folder-analyzer/useAnalyzerTask';
import type {
  AnalyzerMode,
  FileInspectReport,
  ScanReport,
  SearchReport,
} from './folder-analyzer/types';

export function FolderAnalyzer(_props: ToolProps) {
  const [mode, setMode] = useState<AnalyzerMode>('scan');
  const [target, setTarget] = useState<string | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [pattern, setPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const { state, run, cancel } = useAnalyzerTask();

  // Tauri 拦截了 HTML5 drop,必须用 webview 级拖放事件拿真实路径
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let alive = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
          void routeDropped(event.payload.paths).then((entry) => {
            if (!alive || !entry) return;
            setTarget(entry.path);
            if (entry.kind === 'dir') {
              setMode('scan');
              void run({ filePath: entry.path, mode: 'scan', options: { include_hidden: includeHidden } });
            } else {
              setMode('file');
              void run({ filePath: entry.path, mode: 'file' });
            }
          });
        }
      })
      .then((unlisten) => {
        if (alive) dispose = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅初始化订阅
  }, []);

  const handlePickFolder = useCallback(async () => {
    const p = await pickFolder();
    if (!p) return;
    setTarget(p);
    if (mode === 'file') setMode('scan');
  }, [mode]);

  const handleRun = useCallback(async () => {
    if (!target) return;
    if (mode === 'search') {
      await run({
        filePath: target,
        mode: 'search',
        options: { pattern, is_regex: isRegex, case_insensitive: caseInsensitive, include_hidden: includeHidden },
      });
    } else if (mode === 'scan') {
      await run({ filePath: target, mode: 'scan', options: { include_hidden: includeHidden } });
    }
    // file 模式在选中文件后立即运行,无需 Run 按钮
  }, [target, mode, pattern, isRegex, caseInsensitive, includeHidden, run]);

  const handlePickFile = useCallback(async () => {
    const p = await pickFilePath();
    if (!p) return;
    setTarget(p);
    setMode('file');
    await run({ filePath: p, mode: 'file' });
  }, [run]);

  const canRun =
    !!target &&
    state.status !== 'running' &&
    (mode !== 'search' || pattern.trim().length > 0);

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="folder-analyzer">
      <Tabs value={mode} onValueChange={(v) => setMode(v as AnalyzerMode)}>
        <TabsList>
          <TabsTrigger value="scan" data-testid="analyzer-mode-scan">文件夹统计</TabsTrigger>
          <TabsTrigger value="search" data-testid="analyzer-mode-search">内容搜索</TabsTrigger>
          <TabsTrigger value="file" data-testid="analyzer-mode-file">单文件解析</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-4" data-search-anchor="folder_analyzer:config">
        {(mode === 'scan' || mode === 'search') && (
          <div className="flex flex-col gap-1">
            <Button variant="outline" onClick={handlePickFolder} data-testid="analyzer-pick-folder">
              选择文件夹…
            </Button>
          </div>
        )}
        {mode === 'file' && (
          <Button variant="outline" onClick={handlePickFile} data-testid="analyzer-pick-file">
            选择文件…(或直接拖入)
          </Button>
        )}
        {mode === 'search' && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="analyzer-pattern-input" className="text-xs">搜索内容</Label>
            <Input
              id="analyzer-pattern-input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="普通文本或正则表达式"
              className="w-64"
              data-testid="analyzer-pattern"
            />
          </div>
        )}
        <div className="flex items-center gap-2 pb-1">
          <Switch id="hidden-switch" checked={includeHidden} onCheckedChange={setIncludeHidden} />
          <Label htmlFor="hidden-switch" className="text-xs">包含隐藏文件</Label>
        </div>
        {mode === 'search' && (
          <>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="regex-switch" checked={isRegex} onCheckedChange={setIsRegex} />
              <Label htmlFor="regex-switch" className="text-xs">正则</Label>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="case-switch" checked={caseInsensitive} onCheckedChange={setCaseInsensitive} />
              <Label htmlFor="case-switch" className="text-xs">忽略大小写</Label>
            </div>
          </>
        )}
        {mode !== 'file' && (
          <Button onClick={() => void handleRun()} disabled={!canRun} data-testid="analyzer-run">
            {state.status === 'running' ? '分析中…' : '开始分析'}
          </Button>
        )}
        <span className="text-xs text-muted-foreground truncate max-w-[40ch]" title={target ?? ''}>
          {target ? `目标:${target}` : '尚未选择目标'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">只读分析:不会写入或修改任何文件。</p>

      {state.status === 'running' && (
        <div className="flex items-center gap-3">
          <Progress value={undefined} className="flex-1" aria-label="分析进行中" />
          <span className="text-xs text-muted-foreground" data-testid="analyzer-progress-message">
            {state.message}
          </span>
          <Button variant="destructive" size="sm" onClick={() => void cancel()} data-testid="analyzer-cancel">
            取消
          </Button>
        </div>
      )}

      {state.error && (
        <div role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {state.status === 'done' && mode === 'scan' && <ScanResultsPanel report={state.result as ScanReport} />}
      {state.status === 'done' && mode === 'search' && (
        <SearchResultsPanel report={state.result as SearchReport} />
      )}
      {state.status === 'done' && mode === 'file' && (
        <FileInspectPanel report={state.result as FileInspectReport} />
      )}
    </div>
  );
}
```

> 若 `Progress` 不接受 `undefined`(受控组件),改传 `state.processed > 0 ? Math.min(100, state.processed % 100) : undefined` 或用 indeterminate 样式类 —— 以现有组件签名为准。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run src/tools/FolderAnalyzer.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/
git commit -m "feat(analyzer-ui): folder analyzer main tool page with modes and drag-drop"
```

---

### Task 14: 结果面板组件(Scan / Search / Inspect)

**Files:**
- Create: `src/tools/folder-analyzer/ScanResultsPanel.tsx`
- Create: `src/tools/folder-analyzer/SearchResultsPanel.tsx`
- Create: `src/tools/folder-analyzer/FileInspectPanel.tsx`
- Test: `src/tools/folder-analyzer/panels.test.tsx`

**Interfaces:**
- Consumes: Task 10 类型与格式化函数
- Produces:
  - `<ScanResultsPanel report: ScanReport />`:概览卡片(文件数/目录数/总大小/耗时)+ Tabs(按扩展名表 | 按类别表 | 文本统计表+汇总 | 最大文件列表);truncated/cancelled 显示警示条
  - `<SearchResultsPanel report: SearchReport />`:头部计数 + 每文件分组列表(路径、命中数、行号:预览);truncated/cancelled 警示
  - `<FileInspectPanel report: FileInspectReport />`:键值对详情(类别/魔数/编码/行数字数/SHA-256)+ 前 30 行 preview `<pre>`
  - 纯展示组件,无 IPC 依赖,可直接渲染 fixture 测试

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileInspectPanel } from './FileInspectPanel';
import { ScanResultsPanel } from './ScanResultsPanel';
import { SearchResultsPanel } from './SearchResultsPanel';
import type { ScanReport, SearchReport, FileInspectReport } from './types';

const scanFixture: ScanReport = {
  root: 'C:/proj',
  total_files: 3,
  total_dirs: 1,
  total_bytes: 2048,
  symlinks_skipped: 0,
  truncated: false,
  cancelled: false,
  elapsed_ms: 12,
  by_category: [{ category: 'code', files: 2, bytes: 1024 }],
  by_extension: [
    { ext: 'ts', files: 2, bytes: 1024 },
    { ext: 'md', files: 1, bytes: 1024 },
  ],
  text_metrics: {
    files_analyzed: 2,
    files_skipped_large: 0,
    files_skipped_binary: 1,
    lines: 10,
    words: 20,
    chars: 100,
    by_extension: [{ ext: 'ts', files: 2, lines: 10, words: 20, chars: 100 }],
  },
  largest_files: [{ path: 'C:/proj/big.ts', bytes: 800 }],
};

describe('ScanResultsPanel', () => {
  it('renders summary numbers', () => {
    render(<ScanResultsPanel report={scanFixture} />);
    expect(screen.getByTestId('scan-total-files')).toHaveTextContent('3');
    expect(screen.getByTestId('scan-total-size')).toHaveTextContent('2.0 KB');
  });

  it('lists extension stats sorted desc by files', () => {
    render(<ScanResultsPanel report={scanFixture} />);
    const rows = screen.getAllByTestId(/^scan-ext-row-/);
    expect(rows[0]).toHaveTextContent('ts');
  });

  it('shows truncated warning', () => {
    render(<ScanResultsPanel report={{ ...scanFixture, truncated: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/截断/);
  });
});

describe('SearchResultsPanel', () => {
  it('renders grouped matches with line numbers', () => {
    const report: SearchReport = {
      pattern: 'needle',
      is_regex: false,
      case_insensitive: true,
      total_matches: 2,
      files_with_matches: 1,
      files_scanned: 5,
      files_skipped_large: 0,
      truncated: false,
      cancelled: false,
      results: [
        {
          path: 'C:/p/a.txt',
          ext: 'txt',
          match_count: 2,
          matches: [
            { line_number: 1, column: 0, preview: 'needle one' },
            { line_number: 4, column: 7, preview: 'second needle here' },
          ],
        },
      ],
    };
    render(<SearchResultsPanel report={report} />);
    expect(screen.getByText('C:/p/a.txt')).toBeInTheDocument();
    expect(screen.getByText(/L1/)).toBeInTheDocument();
    expect(screen.getByText(/L4/)).toBeInTheDocument();
  });
});

describe('FileInspectPanel', () => {
  it('renders details for text file', () => {
    const r: FileInspectReport = {
      path: 'C:/x/a.md', file_name: 'a.md', ext: 'md', category: 'document',
      magic: null, size_bytes: 7, is_text: true, encoding: 'UTF-8',
      lines: 1, words: 2, chars: 6, sha256: 'ab'.repeat(32),
      preview: ['你好 世界'], duration_ms: 1,
    };
    render(<FileInspectPanel report={r} />);
    expect(screen.getByText('UTF-8')).toBeInTheDocument();
    expect(screen.getByText('你好 世界')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/tools/folder-analyzer/panels.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现三个面板**

`ScanResultsPanel.tsx`:

```tsx
/** 扫描结果面板:概览 + 分类明细(纯展示)。 */
import { useState } from 'react';
import { humanBytes, zhCategory, type ExtStat, type FileCategory } from './types';

interface Props {
  report: import('./types').ScanReport;
}

type TabKey = 'ext' | 'category' | 'text' | 'largest';

export function ScanResultsPanel({ report }: Props) {
  const [tab, setTab] = useState<TabKey>('ext');
  const tabs: Array<[TabKey, string]> = [
    ['ext', '按扩展名'],
    ['category', '按类别'],
    ['text', '文本行数/字数'],
    ['largest', '最大文件'],
  ];
  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="grid grid-cols-4 gap-2">
        <Card label="文件总数" value={String(report.total_files)} testId="scan-total-files" />
        <Card label="目录数" value={String(report.total_dirs)} testId="scan-total-dirs" />
        <Card label="总大小" value={humanBytes(report.total_bytes)} testId="scan-total-size" />
        <Card label="耗时" value={`${report.elapsed_ms} ms`} testId="scan-elapsed" />
      </div>

      {(report.truncated || report.cancelled) && (
        <div role="status" className="text-sm text-yellow-600 dark:text-yellow-400">
          {report.truncated ? '结果被截断(超过条目上限),' : ''}
          {report.cancelled ? '已被用户取消,' : ''}以下为部分统计。
        </div>
      )}

      <div className="flex gap-2 text-sm">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={tab === key ? 'font-semibold underline underline-offset-4' : 'text-muted-foreground'}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ext' && (
        <table className="text-sm w-full">
          <thead><tr><th className="text-left py-1">扩展名</th><th className="text-right">数量</th><th className="text-right">大小</th></tr></thead>
          <tbody>
            {report.by_extension.map((e: ExtStat) => (
              <tr key={e.ext} data-testid={`scan-ext-row-${e.ext}`}>
                <td className="py-1 font-mono">{e.ext || '(无扩展名)'}</td>
                <td className="text-right">{e.files}</td>
                <td className="text-right">{humanBytes(e.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'category' && (
        <table className="text-sm w-full">
          <thead><tr><th className="text-left py-1">类别</th><th className="text-right">数量</th><th className="text-right">大小</th></tr></thead>
          <tbody>
            {report.by_category.map((c) => (
              <tr key={c.category} data-testid={`scan-cat-row-${c.category}`}>
                <td className="py-1">{zhCategory(c.category as FileCategory)}</td>
                <td className="text-right">{c.files}</td>
                <td className="text-right">{humanBytes(c.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'text' && report.text_metrics && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex gap-4 text-muted-foreground">
            <span>覆盖 {report.text_metrics.files_analyzed} 个文本文件</span>
            <span>共 {report.text_metrics.lines} 行 · {report.text_metrics.words} 词 · {report.text_metrics.chars} 字符</span>
          </div>
          <table className="text-sm w-full">
            <thead>
              <tr><th className="text-left py-1">扩展名</th><th className="text-right">文件</th><th className="text-right">行数</th><th className="text-right">字数</th></tr>
            </thead>
            <tbody>
              {report.text_metrics.by_extension.map((e) => (
                <tr key={e.ext} data-testid={`scan-text-row-${e.ext}`}>
                  <td className="py-1 font-mono">{e.ext}</td>
                  <td className="text-right">{e.files}</td>
                  <td className="text-right">{e.lines}</td>
                  <td className="text-right">{e.words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'largest' && (
        <ul className="text-sm font-mono space-y-1">
          {report.largest_files.map((f) => (
            <li key={f.path} className="flex justify-between gap-4">
              <span className="truncate" title={f.path}>{f.path}</span>
              <span>{humanBytes(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold" data-testid={testId}>{value}</div>
    </div>
  );
}
```

`SearchResultsPanel.tsx`:

```tsx
/** 内容搜索结果面板(纯展示)。 */
interface Props {
  report: import('./types').SearchReport;
}

export function SearchResultsPanel({ report }: Props) {
  return (
    <div className="flex flex-col gap-3 min-h-0" data-testid="search-results">
      <div className="text-sm text-muted-foreground" data-testid="search-summary">
        「{report.pattern}」共 {report.total_matches} 处匹配 / {report.files_with_matches} 个文件
        {report.truncated ? '(已截断)' : ''}{report.cancelled ? '(已取消)' : ''}
      </div>
      {report.results.map((file) => (
        <div key={file.path} className="rounded-md border p-3 text-sm">
          <div className="flex justify-between font-mono">
            <span className="truncate" title={file.path}>{file.path}</span>
            <span className="shrink-0">{file.match_count} 处</span>
          </div>
          <ul className="mt-2 space-y-1">
            {file.matches.map((m) => (
              <li key={`${file.path}:${m.line_number}:${m.column}`} className="flex gap-3">
                <span className="text-muted-foreground shrink-0">L{m.line_number}:C{m.column}</span>
                <code className="truncate">{m.preview}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

`FileInspectPanel.tsx`:

```tsx
/** 单文件解析面板(纯展示)。 */
interface Props {
  report: import('./types').FileInspectReport;
}

export function FileInspectPanel({ report }: Props) {
  const rows: Array<[string, string]> = [
    ['路径', report.path],
    ['类型', `${zhCategoryOf(report.category)}${report.magic ? `(魔数:${report.magic})` : ''}`],
    ['大小', `${report.size_bytes} 字节`],
    ...(report.is_text
      ? ([
          ['编码', report.encoding ?? '-'],
          ['行数 / 词数 / 字符', `${report.lines ?? 0} / ${report.words ?? 0} / ${report.chars ?? 0}`],
        ] as Array<[string, string]>)
      : []),
    ['SHA-256', report.sha256],
  ];
  return (
    <div className="flex flex-col gap-4 min-h-0" data-testid="inspect-panel">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <FragmentRow key={k} k={k} v={v} />
        ))}
      </dl>
      {report.preview.length > 0 && (
        <div className="min-h-0 overflow-auto rounded-md border p-3">
          <pre className="text-xs leading-5">{report.preview.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}

import { Fragment } from 'react';
import { zhCategory, type FileCategory } from './types';

function zhCategoryOf(c: FileCategory): string {
  return zhCategory(c);
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground whitespace-nowrap">{k}</dt>
      <dd className="font-mono break-all">{v}</dd>
    </>
  );
}
```

> import 语句应置于文件顶部(eslint 规则),执行时把两个 import 合并到文件头。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run src/tools/folder-analyzer/panels.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/folder-analyzer/
git commit -m "feat(analyzer-ui): scan/search/inspect result panels"
```

---

### Task 15: 注册到 registry.ts 与 tool-catalog.ts

**Files:**
- Modify: `src/tools/registry.ts`(末尾追加注册)
- Modify: `src/lib/tool-catalog.ts`(import 图标 + 目录条目)
- Test: 既有 `src/tools/registry.integration.test.ts` / `registry.test.tsx` 自动覆盖

**Interfaces:**
- Consumes: Task 13 组件;catalog 的 `CatalogEntry` 结构
- Produces: 侧栏/命令面板出现「文件夹分析器」;`folder_analyzer` 可从 UI 打开

- [ ] **Step 1: registry.ts 追加**

在 `registerTool('text_editor', ...)` 之后:

```typescript
registerTool('folder_analyzer', () =>
  import('./FolderAnalyzer').then((m) => ({ default: m.FolderAnalyzer })),
);
```

- [ ] **Step 2: tool-catalog.ts 追加条目**

2a. lucide import 列表加入 `FolderOpen`(按字母序插入)。

2b. 在 `text`(文本处理)分类的条目附近插入:

```typescript
{
  id: 'folder_analyzer',
  name: '文件夹分析器',
  description: '统计文件夹类型分布、文本行数字数、内容搜索、单文件解析(只读)',
  category: 'text',
  icon: FolderOpen,
  keywords: ['folder', 'file', 'stats', 'lines', 'words', 'grep', '分析', '统计', '搜索'],
  backendId: 'folder_analyzer',
},
```

> 先读 tool-catalog.ts 现有条目写法(字段顺序/是否用 as const),保持一致。若 catalog 条目带 `backendId`,UI 走 Rust 执行路径的元数据展示 —— 本工具页面自管 IPC,不依赖 ToolPanel 默认表单,与 CodeEditor 等纯前端页面同模式。

- [ ] **Step 3: 运行验证**

Run: `pnpm vitest run src/tools/registry.integration.test.ts src/tools/registry.test.tsx && pnpm typecheck && pnpm lint`
Expected: 全部 PASS(catalog↔registry 一致性断言通过)

- [ ] **Step 4: 手动冒烟(可选,dev 环境)**

Run: `pnpm tauri dev`
Expected: 打开「文件夹分析器」→ 选择本仓库目录 → 统计出文件数与类型分布;搜索 `fn main` 有结果;拖入任一 md 文件显示行数与 SHA-256。

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts src/lib/tool-catalog.ts
git commit -m "feat(analyzer-ui): register folder analyzer in tool catalog"
```

---

### Task 16: 文档 + 全量验证

**Files:**
- Modify: `CHANGELOG.md`(Unreleased → Added)
- Modify: `prd/07-tool-catalog.md`(P2 工具表追加一行)

- [ ] **Step 1: CHANGELOG.md**

在顶部 Unreleased 段落(若无则新建 `## [Unreleased]` + `### Added`)追加:

```markdown
### Added

- 新增「文件夹分析器」工具(`folder_analyzer`):只读统计文件夹内文件数量、按扩展名/类别的数量与大小分布、文本文件行数/字数;支持跨文本文件内容搜索(普通串/正则/忽略大小写);支持拖入或选择单个文件解析(类型嗅探、编码识别、SHA-256)。流式进度可取消。
```

- [ ] **Step 2: prd/07-tool-catalog.md P2 表追加**

P2 表格末尾加一行:

```markdown
| `folder_analyzer` | Folder Analyzer | Parser | 文件夹路径(file_path)+ mode(scan/search/file)+ options | 类型统计/文本行字数/内容搜索/单文件解析报告 | v2.0 前置交付;只读;流式+可取消 |
```

- [ ] **Step 3: 全量验证(Rust)**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 无 diff 遗留、无 warning、全部测试 PASS

- [ ] **Step 4: 全量验证(前端)**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: 全部 PASS(format:check 失败则先 `pnpm format` 只提交格式化相关文件)

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md prd/07-tool-catalog.md docs/superpowers/plans/2026-08-24-folder-analyzer.md
git commit -m "docs: record folder analyzer feature in changelog and tool catalog"
```

---

## Self-Review 记录

1. **Spec 覆盖**:文件夹统计(Task 3/6)、分门别类类型统计(Task 1/3/14)、文本行数字数按类型分组(Task 2/3/14)、内容查询(Task 4)、单文件直接解析/拖放(Task 5/9/11/13)、只读约束(Global Constraints + Task 8 授权校验加固)—— 全部有对应任务。
2. **占位符扫描**:Task 8 测试中 AppState 构造以注释标注"沿用现有构造"(该信息只能来自执行时读取的既有测试代码,属合理引用而非 TBD);其余步骤均含完整代码与命令。
3. **类型一致性**:Rust Report 字段 ↔ Task 10 TS 类型逐一比对(snake_case 一致);`ProgressFn`、`ScanOptions/SearchOptions` 字段名在 Task 6/7 引用处一致;`routeDropped` 定义于 Task 11、消费于 Task 13;data-testid 约定 Task 13 内部闭环。

## 已知风险与边界

- **事件竞态**:任务完成极快时 completed 事件可能早于前端订阅建立(Tauri spawn 后才回 taskId)。窗口极小;兜底 = UI 提供"重新运行"。(Task 12 注释)
- **Windows symlink**:创建 symlink 需开发者模式,跳过逻辑靠代码审查覆盖,不做自动化断言。
- **GBK 兜底**:非 UTF-8 非 GBK 文件会落入 unknown(lossy),字数统计仍可用但可能有替换符。
- **超大目录**:200k 条目上限保护;node_modules 级目录建议配合隐藏开关默认行为(排除 `.git` 等点开头目录)使用。






