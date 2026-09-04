/**
 * 日期/时间戳转换器 —— 新代统一布局
 *
 * 结构(对齐 JsonFormatter 基准):
 * - 外层 shell 卡片,顶部为扁平「配置」区:输入(Unix 秒 / 毫秒 / 日期字符串)+ 时区 + 执行按钮
 * - 下方结果区:带标题栏的卡片,字段逐行展示并支持单独复制
 *
 * 错误处理遵循新代约定:工具内联 alert 展示。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Globe2 } from 'lucide-react';
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
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

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

export function TimestampConverter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: TimestampParams = { timezone };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      setOutput(null);
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  const extra = output?.extra as TimestampExtra | undefined;

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与结果区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="timestamp-converter"
    >
      <ConfigSection title="" searchAnchor="timestamp_converter:config">
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
        </ConfigRow>
        <ConfigRow
          icon={Globe2}
          label={t('tools.timestamp_converter.timezone')}
          hint={t('tools.timestamp_converter.timezone_hint')}
        >
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-48" aria-label={t('tools.timestamp_converter.timezone')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void handleConvert()} disabled={loading || !text} size="sm">
            {loading
              ? t('tools.timestamp_converter.converting')
              : t('tools.timestamp_converter.convert')}
          </Button>
        </ConfigRow>
      </ConfigSection>

      {/* 配置区下方内容收进带内边距的滚动 wrapper(对齐 shell 布局基准) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
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
            {output?.meta && (
              <span className="text-xs text-muted-foreground">
                {t('tools.timestamp_converter.bytes_unit', {
                  count: output.meta.input_bytes,
                  ms: output.meta.duration_ms,
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
                    value={String(extra.unix_seconds)}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.unix_millis')}
                    value={String(extra.unix_millis)}
                  />
                  <ResultRow label="ISO 8601" value={extra.iso8601} />
                  <ResultRow
                    label={t('tools.timestamp_converter.local_time', { tz: timezone })}
                    value={extra.local}
                  />
                  <ResultRow
                    label={t('tools.timestamp_converter.relative_time')}
                    value={extra.relative}
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

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */
