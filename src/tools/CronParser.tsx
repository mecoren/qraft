/**
 * Cron 表达式解析器
 *
 * - cronstrue:表达式 → 中文描述
 * - cron-parser:计算下 N 次 / 上 N 次执行时间(按所选时区迭代)
 * - 支持 5 段(标准)与 6 段(含秒)模式;常用表达式预设一键填入
 * - 时区语义:默认按本地时区计算执行时间(修复按 UTC 迭代的偏差),
 *   也可显式选择 UTC / 常用时区
 */

import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock, Globe2, ListOrdered } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { CronExpressionParser } from 'cron-parser';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ToolProps } from './registry';

/** 时区选项:local 表示跟随系统(运行时解析为 IANA 名称) */
const TIMEZONE_OPTIONS = [
  'local',
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

/** 常用表达式预设(5 段;含秒模式下自动补 "0 " 秒位) */
const PRESETS: readonly { expr: string; key: string }[] = [
  { expr: '* * * * *', key: 'preset_every_minute' },
  { expr: '*/5 * * * *', key: 'preset_every_5_minutes' },
  { expr: '0 * * * *', key: 'preset_hourly' },
  { expr: '0 0 * * *', key: 'preset_daily' },
  { expr: '0 9 * * 1-5', key: 'preset_weekday_morning' },
  { expr: '0 0 * * 0', key: 'preset_weekly_sunday' },
  { expr: '0 0 1 * *', key: 'preset_monthly' },
  { expr: '0 0 1 1 *', key: 'preset_yearly' },
];

/** 字段标签(按 5 段 / 6 段顺序;6 段模式首列追加秒) */
const FIELD_LABEL_KEYS_5 = [
  'tools.cron_parser.field_minute',
  'tools.cron_parser.field_hour',
  'tools.cron_parser.field_dom',
  'tools.cron_parser.field_month',
  'tools.cron_parser.field_dow',
] as const;
const FIELD_LABEL_KEYS_6 = ['tools.cron_parser.field_second', ...FIELD_LABEL_KEYS_5] as const;

const DT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

/** 按时区格式化为 `YYYY-MM-DD HH:mm:ss`;tz 为 null 时跟随系统本地时区 */
function fmtInTz(d: Date, tz: string | null): string {
  const formatter = new Intl.DateTimeFormat(
    'en-CA',
    tz ? { ...DT_FORMAT_OPTIONS, timeZone: tz } : DT_FORMAT_OPTIONS,
  );
  const parts = formatter.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

type ParsedResult =
  null | { error: string } | { description: string; next: string[]; prev: string[] };

export function CronParser(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [expr, setExpr] = useState('0 0 * * *');
  const [withSeconds, setWithSeconds] = useState(false);
  const [count, setCount] = useState(5);
  const [timezone, setTimezone] = useState<string>('local');

  const parsed = useMemo<ParsedResult>(() => {
    const text = expr.trim();
    if (!text) return null;
    const parts = text.split(/\s+/);
    if (withSeconds && parts.length !== 6) {
      return { error: t('tools.cron_parser.error_seconds_required') };
    }
    if (!withSeconds && parts.length !== 5) {
      return { error: t('tools.cron_parser.error_five_parts_required') };
    }
    let description: string;
    try {
      description = cronstrue.toString(text, { locale: 'zh_CN', use24HourTimeFormat: true });
    } catch (e) {
      return {
        error: t('tools.cron_parser.error_invalid_expression', {
          message: typeof e === 'string' ? e : e instanceof Error ? e.message : String(e),
        }),
      };
    }
    // local 选项在运行时解析为实际 IANA 名称;解析失败(极端环境)回退按 UTC
    const tz =
      timezone === 'local' ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? null) : timezone;
    try {
      const n = Math.min(Math.max(count, 1), 100);
      const collect = (dir: 'next' | 'prev'): string[] => {
        const interval = CronExpressionParser.parse(text, {
          currentDate: new Date(),
          ...(tz ? { tz } : {}),
        });
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          out.push(fmtInTz(interval[dir]().toDate(), tz));
        }
        return out;
      };
      return { description, next: collect('next'), prev: collect('prev') };
    } catch (e) {
      return {
        error: t('tools.cron_parser.error_compute_failed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [expr, withSeconds, count, timezone, t]);

  const nextText = parsed && 'next' in parsed ? parsed.next.join('\n') : '';
  const prevText = parsed && 'prev' in parsed ? parsed.prev.join('\n') : '';
  const fieldLabelKeys = withSeconds ? FIELD_LABEL_KEYS_6 : FIELD_LABEL_KEYS_5;
  const parts = useMemo(() => expr.trim().split(/\s+/), [expr]);

  const applyPreset = (preset: string): void => {
    setExpr(withSeconds ? `0 ${preset}` : preset);
  };

  const renderDateList = (dates: string[], testId: string): JSX.Element => (
    <ScrollArea className="rounded-md border border-border bg-card">
      <ul className="divide-y divide-border">
        {dates.map((d) => (
          <li key={d} className="px-4 py-2 font-mono text-body-sm" data-testid={testId}>
            {d}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );

  return (
    // 外层 shell 卡片:秒/数量/时区为顶部扁平配置区,表达式与结果收进滚动内容区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="cron-parser"
    >
      <ConfigSection title="" searchAnchor="cron_parser:config">
        <ConfigRow
          icon={Clock}
          label={t('tools.cron_parser.include_seconds')}
          hint={t('tools.cron_parser.include_seconds_hint')}
        >
          <Switch
            checked={withSeconds}
            onCheckedChange={setWithSeconds}
            aria-label={t('tools.cron_parser.include_seconds')}
            data-testid="cron-seconds"
          />
        </ConfigRow>
        <ConfigRow icon={ListOrdered} label={t('tools.cron_parser.task_count')}>
          <Input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            aria-label={t('tools.cron_parser.task_count')}
            data-testid="cron-count"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
        <ConfigRow
          icon={Globe2}
          label={t('tools.cron_parser.timezone_label')}
          hint={t('tools.cron_parser.timezone_hint')}
        >
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger
              className="w-52"
              aria-label={t('tools.cron_parser.timezone_label')}
              data-testid="cron-timezone"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz === 'local' ? t('tools.cron_parser.timezone_local') : tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <section
          aria-label={t('tools.cron_parser.expression_label')}
          data-search-anchor="cron_parser:expression"
        >
          <h2 className="mb-1.5 text-body-sm font-semibold">
            {t('tools.cron_parser.expression_label')}
          </h2>
          <Input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder={withSeconds ? '0 0 0 * * *' : '0 0 * * *'}
            aria-label={t('tools.cron_parser.expression_label')}
            data-testid="cron-expr"
            className="h-9 text-body-sm"
          />
          {/* 字段标签行:当前表达式的各段含义 */}
          {parts.length >= 5 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="cron-field-labels">
              {fieldLabelKeys.map((key, i) => (
                <span
                  key={key}
                  className="flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5"
                >
                  <code className="font-mono text-xs text-foreground">{parts[i] ?? '-'}</code>
                  <span className="text-xs text-muted-foreground">{t(key)}</span>
                </span>
              ))}
            </div>
          )}
          {/* 常用表达式预设 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="cron-presets">
            {PRESETS.map((p) => (
              <button
                key={p.expr}
                type="button"
                onClick={() => applyPreset(p.expr)}
                className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(`tools.cron_parser.${p.key}`)}
              </button>
            ))}
          </div>
        </section>

        {/* 描述 */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-4 py-3">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {parsed === null ? (
            <p className="text-xs text-muted-foreground">{t('tools.cron_parser.empty_hint')}</p>
          ) : 'error' in parsed ? (
            <p data-testid="cron-error" className="text-body-sm text-destructive">
              {parsed.error}
            </p>
          ) : (
            <p data-testid="cron-description" className="text-body-sm">
              {parsed.description}
            </p>
          )}
        </div>

        {/* 下次执行时间 */}
        <section
          aria-label={t('tools.cron_parser.scheduled_dates_aria')}
          className="flex flex-col"
          data-search-anchor="cron_parser:result"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-body-sm font-semibold">{t('tools.cron_parser.upcoming_dates')}</h2>
            <CopyAction text={nextText} testId="cron-copy" />
          </div>
          {parsed && 'next' in parsed ? (
            renderDateList(parsed.next, 'cron-next-item')
          ) : (
            <ScrollArea className="rounded-md border border-border bg-card">
              <p className="px-4 py-3 text-xs text-muted-foreground">-</p>
            </ScrollArea>
          )}
        </section>

        {/* 上次执行时间(独立迭代器,避免与 next 共用游标) */}
        <section
          aria-label={t('tools.cron_parser.previous_dates')}
          className="flex flex-col"
          data-search-anchor="cron_parser:prev"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-body-sm font-semibold">{t('tools.cron_parser.previous_dates')}</h2>
            <CopyAction text={prevText} testId="cron-copy-prev" />
          </div>
          {parsed && 'prev' in parsed ? (
            renderDateList(parsed.prev, 'cron-prev-item')
          ) : (
            <ScrollArea className="rounded-md border border-border bg-card">
              <p className="px-4 py-3 text-xs text-muted-foreground">-</p>
            </ScrollArea>
          )}
        </section>
      </div>
    </div>
  );
}
