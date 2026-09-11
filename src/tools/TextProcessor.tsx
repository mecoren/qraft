/**
 * 文本处理工具
 *
 * 整体布局参考 SQL 格式化器:`配置` 区域(ConfigSection)上方一行,
 * 输入/输出区(CodeEditor × 2) 占据下方主体。本工具把常用文本转换与
 * 「文本分析和实用工具」的统计 / 大小写 / 行重组功能合并,集中在一个
 * ButtonGroup 中,样式与 SQL 选择控件一致(描边按钮 +
 * 共用边框 + 首尾圆角 + 中间无缝拼接)。
 *
 * 设计说明:
 * - 所有转换均为纯前端同步操作,无需调用 Rust 后端。
 * - 按钮按功能拆成逻辑组;同一组的转换(操作相近、互为反操作)
 *   放进同一个内层 ButtonGroup 让它们紧密拼接、相邻组之间通过外层
 *   ButtonGroup 的 flex `gap-2` 留白(参考 shadcn ButtonGroup 嵌套用法)。
 * - 点击转换按钮把 **输入** 的转换结果写入 **输出框**,输入保持原值不动;
 *   输出框的「作为输入」按钮可把输出回填到输入,实现多步流水线
 *   (escape → 回填 → 去空格,无需复制粘贴)。
 * - 配置行采用 `ConfigSection > ConfigRow(左 label/hint + 右 ButtonGroup 嵌套)`,
 *   与 SQL 格式化器保持一致;宽按钮组在控件列内自动换行,不挤压左侧提示。
 */
import { useCallback, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownNarrowWide,
  ArrowDownWideNarrow,
  BarChart3,
  Binary,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  ChevronsDown,
  ChevronsUp,
  Copy,
  CopyX,
  CornerDownLeft,
  Eraser,
  Link2,
  Link2Off,
  Languages,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Replace,
  ScanSearch,
  Search,
  Shuffle,
  TextQuote,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { SendToMenu } from '@/components/send-to-menu';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { toast } from 'sonner';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { camelCase, constantCase, kebabCase, pascalCase, snakeCase } from '@/lib/naming-convention';
import {
  applyFindReplace,
  extractPattern,
  wordFrequency,
  addPrefixSuffix,
  fullWidthToAscii,
  numberLines,
  removeConsecutiveDuplicateLines,
  removeLinesContaining,
  EXTRACT_PRESETS,
  type ExtractPresetId,
} from '@/lib/text-ops';
import type { ToolProps } from './registry';

// ============================================================
// 文本转换函数(纯前端同步实现,模块顶部导出,便于将来复用与单测)
// ============================================================

/**
 * 转义控制字符(\\ " ' 换行 回车 制表符 等) → 反斜杠序列。
 */
export function escapeText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
    .replace(/[\b]/g, '\\b')
    .replace(/\v/g, '\\v')
    .replace(/\0/g, '\\0');
}

/** 单字符转义序列 → 真实字符(与 escapeText 的输出一一对应;另支持 JSON 常见的 \/) */
const UNESCAPE_SIMPLE_MAP: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  b: '\b',
  v: '\v',
  '0': '\0',
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
};

/**
 * 去除转义:escapeText 的逆操作,把反斜杠转义序列还原为真实字符。
 * 除 escapeText 产生的全部序列外,还支持 \xNN 与 \uXXXX(含代理对拼接,
 * 如 \uD83D\uDE00 → 😀);无法识别的序列(如 \d)与结尾孤立反斜杠原样保留。
 */
export function unescapeText(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = input[i + 1];
    if (next === undefined) {
      // 结尾孤立反斜杠:无后续字符可转义,原样保留
      out += '\\';
      break;
    }
    i += 1;
    if (next === 'u' || next === 'x') {
      const width = next === 'u' ? 4 : 2;
      const hex = input.slice(i + 1, i + 1 + width);
      if (hex.length === width && /^[0-9a-fA-F]+$/.test(hex)) {
        i += width;
        // 代理对(\uD83D\uDE00)按 UTF-16 码元逐个拼接,自然组成完整字符
        out += String.fromCharCode(parseInt(hex, 16));
        continue;
      }
      // 十六进制位数不足:视为普通文本原样保留
      out += `\\${next}`;
      continue;
    }
    const mapped = UNESCAPE_SIMPLE_MAP[next];
    // 未知转义序列:反斜杠与字符原样保留,不猜测用户意图
    out += mapped !== undefined ? mapped : `\\${next}`;
  }
  return out;
}

/** 移除全部空白(空格、Tab、换行、回车等) */
export function stripWhitespace(input: string): string {
  return input.replace(/\s+/g, '');
}

/** URL 编码(使用 encodeURIComponent 以覆盖 : / ? # 等保留字符) */
export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

/**
 * 整 URL 编码(encodeURI 语义):保留 URL 结构字符(: / ? # & = @ 等),
 * 仅编码中文、空格等不安全字符;适用于完整链接,区别于组件编码。
 */
export function urlEncodeUri(input: string): string {
  return encodeURI(input);
}

/**
 * URL 解码:先按 form-urlencoded 语义把 `+` 还原为空格,再做 percent 解码
 * (对畸形输入抛出 URIError)。
 *
 * `+` 表示空格是 application/x-www-form-urlencoded 的约定(query string 常见
 * 形态),decodeURIComponent 本身不处理。规则:
 * - 输入含首个 `?` 时,仅 `?` 之后的 `+` 还原为空格——path 里的字面 `+`
 *   (如 `/c++/faq`)保持原样;
 * - 输入不含 `?` 时视为裸 query / 表单文本,全文 `+` 还原为空格;
 * - `+` 替换发生在 percent 解码之前,`%2B` 仍能解出字面 `+`。
 */
