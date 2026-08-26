/**
 * 日期/时间戳转换器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:输入(Unix 秒 / 毫秒 / 日期字符串)+ 时区 + 执行按钮
 * - 下方结果区:带标题栏的卡片,字段逐行展示并支持单独复制
 *
 * 错误处理遵循新代约定:工具内联 alert 展示。
 */
import { useState, type JSX } from 'react';
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
          复制
        </button>
      </dd>
    </>
  );
}

export function TimestampConverter({ toolId }: ToolProps): JSX.Element {
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
    <div className="flex h-full flex-col gap-3" data-testid="timestamp-converter">
      <ConfigSection title="" searchAnchor="timestamp_converter:config">
        <ConfigRow
          icon={CalendarClock}
          label="输入"
          hint="Unix 秒 / 毫秒 / 日期字符串"
          searchAnchor="timestamp_converter:input"
        >
          <Input
            id="ts-input"
            placeholder="输入时间戳或日期字符串..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-72 font-mono text-sm"
            data-testid="input"
          />
        </ConfigRow>
        <ConfigRow icon={Globe2} label="时区" hint="本地时间展示所用时区">
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-48" aria-label="时区">
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
            {loading ? '转换中...' : '转换'}
          </Button>
        </ConfigRow>
      </ConfigSection>

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
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-card"
        data-testid="output"
        data-search-anchor="timestamp_converter:result"
      >
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="pl-1 text-xs font-medium">转换结果</span>
          {output?.meta && (
            <span className="text-xs text-muted-foreground">
              {output.meta.input_bytes} 字节 · {output.meta.duration_ms}ms
            </span>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {extra ? (
              <dl className="grid grid-cols-[180px_1fr_auto] gap-x-4 gap-y-3 text-sm">
                <ResultRow label="Unix(秒)" value={String(extra.unix_seconds)} />
                <ResultRow label="Unix(毫秒)" value={String(extra.unix_millis)} />
                <ResultRow label="ISO 8601" value={extra.iso8601} />
                <ResultRow label={`本地时间(${timezone})`} value={extra.local} />
                <ResultRow label="相对时间" value={extra.relative} mono={false} />
              </dl>
            ) : (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                输入时间戳后点击「转换」查看各格式结果
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */

