/**
 * IPv4 子网计算器 —— CIDR → 网络/掩码/反掩码/广播/主机范围。
 * 解析纯函数见 ipv4-subnet-utils.ts;本组件仅负责输入与结果展示。
 */
import { useMemo, useState, type JSX } from 'react';
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
  const [raw, setRaw] = useState('');
  const info = useMemo(() => parseCidr(raw), [raw]);

  const rows = info
    ? [
        {
          k: '网络地址',
          v: `${info.network}/${raw.includes('/') ? raw.split('/')[1] : '32'}`,
          tid: 'subnet-network',
        },
        { k: '子网掩码', v: info.netmask, tid: undefined },
        { k: '反掩码', v: info.wildcard, tid: undefined },
        { k: '广播地址', v: info.broadcast, tid: undefined },
        { k: '第一个可用主机', v: info.firstHost, tid: undefined },
        { k: '最后一个可用主机', v: info.lastHost, tid: undefined },
        { k: '总地址数', v: fmt.format(info.totalAddrs), tid: undefined },
        { k: '可用主机数', v: fmt.format(info.usableHosts), tid: 'subnet-hosts' },
      ]
    : [];

  useToolShortcutActions(toolId, {
    clearInput: () => setRaw(''),
    copyOutput: info
      ? () => void copyTextWithFeedback(rows.map((r) => `${r.k}: ${r.v}`).join('\n'))
      : undefined,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="ipv4-subnet-calculator">
      <ConfigSection title="" searchAnchor="ipv4_subnet_calculator:config">
        <ConfigRow icon={Network} label="CIDR" hint="如 192.168.1.10/24,省略前缀按 /32">
          <Input
            aria-label="CIDR"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="0.0.0.0/0"
            spellCheck={false}
          />
        </ConfigRow>
      </ConfigSection>
      <div
        className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-3"
        data-testid="output"
        data-search-anchor="ipv4_subnet_calculator:output"
      >
        {!info && raw.trim() !== '' && (
          <p role="alert" className="text-sm text-destructive">
            无法解析的 IPv4/CIDR 表达式
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
  );
}
