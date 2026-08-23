/**
 * IP 地址解析器
 *
 * - 输入 IPv4 / IPv6 地址或 CIDR(如 192.168.1.130/26、2001:db8::/48)
 * - 实时计算子网掩码、通配符掩码、CIDR 记法、网络/广播地址、可用主机范围等
 * - 参考 iplocation.net Lookup Summary 的信息卡布局展示结果
 * - 归属地与运营商信息(Country/Region/City/ISP/ASN 等)通过「查询归属地」
 *   按钮联网获取(ip-api.com 白名单例外,见 src-tauri/src/net/ip_lookup.rs)
 */

import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react';
import { Globe2, Loader2, Network } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { analyzeIp, IpParseError, type IpAnalysis } from './ip-parser';
import { extractLookupIp, lookupIpGeo, type IpGeoInfo } from './ip-geo';
import type { ToolProps } from './registry';

interface InfoItem {
  label: string;
  value: string;
  testId: string;
}

/** 将分析结果展开为信息卡片条目 */
function toInfoItems(a: IpAnalysis): InfoItem[] {
  if (a.version === 4) {
    const items: InfoItem[] = [
      { label: 'IP 地址', value: a.ip, testId: 'ip-item-address' },
      { label: '子网掩码', value: a.netmask, testId: 'ip-item-netmask' },
      { label: '通配符掩码', value: a.wildcard, testId: 'ip-item-wildcard' },
      { label: 'CIDR 记法', value: a.cidr, testId: 'ip-item-cidr' },
      { label: '前缀长度', value: `/${a.prefix}`, testId: 'ip-item-prefix' },
      { label: '网络地址', value: a.network, testId: 'ip-item-network' },
    ];
    if (a.broadcast !== null) {
      items.push({ label: '广播地址', value: a.broadcast, testId: 'ip-item-broadcast' });
    }
    items.push(
      {
        label: '可用主机范围',
        value: a.firstHost === a.lastHost ? a.firstHost : `${a.firstHost} - ${a.lastHost}`,
        testId: 'ip-item-hosts',
      },
      { label: '可用主机数', value: a.usableHosts.toString(), testId: 'ip-item-usable' },
      { label: '总地址数', value: a.totalAddresses.toString(), testId: 'ip-item-total' },
      { label: '地址类型', value: a.scope, testId: 'ip-item-scope' },
      { label: '传统分类', value: a.ipClass, testId: 'ip-item-class' },
      { label: '整数表示', value: a.intValue.toString(), testId: 'ip-item-int' },
      { label: '十六进制', value: a.hex, testId: 'ip-item-hex' },
      { label: '二进制', value: a.binary, testId: 'ip-item-binary' },
    );
    return items;
  }
  return [
    { label: 'IP 地址', value: a.ip, testId: 'ip-item-address' },
    { label: '完全展开形式', value: a.full, testId: 'ip-item-full' },
    { label: 'CIDR 记法', value: a.cidr, testId: 'ip-item-cidr' },
    { label: '前缀长度', value: `/${a.prefix}`, testId: 'ip-item-prefix' },
    { label: '网络地址', value: `${a.network}/${a.prefix}`, testId: 'ip-item-network' },
    { label: '子网末地址', value: a.lastAddress, testId: 'ip-item-last' },
    { label: '总地址数', value: a.totalAddresses.toString(), testId: 'ip-item-total' },
    { label: '地址类型', value: a.scope, testId: 'ip-item-scope' },
  ];
}

/** 归属地信息卡条目(label 对齐 iplocation.net 卡片风格,value 为渲染节点) */
interface GeoItem {
  label: string;
  testId: string;
  value: ReactNode;
  /** 复制用纯文本 */
  copyText: string;
}

const UNAVAILABLE = '不可用';

/** 将归属地结果展开为卡片条目(字段与布局对齐参考截图) */
function toGeoItems(info: IpGeoInfo): GeoItem[] {
  return [
    {
      label: 'Country',
      testId: 'ip-geo-card-country',
      value: (
        <span className="inline-flex items-center gap-2">
          {info.flagDataUri ? (
            <img
              src={info.flagDataUri}
              alt=""
              data-testid="ip-geo-flag"
              className="inline-block h-3.5 w-auto rounded-[2px] ring-1 ring-border"
            />
          ) : info.countryCode ? (
            <span className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] leading-none">
              {info.countryCode.toUpperCase()}
            </span>
          ) : null}
          {info.country ?? UNAVAILABLE}
        </span>
      ),
      copyText: info.country ?? UNAVAILABLE,
    },
    {
      label: 'Region',
      testId: 'ip-geo-card-region',
      value: info.region ?? UNAVAILABLE,
      copyText: info.region ?? UNAVAILABLE,
    },
    {
      label: 'City',
      testId: 'ip-geo-card-city',
      value: info.city ?? UNAVAILABLE,
      copyText: info.city ?? UNAVAILABLE,
    },
    {
      label: 'Org&ISP',
      testId: 'ip-geo-card-org',
      value: info.orgIsp ?? UNAVAILABLE,
      copyText: info.orgIsp ?? UNAVAILABLE,
    },
    {
      label: 'Network Type',
      testId: 'ip-geo-card-network',
      value: info.networkType,
      copyText: info.networkType,
    },
    {
      label: 'ASN',
      testId: 'ip-geo-card-asn',
      value: info.asnNumber !== null ? info.asnNumber.toString() : UNAVAILABLE,
      copyText: info.asnNumber !== null ? info.asnNumber.toString() : UNAVAILABLE,
    },
    {
      label: 'Time Zone',
      testId: 'ip-geo-card-timezone',
      value: info.timezoneDisplay ?? UNAVAILABLE,
      copyText: info.timezoneDisplay ?? UNAVAILABLE,
    },
    {
      label: 'Postal Code',
      testId: 'ip-geo-card-postal',
      value: info.postalCode ?? UNAVAILABLE,
      copyText: info.postalCode ?? UNAVAILABLE,
    },
  ];
}

type GeoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; info: IpGeoInfo }
  | { status: 'error'; message: string };

export function IpParser(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });

  const parsed = useMemo<{ result?: IpAnalysis; error?: string }>(() => {
    const text = input.trim();
    if (!text) return {};
    try {
      return { result: analyzeIp(text) };
    } catch (e) {
      return { error: e instanceof IpParseError ? e.message : String(e) };
    }
  }, [input]);

  const infoItems = parsed.result ? toInfoItems(parsed.result) : [];

  /** 手动触发归属地查询:留空输入时查询本机公网 IP */
  const handleGeoQuery = useCallback(async () => {
    setGeo({ status: 'loading' });
    try {
      const info = await lookupIpGeo(extractLookupIp(input));
      setGeo({ status: 'done', info });
    } catch (e) {
      setGeo({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [input]);

  const geoItems = geo.status === 'done' ? toGeoItems(geo.info) : [];

  return (
    <div className="flex h-full flex-col gap-3" data-testid="ip-parser">
      {/* 查询摘要头部:大号 IP + 类型徽章 */}
      {parsed.result ? (
        <section
          aria-label="查询摘要"
          data-search-anchor="ip_parser:summary"
          className="rounded-lg border border-border bg-card px-4 py-3 shadow-card"
        >
          <p className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">解析结果</p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 data-testid="ip-summary-address" className="break-all font-mono text-2xl font-bold">
              {parsed.result.ip}
            </h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              IPv{parsed.result.version}
            </span>
            <span
              data-testid="ip-summary-type"
              className={
                parsed.result.scope.includes('公网') || parsed.result.scope.includes('全球单播')
                  ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400'
                  : 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400'
              }
            >
              {parsed.result.scope}
            </span>
          </div>
        </section>
      ) : null}

      <ConfigSection title="" searchAnchor="ip_parser:input">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Globe2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如 192.168.1.130/26 或 2001:db8::1"
              aria-label="IP 地址或 CIDR"
              data-testid="ip-input"
              spellCheck={false}
              className="h-8 border-0 p-0 font-mono text-body-sm shadow-none focus-visible:ring-0"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              支持 IPv4 / IPv6 地址与 CIDR 前缀长度,留空前缀时按单主机(/32 或 /128)处理
            </p>
          </div>
          <CopyAction text={input.trim()} testId="ip-copy-input" />
        </div>
      </ConfigSection>

      {parsed.error ? (
        <p
          data-testid="ip-error"
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-body-sm text-destructive"
        >
          {parsed.error}
        </p>
      ) : null}

      {!parsed.result && !parsed.error ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          输入 IP 地址后自动解析网络信息
        </p>
      ) : null}

      {/* 归属地与运营商(联网查询,手动触发):布局对齐 iplocation.net Lookup Summary */}
      <section
        aria-label="归属地与运营商"
        data-search-anchor="ip_parser:geo"
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-body-sm font-semibold">归属地与运营商</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleGeoQuery()}
            disabled={geo.status === 'loading'}
            data-testid="ip-geo-query"
          >
            {geo.status === 'loading' ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Globe2 aria-hidden className="size-3.5" />
            )}
            {geo.status === 'loading' ? '查询中…' : '查询归属地'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          查询需联网:仅将待查 IP 发送至 ip-api.com 在线服务;输入为空时查询本机公网 IP
        </p>

        {geo.status === 'error' ? (
          <p
            data-testid="ip-geo-error"
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-body-sm text-destructive"
          >
            {geo.message}
          </p>
        ) : null}

        {geoItems.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {geoItems.map((item) => (
              <div
                key={item.testId}
                data-testid={item.testId}
                className="group rounded-lg border border-border bg-card px-4 py-3 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold tracking-wide text-primary uppercase">
                    {item.label}
                  </p>
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <CopyAction text={item.copyText} testId={`${item.testId}-copy`} />
                  </span>
                </div>
                <div className="mt-1 break-all text-body-sm font-bold">{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* 信息卡网格 */}
      {infoItems.length > 0 ? (
        <section
          aria-label="网络信息"
          data-search-anchor="ip_parser:result"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 overflow-y-auto pr-0.5">
            {infoItems.map((item) => (
              <div
                key={item.testId}
                data-testid={item.testId}
                className="group rounded-lg border border-border bg-card px-4 py-3 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {item.label}
                  </p>
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <CopyAction text={item.value} testId={`${item.testId}-copy`} />
                  </span>
                </div>
                <p className="mt-1 break-all font-mono text-body-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Network aria-hidden className="size-3.5" />
            子网计算均在本地离线完成;归属地数据仅在点击「查询归属地」时联网获取
          </div>
        </section>
      ) : null}
    </div>
  );
}
