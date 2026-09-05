/**
 * 日期/时间戳转换器 —— 新代统一布局
 *
 * 结构(对齐 JsonFormatter 基准):
 * - 外层 shell 卡片,顶部为扁平「配置」区:当前时间横幅 + 输入(自动识别
 *   Unix 秒/毫秒/微秒/纳秒、浮点、负数、"now"、ISO 8601、常见日期字符串)
 *   + 时区(默认本地时区)。「现在」一键填入当前毫秒。
 * - 输入与时区变化后防抖自动转换(300ms),无需点击按钮。
 * - 下方结果区:多种格式逐行展示并支持单独复制;
 *   星期 / 相对时间经 Intl 随界面语言本地化。
 *
 * 错误处理遵循新代约定:工具内联 alert 展示。
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Globe2, TimerReset } from 'lucide-react';
import { formatError } from '@/lib/format-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface TimestampParams {
  timezone: string;
}

interface TimestampExtra {
  unix_seconds: number;
  unix_millis: number;
  iso8601: string;
  local: string;
  relative: string;
  /** 距当前的秒差(前端经 Intl.RelativeTimeFormat 本地化);旧后端无此字段 */
  relative_seconds?: number;
  /** ISO 星期 1=周一 … 7=周日;旧后端无此字段(前端按 unix_millis + Intl 计算) */
  weekday_index?: number;
  day_of_year?: number;
  iso_week?: number;
  /** 所选时区相对 UTC 的偏移,如 +08:00;旧后端无此字段 */
  utc_offset?: string;
}

/** 时区选项:local 表示跟随系统(运行时解析为 IANA 名称) */
const COMMON_TIMEZONES = [
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

/** 时区显示名:local 在运行时解析为实际 IANA 名称 */
function useTimezoneOptions(): { value: string; label: string }[] {
  const { t } = useTranslation();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return COMMON_TIMEZONES.map((tz) => ({
    value: tz,
    label:
      tz === 'local'
        ? `${t('tools.timestamp_converter.tz_local')}${localTz ? ` (${localTz})` : ''}`
        : tz,
  }));
}

/** 把 local 伪时区解析为真实 IANA 名称后再发给后端(后端只认 IANA / ±HH:MM) */
function resolveTimezone(tz: string): string {
  if (tz !== 'local') return tz;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** 把相对秒差选择最大合适单位后本地化格式化;缺失/非有限值(如旧后端缺字段)返回 null */
function formatRelative(seconds: number | undefined, locale: string): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs >= 365.25 * 86400) return rtf.format(Math.round(seconds / (365.25 * 86400)), 'year');
  if (abs >= 30 * 86400) return rtf.format(Math.round(seconds / (30 * 86400)), 'month');
  if (abs >= 7 * 86400) return rtf.format(Math.round(seconds / (7 * 86400)), 'week');
  if (abs >= 86400) return rtf.format(Math.round(seconds / 86400), 'day');
  if (abs >= 3600) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs >= 60) return rtf.format(Math.round(seconds / 60), 'minute');
  return rtf.format(seconds, 'second');
}

/** 数值字段展示:缺字段(旧后端响应)时显示占位,不参与计算 */
function numText(value: number | undefined): string {
  return value === undefined ? '-' : String(value);
}

/** 结果行:值 + 独立复制按钮 */
function ResultRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <dt className="font-semibold">{label}</dt>
      <dd className={mono ? 'break-all font-mono' : ''}>{value}</dd>
      <dd>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => void copyTextWithFeedback(value)}
        >
          {t('tools.timestamp_converter.copy')}
        </button>
      </dd>
    </>
  );
}

/** 当前时间横幅:本地计算,每秒刷新 */
function NowBanner(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const secs = Math.floor(now.getTime() / 1000);
  const millis = now.getTime();
  const local = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(now);
  return (
    <ConfigRow
      icon={TimerReset}
      label={t('tools.timestamp_converter.now_title')}
      searchAnchor="timestamp_converter:now"
    >
      <div className="flex items-center gap-2 text-right">
        <div className="text-xs leading-tight">
          <div className="font-mono">
            {t('tools.timestamp_converter.unix_seconds_short', { value: secs })}
          </div>
          <div className="font-mono text-muted-foreground">
            {t('tools.timestamp_converter.unix_millis_short', { value: millis })}
          </div>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{local}</span>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => void copyTextWithFeedback(String(millis))}
          data-testid="ts-now-copy"
        >
          {t('tools.timestamp_converter.copy')}
        </button>
      </div>
    </ConfigRow>
  );
}

