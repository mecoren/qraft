/**
 * 文本统计纯函数:与组件分离(避免 react-refresh 混合导出警告)。
 */
export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  bytes: number;
}

/** 纯函数统计:字符/去空白字符/词数/行数/UTF-8 字节数 */
export function computeStats(text: string): TextStats {
  const withoutTrailingNewline = text.replace(/\n$/, '');
  return {
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    words: (text.match(/\S+/g) ?? []).length,
    lines: withoutTrailingNewline === '' ? 0 : withoutTrailingNewline.split('\n').length,
    bytes: new TextEncoder().encode(text).length,
  };
}
