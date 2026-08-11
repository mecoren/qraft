/**
 * 文本处理工具
 *
 * 整体布局参考 SQL 格式化器:`配置` 区域(ConfigSection)上方一行,
 * 输入/输出区(CodeEditor × 2) 占据下方主体。本工具把 7 个常用文本转换
 * 集中在一个 ButtonGroup 中,样式与 SQL 选择控件一致(描边按钮 +
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
  Binary,
  Eraser,
  Link2,
  Link2Off,
  Languages,
  Quote,
  Replace,
  Wand2,
} from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
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
  '　': ' ',
};

export function chineseSymbolToEnglish(input: string): string {
  return input.replace(/[，。、；：！？（）【】「」『』《》〈〉“”‘’…—·～　]/g, (ch) =>
    CN_SYMBOL_MAP[ch] ?? ch,
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
  | 'chineseSymbolToEnglish';

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
  { id: 'chineseSymbolToEnglish', label: '中文符号转英文', Icon: Replace, apply: chineseSymbolToEnglish },
];

/**
 * 把 7 个转换按操作关系拆成若干「功能组」,每组放进同一内层 ButtonGroup
 * 内(紧密拼接、相邻 border 重叠);不同组之间通过外层 ButtonGroup 的
 * flex `gap-2` 留白。
 *
 * 拆组规则:
 * - 转义 / 去空格——同属"调整字符集",互为正交操作,合并为一组;
 * - URL 编码 / URL 解码——互为反操作,合并为一组;
 * - Unicode 转中文 / 中文转 Unicode——互为反操作,合并为一组;
 * - 中文符号转英文——独立的符号转换,单独成一组。
 *
 * 注意:虽然「转义」与「去空格」技术上可独立,但它们共享「修整文本字符」
 * 这一操作意图,合并为一组能更清晰表达工具属性分类;不同操作意图之间
 * 留出间隙,视觉上更接近 shadcn 文档的多组并列示例。
 */
const TRANSFORM_GROUPS: ReadonlyArray<ReadonlyArray<TransformId>> = [
  ['escape', 'stripWhitespace'],
  ['urlEncode', 'urlDecode'],
  ['unicodeToChinese', 'chineseToUnicode'],
  ['chineseSymbolToEnglish'],
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
 * - 上方"配置"区域(与 SQL 格式化器一致)以嵌套 ButtonGroup 放置
 *   4 组共 7 个文本转换按钮:组内紧密拼边、组间留出 gap-2。
 * - 下方为左右两栏的输入/输出编辑器,与所有"配置 → 输入 → 输出"工具
 *   同构,保持工具面板视觉一致。
 */
export function TextProcessor(_props: ToolProps): JSX.Element {
  const [text, setText] = useState('');

  /**
   * 把当前输入按指定转换处理:成功时把转换结果写回输入框(输出框同步),
   * 失败时弹 toast 提示并保持原文本不变。
   */
  const handleApply = useCallback(
    (id: TransformId) => {
      if (!text) return;
      const def = TRANSFORMS_BY_ID.get(id);
      if (!def) return;
      try {
        const next = def.apply(text);
        if (next === text) {
          toast.info(`${def.label}:文本无需转换`);
          return;
        }
        setText(next);
      } catch (e) {
        toast.error(
          `${def.label}失败:${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [text],
  );

  const disabled = !text;

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
      <ConfigSection>
        <ConfigRow
          icon={Wand2}
          label="转换"
          hint="点击按钮把当前输入替换为转换结果;同组内紧密拼接,组间留白"
        >
          {/* 外层 ButtonGroup 起容器作用 —— 仅作为 flex 父节点,
              配合 `has-[>[data-slot=button-group]]:gap-2` 自动在子组之间
              生成间距,而无需由使用者手动添加 className。
              整体可访问性名称在按钮组集合层面给出。 */}
          <ButtonGroup aria-label="全部文本转换" data-testid="textproc-button-group">
            {TRANSFORM_GROUPS.map((ids) => (
              <GroupFragment key={ids.join('-')} ids={ids} renderGroup={renderGroup} />
            ))}
          </ButtonGroup>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入"
            language="plaintext"
            value={text}
            onChange={setText}
            placeholder="在此粘贴或输入文本..."
            className="h-full"
            data-testid="input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            readOnly
            title="输出"
            language="plaintext"
            value={text}
            className="h-full"
            data-testid="output"
            actions={<CopyAction text={text} testId="output-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
