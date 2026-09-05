/**
 * IPv4 子网计算器 —— CIDR/掩码 → 网络/掩码/反掩码/广播/主机范围/二进制等,
 * 并支持子网划分预览(按新前缀列出前几个子网)。
 * 解析纯函数见 ipv4-subnet-utils.ts;本组件仅负责输入与结果展示。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, ScissorsLineDashed } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { describeIpv4Class, describeIpv4Scope } from './ip-parser';
import { parseCidr, splitSubnet } from './ipv4-subnet-utils';
import type { ToolProps } from './registry';

const fmt = new Intl.NumberFormat('en-US');

/** 点分十进制 → uint32 BigInt(用于复用 ip-parser 的分类/作用域描述) */
function ipToBigint(dotted: string): bigint {
  return dotted.split('.').reduce((acc, o) => (acc << 8n) | BigInt(Number(o)), 0n);
}

export function Ipv4SubnetCalculator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [splitPrefix, setSplitPrefix] = useState<string>('');
  const info = useMemo(() => parseCidr(raw), [raw]);

  const ipBig = info ? ipToBigint(info.ip) : null;
  const rows = info
    ? [
        {
          k: t('tools.ipv4_subnet_calculator.network_address'),
          v: `${info.network}/${info.prefix}`,
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
        {
          k: t('tools.ipv4_subnet_calculator.prefix_length'),
          v: `/${info.prefix}`,
          tid: undefined,
        },
        {
          k: t('tools.ipv4_subnet_calculator.host_bits'),
          v: String(32 - info.prefix),
          tid: undefined,
        },
        {
          k: t('tools.ipv4_subnet_calculator.ip_class'),
          v: t(describeIpv4Class(ipBig!)),
          tid: 'subnet-class',
        },
        {
          k: t('tools.ipv4_subnet_calculator.ip_scope'),
          v: t(describeIpv4Scope(ipBig!)),
          tid: 'subnet-scope',
        },
        { k: t('tools.ipv4_subnet_calculator.binary_ip'), v: info.binaryIp, tid: undefined },
        { k: t('tools.ipv4_subnet_calculator.binary_mask'), v: info.binaryMask, tid: undefined },
      ]
    : [];

  // 子网划分:默认选中第一个可用新前缀;网络地址为划分基点
  const splitOptions = info
    ? Array.from({ length: 32 - info.prefix }, (_, i) => info.prefix + 1 + i)
    : [];
  const effectiveSplitPrefix = splitOptions.includes(Number(splitPrefix))
    ? Number(splitPrefix)
    : (splitOptions[0] ?? null);
  const split =
    info && effectiveSplitPrefix !== null
      ? splitSubnet(
          info.network.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0),
          info.prefix,
          effectiveSplitPrefix,
        )
      : null;

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
            placeholder="192.168.1.10/24"
            spellCheck={false}
          />
        </ConfigRow>
        <ConfigRow
          icon={ScissorsLineDashed}
          label={t('tools.ipv4_subnet_calculator.split_title')}
          hint={
            info
              ? info.prefix >= 32
                ? t('tools.ipv4_subnet_calculator.split_unavailable')
                : undefined
              : undefined
          }
        >
          {info && info.prefix < 32 ? (
            <Select
              value={String(effectiveSplitPrefix)}
              onValueChange={setSplitPrefix}
              disabled={splitOptions.length === 0}
            >
              <SelectTrigger
                className="w-32"
                aria-label={t('tools.ipv4_subnet_calculator.split_new_prefix')}
                data-testid="subnet-split-prefix"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {splitOptions.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    /{p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
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
            <>
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
              {split && (
                <section
                  className="mt-3"
                  aria-label={t('tools.ipv4_subnet_calculator.split_title')}
                  data-testid="subnet-split"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span data-testid="subnet-split-count">
                      {t('tools.ipv4_subnet_calculator.split_subnet_count')}:
                      {fmt.format(split.subnetCount)}
                    </span>
                    <span data-testid="subnet-split-hosts">
                      {t('tools.ipv4_subnet_calculator.split_hosts_per_subnet')}:
                      {fmt.format(split.usablePerSubnet)}
                    </span>
                    {split.subnetCount > split.subnets.length && (
                      <span>
                        {t('tools.ipv4_subnet_calculator.split_limit_note', {
                          count: split.subnets.length,
                        })}
                      </span>
                    )}
                  </div>
                  <ul className="grid gap-1.5">
                    {split.subnets.map((s) => (
                      <li
                        key={s.network}
                        className="flex flex-wrap items-center justify-between gap-x-3 rounded border px-3 py-1.5 font-mono text-sm"
                        data-testid="subnet-split-item"
                      >
                        <span>
                          {s.network}/{split.newPrefix}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.firstHost} - {s.lastHost}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
