/**
 * 编辑器语言 —— 快捷栏常量与扩展名推断
 *
 * 提供:
 * - `QUICK_LANGUAGES`:顶栏快速切换的常用语言列表(沿用旧单编辑器实现)
 * - `LANGUAGE_LABELS`:语言 id → 中文显示名
 * - `inferLanguageFromPath`:按文件扩展名推断 Monaco 语言 id
 * - `detectLanguageFromContent`:按内容特征识别语言(自动检测模式,无路径 Tab 用)
 */
import type { EditorLanguage } from '@/components/ui/code-editor';

/** 顶栏快捷语言列表(与 EditorLanguage 对齐) */
export const QUICK_LANGUAGES: ReadonlyArray<{ id: EditorLanguage; label: string }> = [
  { id: 'plaintext', label: '纯文本' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'sql', label: 'SQL' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'xml', label: 'XML' },
  { id: 'ini', label: 'INI' },
  { id: 'shell', label: 'Shell' },
  { id: 'diff', label: 'Diff' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'dart', label: 'Dart' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'lua', label: 'Lua' },
  { id: 'r', label: 'R' },
  { id: 'perl', label: 'Perl' },
  { id: 'scala', label: 'Scala' },
  { id: 'objective-c', label: 'Objective-C' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'hcl', label: 'Terraform' },
  { id: 'bat', label: 'Batch' },
  { id: 'fsharp', label: 'F#' },
  { id: 'julia', label: 'Julia' },
  { id: 'proto', label: 'Protocol Buffers' },
  { id: 'pascal', label: 'Pascal' },
  { id: 'vb', label: 'Visual Basic' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'elixir', label: 'Elixir' },
];

/** 语言 id → 中文显示名 */
export const LANGUAGE_LABELS: Record<EditorLanguage, string> = Object.fromEntries(
  QUICK_LANGUAGES.map((l) => [l.id, l.label]),
) as Record<EditorLanguage, string>;

/** 特殊文件名(无扩展名,basename 小写)→ Monaco 语言 id */
const FILENAME_TO_LANG: Readonly<Record<string, EditorLanguage>> = {
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  makefile: 'shell',
  'cmakelists.txt': 'shell',
  justfile: 'shell',
};

/** 扩展名(含点,小写)→ Monaco 语言 id */
const EXT_TO_LANG: Readonly<Record<string, EditorLanguage>> = {
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.xml': 'xml',
  '.svg': 'xml',
  '.ini': 'ini',
  '.conf': 'ini',
  '.cfg': 'ini',
  '.properties': 'ini',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.diff': 'diff',
  '.patch': 'diff',
  '.rs': 'rust',
  '.rlib': 'rust',
  '.go': 'go',
  '.py': 'python',
  '.pyw': 'python',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.csx': 'csharp',
  '.cake': 'csharp',
  '.php': 'php',
  '.php4': 'php',
  '.php5': 'php',
  '.phtml': 'php',
  '.ctp': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.rb': 'ruby',
  '.rbx': 'ruby',
  '.rjs': 'ruby',
  '.gemspec': 'ruby',
  '.lua': 'lua',
  '.r': 'r',
  '.rmd': 'r',
  '.rhistory': 'r',
  '.rprofile': 'r',
  '.pl': 'perl',
  '.pm': 'perl',
  '.scala': 'scala',
  '.sc': 'scala',
  '.sbt': 'scala',
  '.m': 'objective-c',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.tf': 'hcl',
  '.tfvars': 'hcl',
  '.hcl': 'hcl',
  '.bat': 'bat',
  '.cmd': 'bat',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.ml': 'fsharp',
  '.mli': 'fsharp',
  '.jl': 'julia',
  '.proto': 'proto',
  '.pas': 'pascal',
  '.p': 'pascal',
  '.vb': 'vb',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.ex': 'elixir',
  '.exs': 'elixir',
};

