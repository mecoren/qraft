/**
 * Cron 表达式解析器
 *
 * - cronstrue:表达式 → 中文描述
 * - cron-parser:计算下 N 次执行时间
 * - 支持 5 段(标准)与 6 段(含秒)模式
 */

import { useMemo, useState, type JSX } from 'react';
import { CalendarClock, Clock, ListOrdered } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { CronExpressionParser } from 'cron-parser';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ToolProps } from './registry';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ParsedResult = null | { error: string } | { description: string; next: string[] };

export function CronParser(_props: ToolProps): JSX.Element {
  const [expr, setExpr] = useState('0 0 * * *');
  const [withSeconds, setWithSeconds] = useState(false);
  const [count, setCount] = useState(5);

  const parsed = useMemo<ParsedResult>(() => {
    const text = expr.trim();
    if (!text) return null;
    const parts = text.split(/\s+/);
    if (withSeconds && parts.length !== 6) {
      return { error: '包含秒的 Cron 表达式应为 6 段' };
    }
    if (!withSeconds && parts.length !== 5) {
      return { error: '标准 Cron 表达式应为 5 段(分 时 日 月 周)' };
    }
    let description: string;
    try {
      description = cronstrue.toString(text, { locale: 'zh_CN', use24HourTimeFormat: true });
    } catch (e) {
      return {
        error: `表达式无效: ${typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)}`,
      };
    }
    try {
      const interval = CronExpressionParser.parse(text, { currentDate: new Date() });
      const n = Math.min(Math.max(count, 1), 100);
      const next: string[] = [];
      for (let i = 0; i < n; i++) {
        next.push(fmt(interval.next().toDate()));
      }
      return { description, next };
    } catch (e) {
      return { error: `计算执行时间失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }, [expr, withSeconds, count]);

  const nextText = parsed && 'next' in parsed ? parsed.next.join('\n') : '';

  return (
    <div className="flex h-full flex-col gap-3" data-testid="cron-parser">
      <ConfigSection title="">
        <ConfigRow icon={Clock} label="包含秒" hint="6 段模式(秒 分 时 日 月 周)">
          <Switch
            checked={withSeconds}
            onCheckedChange={setWithSeconds}
            aria-label="包含秒"
            data-testid="cron-seconds"
          />
        </ConfigRow>
        <ConfigRow icon={ListOrdered} label="计划任务数量">
          <Input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            aria-label="计划任务数量"
            data-testid="cron-count"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
      </ConfigSection>

      <section aria-label="Cron 表达式">
        <h2 className="mb-1.5 text-body-sm font-semibold">Cron 表达式</h2>
        <Input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder={withSeconds ? '0 0 0 * * *' : '0 0 * * *'}
          aria-label="Cron 表达式"
          data-testid="cron-expr"
          className="h-9 font-mono text-body-sm"
        />
      </section>

      {/* 描述 */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
        <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {parsed === null ? (
          <p className="text-xs text-muted-foreground">输入表达式后自动解析</p>
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
      <section aria-label="计划的日期" className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">接下来的计划日期</h2>
          <CopyAction text={nextText} testId="cron-copy" />
        </div>
        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card shadow-card">
          {parsed && 'next' in parsed ? (
            <ul className="divide-y divide-border">
              {parsed.next.map((t) => (
                <li
                  key={t}
                  className="px-4 py-2 font-mono text-body-sm"
                  data-testid="cron-next-item"
                >
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-foreground">-</p>
          )}
        </ScrollArea>
      </section>
    </div>
  );
}
