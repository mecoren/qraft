const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[),.;:!?'\]]+$/;

/** 返回覆盖指定列(1-based)的 http/https URL;没有则返回 null */
export function findHttpUrlAtPosition(line: string, column: number): string | null {
  const position = column - 1;
  HTTP_URL_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = HTTP_URL_PATTERN.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position >= start && position < end) {
      const url = match[0].replace(TRAILING_PUNCTUATION, '');
      HTTP_URL_PATTERN.lastIndex = 0;
      return HTTP_URL_PATTERN.test(url) ? url : null;
    }
    if (position < end) return null;
  }
  return null;
}
