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
