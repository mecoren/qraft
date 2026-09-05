import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  analyzeIp,
  formatIpv4,
  parseIpv4,
  parseIpv6,
  formatIpv6Compressed,
  describeIpv4Scope,
  describeIpv4Class,
  IpParseError,
} from './ip-parser';
import { IpParser } from './IpParser';
import type { IpGeoInfo } from './ip-geo';

// 归属地查询走真实 IPC,mock 掉服务模块(保留 extractLookupIp 纯逻辑)
vi.mock('./ip-geo', () => ({
  lookupIpGeo: vi.fn(),
  extractLookupIp: (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.split('/')[0]?.trim() || null;
  },
}));

import { lookupIpGeo } from './ip-geo';

const lookupIpGeoMock = vi.mocked(lookupIpGeo);

/** 对齐参考截图的归属地数据(HK 数据中心) */
function geoFixture(overrides: Partial<IpGeoInfo> = {}): IpGeoInfo {
  return {
    queryIp: '103.152.220.7',
    country: 'Hong Kong',
    countryCode: 'HK',
    region: 'Hong Kong',
    city: 'Hong Kong',
    orgIsp: 'RadishCloud Technology LLC',
    asnNumber: 201217,
    asnOrg: 'RadishCloud Technology LLC',
    networkType: '(DCH) - Data Center/Web Hosting/Transit',
    mobile: false,
    proxy: false,
    hosting: true,
    timezoneDisplay: '+08:00 (HKT)',
    postalCode: null,
    latitude: 22.2855,
    longitude: 114.1577,
    flagDataUri: 'data:image/png;base64,QUFB',
    ...overrides,
  };
}

// ============================================================
// 纯逻辑:IPv4
// ============================================================

describe('parseIpv4', () => {
  it.each([
    ['192.168.1.1', 0xc0a80101n],
    ['0.0.0.0', 0n],
    ['255.255.255.255', 0xffffffffn],
    ['1.2.3.4', 0x01020304n],
  ])('parses %s', (input, expected) => {
    expect(parseIpv4(input)).toBe(expected);
  });

  it.each([['256.1.1.1'], ['1.2.3'], ['1.2.3.4.5'], ['a.b.c.d'], ['01.2.3.4'], ['-1.2.3.4'], ['']])(
    'rejects %s',
    (input) => {
      expect(parseIpv4(input)).toBeNull();
    },
  );
});

describe('formatIpv4', () => {
  it('round-trips dotted decimal', () => {
    expect(formatIpv4(0xc0a80182n)).toBe('192.168.1.130');
  });
});

// ============================================================
// 纯逻辑:IPv6
// ============================================================

