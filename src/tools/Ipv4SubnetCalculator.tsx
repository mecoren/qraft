/**
 * IPv4 子网计算器 —— CIDR → 网络/掩码/反掩码/广播/主机范围。
 * 解析纯函数见 ipv4-subnet-utils.ts;本组件仅负责输入与结果展示。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Network } from 'lucide-react';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { parseCidr } from './ipv4-subnet-utils';
import type { ToolProps } from './registry';

const fmt = new Intl.NumberFormat('en-US');

export function Ipv4SubnetCalculator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const info = useMemo(() => parseCidr(raw), [raw]);

  const rows = info
    ? [
        {
          k: t('tools.ipv4_subnet_calculator.network_address'),
          v: `${info.network}/${raw.includes('/') ? raw.split('/')[1] : '32'}`,
          tid: 'subnet-network',
        },
        { k: t('tools.ipv4_subnet_calculator.netmask'), v: info.netmask, tid: undefined },
        { k: t('tools.ipv4_subnet_calculator.wildcard_mask'), v: info.wildcard, tid: undefined },
        {
          k: t('tools.ipv4_subnet_calculator.broadcast_address'),
          v: info.broadcast,
          tid: undefined,
        },
        { k: t('tools.ipv4_subnet_calculator.first_host'), v: info.firstHost, tid: undefined },
        { k: t('tools.ipv4_subnet_calculator.last_host'), v: info.lastHost, tid: undefined },
        {
          k: t('tools.ipv4_subnet_calculator.total_addresses'),
          v: fmt.format(info.totalAddrs),
          tid: undefined,
        },
        {
          k: t('tools.ipv4_subnet_calculator.usable_hosts'),
          v: fmt.format(info.usableHosts),
          tid: 'subnet-hosts',
        },
      ]
    : [];

  useToolShortcutActions(toolId, {
    clearInput: () => setRaw(''),
    copyOutput: info
      ? () => void copyTextWithFeedback(rows.map((r) => `${r.k}: ${r.v}`).join('\n'))
      : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与结果区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="ipv4-subnet-calculator"
    >
      <ConfigSection title="" searchAnchor="ipv4_subnet_calculator:config">
        <ConfigRow icon={Network} label="CIDR" hint={t('tools.ipv4_subnet_calculator.cidr_hint')}>
          <Input
            aria-label="CIDR"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="0.0.0.0/0"
            spellCheck={false}
          />
        </ConfigRow>
      </ConfigSection>
      {/* 结果区收进带内边距的 wrapper,卡片内部自行滚动(对齐 shell 布局基准) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <div
          className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-3"
          data-testid="output"
          data-search-anchor="ipv4_subnet_calculator:output"
        >
          {!info && raw.trim() !== '' && (
            <p role="alert" className="text-sm text-destructive">
              {t('tools.ipv4_subnet_calculator.parse_error')}
            </p>
          )}
          {info && (
            <dl className="grid gap-2">
              {rows.map((r) => (
                <div
                  key={r.k}
                  className="flex items-center justify-between rounded border px-3 py-1.5"
                >
                  <dt className="text-xs text-muted-foreground">{r.k}</dt>
                  <dd className="flex items-center gap-2 font-mono text-sm" data-testid={r.tid}>
                    {r.v}
                    <CopyAction text={r.v} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