/**
 * 按文件类型推断语言。优先级:
 * 1. 特殊文件名(Dockerfile / Gemfile / Rakefile / Makefile 等无扩展名文件)
 * 2. 扩展名(含点,小写)
 * 未知类型或未提供路径时回退 plaintext。
 * 覆盖 Monaco 0.56 内置的语言 id(含 C/C++/Rust/Go/Python/Java/C# 等 42 种)。
 */
export function inferLanguageFromPath(path: string | null): EditorLanguage {
  if (!path) return 'plaintext';
  const filename = fileNameFromPath(path).toLowerCase();
  const byName = FILENAME_TO_LANG[filename];
  if (byName) return byName;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = path.slice(dot).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

/** 从绝对路径提取文件名(兼容 Windows `\` 与 POSIX `/`) */
export function fileNameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 内容识别的扫描上限(只看开头片段,避免大文件每次编辑全量扫描) */
const CONTENT_SNIFF_LIMIT = 2000;

/**
 * 按内容特征识别语言(「自动检测」模式用,主要服务于无路径的未命名 Tab):
 * shebang → JSON → diff → HTML/XML → Dockerfile → INI → YAML → Markdown → SQL → 常规编程语言。
 * 识别失败返回 null(调用方保留当前语言 / 回退 plaintext)。
 * 有路径的文件以 `inferLanguageFromPath` 为准,内容识别仅在自动模式下兜底。
 */
export function detectLanguageFromContent(content: string): EditorLanguage | null {
  const head = content.slice(0, CONTENT_SNIFF_LIMIT);
  const trimmed = head.trimStart();
  if (!trimmed) return null;

  // 1. shebang:按解释器路径细分,识别不出具体语言时归 shell
  if (trimmed.startsWith('#!')) {
    const firstLine = trimmed.split('\n', 1)[0] ?? '';
    if (/pwsh|powershell/i.test(firstLine)) return 'powershell';
    if (/python/.test(firstLine)) return 'python';
    if (/perl/.test(firstLine)) return 'perl';
    if (/ruby/.test(firstLine)) return 'ruby';
    if (/node/.test(firstLine)) return 'javascript';
    return 'shell';
  }

  // 2. JSON:以 { / [ 开头且整体可解析;解析失败时(带注释 / 尾逗号 /
  //    截断的 JSON)用「引号键名 "key": 」特征宽松兜底——JS 对象字面量的
  //    键不带引号,不会误判
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(content);
      return 'json';
    } catch {
      if (/"[^"\n]+"\s*:/m.test(head)) return 'json';
    }
  }

  // 3. diff:git diff 头 / --- +++ 对 / @@ hunk 头
  if (/^diff --git /m.test(head) || (/^--- \S/m.test(head) && /^\+\+\+ \S/m.test(head))) {
    return 'diff';
  }

  // 4. HTML / XML
  if (trimmed.startsWith('<')) {
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
    if (/^<\?xml/i.test(trimmed) || /<\/[a-zA-Z][\w.:-]*>/.test(head)) return 'xml';
  }

  // 5. Dockerfile:FROM 指令 + 任一典型构建指令
  if (/^FROM \S+/m.test(head) && /^(RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV)\s/m.test(head)) {
    return 'dockerfile';
  }

  // 6. INI:小节头 [name] + key=value 行
  if (/^\[[^\]\n]+\]\s*$/m.test(head) && /^[^[\s][^\n=]*=/m.test(head)) return 'ini';

  // 7. YAML:文档分隔符,或至少两行「key: value」顶层键值
  const yamlKeyLines = head.match(/^[A-Za-z_][\w.-]*:\s+\S/gm)?.length ?? 0;
  if (/^---\s*$/m.test(head) || yamlKeyLines >= 2) return 'yaml';

  // 8. Markdown:标题 / 围栏代码块 / 任务列表
  if (/^#{1,6} \S/m.test(head) || /^```/m.test(head) || /^[-*+] \[[ xX]\] /m.test(head)) {
    return 'markdown';
  }

  // 9. SQL:典型 DML / DDL 语句
  if (
    /\bSELECT\b[\s\S]{0,200}?\bFROM\b/i.test(head) ||
    /\bCREATE\s+(TABLE|VIEW|INDEX)\b/i.test(head) ||
    /\bINSERT\s+INTO\s+\w+/i.test(head)
  ) {
    return 'sql';
  }

  // 10. C#:using / namespace + 类型声明(file-scoped 或 block-scoped)
  if (
    (/^using\s+[\w.]+;/m.test(head) || /^\s*namespace\s+[\w.]+\s*(?:;|\{)/m.test(head)) &&
    /^\s*(?:public\s+|internal\s+|sealed\s+|abstract\s+|static\s+)*(class|interface|record|struct|enum)\s+\w+/m.test(
      head,
    )
  ) {
    return 'csharp';
  }

  // 11. Go:package 声明 + import 块 / func 定义
  if (/^package\s+\w+/m.test(head) && (/^import\s+\(/m.test(head) || /^func\s+\w+\(/m.test(head))) {
    return 'go';
  }

  // 12. Rust:use 路径 + fn 定义,或 Cargo 风格宏
  if (/^use\s+[\w:]+;/m.test(head) && /^fn\s+\w+/m.test(head)) return 'rust';
  if (/^fn\s+main\(\)/m.test(head) && /println!/.test(head)) return 'rust';

  // 13. Python:函数定义 + 缩进主体 / 模块入口
  if (/^def\s+\w+\(.*\)\s*(?::.*?)?$/m.test(head) && /^\s+(?:return|pass|print)\b/m.test(head)) {
    return 'python';
  }
  if (/^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(head)) return 'python';

  // 14. PHP
  if (trimmed.startsWith('<?php')) return 'php';

  // 15. Swift / Kotlin / Dart:import + 各自声明特征
  if (/^import\s+\w/m.test(head) && /^\s*(?:struct|class)\s+\w+\s*(?::\s*[^{]+)?\{/m.test(head)) {
    return 'swift';
  }
  if (/^fun\s+\w+\(/m.test(head) || /^\s*fun\s+\w+\(/m.test(head)) return 'kotlin';
  if (/^void\s+main\(\)\s*\{/m.test(head)) return 'dart';

  // 16. C/C++:include + 标准输出;C++ 命名空间/iostream 优先,否则按 stdio 判 C
  if (/^#\s*include\s*[<"]/.test(head) && /^int\s+main\s*\(/m.test(head)) {
    if (/std::|iostream|#\s*include\s*[<"]iostream[">]/.test(head)) return 'cpp';
    if (/printf\s*\(/.test(head)) return 'c';
  }

  // 17. TypeScript / JavaScript:类型注解优先,再回退 ESM + 现代语法
  if (/:\s*(?:string|number|boolean)\b/.test(head) && /\bfunction\s+\w+\(/.test(head)) {
    return 'typescript';
  }
  if (
    (/^import\s+[^;]+from\s+['"][^'"]+['"];?/m.test(head) ||
      /^export\s+(?:default\s+)?(?:function|const|class)\b/m.test(head)) &&
    (/\basync\s+function\b/.test(head) || /`[^`]*`/.test(head))
  ) {
    return 'javascript';
  }

  // 18. Java:package/import + 类型声明的组合特征,或显式 public 类型声明
  if (
    (/^package\s+[\w.]+\s*;/m.test(head) || /^import\s+(?:static\s+)?[\w.*]+;/m.test(head)) &&
    /^\s*(?:public\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+)*(class|interface|enum|record)\s+\w+/m.test(
      head,
    )
  ) {
    return 'java';
  }
  if (/^\s*public\s+(class|interface|enum|record)\s+\w+/m.test(head)) return 'java';

  return null;
}

/**
 * 从绝对路径提取所在目录(去掉最后的文件名部分;兼容 Windows `\` 与 POSIX `/`)。
 * 用于「打开的编辑器」列表的描述列(VSCode 样式:名称后跟所在位置)。
 * 无分隔符(纯文件名)时返回原路径。
 */
export function dirNameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
}