describe('parseIpv6', () => {
  it('parses full form', () => {
    expect(parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe((0x20010db8n << 96n) | 1n);
  });

  it('parses :: compression', () => {
    expect(parseIpv6('2001:db8::1')).toBe((0x20010db8n << 96n) | 1n);
    expect(parseIpv6('::')).toBe(0n);
    expect(parseIpv6('::1')).toBe(1n);
  });

  it('parses embedded IPv4 tail', () => {
    const mapped = parseIpv6('::ffff:192.168.1.130');
    expect(mapped).toBe((0xffffn << 32n) | 0xc0a80182n);
  });

  it.each([['1.2.3.4'], ['2001:db8:::1'], ['12345::'], ['2001:db8:1:2:3:4:5:6:7'], ['gggg::1']])(
    'rejects %s',
    (input) => {
      expect(parseIpv6(input)).toBeNull();
    },
  );
});

describe('formatIpv6Compressed', () => {
  it('compresses the longest zero run once', () => {
    const v = parseIpv6('2001:db8:0:0:0:0:0:1')!;
    expect(formatIpv6Compressed(v)).toBe('2001:db8::1');
  });

  it('compresses all-zero address to ::', () => {
    expect(formatIpv6Compressed(0n)).toBe('::');
  });

  it('does not compress single zero group', () => {
    const v = parseIpv6('2001:db8:1:0:2:3:4:5')!;
    expect(formatIpv6Compressed(v)).toBe('2001:db8:1:0:2:3:4:5');
  });
});

// ============================================================
// 纯逻辑:analyzeIp
// ============================================================

describe('analyzeIp (IPv4 + CIDR)', () => {
  const r = analyzeIp('192.168.1.130/26');

  it('computes subnet fields for /26', () => {
    if (r.version !== 4) throw new Error('expected v4');
    expect(r.ip).toBe('192.168.1.130');
    expect(r.netmask).toBe('255.255.255.192');
    expect(r.wildcard).toBe('0.0.0.63');
    expect(r.cidr).toBe('192.168.1.128/26');
    expect(r.network).toBe('192.168.1.128');
    expect(r.broadcast).toBe('192.168.1.191');
    expect(r.firstHost).toBe('192.168.1.129');
    expect(r.lastHost).toBe('192.168.1.190');
    expect(r.usableHosts).toBe(62n);
    expect(r.totalAddresses).toBe(64n);
    expect(r.hex).toBe('0xC0A80182');
    expect(r.binary).toBe('11000000.10101000.00000001.10000010');
    expect(r.ptr).toBe('130.1.168.192.in-addr.arpa');
  });

  it('classifies private class C', () => {
    if (r.version !== 4) throw new Error('expected v4');
    expect(r.scope).toBe('tools.ip_parser.scope_private');
    expect(r.ipClass).toBe('tools.ip_parser.class_c');
  });

  it('treats bare IP as /32 host', () => {
    const h = analyzeIp('8.8.8.8');
    if (h.version !== 4) throw new Error('expected v4');
    expect(h.prefix).toBe(32);
    expect(h.netmask).toBe('255.255.255.255');
    expect(h.cidr).toBe('8.8.8.8/32');
    expect(h.broadcast).toBeNull();
    expect(h.usableHosts).toBe(1n);
    expect(h.firstHost).toBe('8.8.8.8');
    expect(h.lastHost).toBe('8.8.8.8');
    expect(h.scope).toBe('tools.ip_parser.scope_public');
  });

  it('handles RFC 3021 /31 point-to-point subnet', () => {
    const p = analyzeIp('10.0.0.4/31');
    if (p.version !== 4) throw new Error('expected v4');
    expect(p.broadcast).toBeNull();
    expect(p.firstHost).toBe('10.0.0.4');
    expect(p.lastHost).toBe('10.0.0.5');
    expect(p.usableHosts).toBe(2n);
    expect(p.totalAddresses).toBe(2n);
  });

  it('handles /0 default route', () => {
    const z = analyzeIp('1.2.3.4/0');
    if (z.version !== 4) throw new Error('expected v4');
    expect(z.netmask).toBe('0.0.0.0');
    expect(z.wildcard).toBe('255.255.255.255');
    expect(z.network).toBe('0.0.0.0');
    expect(z.broadcast).toBe('255.255.255.255');
    expect(z.totalAddresses).toBe(2n ** 32n);
  });
});

describe('analyzeIp (IPv6)', () => {
  const r = analyzeIp('2001:db8:abcd:0012:0000:0000:0000:0001/64');
  it('expands and computes network range', () => {
    if (r.version !== 6) throw new Error('expected v6');
    expect(r.ip).toBe('2001:db8:abcd:12::1');
    expect(r.full).toBe('2001:0db8:abcd:0012:0000:0000:0000:0001');
    expect(r.cidr).toBe('2001:db8:abcd:12::/64');
    expect(r.network).toBe('2001:db8:abcd:12::');
    expect(r.lastAddress).toBe('2001:db8:abcd:12:ffff:ffff:ffff:ffff');
    expect(r.totalAddresses).toBe(2n ** 64n);
  });

  it('treats bare IPv6 as /128', () => {
    const h = analyzeIp('fe80::1');
    if (h.version !== 6) throw new Error('expected v6');
    expect(h.prefix).toBe(128);
    expect(h.cidr).toBe('fe80::1/128');
    expect(h.scope).toBe('tools.ip_parser.v6_link_local');
  });

  it('classifies IPv4-mapped addresses and exposes embedded IPv4 + PTR', () => {
    const m = analyzeIp('::ffff:192.168.0.1');
    if (m.version !== 6) throw new Error('expected v6');
    expect(m.scope).toBe('tools.ip_parser.v6_v4mapped');
    expect(m.mappedIpv4).toBe('192.168.0.1');
    // nibble 反解:c0a80001 逐 nibble 逆序(1,0,0,0,8,a,0,c)+ ffff + 20 个 0
    expect(m.ptr.startsWith('1.0.0.0.8.a.0.c.f.f.f.f.')).toBe(true);
    expect(m.ptr.endsWith('.ip6.arpa')).toBe(true);
  });
});

describe('scope / classification helpers', () => {
  it('identifies loopback and multicast scopes', () => {
    expect(describeIpv4Scope(parseIpv4('127.0.0.1')!)).toBe('tools.ip_parser.scope_loopback');
    expect(describeIpv4Scope(parseIpv4('224.0.0.1')!)).toBe('tools.ip_parser.scope_multicast');
    expect(describeIpv4Scope(parseIpv4('172.16.5.5')!)).toBe('tools.ip_parser.scope_private');
    expect(describeIpv4Scope(parseIpv4('169.254.9.9')!)).toBe('tools.ip_parser.scope_link_local');
    expect(describeIpv4Scope(parseIpv4('100.100.1.1')!)).toBe('tools.ip_parser.scope_cgnat');
    expect(describeIpv4Class(parseIpv4('10.0.0.1')!)).toBe('tools.ip_parser.class_a');
    expect(describeIpv4Class(parseIpv4('150.1.1.1')!)).toBe('tools.ip_parser.class_b');
    expect(describeIpv4Class(parseIpv4('240.0.0.1')!)).toBe('tools.ip_parser.class_e');
  });
});

describe('analyzeIp errors', () => {
  it('throws on invalid inputs', () => {
    expect(() => analyzeIp('')).toThrow(IpParseError);
    expect(() => analyzeIp('999.1.1.1')).toThrow(IpParseError);
    expect(() => analyzeIp('1.2.3.4/33')).toThrow(/0-32/);
    expect(() => analyzeIp('::1/129')).toThrow(/0-128/);
    expect(() => analyzeIp('1.2.3.4/x')).toThrow(/前缀长度/);
  });
});

// ============================================================
// UI 组件
// ============================================================

describe('IpParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input with placeholder and empty state hint', () => {
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    expect(screen.getByRole('textbox', { name: 'IP 地址或 CIDR' })).toBeInTheDocument();
    expect(screen.getByText(/自动解析网络信息/)).toBeInTheDocument();
  });

  it('shows error message for invalid input', () => {
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'IP 地址或 CIDR' }), {
      target: { value: 'not-an-ip' },
    });
    expect(screen.getByTestId('ip-error')).toHaveTextContent(/无效的 IP/);
  });

  it('renders summary and info cards for IPv4 CIDR input', () => {
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'IP 地址或 CIDR' }), {
      target: { value: '192.168.1.130/26' },
    });

    expect(screen.getByTestId('ip-summary-address')).toHaveTextContent('192.168.1.130');
    expect(screen.getByTestId('ip-summary-type')).toHaveTextContent('私网地址(RFC 1918)');
    expect(screen.getByTestId('ip-item-netmask')).toHaveTextContent('255.255.255.192');
    expect(screen.getByTestId('ip-item-wildcard')).toHaveTextContent('0.0.0.63');
    expect(screen.getByTestId('ip-item-cidr')).toHaveTextContent('192.168.1.128/26');
    expect(screen.getByTestId('ip-item-network')).toHaveTextContent('192.168.1.128');
    expect(screen.getByTestId('ip-item-broadcast')).toHaveTextContent('192.168.1.191');
    expect(screen.getByTestId('ip-item-hosts')).toHaveTextContent('192.168.1.129 - 192.168.1.190');
    expect(screen.getByTestId('ip-item-usable')).toHaveTextContent('62');
  });

  it('renders info cards for bare IPv6 input', () => {
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'IP 地址或 CIDR' }), {
      target: { value: '2001:db8::1' },
    });

    expect(screen.getByTestId('ip-summary-address')).toHaveTextContent('2001:db8::1');
    expect(screen.getByTestId('ip-item-full')).toHaveTextContent(
      '2001:0db8:0000:0000:0000:0000:0000:0001',
    );
    expect(screen.getByTestId('ip-item-cidr')).toHaveTextContent('2001:db8::1/128');
  });

  // ============================================================
  // 归属地与运营商(联网查询)
  // ============================================================

  it('queries geo info on button click and renders lookup summary cards', async () => {
    lookupIpGeoMock.mockResolvedValue(geoFixture());
    render(<IpParser toolId="ip_parser" metadata={null as never} />);

    fireEvent.click(screen.getByTestId('ip-geo-query'));

    await waitFor(() => {
      expect(lookupIpGeoMock).toHaveBeenCalledWith(null); // 留空 → 查询本机 IP
    });
    await waitFor(() => {
      expect(screen.getByTestId('ip-geo-card-country')).toBeInTheDocument();
    });

    // 卡片字段与布局对齐参考截图
    expect(screen.getByTestId('ip-geo-flag')).toBeInTheDocument();
    expect(screen.getByTestId('ip-geo-card-country')).toHaveTextContent('Hong Kong');
    expect(screen.getByTestId('ip-geo-card-region')).toHaveTextContent('Hong Kong');
    expect(screen.getByTestId('ip-geo-card-city')).toHaveTextContent('Hong Kong');
    expect(screen.getByTestId('ip-geo-card-org')).toHaveTextContent('RadishCloud Technology LLC');
    expect(screen.getByTestId('ip-geo-card-network')).toHaveTextContent('(DCH)');
    expect(screen.getByTestId('ip-geo-card-asn')).toHaveTextContent('201217');
    expect(screen.getByTestId('ip-geo-card-timezone')).toHaveTextContent('+08:00 (HKT)');
    expect(screen.getByTestId('ip-geo-card-postal')).toHaveTextContent('不可用');
  });

  it('strips CIDR prefix and queries the bare ip', async () => {
    lookupIpGeoMock.mockResolvedValue(geoFixture());
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'IP 地址或 CIDR' }), {
      target: { value: '8.8.8.8/24' },
    });
    fireEvent.click(screen.getByTestId('ip-geo-query'));

    await waitFor(() => {
      expect(lookupIpGeoMock).toHaveBeenCalledWith('8.8.8.8');
    });
  });

  it('falls back to country code badge when flag is unavailable', async () => {
    lookupIpGeoMock.mockResolvedValue(geoFixture({ flagDataUri: null }));
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('ip-geo-query'));

    await waitFor(() => {
      expect(screen.getByTestId('ip-geo-card-country')).toHaveTextContent('HK');
    });
    expect(screen.queryByTestId('ip-geo-flag')).not.toBeInTheDocument();
  });

  it('shows error alert when geo query fails', async () => {
    lookupIpGeoMock.mockRejectedValue(new Error('ip lookup request failed: Network unreachable'));
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('ip-geo-query'));

    await waitFor(() => {
      expect(screen.getByTestId('ip-geo-error')).toHaveTextContent(/Network unreachable/);
    });
  });

  it('disables query button while loading', async () => {
    lookupIpGeoMock.mockReturnValue(new Promise(() => {})); // 永不 resolve
    render(<IpParser toolId="ip_parser" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('ip-geo-query'));

    await waitFor(() => {
      expect(screen.getByTestId('ip-geo-query')).toBeDisabled();
      expect(screen.getByTestId('ip-geo-query')).toHaveTextContent('查询中…');
    });
  });
});
