/**
 * Regex Lab 类型定义 —— 前端与 Rust regex_lab 命令的契约(手写镜像,序列化为 camelCase)
 */

/** 编译错误(含位置) */
export interface RegexCompileError {
  column: number;
  title: string;
  message: string;
}

/** 单个匹配项 */
export interface RegexMatchInfo {
  index: number;
  text: string;
  range: [number, number];
  groups: Array<{
    text: string;
    start: number;
    end: number;
  } | null>;
  namedGroups: Array<{
    name: string;
    text: string;
    start: number;
    end: number;
  }>;
}

/** 解释树节点 */
export interface RegexExplainNode {
  token: string;
  title: string;
  description: string;
  span: [number, number];
  children: RegexExplainNode[];
  quantifiable: boolean;
}

/** 分组清单条目 */
export interface RegexGroupEntry {
  index: number;
  name: string;
}

/** regex_live 响应 */
export interface RegexLiveOutput {
  ok: boolean;
  compileError: RegexCompileError | null;
  matches: RegexMatchInfo[];
  matchCount: number;
  /** 测试文本超出护栏被截断(仅预览前 1MB) */
  truncatedText: boolean;
  /** 匹配条目超出上限被截断(count 保留真实值) */
  matchesTruncated: boolean;
  substitutionResult: string | null;
  explain: RegexExplainNode[];
  groups: RegexGroupEntry[];
  durationMs: number;
}

/** regex_live 请求 */
export interface RegexLiveInput {
  pattern: string;
  flags: string;
  testText: string;
  substitution: string;
}

/** 单元测试用例 */
export interface RegexTestCase {
  description: string;
  text: string;
  shouldMatch: boolean;
  expectedMatch?: string | null;
  expectedGroups?: Array<string | null>;
}

/** 单测结果 */
export interface RegexTestResult {
  description: string;
  passed: boolean;
  reason: string;
}

export interface RegexTestsOutput {
  ok: boolean;
  compileError: RegexCompileError | null;
  results: RegexTestResult[];
  passed: number;
  failed: number;
}

/** 代码生成语言 */
export type CodegenLanguage = 'rust' | 'javascript' | 'python' | 'java' | 'csharp' | 'go';

export interface CodegenOutput {
  language: string;
  code: string;
}

/** 调试回放步骤 */
export interface RegexDebugStep {
  start: number;
  outcome: 'match' | 'fail' | string;
  end: number | null;
  matchedText: string | null;
}

export interface RegexDebugOutput {
  ok: boolean;
  compileError: RegexCompileError | null;
  steps: RegexDebugStep[];
  matchCount: number;
}

/** 工作区模式(regex101 的 Editor 页签) */
export type RegexMode = 'match' | 'substitution' | 'tests' | 'tools';
