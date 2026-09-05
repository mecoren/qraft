/**
 * 进制转换器 —— BigInt 实现,支持 2-36 任意进制互转、格式化分组与位宽模式。
 *
 * 位宽模式(8/16/32/64,对标 binaryhexconverter / rapidtables):
 * - 二/八/十六进制结果按位宽零填充
 * - 负数显示二补码位型(十进制保持带符号)
 * - 超出位宽范围的正数回退为任意精度原样显示,并给出提示
 */

import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, Info, LayoutList } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

/** 位宽:0 表示不限制 */
export type BitWidth = 0 | 8 | 16 | 32 | 64;

/** parseInBase 抛出 i18n 键名(而非中文),由组件层翻译 */
const ERROR_EMPTY_INPUT = 'tools.number_base_converter.error_empty_input';

const ERROR_INVALID_DIGIT = 'tools.number_base_converter.error_invalid_digit';

/** 与进制匹配的前缀(0b/0o/0x),仅对应进制时剥离 */
const BASE_PREFIXES: readonly { re: RegExp; base: number }[] = [
  { re: /^0b/i, base: 2 },
  { re: /^0o/i, base: 8 },
  { re: /^0x/i, base: 16 },
];

export function parseInBase(raw: string, base: number): bigint {
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new Error(`${ERROR_INVALID_DIGIT}|${base}`);
  }
  let text = raw.trim().replace(/[\s_,]/g, '');
  if (!text) throw new Error(ERROR_EMPTY_INPUT);
  let negative = false;
  if (text.startsWith('-') || text.startsWith('+')) {
    negative = text.startsWith('-');
    text = text.slice(1);
  }
  for (const { re, base: prefixBase } of BASE_PREFIXES) {
    if (prefixBase === base && re.test(text)) {
      text = text.replace(re, '');
      break;
    }
  }
  if (!text) throw new Error(ERROR_EMPTY_INPUT);
  if (!/^[0-9a-z]+$/i.test(text)) {
    throw new Error(`${ERROR_INVALID_DIGIT}|${base}`);
  }
  const bigBase = BigInt(base);
  let value = 0n;
  for (const ch of text.toLowerCase()) {
    const digit = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 87;
    if (digit >= base) throw new Error(`${ERROR_INVALID_DIGIT}|${base}`);
    value = value * bigBase + BigInt(digit);
  }
  return negative ? -value : value;
}

/** 按进制惯例分组:十进制 3 位逗号,其余 4 位空格 */
function groupDigits(digits: string, base: number): string {
  const size = base === 10 ? 3 : 4;
  const sep = base === 10 ? ',' : ' ';
  const out: string[] = [];
  for (let end = digits.length; end > 0; end -= size) {
    out.unshift(digits.slice(Math.max(0, end - size), end));
  }
  return out.join(sep);
}

/**
 * 格式化数值。
 * width > 0 且进制非十进制:负数呈现二补码位型,正数(未超位宽)按位宽零填充;
 * 十进制始终带符号显示;超位宽正数按任意精度原样显示。
 */
export function formatInBase(
  value: bigint,
  base: number,
  grouped: boolean,
  width: BitWidth = 0,
): string {
  const negative = value < 0n;
  const useTwosComplement = width > 0 && base !== 10 && negative;
  const magnitude = useTwosComplement ? BigInt.asUintN(width, value) : negative ? -value : value;
  let digits = magnitude.toString(base);
  if (width > 0 && base !== 10 && magnitude < 1n << BigInt(width)) {
    const digitCount = Math.ceil(width / Math.log2(base));
    digits = digits.padStart(digitCount, '0');
  }
  if (base === 16) digits = digits.toUpperCase();
  if (grouped) digits = groupDigits(digits, base);
  return (negative && !useTwosComplement ? '-' : '') + digits;
}

const RESULT_BASES = [16, 10, 8, 2] as const;

const BASE_LABEL_KEY: Record<number, string> = {
  2: 'tools.number_base_converter.base_binary',
  8: 'tools.number_base_converter.base_octal',
  10: 'tools.number_base_converter.base_decimal',
  16: 'tools.number_base_converter.base_hex',
};

/** 输入进制选项:常用 4 种 + 全部 2-36 */
const INPUT_BASES: readonly number[] = Array.from({ length: 35 }, (_, i) => i + 2);

