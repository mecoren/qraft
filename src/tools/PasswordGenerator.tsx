/**
 * 密码生成器 —— crypto.getRandomValues + 强度评估
 */

import { useCallback, useMemo, useState, type JSX } from 'react';
import { Hash, KeyRound, ListOrdered, RefreshCw, Type as TypeIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/';

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

const AMBIGUOUS = new Set('Il1O0o`|');

export function generatePassword(opts: PasswordOptions): string {
  let pool = '';
  const groups: string[] = [];
  const addGroup = (chars: string): void => {
    const filtered = opts.excludeAmbiguous
      ? [...chars].filter((c) => !AMBIGUOUS.has(c)).join('')
      : chars;
    if (filtered) {
      pool += filtered;
      groups.push(filtered);
    }
  };
  if (opts.lower) addGroup(LOWER);
  if (opts.upper) addGroup(UPPER);
  if (opts.digits) addGroup(DIGITS);
  if (opts.symbols) addGroup(SYMBOLS);
  if (!pool) throw new Error('至少选择一种字符类型');

  const length = Math.min(Math.max(opts.length, 4), 256);
  const rand = new Uint32Array(length);
  crypto.getRandomValues(rand);
  const chars = Array.from(rand, (r, i) => {
    // 前 groups.length 位保证每组至少一个字符
    if (i < groups.length) return groups[i][r % groups[i].length];
    return pool[r % pool.length];
  });
  // Fisher-Yates 打乱,避免"每组首字符固定在前"的模式
  const shuffle = new Uint32Array(length);
  crypto.getRandomValues(shuffle);
  for (let i = length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** 粗略强度:池大小与长度的信息熵(bit) */
export function passwordEntropy(opts: PasswordOptions): number {
  let poolSize = 0;
  if (opts.lower) poolSize += 26;
  if (opts.upper) poolSize += 26;
  if (opts.digits) poolSize += 10;
  if (opts.symbols) poolSize += SYMBOLS.length;
  if (poolSize === 0) return 0;
  return Math.round(opts.length * Math.log2(poolSize));
}

function strengthLabel(entropy: number): { label: string; percent: number } {
  if (entropy >= 128) return { label: '极强', percent: 100 };
  if (entropy >= 80) return { label: '强', percent: 80 };
  if (entropy >= 60) return { label: '中等', percent: 60 };
  if (entropy >= 40) return { label: '较弱', percent: 40 };
  return { label: '弱', percent: 20 };
}

export function PasswordGenerator(_props: ToolProps): JSX.Element {
  const [length, setLength] = useState(16);
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(false);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [count, setCount] = useState(5);
  const [output, setOutput] = useState('');

  const opts = useMemo<PasswordOptions>(
    () => ({ length, lower, upper, digits, symbols, excludeAmbiguous }),
    [length, lower, upper, digits, symbols, excludeAmbiguous],
  );

  const entropy = useMemo(() => passwordEntropy(opts), [opts]);
  const strength = useMemo(() => strengthLabel(entropy), [entropy]);
  const noType = !lower && !upper && !digits && !symbols;

  const generate = useCallback(() => {
    if (noType) return;
    const n = Math.min(Math.max(count, 1), 1000);
    const list = Array.from({ length: n }, () => generatePassword(opts));
    setOutput(list.join('\n'));
  }, [opts, count, noType]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="password-generator">
      <ConfigSection title="">
        <ConfigRow icon={KeyRound} label="长度">
          <Input
            type="number"
            min={4}
            max={256}
            value={length}
            onChange={(e) => setLength(Number(e.target.value) || 4)}
            aria-label="密码长度"
            data-testid="pw-length"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
        <ConfigRow icon={TypeIcon} label="小写字母" hint="a-z">
          <Switch
            checked={lower}
            onCheckedChange={setLower}
            aria-label="小写字母"
            data-testid="pw-lower"
          />
        </ConfigRow>
        <ConfigRow icon={TypeIcon} label="大写字母" hint="A-Z">
          <Switch
            checked={upper}
            onCheckedChange={setUpper}
            aria-label="大写字母"
            data-testid="pw-upper"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label="数字" hint="0-9">
          <Switch
            checked={digits}
            onCheckedChange={setDigits}
            aria-label="数字"
            data-testid="pw-digits"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label="特殊字符" hint={SYMBOLS}>
          <Switch
            checked={symbols}
            onCheckedChange={setSymbols}
            aria-label="特殊字符"
            data-testid="pw-symbols"
          />
        </ConfigRow>
        <ConfigRow icon={TypeIcon} label="排除易混淆字符" hint="I l 1 O 0 o | `">
          <Switch
            checked={excludeAmbiguous}
            onCheckedChange={setExcludeAmbiguous}
            aria-label="排除易混淆字符"
            data-testid="pw-ambiguous"
          />
        </ConfigRow>
        <ConfigRow icon={ListOrdered} label="生成数量">
          <Input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            aria-label="生成数量"
            data-testid="pw-count"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
      </ConfigSection>

      {/* 强度与生成 */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-card">
        <span className="text-xs text-muted-foreground">强度</span>
        <Progress value={noType ? 0 : strength.percent} className="h-1.5 w-40" />
        <span data-testid="pw-strength" className="text-xs">
          {noType ? '未选择字符类型' : `${strength.label}(约 ${entropy} bit)`}
        </span>
        <div className="flex-1" />
        <Button size="sm" data-testid="pw-generate" disabled={noType} onClick={generate}>
          <RefreshCw aria-hidden className="size-3.5" /> 生成
        </Button>
      </div>

      <CodeEditor
        title="生成结果"
        language="plaintext"
        value={output}
        readOnly
        data-testid="pw-output"
        className="min-h-0 flex-1"
        actions={<CopyAction text={output} testId="pw-copy" />}
      />
    </div>
  );
}
