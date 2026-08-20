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
 * - 7 个按钮按功能拆成 4 个逻辑组;同一组的转换(操作相近、互为反操)
 *   放进同一个内层 ButtonGroup 让它们紧密拼接、相邻组之间通过外层
 *   ButtonGroup 的 flex `gap-2` 留白(参考 shadcn ButtonGroup 嵌套用法)。
 * - 点击按钮即把当前输入文本替换为转换结果,并在右侧输出框同步展示。
 * - 连续点击多个按钮会在前一次结果上叠加,便于组合多步处理。
 * - 配置行采用 `ConfigSection > ConfigRow > ButtonGroup(嵌套) + 图标`,
 *   与 SQL 格式化器保持一致。
 */
import { useCallback, useState, type JSX } from 'react';
import {
  ArrowDownNarrowWide,
  Binary,
  CaseLower,
  CaseUpper,
  CopyX,
  Eraser,
  Link2,
  Link2Off,
  Languages,
  Quote,
  Replace,
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { toast } from 'sonner';
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

/** 移除全部空白(空格、Tab、换行、回车等) */
export function stripWhitespace(input: string): string {
  return input.replace(/\s+/g, '');
}

/** URL 编码(使用 encodeURIComponent 以覆盖 : / ? # 等保留字符) */
export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

/** URL 解码(对畸形输入抛出 URIError) */
export function urlDecode(input: string): string {
  return decodeURIComponent(input);
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
// 编辑器底部统计(独立模块,供 EditorStats 与将来的单元测试复用)
// ============================================================
/**
 * 紧凑统计口径(沿用「文本分析和实用工具」):
 * 字符(Unicode 码点)、单词(非空白连续片段)、行(以 \n 分隔)、字节(UTF-8 编码长度)、
 * 句子(以 .!?。！？ 结尾的片段)、段落(连续空行分隔的非空块)。
 *
 * 返回有序元组,供 EditorStats 用中点分隔紧凑渲染,
 * 同时避免在 JSX 内做重复计算。
 */
export interface TextStats {
  chars: number;
  words: number;
  lines: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
}

export const EMPTY_STATS: TextStats = {
  chars: 0,
  words: 0,
  lines: 0,
  bytes: 0,
  sentences: 0,
  paragraphs: 0,
};

export function computeStats(input: string): TextStats {
  if (!input) return EMPTY_STATS;
  return {
    chars: Array.from(input).length,
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
 */
function EditorStats({ text }: { text: string }): JSX.Element {
  const s = computeStats(text);
  return (
    <span
      className="whitespace-nowrap tabular-nums text-muted-foreground"
      data-testid="textproc-editor-stats"
      title={`字符 ${s.chars} · 单词 ${s.words} · 行 ${s.lines} · 字节 ${s.bytes} · 句子 ${s.sentences} · 段落 ${s.paragraphs}`}
    >
      <span data-testid="textproc-stat-chars">{s.chars}</span> 字符
      <span aria-hidden> · </span>
      <span data-testid="textproc-stat-words">{s.words}</span> 单词
      <span aria-hidden> · </span>
      <span data-testid="textproc-stat-lines">{s.lines}</span> 行<span aria-hidden> · </span>
      <span data-testid="textproc-stat-bytes">{s.bytes}</span> 字节
      <span aria-hidden> · </span>
      <span data-testid="textproc-stat-sentences">{s.sentences}</span> 句子
      <span aria-hidden> · </span>
      <span data-testid="textproc-stat-paragraphs">{s.paragraphs}</span> 段落
    </span>
  );
}

// ============================================================
// UI 组件
// ============================================================

type TransformId =
  | 'escape'
  | 'stripWhitespace'
  | 'urlEncode'
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
  | 'sortLines';

/** 单个转换的配置 */
interface TransformDef {
  id: TransformId;
  label: string;
  Icon: typeof Quote;
  apply: (input: string) => string;
}

const TRANSFORMS: readonly TransformDef[] = [
  { id: 'escape', label: '转义', Icon: Quote, apply: escapeText },
  { id: 'stripWhitespace', label: '去空格', Icon: Eraser, apply: stripWhitespace },
  { id: 'urlEncode', label: 'URL 编码', Icon: Link2, apply: urlEncode },
  { id: 'urlDecode', label: 'URL 解码', Icon: Link2Off, apply: urlDecode },
  { id: 'unicodeToChinese', label: 'Unicode 转中文', Icon: Languages, apply: unicodeToChinese },
  { id: 'chineseToUnicode', label: '中文转 Unicode', Icon: Binary, apply: chineseToUnicode },
  {
    id: 'chineseSymbolToEnglish',
    label: '中文符号转英文',
    Icon: Replace,
    apply: chineseSymbolToEnglish,
  },
  { id: 'toUpperCase', label: '大写', Icon: CaseUpper, apply: toUpperCase },
  { id: 'toLowerCase', label: '小写', Icon: CaseLower, apply: toLowerCase },
  { id: 'capitalizeSentences', label: '句首大写', Icon: TextQuote, apply: capitalizeSentences },
  { id: 'capitalizeWords', label: '词首大写', Icon: Type, apply: capitalizeWords },
  { id: 'reverseText', label: '反转', Icon: Undo2, apply: reverseText },
  { id: 'uniqueLines', label: '去重行', Icon: CopyX, apply: uniqueLines },
  { id: 'sortLines', label: '排序行', Icon: ArrowDownNarrowWide, apply: sortLines },
];

/**
 * 把转换按操作关系拆成若干「功能组」,每组放进同一内层 ButtonGroup
 * 内(紧密拼接、相邻 border 重叠);不同组之间通过外层 ButtonGroup 的
 * flex `gap-2` 留白。
 *
 * 拆组规则:
 * - 转义 / 去空格——同属"调整字符集",互为正交操作,合并为一组;
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
  ['escape', 'stripWhitespace'],
  ['urlEncode', 'urlDecode'],
  ['unicodeToChinese', 'chineseToUnicode'],
  ['chineseSymbolToEnglish'],
];

/**
 * 第二排按钮组(大小写 / 行重组):大写 / 小写 / 句首大写 / 词首大写 / 反转 /
 * 去重行 / 排序行。单独成「调整」ConfigRow,与上行意图区分、视觉上独立成排。
 */
const SECOND_ROW_GROUPS: ReadonlyArray<ReadonlyArray<TransformId>> = [
  ['toUpperCase', 'toLowerCase', 'capitalizeSentences', 'capitalizeWords'],
  ['reverseText', 'uniqueLines', 'sortLines'],
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
 * - 上方"配置"区域(与 SQL 格式化器一致)以嵌套 ButtonGroup 放置文本转换
 *   按钮(含原「文本分析和实用工具」的大小写 / 行重组功能),组内紧密拼边、
 *   组间留出 gap-2;按钮组在宽度不足时自动换行(共 ~14 个按钮),设计上
 *   期望其占满两排。
 * - 下方为左右两栏的输入/输出编辑器:输入框可编辑,转换按钮只
 *   把结果写入 **输出框**,输入保持原值不动。
 * - 统计指标移到输入/输出编辑器各自的底部状态栏(CodeEditor 内置)右侧,
 *   通过 statusBarRight 自定义节点注入;关闭编辑器默认字符数
 *   (`showCharCount={false}`),改由统一的 EditorStats 紧凑展示
 *   「字符 · 单词 · 行 · 字节 · 句子 · 段落」,字号与编辑器状态栏一致。
 */
export function TextProcessor(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  // 把当前输入按指定转换处理:成功时把结果写入输出框、不改动输入;
  // 输出为只读副本,不会随输入实时同步,需要时再点转换。失败时弹 toast 并保持输出不变。
  const handleApply = useCallback(
    (id: TransformId) => {
      if (!input) return;
      const def = TRANSFORMS_BY_ID.get(id);
      if (!def) return;
      try {
        const next = def.apply(input);
        if (next === input) {
          toast.info(`${def.label}:文本无需转换`);
          return;
        }
        setOutput(next);
      } catch (e) {
        toast.error(`${def.label}失败:${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [input],
  );

  const disabled = !input;

  function renderGroup(ids: readonly TransformId[]): JSX.Element {
    return (
      <ButtonGroup aria-label="文本转换" data-testid={`textproc-group-${ids.join('-')}`}>
        {ids.map((id) => {
          const def = TRANSFORMS_BY_ID.get(id);
          if (!def) return null;
          const Icon = def.Icon;
          return (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => handleApply(id)}
              title={def.label}
              aria-label={def.label}
              data-testid={`textproc-btn-${id}`}
              className="gap-1.5"
            >
              <Icon aria-hidden className="size-3.5" />
              {def.label}
            </Button>
          );
        })}
      </ButtonGroup>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-processor">
      <ConfigSection title="">
        <ConfigRow
          icon={Wand2}
          label="转换"
          hint="点击按钮把当前输入的转换结果写入输出框,输入不变;同组内紧密拼接,组间留白"
        >
          {/* 外层 ButtonGroup 起容器作用 —— 仅作为 flex 父节点,
              配合 `has-[>[data-slot=button-group]]:gap-2` 自动在子组之间
              生成间距,而无需由使用者手动添加 className。
              整体可访问性名称在按钮组集合层面给出。
              使用 `flex-wrap + w-full` 覆盖默认的 `w-fit`,让子组(每个内层
              ButtonGroup)在横向放不下时自动换行到第二排;`gap-y-2` 为换行后
              的垂直间距,与组内 `gap-2` 视觉一致。 */}
          <ButtonGroup
            aria-label="符号与编码转换"
            data-testid="textproc-button-group-row1"
            className="w-full flex-wrap gap-y-2"
          >
            {FIRST_ROW_GROUPS.map((ids) => (
              <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
            ))}
          </ButtonGroup>
        </ConfigRow>

        <ConfigRow
          icon={CaseUpper}
          label="调整"
          hint="大小写与行级重排:点击写入输出框,输入不变;横向放不下时自动换行"
        >
          <ButtonGroup
            aria-label="大小写与行重排"
            data-testid="textproc-button-group-row2"
            className="w-full flex-wrap gap-y-2"
          >
            {SECOND_ROW_GROUPS.map((ids) => (
              <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
            ))}
          </ButtonGroup>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入"
            language="plaintext"
            value={input}
            onChange={setInput}
            className="h-full"
            data-testid="input"
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
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            readOnly
            title="输出"
            language="plaintext"
            value={output}
            className="h-full"
            data-testid="output"
            actions={<CopyAction text={output} testId="output-copy" />}
            showCharCount={false}
            statusBarRight={<EditorStats text={output} />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
