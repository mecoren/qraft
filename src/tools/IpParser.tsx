/**
 * IP 地址解析器
 *
 * - 输入 IPv4 / IPv6 地址或 CIDR(如 192.168.1.130/26、2001:db8::/48)
 * - 实时计算子网掩码、通配符掩码、CIDR 记法、网络/广播地址、可用主机范围等
 * - 参考 iplocation.net Lookup Summary 的信息卡布局展示结果
 * - 归属地与运营商信息(Country/Region/City/ISP/ASN 等)通过「查询归属地」
 *   按钮联网获取(ip-api.com 白名单例外,见 src-tauri/src/net/ip_lookup.rs)
 */

import { useCallback, useDeferredValue, useMemo, useState, type JSX, type ReactNode } from 'react';
import { Globe2, Loader2, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { t } from '@/i18n';
import { analyzeIp, IpParseError, IP_PUBLIC_SCOPE_KEYS, type IpAnalysis } from './ip-parser';
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
      { label: t('tools.ip_parser.field_ip'), value: a.ip, testId: 'ip-item-address' },
      { label: t('tools.ip_parser.field_netmask'), value: a.netmask, testId: 'ip-item-netmask' },
      { label: t('tools.ip_parser.field_wildcard'), value: a.wildcard, testId: 'ip-item-wildcard' },
      { label: t('tools.ip_parser.field_cidr'), value: a.cidr, testId: 'ip-item-cidr' },
      {
        label: t('tools.ip_parser.field_prefix_len'),
        value: `/${a.prefix}`,
        testId: 'ip-item-prefix',
      },
      { label: t('tools.ip_parser.field_network'), value: a.network, testId: 'ip-item-network' },
    ];
    if (a.broadcast !== null) {
      items.push({
        label: t('tools.ip_parser.field_broadcast'),
        value: a.broadcast,
        testId: 'ip-item-broadcast',
      });
    }
    items.push(
      {
        label: t('tools.ip_parser.field_host_range'),
        value: a.firstHost === a.lastHost ? a.firstHost : `${a.firstHost} - ${a.lastHost}`,
        testId: 'ip-item-hosts',
      },
      {
        label: t('tools.ip_parser.field_usable_hosts'),
        value: a.usableHosts.toString(),
        testId: 'ip-item-usable',
      },
      {
        label: t('tools.ip_parser.field_total_addresses'),
        value: a.totalAddresses.toString(),
        testId: 'ip-item-total',
      },
      { label: t('tools.ip_parser.field_scope'), value: t(a.scope), testId: 'ip-item-scope' },
      {
        label: t('tools.ip_parser.field_class'),
        value: t(a.ipClass),
        testId: 'ip-item-class',
      },
      {
        label: t('tools.ip_parser.field_int'),
        value: a.intValue.toString(),
        testId: 'ip-item-int',
      },
      { label: t('tools.ip_parser.field_hex'), value: a.hex, testId: 'ip-item-hex' },
      { label: t('tools.ip_parser.field_binary'), value: a.binary, testId: 'ip-item-binary' },
    );
    return items;
  }
  return [
    { label: t('tools.ip_parser.field_ip'), value: a.ip, testId: 'ip-item-address' },
    { label: t('tools.ip_parser.field_full_form'), value: a.full, testId: 'ip-item-full' },
    { label: t('tools.ip_parser.field_cidr'), value: a.cidr, testId: 'ip-item-cidr' },
    {
      label: t('tools.ip_parser.field_prefix_len'),
      value: `/${a.prefix}`,
      testId: 'ip-item-prefix',
    },
    {
      label: t('tools.ip_parser.field_network'),
      value: `${a.network}/${a.prefix}`,
      testId: 'ip-item-network',
    },
    {
      label: t('tools.ip_parser.field_last_address'),
      value: a.lastAddress,
      testId: 'ip-item-last',
    },
    {
      label: t('tools.ip_parser.field_total_addresses'),
      value: a.totalAddresses.toString(),
      testId: 'ip-item-total',
    },
    { label: t('tools.ip_parser.field_scope'), value: t(a.scope), testId: 'ip-item-scope' },
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

/** 将归属地结果展开为卡片条目(字段与布局对齐参考截图) */
function toGeoItems(info: IpGeoInfo): GeoItem[] {
  const unavailable = t('tools.ip_parser.unavailable');
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
          {info.country ?? unavailable}
        </span>
      ),
      copyText: info.country ?? unavailable,
    },
    {
      label: 'Region',
      testId: 'ip-geo-card-region',
      value: info.region ?? unavailable,
      copyText: info.region ?? unavailable,
    },
    {
      label: 'City',
      testId: 'ip-geo-card-city',
      value: info.city ?? unavailable,
      copyText: info.city ?? unavailable,
    },
    {
      label: 'Org&ISP',
      testId: 'ip-geo-card-org',
      value: info.orgIsp ?? unavailable,
      copyText: info.orgIsp ?? unavailable,
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
      value: info.asnNumber !== null ? info.asnNumber.toString() : unavailable,
      copyText: info.asnNumber !== null ? info.asnNumber.toString() : unavailable,
    },
    {
      label: 'Time Zone',
      testId: 'ip-geo-card-timezone',
      value: info.timezoneDisplay ?? unavailable,
      copyText: info.timezoneDisplay ?? unavailable,
    },
    {
      label: 'Postal Code',
      testId: 'ip-geo-card-postal',
      value: info.postalCode ?? unavailable,
      copyText: info.postalCode ?? unavailable,
    },
  ];
}

type GeoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; info: IpGeoInfo }
  | { status: 'error'; message: string };

export function IpParser(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  // analyzeIp 对超长/畸形输入逐字符回溯:defer 输入,解析低优先级追赶
  const deferredInput = useDeferredValue(input);

  const parsed = useMemo<{ result?: IpAnalysis; error?: string }>(() => {
    const text = deferredInput.trim();
    if (!text) return {};
    try {
      return { result: analyzeIp(text) };
    } catch (e) {
      return { error: e instanceof IpParseError ? e.message : String(e) };
    }
  }, [deferredInput]);

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
    // 外层 shell 卡片:输入区固定为顶部扁平配置区,
    // 摘要 / 错误 / 归属地 / 信息卡收进下方统一滚动内容区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="ip-parser"
    >
      <ConfigSection title="" searchAnchor="ip_parser:input">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Globe2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('tools.ip_parser.input_placeholder')}
              aria-label={t('tools.ip_parser.input_aria')}
              data-testid="ip-input"
              spellCheck={false}
              className="h-8 text-body-sm"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('tools.ip_parser.input_hint')}
            </p>
          </div>
          <CopyAction text={input.trim()} testId="ip-copy-input" />
        </div>
      </ConfigSection>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {/* 查询摘要头部:大号 IP + 类型徽章 */}
        {parsed.result ? (
          <section
            aria-label={t('tools.ip_parser.summary_aria')}
            data-search-anchor="ip_parser:summary"
            className="rounded-md border border-border bg-card px-4 py-3"
          >
            <p className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">
              {t('tools.ip_parser.summary_heading')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                data-testid="ip-summary-address"
                className="break-all font-mono text-2xl font-bold"
              >
                {parsed.result.ip}
              </h2>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                IPv{parsed.result.version}
              </span>
              <span
                data-testid="ip-summary-type"
                className={
                  IP_PUBLIC_SCOPE_KEYS.has(parsed.result.scope)
                    ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400'
                    : 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400'
                }
              >
                {t(parsed.result.scope)}
              </span>
            </div>
          </section>
        ) : null}

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
            {t('tools.ip_parser.empty_state')}
          </p>
        ) : null}

        {/* 归属地与运营商(联网查询,手动触发):布局对齐 iplocation.net Lookup Summary */}
        <section
          aria-label={t('tools.ip_parser.geo_section_aria')}
          data-search-anchor="ip_parser:geo"
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-body-sm font-semibold">{t('tools.ip_parser.geo_heading')}</h2>
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
              {geo.status === 'loading'
                ? t('tools.ip_parser.geo_querying')
                : t('tools.ip_parser.geo_query_btn')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('tools.ip_parser.geo_hint')}</p>

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
                  className="group rounded-md border border-border bg-card px-4 py-3"
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

        {/* 信息卡网格:滚动由外层内容区承担 */}
        {infoItems.length > 0 ? (
          <section
            aria-label={t('tools.ip_parser.info_section_aria')}
            data-search-anchor="ip_parser:result"
            className="flex flex-col"
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
              {infoItems.map((item) => (
                <div
                  key={item.testId}
                  data-testid={item.testId}
                  className="group rounded-md border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {item.label}
                    </p>
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <CopyAction text={item.value} testId={`${item.testId}-copy`} />
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-body-sm font-semibold">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Network aria-hidden className="size-3.5" />
              {t('tools.ip_parser.offline_note')}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