export function TimestampConverter({ toolId }: ToolProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState('');
  const [timezone, setTimezone] = useState('local');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const tzOptions = useTimezoneOptions();
  // 防抖竞态防护:仅采纳最后一次请求的响应
  const requestSeq = useRef(0);

  const handleConvert = useCallback(
    async (input: string, tz: string) => {
      const seq = ++requestSeq.current;
      setConverting(true);
      setError(null);
      try {
        const params: TimestampParams = { timezone: resolveTimezone(tz) };
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: { text: input, params },
        });
        if (seq === requestSeq.current) setOutput(result);
      } catch (e) {
        if (seq === requestSeq.current) {
          setOutput(null);
          setError(formatError(e));
        }
      } finally {
        if (seq === requestSeq.current) setConverting(false);
      }
    },
    [toolId],
  );

  // 输入/时区变化防抖自动转换;空输入不发请求(旧结果在渲染层按输入派生屏蔽)
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const timer = window.setTimeout(() => void handleConvert(trimmed, timezone), 300);
    return () => window.clearTimeout(timer);
  }, [text, timezone, handleConvert]);

  const hasInput = text.trim() !== '';
  const visibleOutput = hasInput ? output : null;
  const visibleError = hasInput ? error : null;
  const showConverting = hasInput && converting;
  const extra = visibleOutput?.extra as TimestampExtra | undefined;

  /** 星期(随界面语言本地化):按所选时区计算;unix_millis 缺失/非法时不渲染 */
  const weekday = (() => {
    if (!extra || !Number.isFinite(extra.unix_millis)) return null;
    const tz = resolveTimezone(timezone);
    return new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: tz }).format(
      new Date(extra.unix_millis),
    );
  })();

  // relative_seconds 缺失(旧后端)时回退到后端英文文案,避免渲染崩溃
  const relative = extra
    ? (formatRelative(extra.relative_seconds, i18n.language) ?? extra.relative ?? '-')
    : null;

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与结果区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="timestamp-converter"
    >
      <ConfigSection title="" searchAnchor="timestamp_converter:config">
        <NowBanner />
        <ConfigRow
          icon={CalendarClock}
          label={t('tools.timestamp_converter.input')}
          hint={t('tools.timestamp_converter.input_hint')}
          searchAnchor="timestamp_converter:input"
        >
          <Input
            id="ts-input"
            placeholder={t('tools.timestamp_converter.input_placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-72 text-sm"
            data-testid="input"
          />
          {/* 与 Input 默认 h-9 对齐,保持同高 */}
          <Button
            variant="outline"
            onClick={() => setText(String(Date.now()))}
            data-testid="ts-now-btn"
          >
            {t('tools.timestamp_converter.now_btn')}
          </Button>
        </ConfigRow>
        <ConfigRow
          icon={Globe2}
          label={t('tools.timestamp_converter.timezone')}
          hint={t('tools.timestamp_converter.timezone_hint')}
        >
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-56" aria-label={t('tools.timestamp_converter.timezone')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tzOptions.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showConverting && (
            <span className="text-xs text-muted-foreground" data-testid="ts-converting">
              {t('tools.timestamp_converter.converting')}
            </span>
          )}
        </ConfigRow>
      </ConfigSection>

      {/* 配置区下方内容收进带内边距的滚动 wrapper(对齐 shell 布局基准) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {visibleError && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {visibleError}
          </div>
        )}

        {/* 结果区:常驻卡片承载,空态给引导文案;锚点保持 timestamp_converter:result */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card"
          data-testid="output"
          data-search-anchor="timestamp_converter:result"
        >
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <span className="pl-1 text-xs font-medium">
              {t('tools.timestamp_converter.result_title')}
            </span>
            {visibleOutput?.meta && (
              <span className="text-xs text-muted-foreground">
                {t('tools.timestamp_converter.bytes_unit', {
                  count: visibleOutput.meta.input_bytes,
                  ms: visibleOutput.meta.duration_ms,
                })}
              </span>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              {extra ? (
                <dl className="grid grid-cols-[180px_1fr_auto] gap-x-4 gap-y-3 text-sm">
                  <ResultRow
                    label={t('tools.timestamp_converter.unix_seconds')}
                    value={numText(extra.unix_seconds)}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.unix_millis')}
                    value={numText(extra.unix_millis)}
                  />
                  <ResultRow label="ISO 8601" value={extra.iso8601 ?? '-'} />
                  <ResultRow
                    label={t('tools.timestamp_converter.local_time', {
                      tz: resolveTimezone(timezone),
                    })}
                    value={extra.local ?? '-'}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.utc_offset')}
                    value={extra.utc_offset ?? '-'}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.weekday')}
                    value={weekday ?? '-'}
                    mono={false}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.day_of_year')}
                    value={numText(extra.day_of_year)}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.iso_week')}
                    value={numText(extra.iso_week)}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.relative_time')}
                    value={relative ?? '-'}
                    mono={false}
                  />
                </dl>
              ) : (
                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  {t('tools.timestamp_converter.empty_state')}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
