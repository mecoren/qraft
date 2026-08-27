/**
 * 密码生成器 —— crypto.getRandomValues + 强度评估
 */

import { useCallback, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, KeyRound, ListOrdered, RefreshCw, Type as TypeIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { t } from '@/i18n';
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
  if (!pool) throw new Error(t('tools.password_generator.error_no_char_type'));

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

/** 粗略强度:池大小与长度的信息熵(bit);label 为 i18n 键,渲染时经 t() 翻译 */
function strengthLabel(entropy: number): { label: string; percent: number } {
  if (entropy >= 128)
    return { label: 'tools.password_generator.strength_very_strong', percent: 100 };
  if (entropy >= 80) return { label: 'tools.password_generator.strength_strong', percent: 80 };
  if (entropy >= 60) return { label: 'tools.password_generator.strength_medium', percent: 60 };
  if (entropy >= 40)
    return { label: 'tools.password_generator.strength_below_average', percent: 40 };
  return { label: 'tools.password_generator.strength_weak', percent: 20 };
}

export function PasswordGenerator(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
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
      <ConfigSection title="" searchAnchor="password_generator:config">
        <ConfigRow icon={KeyRound} label={t('tools.password_generator.length')}>
          <Input
            type="number"
            min={4}
            max={256}
            value={length}
            onChange={(e) => setLength(Number(e.target.value) || 4)}
            aria-label={t('tools.password_generator.length_aria')}
            data-testid="pw-length"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
        <ConfigRow icon={TypeIcon} label={t('tools.password_generator.lowercase')} hint="a-z">
          <Switch
            checked={lower}
            onCheckedChange={setLower}
            aria-label={t('tools.password_generator.lowercase')}
            data-testid="pw-lower"
          />
        </ConfigRow>
        <ConfigRow icon={TypeIcon} label={t('tools.password_generator.uppercase')} hint="A-Z">
          <Switch
            checked={upper}
            onCheckedChange={setUpper}
            aria-label={t('tools.password_generator.uppercase')}
            data-testid="pw-upper"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label={t('tools.password_generator.digits')} hint="0-9">
          <Switch
            checked={digits}
            onCheckedChange={setDigits}
            aria-label={t('tools.password_generator.digits')}
            data-testid="pw-digits"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} label={t('tools.password_generator.symbols')} hint={SYMBOLS}>
          <Switch
            checked={symbols}
            onCheckedChange={setSymbols}
            aria-label={t('tools.password_generator.symbols')}
            data-testid="pw-symbols"
          />
        </ConfigRow>
        <ConfigRow
          icon={TypeIcon}
          label={t('tools.password_generator.exclude_ambiguous')}
          hint="I l 1 O 0 o | `"
        >
          <Switch
            checked={excludeAmbiguous}
            onCheckedChange={setExcludeAmbiguous}
            aria-label={t('tools.password_generator.exclude_ambiguous')}
            data-testid="pw-ambiguous"
          />
        </ConfigRow>
        <ConfigRow icon={ListOrdered} label={t('tools.password_generator.count')}>
          <Input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            aria-label={t('tools.password_generator.count')}
            data-testid="pw-count"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
      </ConfigSection>

      {/* 强度与生成 */}
      <div
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-card"
        data-search-anchor="password_generator:strength"
      >
        <span className="text-xs text-muted-foreground">
          {t('tools.password_generator.strength_title')}
        </span>
        <Progress value={noType ? 0 : strength.percent} className="h-1.5 w-40" />
        <span data-testid="pw-strength" className="text-xs">
          {noType
            ? t('tools.password_generator.no_type_selected')
            : t('tools.password_generator.strength_with_entropy', {
                label: t(strength.label),
                entropy,
              })}
        </span>
        <div className="flex-1" />
        <Button size="sm" data-testid="pw-generate" disabled={noType} onClick={generate}>
          <RefreshCw aria-hidden className="size-3.5" /> {t('tools.password_generator.generate')}
        </Button>
      </div>

      <CodeEditor
        title={t('tools.password_generator.output_title')}
        language="plaintext"
        value={output}
        readOnly
        data-testid="pw-output"
        className="min-h-0 flex-1"
        searchAnchor="password_generator:output"
        actions={<CopyAction text={output} testId="pw-copy" />}
      />
    </div>
  );
}
