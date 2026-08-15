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
];

/** 语言 id → 中文显示名 */
export const LANGUAGE_LABELS: Record<EditorLanguage, string> = Object.fromEntries(
  QUICK_LANGUAGES.map((l) => [l.id, l.label]),
) as Record<EditorLanguage, string>;

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
};

/**
 * 按扩展名推断语言。未知扩展名或未提供路径时回退 plaintext。
 * 非文本语言(py/go/rust 等 Monaco 未内置)统一回退 plaintext,不会报错。
 */
export function inferLanguageFromPath(path: string | null): EditorLanguage {
  if (!path) return 'plaintext';
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