export function urlDecode(input: string): string {
  const qIndex = input.indexOf('?');
  const head = qIndex === -1 ? '' : input.slice(0, qIndex + 1);
  const tail = qIndex === -1 ? input : input.slice(qIndex + 1);
  const plusToSpace = tail.replace(/\+/g, ' ');
  return decodeURIComponent(head + plusToSpace);
}

/**
 * Unicode 转中文:\\uXXXX 形式的转义序列 → 实际字符。
 * 仅支持 BMP 内的 4 位十六进制转义;不支持代理对。
 */
export function unicodeToChinese(input: string): string {
  return input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * 中文 / 全角字符 → \\uXXXX 转义序列。
 * 范围:CJK 统一汉字(4E00-9FFF)、CJK 部首扩展(3400-4DBF)、
 * CJK 符号和标点(3000-303F)、全角 ASCII(FF00-FFEF);超出 BMP 用代理对转义。
 */
export function chineseToUnicode(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code > 127) {
      if (code <= 0xffff) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      } else {
        // 代理对:拆成两个 4 位转义
        const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
        const low = ((code - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** 全角中文标点 → 对应半角英文符号;空白/不可识别的字符保持原样 */
const CN_SYMBOL_MAP: Record<string, string> = {
  '，': ',',
  '。': '.',
  '、': ',',
  '；': ';',
  '：': ':',
  '！': '!',
  '？': '?',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '「': '[',
  '」': ']',
  '『': '[',
  '』': ']',
  '《': '<',
  '》': '>',
  '〈': '<',
  '〉': '>',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  '—': '-',
  '·': '.',
  '～': '~',
  '\u3000': ' ',
};

export function chineseSymbolToEnglish(input: string): string {
  return input.replace(
    /[，。、；：！？（）【】「」『』《》〈〉“”‘’…—·～\u3000]/g,
    (ch) => CN_SYMBOL_MAP[ch] ?? ch,
  );
}

/** 全部转为大写 */
export function toUpperCase(input: string): string {
  return input.toUpperCase();
}

/** 全部转为小写 */
export function toLowerCase(input: string): string {
  return input.toLowerCase();
}

/** 句首大写:每段每句首字母大写,其余小写 */
export function capitalizeSentences(input: string): string {
  return input.replace(
    /(^|[.!?。！？\n]\s*)([a-z\u00DF-\u00FF])/g,
    (_m, pre: string, ch: string) => pre + ch.toUpperCase(),
  );
}

/** 词首大写:每个单词首字母大写,其余小写 */
export function capitalizeWords(input: string): string {
  return input.replace(/\b([a-z\u00DF-\u00FF]+)\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** 反转文本(按 Unicode 码点,支持 emoji / 代理对) */
export function reverseText(input: string): string {
  return Array.from(input).reverse().join('');
}

/** 去除重复行(保留出现顺序,空行一并去重) */
export function uniqueLines(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of input.split('\n')) {
    const key = line.trim();
    if (key === '') {
      out.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n');
}

/** 按字典序排序所有行(保留原有换行结尾) */
export function sortLines(input: string): string {
  const lines = input.split('\n');
  const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  lines.sort((a, b) => a.localeCompare(b));
  return endsWithNewline ? lines.join('\n') + '\n' : lines.join('\n');
}

// ============================================================
// 行清理 / 命名风格 / 排序变体(竞品对齐批次,纯函数同上)
// ============================================================

/**
 * 统一按 LF 拆行并保留「是否以换行结尾」形状。
 * 供行级操作族共享 CRLF 兼容语义(行尾不残留 \r)。
 */
function splitLinesKeepShape(text: string): { lines: string[]; endsWithNewline: boolean } {
  if (text === '') return { lines: [], endsWithNewline: false };
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

function joinKeepShape(lines: string[], endsWithNewline: boolean): string {
  return endsWithNewline ? lines.join('\n') + '\n' : lines.join('\n');
}

/** 去除每行行首与行尾空白(空格、Tab 等;CRLF 安全) */
export function trimLines(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  return joinKeepShape(
    lines.map((l) => l.trim()),
    endsWithNewline,
  );
}

/** 删除全部空行(仅空白的行视为空行;保留结尾换行形状) */
export function removeEmptyLines(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  return joinKeepShape(
    lines.filter((l) => l.trim() !== ''),
    endsWithNewline,
  );
}

/** 移除换行符:换行(含 CRLF)替换为单个空格,连续换行合并为一个空格 */
export function removeLineBreaks(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim();
}

/** LF → CRLF(先把 CRLF 归一再统一替换,避免 CR 重复) */
export function toCrlf(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

/** CRLF → LF */
export function toLf(input: string): string {
  return input.replace(/\r\n/g, '\n');
}

/** 行序反转:行的顺序倒排,每行内容不变(区别于字符级反转) */
export function reverseLines(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  return joinKeepShape([...lines].reverse(), endsWithNewline);
}

/** 按字典序降序排序所有行(与 sortLines 同形状语义) */
export function sortLinesDesc(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  lines.sort((a, b) => b.localeCompare(a));
  return joinKeepShape(lines, endsWithNewline);
}

/**
 * 自然排序:行内嵌入数字按数值比较(file2 < file10),无数字段退化为字典序。
 * 按「数字块 / 非数字块」切分逐块比较;大小写按 locale 字典序。
 */
export function naturalSortLines(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  const chunk = (s: string): string[] => s.split(/(\d+)/);
  const cmpChunk = (a: string, b: string): number => {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) - Number(b) || a.localeCompare(b);
    return a.localeCompare(b);
  };
  lines.sort((a, b) => {
    const ca = chunk(a);
    const cb = chunk(b);
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
      const c = cmpChunk(ca[i]!, cb[i]!);
      if (c !== 0) return c;
    }
    return ca.length - cb.length;
  });
  return joinKeepShape(lines, endsWithNewline);
}

/** 大小写互换:大写变小写、小写变大写(与 Sublime / N++ 的 Swap Case 对齐) */
export function swapCase(input: string): string {
  return input.replace(/\p{L}/gu, (ch) =>
    ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(),
  );
}

/** 行洗牌:Fisher-Yates 随机打乱行的顺序(保持行集合不变) */
export function shuffleLines(input: string): string {
  const { lines, endsWithNewline } = splitLinesKeepShape(input);
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lines[i], lines[j]] = [lines[j]!, lines[i]!];
  }
  return joinKeepShape(lines, endsWithNewline);
}

// ============================================================
// 编辑器底部统计(独立模块,供 EditorStats 与将来的单元测试复用)
// ============================================================
/**
 * 紧凑统计口径(沿用「文本分析和实用工具」):
 * 字符(Unicode 码点)、去空白字符(剔除空白后的码点数)、单词(非空白连续片段)、
 * 行(以 \n 分隔)、字节(UTF-8 编码长度)、
 * 句子(以 .!?。！？ 结尾的片段)、段落(连续空行分隔的非空块)。
 *
 * 返回有序元组,供 EditorStats 用中点分隔紧凑渲染,
 * 同时避免在 JSX 内做重复计算。
 */
export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
}

export const EMPTY_STATS: TextStats = {
  chars: 0,
  charsNoSpaces: 0,
  words: 0,
  lines: 0,
  bytes: 0,
  sentences: 0,
  paragraphs: 0,
};

export function computeStats(input: string): TextStats {
  if (!input) return EMPTY_STATS;
  // 统一按 Unicode 码点计数:emoji 等代理对只算 1 个字符,与 chars 口径一致
  const codePoints = Array.from(input);
  return {
    chars: codePoints.length,
    charsNoSpaces: codePoints.filter((ch) => !/\s/.test(ch)).length,
    words: (input.match(/[^\s]+/g) ?? []).length,
    lines: input.split('\n').length,
    bytes: new TextEncoder().encode(input).length,
    sentences: (input.match(/[^.!?。！？]+[.!?。！？]+/g) ?? []).length,
    paragraphs: input.split(/\n{2,}/).filter((p) => p.trim().length > 0).length,
  };
}

/**
 * 编辑器底部状态栏右侧用的紧凑统计:
 * - 中点「·」分隔各项,沿用 Editor 内置 statusBar 的 text-xs / tabular-nums,
 *   与编辑器自带「字符数 / 行号列号」视觉权重一致,不会喧宾夺主。
 * - 该组件作为 CodeEditor.statusBarRight 渲染,自动位于状态栏右侧,与 VS Code 风格一致。
 * - 末尾附复制按钮:把全部统计指标按「标签: 数值」逐行写入剪贴板,
 *   复用 copyTextWithFeedback(成功 toast + 失败报错),替代原独立统计工具的复制能力。
 */
function EditorStats({ text }: { text: string }): JSX.Element {
  const { t } = useTranslation();
  const s = computeStats(text);
  // 复制用的汇总文本:每行「标签: 数值」,便于粘贴到笔记或报告
  const summary = [
    `${t('tools.json_minifier.stat_chars')}: ${s.chars}`,
    `${t('tools.json_minifier.stat_chars_no_spaces')}: ${s.charsNoSpaces}`,
    `${t('tools.json_minifier.stat_words')}: ${s.words}`,
    `${t('tools.json_minifier.stat_lines')}: ${s.lines}`,
    `${t('tools.json_minifier.stat_bytes')}: ${s.bytes}`,
    `${t('tools.json_minifier.stat_sentences')}: ${s.sentences}`,
    `${t('tools.json_minifier.stat_paragraphs')}: ${s.paragraphs}`,
  ].join('\n');
  return (
    <span className="flex items-center gap-1" data-testid="textproc-editor-stats">
      <span
        className="whitespace-nowrap tabular-nums text-muted-foreground"
        title={t('tools.json_minifier.stats_tooltip', {
          chars: s.chars,
          charsNoSpaces: s.charsNoSpaces,
          words: s.words,
          lines: s.lines,
          bytes: s.bytes,
          sentences: s.sentences,
          paragraphs: s.paragraphs,
        })}
      >
        <span data-testid="textproc-stat-chars">{s.chars}</span>{' '}
        {t('tools.json_minifier.stat_chars')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-chars-no-spaces">{s.charsNoSpaces}</span>{' '}
        {t('tools.json_minifier.stat_chars_no_spaces')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-words">{s.words}</span>{' '}
        {t('tools.json_minifier.stat_words')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-lines">{s.lines}</span>{' '}
        {t('tools.json_minifier.stat_lines')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-bytes">{s.bytes}</span>{' '}
        {t('tools.json_minifier.stat_bytes')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-sentences">{s.sentences}</span>{' '}
        {t('tools.json_minifier.stat_sentences')}
        <span aria-hidden> · </span>
        <span data-testid="textproc-stat-paragraphs">{s.paragraphs}</span>{' '}
        {t('tools.json_minifier.stat_paragraphs')}
      </span>
      <button
        type="button"
        data-testid="textproc-stats-copy"
        title={t('tools.json_minifier.copy_stats')}
        aria-label={t('tools.json_minifier.copy_stats')}
        onClick={() => {
          void copyTextWithFeedback(summary);
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Copy aria-hidden className="size-3" />
      </button>
    </span>
  );
}

// ============================================================
// UI 组件
// ============================================================

type TransformId =
  | 'escape'
  | 'unescape'
  | 'stripWhitespace'
  | 'urlEncode'
  | 'urlEncodeUri'
  | 'urlDecode'
  | 'unicodeToChinese'
  | 'chineseToUnicode'
  | 'chineseSymbolToEnglish'
  | 'toUpperCase'
  | 'toLowerCase'
  | 'capitalizeSentences'
  | 'capitalizeWords'
  | 'reverseText'
  | 'uniqueLines'
  | 'sortLines'
  | 'camelCase'
  | 'pascalCase'
  | 'snakeCase'
  | 'kebabCase'
  | 'constantCase'
  | 'trimLines'
  | 'removeEmptyLines'
  | 'removeLineBreaks'
  | 'toCrlf'
  | 'toLf'
  | 'sortLinesDesc'
  | 'naturalSortLines'
  | 'reverseLines'
  | 'shuffleLines'
  | 'swapCase'
  | 'fullWidthToAscii'
  | 'removeConsecutiveDuplicates';

/** 单个转换的配置(label 存 i18n 键名,由组件层翻译,保证语言切换即生效) */
interface TransformDef {
  id: TransformId;
  labelKey: string;
  Icon: typeof Quote;
  apply: (input: string) => string;
}

const TRANSFORMS: readonly TransformDef[] = [
  { id: 'escape', labelKey: 'tools.json_minifier.label_escape', Icon: Quote, apply: escapeText },
  {
    id: 'unescape',
    labelKey: 'tools.json_minifier.label_unescape',
    Icon: RemoveFormatting,
    apply: unescapeText,
  },
  {
    id: 'stripWhitespace',
    labelKey: 'tools.json_minifier.label_strip_whitespace',
    Icon: Eraser,
    apply: stripWhitespace,
  },
  {
    id: 'urlEncode',
    labelKey: 'tools.json_minifier.label_url_encode',
    Icon: Link2,
    apply: urlEncode,
  },
  {
    id: 'urlEncodeUri',
    labelKey: 'tools.json_minifier.label_url_encode_uri',
    Icon: Link2,
    apply: urlEncodeUri,
  },
  {
    id: 'urlDecode',
    labelKey: 'tools.json_minifier.label_url_decode',
    Icon: Link2Off,
    apply: urlDecode,
  },
  {
    id: 'unicodeToChinese',
    labelKey: 'tools.json_minifier.label_unicode_to_chinese',
    Icon: Languages,
    apply: unicodeToChinese,
  },
  {
    id: 'chineseToUnicode',
    labelKey: 'tools.json_minifier.label_chinese_to_unicode',
    Icon: Binary,
    apply: chineseToUnicode,
  },
  {
    id: 'chineseSymbolToEnglish',
    labelKey: 'tools.json_minifier.label_cn_symbol_to_ascii',
    Icon: Replace,
    apply: chineseSymbolToEnglish,
  },
  {
    id: 'toUpperCase',
    labelKey: 'tools.json_minifier.label_uppercase',
    Icon: CaseUpper,
    apply: toUpperCase,
  },
  {
    id: 'toLowerCase',
    labelKey: 'tools.json_minifier.label_lowercase',
    Icon: CaseLower,
    apply: toLowerCase,
  },
  {
    id: 'capitalizeSentences',
    labelKey: 'tools.json_minifier.label_capitalize_sentences',
    Icon: TextQuote,
    apply: capitalizeSentences,
  },
  {
    id: 'capitalizeWords',
    labelKey: 'tools.json_minifier.label_capitalize_words',
    Icon: Type,
    apply: capitalizeWords,
  },
  {
    id: 'reverseText',
    labelKey: 'tools.json_minifier.label_reverse',
    Icon: Undo2,
    apply: reverseText,
  },
  {
    id: 'uniqueLines',
    labelKey: 'tools.json_minifier.label_unique_lines',
    Icon: CopyX,
    apply: uniqueLines,
  },
  {
    id: 'sortLines',
    labelKey: 'tools.json_minifier.label_sort_lines',
    Icon: ArrowDownNarrowWide,
    apply: sortLines,
  },
  {
    id: 'camelCase',
    labelKey: 'tools.json_minifier.label_camel_case',
    Icon: Type,
    apply: camelCase,
  },
  {
    id: 'pascalCase',
    labelKey: 'tools.json_minifier.label_pascal_case',
    Icon: Type,
    apply: pascalCase,
  },
  {
    id: 'snakeCase',
    labelKey: 'tools.json_minifier.label_snake_case',
    Icon: Type,
    apply: snakeCase,
  },
  {
    id: 'kebabCase',
    labelKey: 'tools.json_minifier.label_kebab_case',
    Icon: Type,
    apply: kebabCase,
  },
  {
    id: 'constantCase',
    labelKey: 'tools.json_minifier.label_constant_case',
    Icon: Type,
    apply: constantCase,
  },
  {
    id: 'trimLines',
    labelKey: 'tools.json_minifier.label_trim_lines',
    Icon: Eraser,
    apply: trimLines,
  },
  {
    id: 'removeEmptyLines',
    labelKey: 'tools.json_minifier.label_remove_empty_lines',
    Icon: Eraser,
    apply: removeEmptyLines,
  },
  {
    id: 'removeLineBreaks',
    labelKey: 'tools.json_minifier.label_remove_line_breaks',
    Icon: Eraser,
    apply: removeLineBreaks,
  },
  {
    id: 'toCrlf',
    labelKey: 'tools.json_minifier.label_to_crlf',
    Icon: Replace,
    apply: toCrlf,
  },
  {
    id: 'toLf',
    labelKey: 'tools.json_minifier.label_to_lf',
    Icon: Replace,
    apply: toLf,
  },
  {
    id: 'sortLinesDesc',
    labelKey: 'tools.json_minifier.label_sort_lines_desc',
    Icon: ArrowDownWideNarrow,
    apply: sortLinesDesc,
  },
  {
    id: 'naturalSortLines',
    labelKey: 'tools.json_minifier.label_natural_sort',
    Icon: ArrowDownNarrowWide,
    apply: naturalSortLines,
  },
  {
    id: 'reverseLines',
    labelKey: 'tools.json_minifier.label_reverse_lines',
    Icon: Undo2,
    apply: reverseLines,
  },
  {
    id: 'shuffleLines',
    labelKey: 'tools.json_minifier.label_shuffle_lines',
    Icon: Shuffle,
    apply: shuffleLines,
  },
  {
    id: 'swapCase',
    labelKey: 'tools.json_minifier.label_swap_case',
    Icon: CaseSensitive,
    apply: swapCase,
  },
  {
    id: 'fullWidthToAscii',
    labelKey: 'tools.json_minifier.label_fullwidth_to_ascii',
    Icon: Languages,
    apply: fullWidthToAscii,
  },
  {
    id: 'removeConsecutiveDuplicates',
    labelKey: 'tools.json_minifier.label_remove_consecutive_dup',
    Icon: CopyX,
    apply: removeConsecutiveDuplicateLines,
  },
];

/**
 * 把转换按操作关系拆成若干「功能组」,每组放进同一内层 ButtonGroup
 * 内(紧密拼接、相邻 border 重叠);不同组之间通过外层 ButtonGroup 的
 * flex `gap-2` 留白。
 *
 * 拆组规则:
 * - 转义 / 去除转义 / 去空格——转义与去除转义互为反操作,与去空格同属
 *   "字符集整理",合并为一组;
 * - URL 编码 / URL 解码——互为反操作,合并为一组;
 * - Unicode 转中文 / 中文转 Unicode——互为反操作,合并为一组;
 * - 中文符号转英文——独立的符号转换,单独成一组;
 * - 大写 / 小写 / 句首大写 / 词首大写——同属"大小写调整",合并为一组;
 * - 反转 / 去重行 / 排序行——同属"行与文本重组",合并为一组。
 *
 * 注意:虽然「转义」与「去空格」技术上可独立,但它们共享「修整文本字符」
 * 这一操作意图,合并为一组能更清晰表达工具属性分类;不同操作意图之间
 * 留出间隙,视觉上更接近 shadcn 文档的多组并列示例。
 */
/**
 * 第一排按钮组(转换 / 符号类):转义 / 去空格 / URL 编解码 / Unicode 互转 /
 * 中文符号转英文。放在「转换」ConfigRow,与转换意图一致。
 */
const FIRST_ROW_GROUPS: ReadonlyArray<ReadonlyArray<TransformId>> = [
  ['escape', 'unescape', 'stripWhitespace'],
  ['urlEncode', 'urlEncodeUri', 'urlDecode'],
  ['unicodeToChinese', 'chineseToUnicode'],
  ['chineseSymbolToEnglish', 'fullWidthToAscii'],
];

/**
 * 第二排按钮组(大小写 / 行重组):大写 / 小写 / 句首大写 / 词首大写 / 反转 /
 * 去重行 / 排序行。单独成「调整」ConfigRow,与上行意图区分、视觉上独立成排。
 */
const SECOND_ROW_GROUPS: ReadonlyArray<ReadonlyArray<TransformId>> = [
  ['toUpperCase', 'toLowerCase', 'capitalizeSentences', 'capitalizeWords'],
  ['reverseText', 'uniqueLines', 'sortLines'],
  ['removeConsecutiveDuplicates'],
];

/**
 * 第三排按钮组(命名风格 / 行清理 / 排序与行序):
 * - 命名风格:camelCase / PascalCase / snake_case / kebab-case / CONSTANT_CASE,
 *   复用编辑器快捷键同款 naming-convention 库;
 * - 行清理:Trim 行首尾 / 删空行 / 移除换行 / LF→CRLF / CRLF→LF;
 * - 排序与行序:降序 / 自然排序 / 行序反转 / 洗牌 / 大小写互换。
 */
const THIRD_ROW_GROUPS: ReadonlyArray<ReadonlyArray<TransformId>> = [
  ['camelCase', 'pascalCase', 'snakeCase', 'kebabCase', 'constantCase'],
  ['trimLines', 'removeEmptyLines', 'removeLineBreaks', 'toCrlf', 'toLf'],
  ['sortLinesDesc', 'naturalSortLines', 'reverseLines', 'shuffleLines', 'swapCase'],
];

const TRANSFORMS_BY_ID: ReadonlyMap<TransformId, TransformDef> = new Map(
  TRANSFORMS.map((t) => [t.id, t]),
);

/**
 * 渲染一个内层组的辅助组件,仅用于在 map 中给每个组一个 React key。
 * 必须返回单根节点,且根节点就是 ButtonGroup 本身 —— 若返回 Fragment
 * 会让外层 ButtonGroup 的直接子节点偏离 ButtonGroup,导致圆角与 gap
 * 选择器无法命中。所以这里使用一个直接返回 ButtonGroup 的函数式组件,
 * 外部再以单根 map 渲染。
 */
function GroupFragment({
  ids,
  renderGroup,
}: {
  ids: readonly TransformId[];
  renderGroup: (ids: readonly TransformId[]) => JSX.Element;
}): JSX.Element {
  return renderGroup(ids);
}

/**
 * 文本处理工具主组件
 *
 * - 顶部"配置"区分两层:
 *   - 常驻条(默认可见):常用转换(转义/URL/Unicode/中文场景)+ 大小写
 *     与行重组核心,两排 ButtonGroup;右上角 ChevronsUpDown 图标切换进阶区;
 *   - 进阶区(点击图标展开):命名风格 / 行清理 / 排序变体 / 查找替换 /
 *     提取统计。展开区限高 `min(320px, 50vh)` 内部滚动——按钮再多也不
 *     挤压下方编辑器,收起即恢复全高编辑区。
 * - 每个配置行恢复「左提示 + 右控件」左右布局:label 列(图标 + 小标题
 *   + 一行 hint)居左,按钮组/输入控件居右;宽按钮组在控件列内自动换行。
 * - 下方为左右两栏的输入/输出编辑器:输入框可编辑,转换按钮只
 *   把结果写入 **输出框**,输入保持原值不动;输出框的「作为输入」
 *   按钮把输出回填到输入,衔接多步流水线。
 * - 统计指标移到输入/输出编辑器各自的底部状态栏(CodeEditor 内置)右侧,
 *   通过 statusBarRight 自定义节点注入;关闭编辑器默认字符数
 *   (`showCharCount={false}`),改由统一的 EditorStats 紧凑展示
 *   「字符 · 单词 · 行 · 字节 · 句子 · 段落」,字号与编辑器状态栏一致。
 */
export function TextProcessor({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  // 进阶配置区(命名风格 / 行清理 / 查找替换 / 提取统计)默认折叠,
  // 保持常驻条两排,编辑器始终占据主体高度
  const [moreOpen, setMoreOpen] = useState(false);

  // handoff 接收:跨工具发来的文本直接进入输入框
  useToolHandoff(toolId, setInput);

  // 查找替换 / 提取器 / 词频(第四排):文本输入即状态,点击按钮才执行
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [regexMode, setRegexMode] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [extractId, setExtractId] = useState<ExtractPresetId>('url');
  // 行级参数化操作:删含关键字行 / 加前后缀
  const [keyword, setKeyword] = useState('');
  const [prefix, setPrefix] = useState('');

  // 把当前输入按指定转换处理:成功时把结果写入输出框、不改动输入;
  // 输出为只读副本,不会随输入实时同步,需要时再点转换。失败时弹 toast 并保持输出不变。
  // toast 文案在回调内即时翻译(t 进入依赖数组),语言切换后再次点击即为新语言。
  const handleApply = useCallback(
    (id: TransformId) => {
      if (!input) return;
      const def = TRANSFORMS_BY_ID.get(id);
      if (!def) return;
      try {
        const next = def.apply(input);
        if (next === input) {
          toast.info(t('tools.json_minifier.toast_no_change', { label: t(def.labelKey) }));
          return;
        }
        setOutput(next);
      } catch (e) {
        toast.error(
          t('tools.json_minifier.toast_failed', {
            label: t(def.labelKey),
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [input, t],
  );

  const disabled = !input;

  /** 把输出框内容回填到输入框并清空输出,实现多步流水线的衔接 */
  const handleUseOutputAsInput = useCallback((): void => {
    if (!output) return;
    setInput(output);
    setOutput('');
  }, [output]);

  /** 查找替换:非法正则 / 空查找串走 toast,失败不改动输出 */
  const handleFindReplace = useCallback((): void => {
    if (!input) return;
    if (!findText) {
      toast.info(t('tools.json_minifier.toast_find_empty'));
      return;
    }
    try {
      setOutput(
        applyFindReplace(input, findText, replaceText, { regex: regexMode, caseSensitive }),
      );
    } catch (e) {
      toast.error(
        t('tools.json_minifier.toast_failed', {
          label: t('tools.json_minifier.row_find_replace'),
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }, [input, findText, replaceText, regexMode, caseSensitive, t]);

  /** 提取器:按预设正则抽取匹配项写入输出 */
  const handleExtract = useCallback((): void => {
    if (!input) return;
    setOutput(extractPattern(input, extractId));
  }, [input, extractId]);

  /** 词频统计:值\t次数 逐行写入输出(与重复行检测器表格同口径) */
  const handleWordFrequency = useCallback((): void => {
    if (!input) return;
    setOutput(
      wordFrequency(input)
        .map((r) => `${r.value}\t${r.count}`)
        .join('\n'),
    );
  }, [input]);

  /** 删除包含关键字的行(大小写不敏感);空关键字 toast 提示 */
  const handleRemoveLinesContaining = useCallback((): void => {
    if (!input) return;
    if (!keyword) {
      toast.info(t('tools.json_minifier.toast_keyword_empty'));
      return;
    }
    setOutput(removeLinesContaining(input, keyword));
  }, [input, keyword, t]);

  /** 加前后缀:prefix 输入为前缀,suffix 输入为后缀(空则原样) */
  const handleAddPrefixSuffix = useCallback((): void => {
    if (!input) return;
    setOutput(addPrefixSuffix(input, { prefix }));
  }, [input, prefix]);

  /** 行编号:1 起始逐行编号 */
  const handleNumberLines = useCallback((): void => {
    if (!input) return;
    setOutput(numberLines(input));
  }, [input]);

  function renderGroup(ids: readonly TransformId[]): JSX.Element {
    return (
      <ButtonGroup
        aria-label={t('tools.json_minifier.group_aria_inner')}
        data-testid={`textproc-group-${ids.join('-')}`}
      >
        {ids.map((id) => {
          const def = TRANSFORMS_BY_ID.get(id);
          if (!def) return null;
          const Icon = def.Icon;
          const label = t(def.labelKey);
          return (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => handleApply(id)}
              title={label}
              aria-label={label}
              data-testid={`textproc-btn-${id}`}
              className="gap-1.5 px-3.5"
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </Button>
          );
        })}
      </ButtonGroup>
    );
  }

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="text-processor"
    >
      <ConfigSection
        searchAnchor="json_minifier:config"
        headerTestId="textproc-config-header"
        headerAction={
          /* 进阶区切换按钮:标题行右侧;展开时图标转 ChevronsUp 语义收起 */
          <button
            type="button"
            data-testid="textproc-more-toggle"
            aria-pressed={moreOpen}
            title={t('tools.json_minifier.more_toggle')}
            aria-label={t('tools.json_minifier.more_toggle')}
            onClick={() => setMoreOpen((v) => !v)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {moreOpen ? (
              <ChevronsUp aria-hidden className="size-3.5" />
            ) : (
              <ChevronsDown aria-hidden className="size-3.5" />
            )}
          </button>
        }
      >
        {/* 左侧 label 列带图标与一行描述,右侧按钮组换行铺开;
            五行 labelClassName 统一 w-64 定宽——左侧描述列等宽对齐,
            控件列起点随之对齐;描述完整单行显示 */}
        <ConfigRow
          icon={Wand2}
          label={t('tools.json_minifier.row_transform')}
          hint={t('tools.json_minifier.row_transform_hint')}
          labelClassName="w-64 shrink-0"
          searchAnchor="json_minifier:row1"
        >
          {/* 外层 ButtonGroup 起容器作用 —— 仅作为 flex 父节点。组间距用与
              组件内置 `has-[...]:gap-2` 同为 :has 选择器的 `gap-x-3`(12px)/
              `gap-y-2.5`(10px) 压过它——普通 gap-x/y 的 specificity 更低,
              会被简写 gap(8px) 整体盖掉;`flex-wrap + w-full` 覆盖默认
              `w-fit`,子组横向放不下时自动换行。 */}
          <ButtonGroup
            aria-label={t('tools.json_minifier.group_aria_row1')}
            data-testid="textproc-button-group-row1"
            className="w-full flex-wrap has-[>[data-slot=button-group]]:gap-x-3 has-[>[data-slot=button-group]]:gap-y-2.5"
          >
            {FIRST_ROW_GROUPS.map((ids) => (
              <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
            ))}
          </ButtonGroup>
        </ConfigRow>

        <ConfigRow
          icon={CaseUpper}
          label={t('tools.json_minifier.row_adjust')}
          hint={t('tools.json_minifier.row_adjust_hint')}
          labelClassName="w-64 shrink-0"
          searchAnchor="json_minifier:row2"
        >
          <ButtonGroup
            aria-label={t('tools.json_minifier.group_aria_row2')}
            data-testid="textproc-button-group-row2"
            className="w-full flex-wrap has-[>[data-slot=button-group]]:gap-x-3 has-[>[data-slot=button-group]]:gap-y-2.5"
          >
            {SECOND_ROW_GROUPS.map((ids) => (
              <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
            ))}
          </ButtonGroup>
        </ConfigRow>

        {/* 进阶配置区:默认折叠;展开时限高 min(240px, 40vh) 内部滚动,
            按钮再多也不进一步压缩编辑器 */}
        {moreOpen && (
          <div
            data-testid="textproc-more-config"
            className="max-h-[min(240px,40vh)] divide-y divide-border overflow-y-auto"
          >
            <ConfigRow
              icon={Type}
              label={t('tools.json_minifier.row_advanced')}
              hint={t('tools.json_minifier.row_advanced_hint')}
              labelClassName="w-64 shrink-0"
              searchAnchor="json_minifier:row3"
            >
              <ButtonGroup
                aria-label={t('tools.json_minifier.group_aria_row3')}
                data-testid="textproc-button-group-row3"
                className="w-full flex-wrap has-[>[data-slot=button-group]]:gap-x-3 has-[>[data-slot=button-group]]:gap-y-2.5"
              >
                {THIRD_ROW_GROUPS.map((ids) => (
                  <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
                ))}
              </ButtonGroup>
            </ConfigRow>

            <ConfigRow
              icon={Search}
              label={t('tools.json_minifier.row_find_replace')}
              hint={t('tools.json_minifier.row_find_replace_hint')}
              labelClassName="w-64 shrink-0"
              searchAnchor="json_minifier:row4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                <Input
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder={t('tools.json_minifier.find_placeholder')}
                  className="h-7 w-44 text-xs"
                  data-testid="textproc-find-input"
                />
                <span aria-hidden className="text-xs text-muted-foreground">
                  →
                </span>
                <Input
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder={t('tools.json_minifier.replace_placeholder')}
                  className="h-7 w-44 text-xs"
                  data-testid="textproc-replace-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input || !findText}
                  onClick={handleFindReplace}
                  data-testid="textproc-btn-find-replace"
                  className="gap-1 px-3.5"
                >
                  <Replace aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_replace')}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    checked={regexMode}
                    onCheckedChange={setRegexMode}
                    aria-label={t('tools.json_minifier.regex_mode')}
                    data-testid="textproc-regex-toggle"
                  />
                  {t('tools.json_minifier.regex_mode')}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    checked={caseSensitive}
                    onCheckedChange={setCaseSensitive}
                    aria-label={t('tools.json_minifier.case_sensitive')}
                    data-testid="textproc-case-toggle"
                  />
                  {t('tools.json_minifier.case_sensitive')}
                </label>
              </div>
            </ConfigRow>

            <ConfigRow
              icon={ScanSearch}
              label={t('tools.json_minifier.row_extract')}
              hint={t('tools.json_minifier.row_extract_hint')}
              labelClassName="w-64 shrink-0"
              searchAnchor="json_minifier:row5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                <Select value={extractId} onValueChange={(v) => setExtractId(v as ExtractPresetId)}>
                  <SelectTrigger
                    className="h-7 w-32 text-xs"
                    data-testid="textproc-extract-select"
                    aria-label={t('tools.json_minifier.row_extract')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTRACT_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {t(`tools.json_minifier.extract_${p.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input}
                  onClick={handleExtract}
                  data-testid="textproc-btn-extract"
                  className="gap-1 px-3.5"
                >
                  <ScanSearch aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_extract')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input}
                  onClick={handleWordFrequency}
                  data-testid="textproc-btn-wordfreq"
                  className="gap-1 px-3.5"
                >
                  <BarChart3 aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_wordfreq')}
                </Button>

                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('tools.json_minifier.keyword_placeholder')}
                  className="h-7 w-32 text-xs"
                  data-testid="textproc-keyword-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input || !keyword}
                  onClick={handleRemoveLinesContaining}
                  data-testid="textproc-btn-removeLinesContaining"
                  className="gap-1 px-3.5"
                >
                  <Eraser aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_remove_containing')}
                </Button>
                <Input
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder={t('tools.json_minifier.prefix_placeholder')}
                  className="h-7 w-24 text-xs"
                  data-testid="textproc-prefix-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input || !prefix}
                  onClick={handleAddPrefixSuffix}
                  data-testid="textproc-btn-addPrefixSuffix"
                  className="gap-1 px-3.5"
                >
                  <Replace aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_add_prefix')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input}
                  onClick={handleNumberLines}
                  data-testid="textproc-btn-numberLines"
                  className="gap-1 px-3.5"
                >
                  <ListOrdered aria-hidden className="size-3.5" />
                  {t('tools.json_minifier.btn_number_lines')}
                </Button>
              </div>
            </ConfigRow>
          </div>
        )}
      </ConfigSection>

      {/* 双栏工作区直接置于 shell 卡片内(外框由根元素提供):
          两侧编辑器只保留朝向中缝的边框,避免双线/双圆角 */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.json_minifier.input_title')}
            language="plaintext"
            value={input}
            onChange={setInput}
            // 只保留右侧边框(朝向中间分隔缝),外三边由外层卡片提供,理由同 JsonFormatter
            className="h-full rounded-none border-0 border-r"
            data-testid="input"
            searchAnchor="json_minifier:input"
            // 文本工具需要粘贴 / 打开文件 / 清除辅助按钮;编辑器工作区不使用 CodeEditor,
            // 不受 CodeEditor 默认关闭工具栏的全局影响。
            showPaste
            showOpenFile
            showClear
            // 关闭编辑器自带的「X 字符」展示,改由右侧 EditorStats 统一以中点分隔
            // 紧凑呈现 6 项统计,与"VSCode 状态栏右侧"风格一致。
            showCharCount={false}
            statusBarRight={<EditorStats text={input} />}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            readOnly
            title={t('tools.json_minifier.output_title')}
            language="plaintext"
            value={output}
            // 对称:只保留左侧边框(朝向中间分隔缝),理由同输入侧
            className="h-full rounded-none border-0 border-l"
            data-testid="output"
            searchAnchor="json_minifier:output"
            actions={
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs"
                  disabled={!output}
                  onClick={handleUseOutputAsInput}
                  title={t('tools.json_minifier.use_output_as_input')}
                  aria-label={t('tools.json_minifier.use_output_as_input')}
                  data-testid="textproc-btn-useOutputAsInput"
                >
                  <CornerDownLeft aria-hidden className="size-3" />
                  {t('tools.json_minifier.use_output_as_input_short')}
                </Button>
                <CopyAction text={output} testId="output-copy" />
                <SendToMenu text={output} currentToolId={toolId} testId="output-send-to" />
              </span>
            }
            showCharCount={false}
            statusBarRight={<EditorStats text={output} />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
