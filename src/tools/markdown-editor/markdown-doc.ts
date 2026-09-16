/**
 * Markdown 文档字符串层(TipTap 编辑器进出共用,无 DOM 依赖)。
 *
 * 背景:tiptap-markdown 经 markdown-it 解析,文档首部的 YAML front matter
 * 会被拆成 hr + 标题(实测见 tiptap-spike.test.ts),属于数据破坏。
 * 因此编辑器加载前剥离、序列化保存时原样贴回;编辑器内永远只见正文。
 */

export interface FrontMatterSplit {
  /** 正文(无 front matter 头) */
  body: string;
  /** 原始 front matter 块(含首尾 --- 行与换行),无则为 null */
  fence: string | null;
}

/**
 * 剥离文档首部的 YAML front matter。
 * 仅首行是 --- 才生效;闭合行找下一个整行 ---/...(允许 3 空格缩进)。
 */
export function splitFrontMatter(source: string): FrontMatterSplit {
  if (!/^---[ \t]*\r?\n/.test(source)) return { body: source, fence: null };
  const lines = source.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^ {0,3}(---|\.\.\.)[ \t]*$/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  if (end === -1) return { body: source, fence: null };
  return {
    body: lines.slice(end + 1).join('\n'),
    fence: lines.slice(0, end + 1).join('\n'),
  };
}

/** 序列化结果贴回 front matter(无 fence 原样返回)。 */
export function joinFrontMatter(fence: string | null, body: string): string {
  if (!fence) return body;
  return body ? `${fence}\n${body}` : `${fence}\n`;
}
