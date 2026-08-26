/**
 * 工具错误格式化共享实现(Phase 4 收口)。
 *
 * 统一此前 7 个工具各自的本地 formatError:
 * - CommandError:剥离 Rust ToolError 的 Display 英文前缀(与 code 语义重复),
 *   保留 `CODE: 正文`;非 CommandError 的 Error 取 message,其余 String()
 * - 可选 prefix 由调用方传入(经 i18n 后的中文前缀),直接拼接在正文之前
 */
import { CommandError } from '@/lib/ipc';

/** Rust ToolError 的 Display 前缀 */
const RUST_ERROR_PREFIXES: readonly string[] = [
  'parse failed: ',
  'invalid input: ',
  'internal error: ',
  'input too large: ',
  'tool not found: ',
  'timeout after ',
  'out of memory: ',
];

export function formatError(e: unknown, prefix?: string): string {
  let body: string;
  if (e instanceof CommandError) {
    let message = e.message;
    for (const p of RUST_ERROR_PREFIXES) {
      if (message.startsWith(p)) {
        message = message.slice(p.length);
        break;
      }
    }
    body = e.code ? `${e.code}: ${message}` : message;
  } else if (e instanceof Error) {
    body = e.message;
  } else {
    body = String(e);
  }
  return prefix ? `${prefix}${body}` : body;
}
