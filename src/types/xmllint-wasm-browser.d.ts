/**
 * xmllint-wasm 浏览器版类型声明
 * (包只提供 index-browser.d.ts 但未在 package.json types 字段映射 .mjs 入口)
 */

declare module 'xmllint-wasm/index-browser.mjs' {
  export interface XMLLintValidationError {
    rawMessage: string;
    message: string;
    loc: { fileName: string; lineNumber: number } | null;
  }

  export interface XMLLintValidationResult {
    valid: boolean;
    normalized: string;
    errors: readonly XMLLintValidationError[];
    rawOutput: string;
  }

  export function validateXML(options: {
    xml: Array<{ fileName: string; contents: string | Uint8Array }>;
    schema: Array<{ fileName: string; contents: string | Uint8Array }>;
    preload?: Array<{ fileName: string; contents: string | Uint8Array }>;
    initialMemoryPages?: number;
    maxMemoryPages?: number;
  }): Promise<XMLLintValidationResult>;
}
