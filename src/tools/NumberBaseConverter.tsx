/**
 * 进制转换器 —— BigInt 实现,支持 2/8/10/16 进制互转与格式化分组
 */

import { useMemo, useState, type JSX } from 'react';
import { Hash, LayoutList } from 'lucide-react';
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

type Base = 2 | 8 | 10 | 16;

const BASE_LABEL: Record<Base, string> = {
  2: '二进制',
  8: '八进制',
  10: '十进制',
  16: '十六进制',
};

const BASE_PREFIX: Record<Base, RegExp> = {
  2: /^0b/i,
  8: /^0o/i,
  10: /^$/,
  16: /^0x/i,
};

export function parseInBase(raw: string, base: Base): bigint {
  let text = raw.trim().replace(/[\s_,]/g, '');
  if (!text) throw new Error('空输入');
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(BASE_PREFIX[base], '');
  if (!text) throw new Error('空输入');
  const valid: Record<Base, RegExp> = {
    2: /^[01]+$/,
    8: /^[0-7]+$/,
    10: /^[0-9]+$/,
    16: /^[0-9a-fA-F]+$/,
  };
  if (!valid[base].test(text)) throw new Error(`不是有效的${BASE_LABEL[base]}数`);
  const prefixes: Record<Base, string> = { 2: '0b', 8: '0o', 10: '', 16: '0x' };
  const value = BigInt(prefixes[base] + text);
  return negative ? -value : value;
}

/** 按进制惯例分组:十进制 3 位逗号,其余 4 位空格 */
export function formatInBase(value: bigint, base: Base, grouped: boolean): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  let digits = abs.toString(base);
  if (base === 16) digits = digits.toUpperCase();
  if (grouped) {
    const size = base === 10 ? 3 : 4;
    const sep = base === 10 ? ',' : ' ';
    const out: string[] = [];
    for (let end = digits.length; end > 0; end -= size) {
      out.unshift(digits.slice(Math.max(0, end - size), end));
    }
    digits = out.join(sep);
  }
  return (negative ? '-' : '') + digits;
}

export function NumberBaseConverter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [inputBase, setInputBase] = useState<Base>(10);
  const [grouped, setGrouped] = useState(true);

  const results = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const value = parseInBase(input, inputBase);
      return {
        error: null,
        values: ([16, 10, 8, 2] as Base[]).map((b) => ({
          base: b,
          text: formatInBase(value, b, grouped),
        })),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), values: [] };
    }
  }, [input, inputBase, grouped]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="number-base-converter">
      <ConfigSection title="">
        <ConfigRow icon={LayoutList} label="格式化数字" hint="按进制惯例分组显示">
          <Switch
            checked={grouped}
            onCheckedChange={setGrouped}
            aria-label="格式化数字"
            data-testid="nb-grouped"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label="输入进制">
          <Select value={String(inputBase)} onValueChange={(v) => setInputBase(Number(v) as Base)}>
            <SelectTrigger data-testid="nb-input-base" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {([10, 16, 8, 2] as Base[]).map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {BASE_LABEL[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <section aria-label="输入">
        <h2 className="mb-1.5 text-body-sm font-semibold">输入</h2>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={inputBase === 16 ? '例如 FF 或 0xFF' : '输入数字'}
          aria-label="待转换数字"
          data-testid="nb-input"
          className="h-9 font-mono text-body-sm"
        />
        {results?.error ? (
          <p data-testid="nb-error" className="mt-1 text-xs text-destructive">
            {results.error}
          </p>
        ) : null}
      </section>

      <section aria-label="转换结果" className="flex flex-col gap-2">
        <h2 className="text-body-sm font-semibold">转换结果</h2>
        {([16, 10, 8, 2] as Base[]).map((b, i) => {
          const text = results && !results.error ? results.values[i].text : '';
          return (
            <div
              key={b}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-card"
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{BASE_LABEL[b]}</span>
              <code
                data-testid={`nb-result-${b}`}
                className="min-w-0 flex-1 truncate font-mono text-body-sm"
              >
                {text || '-'}
              </code>
              <CopyAction text={text} testId={`nb-copy-${b}`} />
            </div>
          );
        })}
      </section>
    </div>
  );
}