const WIDTH_OPTIONS: readonly BitWidth[] = [0, 8, 16, 32, 64];

function baseLabel(t: ReturnType<typeof useTranslation>['t'], base: number): string {
  return BASE_LABEL_KEY[base]
    ? t(BASE_LABEL_KEY[base]!)
    : t('tools.number_base_converter.base_n', { base });
}

export function NumberBaseConverter(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [inputBase, setInputBase] = useState<number>(10);
  const [grouped, setGrouped] = useState(true);
  const [width, setWidth] = useState<BitWidth>(0);

  const results = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const value = parseInBase(input, inputBase);
      return {
        error: null as string | null,
        value,
        values: RESULT_BASES.map((b) => ({
          base: b,
          text: formatInBase(value, b, grouped, width),
        })),
      };
    } catch (e) {
      // parseInBase 抛的是「键名|参数」或纯键名,在此翻译;未知异常文本原样透传
      const raw = e instanceof Error ? e.message : String(e);
      const [key, param] = raw.split('|');
      return {
        error: (key ?? raw).startsWith('tools.')
          ? t(key!, param !== undefined ? { base: param } : undefined)
          : raw,
        value: null,
        values: [],
      };
    }
  }, [input, inputBase, grouped, width, t]);

  const overflow =
    results?.value !== null && results?.value !== undefined && width > 0
      ? results.value >= 1n << BigInt(width)
      : false;

  const allText = results && !results.error ? results.values.map((r) => r.text).join('\n') : '';

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 输入/结果收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="number-base-converter"
    >
      <ConfigSection title="" searchAnchor="number_base_converter:config">
        <ConfigRow
          icon={LayoutList}
          label={t('tools.number_base_converter.group_formatted')}
          hint={t('tools.number_base_converter.group_formatted_hint')}
        >
          <Switch
            checked={grouped}
            onCheckedChange={setGrouped}
            aria-label={t('tools.number_base_converter.group_formatted')}
            data-testid="nb-grouped"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label={t('tools.number_base_converter.input_base')}>
          <Select value={String(inputBase)} onValueChange={(v) => setInputBase(Number(v))}>
            <SelectTrigger data-testid="nb-input-base" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INPUT_BASES.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {baseLabel(t, b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={Info}
          label={t('tools.number_base_converter.bit_width')}
          hint={t('tools.number_base_converter.bit_width_hint')}
        >
          <Select value={String(width)} onValueChange={(v) => setWidth(Number(v) as BitWidth)}>
            <SelectTrigger data-testid="nb-width" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTH_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w === 0 ? t('tools.number_base_converter.bit_width_none') : `${w} bit`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      {/* 配置区下方内容收进带内边距的滚动 wrapper(对齐 shell 布局基准) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <section
          aria-label={t('tools.number_base_converter.input_title')}
          data-search-anchor="number_base_converter:input"
        >
          <h2 className="mb-1.5 text-body-sm font-semibold">
            {t('tools.number_base_converter.input_title')}
          </h2>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              inputBase === 16
                ? t('tools.number_base_converter.placeholder_hex')
                : t('tools.number_base_converter.placeholder_default')
            }
            aria-label={t('tools.number_base_converter.input_aria')}
            data-testid="nb-input"
            className="h-9 text-body-sm"
          />
          {results?.error ? (
            <p data-testid="nb-error" className="mt-1 text-xs text-destructive">
              {results.error}
            </p>
          ) : null}
        </section>

        <section
          aria-label={t('tools.number_base_converter.result_title')}
          className="flex flex-col gap-2"
          data-search-anchor="number_base_converter:result"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-body-sm font-semibold">
              {t('tools.number_base_converter.result_title')}
            </h2>
            {allText && <CopyAction text={allText} testId="nb-copy-all" />}
          </div>
          {RESULT_BASES.map((b, i) => {
            const text = results && !results.error ? results.values[i]!.text : '';
            return (
              <div
                key={b}
                className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-2.5"
              >
                <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">
                  {baseLabel(t, b)}
                </span>
                <code
                  data-testid={`nb-result-${b}`}
                  className="min-w-0 flex-1 break-all font-mono text-body-sm"
                >
                  {text || '-'}
                </code>
                <CopyAction text={text} testId={`nb-copy-${b}`} />
              </div>
            );
          })}
          {overflow && (
            <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="nb-overflow">
              {t('tools.number_base_converter.overflow_note', { width })}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
