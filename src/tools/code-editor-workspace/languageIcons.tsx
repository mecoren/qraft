/**
 * 语言模式图标 —— 语言 id → Material Icon Theme 图标
 *
 * 复用文件图标主题的 SVG 资源(与 FileIcon 同源),用于:
 * - 状态栏右下角语言徽章(仿 VSCode)
 * - 「选择语言模式」对话框列表项
 */
import type { JSX } from 'react';
import type { EditorLanguage } from '@/components/ui/code-editor';
import { cn } from '@/lib/utils';
import { FILE_ICON_SRCS, type FileIconName } from './fileIcons';

/** 语言 id → 图标名(material-icon-theme 中最贴近的语言/文件图标) */
const LANGUAGE_ICON_NAMES: Readonly<Record<EditorLanguage, FileIconName>> = {
  plaintext: 'file',
  json: 'json',
  html: 'html',
  css: 'css',
  javascript: 'javascript',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  markdown: 'markdown',
  sql: 'database',
  ini: 'settings',
  shell: 'console',
  diff: 'git',
  rust: 'rust',
  go: 'go',
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  dart: 'dart',
  ruby: 'ruby',
  lua: 'lua',
  r: 'r',
  perl: 'perl',
  scala: 'scala',
  'objective-c': 'objective-c',
  powershell: 'powershell',
  dockerfile: 'docker',
  graphql: 'graphql',
  hcl: 'terraform',
  bat: 'console',
  fsharp: 'fsharp',
  julia: 'julia',
  proto: 'proto',
  pascal: 'pascal',
  vb: 'word',
  clojure: 'clojure',
  elixir: 'elixir',
};

/** 获取语言对应的图标名 */
export function getLanguageIconName(language: EditorLanguage): FileIconName {
  return LANGUAGE_ICON_NAMES[language] ?? 'file';
}

/** 语言图标组件:按语言 id 渲染对应 SVG */
export function LanguageIcon({
  language,
  className,
}: {
  language: EditorLanguage;
  /** 覆盖默认尺寸(size-3.5) */
  className?: string;
}): JSX.Element {
  return (
    <img
      src={FILE_ICON_SRCS[getLanguageIconName(language)]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('size-3.5 shrink-0 object-contain', className)}
    />
  );
}
