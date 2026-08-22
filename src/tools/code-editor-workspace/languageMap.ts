/**
 * 编辑器语言 —— 快捷栏常量与扩展名推断
 *
 * 提供:
 * - `QUICK_LANGUAGES`:顶栏快速切换的常用语言列表(沿用旧单编辑器实现)
 * - `LANGUAGE_LABELS`:语言 id → 中文显示名
 * - `inferLanguageFromPath`:按文件扩展名推断 Monaco 语言 id
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

/**
 * 从绝对路径提取所在目录(去掉最后的文件名部分;兼容 Windows `\` 与 POSIX `/`)。
 * 用于「打开的编辑器」列表的描述列(VSCode 样式:名称后跟所在位置)。
 * 无分隔符(纯文件名)时返回原路径。
 */
export function dirNameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
}
