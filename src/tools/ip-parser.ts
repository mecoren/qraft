/**
 * IP 地址解析纯逻辑模块
 *
 * 支持:
 * - IPv4 / IPv6 地址与 CIDR 记法(如 192.168.1.130/26、2001:db8::/48)
 * - 子网掩码、通配符掩码、网络/广播地址、可用主机范围与数量
 * - IPv4 分类(A-E)与保留地址段识别、IPv6 作用域识别
 *
 * 全部为纯函数,不依赖 React,便于单元测试。
 */

// ============================================================
// 基础类型
// ============================================================

export interface IpV4Analysis {
  version: 4;
  /** 输入的 IP(点分十进制规范化形式) */
  ip: string;
  /** IP 整数表示(uint32,以 BigInt 承载避免 >>> 符号位问题) */
  intValue: bigint;
  /** 十六进制表示(0xXXXXXXXX) */
  hex: string;
  /** 二进制点分表示(11000000.10101000.…) */
  binary: string;
  /** CIDR 记法的网络地址,如 192.168.1.128/26 */
  cidr: string;
  /** 前缀长度 0-32 */
  prefix: number;
  /** 子网掩码,如 255.255.255.192 */
  netmask: string;
  /** 通配符掩码(反掩码),如 0.0.0.63 */
  wildcard: string;
  /** 网络地址 */
  network: string;
  /** 广播地址(/31 与 /32 无独立广播地址,返回 null) */
  broadcast: string | null;
  /** 可用主机范围首地址(/32 返回自身) */
  firstHost: string;
  /** 可用主机范围末地址(/32 返回自身) */
  lastHost: string;
  /** 可用主机数(RFC 3021:/31 为 2;/32 为 1;其余为 2^(32-n)-2) */
  usableHosts: bigint;
  /** 总地址数 2^(32-n) */
  totalAddresses: bigint;
  /** 传统分类:A / B / C / D(组播)/ E(保留) */
  ipClass: string;
  /** 地址用途/作用域描述,如「私网地址(RFC 1918)」 */
  scope: string;
}

export interface IpV6Analysis {
  version: 6;
  /** 输入的 IP(RFC 5952 压缩形式) */
  ip: string;
  /** 完全展开形式(8 组 4 位十六进制) */
  full: string;
  /** CIDR 记法的网络地址,如 2001:db8::/48 */
  cidr: string;
  /** 前缀长度 0-128 */
  prefix: number;
  /** 网络地址(该子网的首地址,压缩形式) */
  network: string;
  /** 子网末地址(压缩形式) */
  lastAddress: string;
  /** 总地址数 2^(128-n) */
  totalAddresses: bigint;
  /** 地址作用域描述,如「链路本地地址」 */
  scope: string;
}

export type IpAnalysis = IpV4Analysis | IpV6Analysis;

// ============================================================
// IPv4 解析
// ============================================================

/** 点分十进制 → uint32(BigInt);非法时返回 null。拒绝前导零八位组以规避八进制歧义 */
export function parseIpv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** uint32(BigInt)→ 点分十进制 */
export function formatIpv4(value: bigint): string {
  const v = BigInt.asUintN(32, value);
  return [(v >> 24n) & 255n, (v >> 16n) & 255n, (v >> 8n) & 255n, v & 255n].join('.');
}

/** 连续 n 个 1 的掩码值(n=0 时为 0) */
function prefixToMaskBigInt(prefix: number, bits: 32 | 128): bigint {
  if (prefix <= 0) return 0n;
  if (prefix >= bits) return (1n << BigInt(bits)) - 1n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

// ============================================================
// IPv6 解析
// ============================================================

/**
 * RFC 4291 文本形式 → 128bit BigInt;非法时返回 null。
 * 支持 `::` 压缩与结尾内嵌 IPv4(如 ::ffff:192.168.0.1)。
 */
export function parseIpv6(text: string): bigint | null {
  let s = text.trim();
  if (!s.includes(':')) return null;

  // 拆出可能存在的内嵌 IPv4 尾部(::ffff:1.2.3.4)
  let embeddedV4: bigint | null = null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    embeddedV4 = parseIpv4(tail);
    if (embeddedV4 === null) return null;
    s = s.slice(0, lastColon + 1) + 'ffff:ffff'; // 占位,稍后替换低 32 位
  }

  // 处理 :: 压缩(仅允许出现一次)
  const doubleColonCount = s.split('::').length - 1;
  if (doubleColonCount > 1) return null;
  let head: string[];
  let tailGroups: string[];
  if (doubleColonCount === 1) {
    const [left, right] = s.split('::');
    head = left ? left.split(':') : [];
    tailGroups = right ? right.split(':') : [];
  } else {
    head = s.split(':');
    tailGroups = [];
  }
  for (const g of [...head, ...tailGroups]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
  }
  const missing = 8 - head.length - tailGroups.length;
  if (missing < 0 || (doubleColonCount === 0 && missing !== 0)) return null;

  const groups = [...head, ...Array<string>(missing).fill('0'), ...tailGroups];
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(parseInt(g, 16));
  if (embeddedV4 !== null) value = (value & ~0xffffffffn) | BigInt.asUintN(32, embeddedV4);
  return BigInt.asUintN(128, value);
}

/** 128bit BigInt → 8 组十六进制数组 */
function ipv6ToGroups(value: bigint): number[] {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  }
  return groups;
}

/** 128bit BigInt → RFC 5952 压缩形式 */
export function formatIpv6Compressed(value: bigint): string {
  const hexGroups = ipv6ToGroups(value).map((g) => g.toString(16));
  // 找最长(≥2 组)的全零串进行压缩;并列时取最左(RFC 5952)
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (hexGroups[i] === '0') {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return hexGroups.join(':');
  const head = hexGroups.slice(0, bestStart).join(':');
  const tail = hexGroups.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

/** 128bit BigInt → 完全展开形式(8 组 4 位小写十六进制) */
export function formatIpv6Full(value: bigint): string {
  return ipv6ToGroups(value)
    .map((g) => g.toString(16).padStart(4, '0'))
    .join(':');
}

// ============================================================
// 用途 / 分类识别
// ============================================================

interface V4Range {
  lo: number;
  hi: number;
  scope: string;
}

/** IPv4 保留/特殊地址段(lo/hi 为 uint32 数值),按惯例顺序匹配 */
const V4_SCOPES: readonly V4Range[] = [
  { lo: 0x00000000, hi: 0x00ffffff, scope: '本网络地址(保留,RFC 791)' },
  { lo: 0x0a000000, hi: 0x0affffff, scope: '私网地址(RFC 1918)' },
  { lo: 0x64400000, hi: 0x647fffff, scope: '运营商级 NAT(RFC 6598)' },
  { lo: 0x7f000000, hi: 0x7fffffff, scope: '环回地址(RFC 1122)' },
  { lo: 0xa9fe0000, hi: 0xa9feffff, scope: '链路本地地址(RFC 3927)' },
  { lo: 0xac100000, hi: 0xac1fffff, scope: '私网地址(RFC 1918)' },
  { lo: 0xc0000000, hi: 0xc00000ff, scope: 'IETF 协议分配(RFC 6890)' },
  { lo: 0xc0000200, hi: 0xc00002ff, scope: '测试文档专用(TEST-NET-1)' },
  { lo: 0xc0586300, hi: 0xc05863ff, scope: '6to4 中继任播(保留,RFC 7526)' },
  { lo: 0xc0a80000, hi: 0xc0a8ffff, scope: '私网地址(RFC 1918)' },
  { lo: 0xc6120000, hi: 0xc613ffff, scope: '网络性能测试(RFC 2544)' },
  { lo: 0xc6336400, hi: 0xc63364ff, scope: '测试文档专用(TEST-NET-2)' },
  { lo: 0xcb007100, hi: 0xcb0071ff, scope: '测试文档专用(TEST-NET-3)' },
  { lo: 0xe0000000, hi: 0xefffffff, scope: '组播地址(RFC 1112)' },
  { lo: 0xf0000000, hi: 0xffffffff, scope: '保留地址(含受限广播)' },
];

/** IPv4 用途描述;公网返回「公网地址」 */
export function describeIpv4Scope(value: bigint): string {
  const v = Number(BigInt.asUintN(32, value));
  for (const r of V4_SCOPES) {
    if (v >= r.lo && v <= r.hi) return r.scope;
  }
  return '公网地址';
}

/** IPv4 传统分类(A/B/C/D/E) */
export function describeIpv4Class(value: bigint): string {
  const first = Number((BigInt.asUintN(32, value) >> 24n) & 255n);
  if (first < 128) return 'A 类';
  if (first < 192) return 'B 类';
  if (first < 224) return 'C 类';
  if (first < 240) return 'D 类(组播)';
  return 'E 类(保留)';
}

/** IPv6 作用域描述 */
export function describeIpv6Scope(value: bigint): string {
  if (value === 0n) return '未指定地址(::)';
  if (value === 1n) return '环回地址(::1)';
  const top8 = value >> 120n;
  if (top8 === 0xffn) return '组播地址(RFC 4291)';
  // fe80::/10:首 10 位 1111 1110 10
  if (value >> 118n === 0x3fan) return '链路本地地址(RFC 4291)';
  // fc00::/7:首 7 位 1111 110
  if (value >> 121n === 0x7fn) return '唯一本地地址(RFC 4193)';
  if (value >> 96n === 0x20010db8n) return '测试文档专用(RFC 3849)';
  if (value >> 96n === 0x20010000n) return 'Teredo 隧道地址(RFC 4380,已弃用)';
  if (value >> 112n === 0x2002n) return '6to4 地址(RFC 7526,已弃用)';
  if (value >> 96n === 0x64ff9bn) return 'NAT64 地址(RFC 6052)';
  return '全球单播地址(公网)';
}

// ============================================================
// 顶层解析入口
// ============================================================

export class IpParseError extends Error {}

/**
 * 解析输入(IP 或 CIDR):
 * - 未带前缀时 IPv4 视为 /32 单主机,IPv6 视为 /128
 * - 前缀长度必须为 0 ≤ n ≤ 版本位数,且网络部分不得超出前缀(严格模式,
 *   如 192.168.1.130/26 视为「IP + 掩码」的常见写法,自动归并到所属子网)
 */
export function analyzeIp(rawInput: string): IpAnalysis {
  const input = rawInput.trim();
  if (!input) throw new IpParseError('请输入 IP 地址或 CIDR');

  const slash = input.lastIndexOf('/');
  const ipText = slash >= 0 ? input.slice(0, slash) : input;
  const prefixText = slash >= 0 ? input.slice(slash + 1) : '';
  if (!ipText) throw new IpParseError('缺少 IP 地址部分');
  if (slash >= 0 && !/^\d{1,3}$/.test(prefixText)) {
    throw new IpParseError(`无效的前缀长度: ${prefixText}`);
  }
  const explicitPrefix = slash >= 0 ? Number(prefixText) : null;

  // —— IPv4 ——
  if (ipText.includes('.')) {
    const ipValue = parseIpv4(ipText);
    if (ipValue === null) throw new IpParseError(`无效的 IPv4 地址: ${ipText}`);
    const prefix = explicitPrefix ?? 32;
    if (explicitPrefix !== null && (explicitPrefix < 0 || explicitPrefix > 32)) {
      throw new IpParseError(`IPv4 前缀长度应在 0-32 之间: ${explicitPrefix}`);
    }
    const mask = prefixToMaskBigInt(prefix, 32);
    const networkValue = ipValue & mask;
    const broadcastValue = networkValue | (~mask & 0xffffffffn);

    const totalAddresses = 1n << BigInt(32 - prefix);
    let usableHosts: bigint;
    let firstHost: string;
    let lastHost: string;
    let broadcastAddr: string | null = formatIpv4(broadcastValue);
    if (prefix === 32) {
      usableHosts = 1n;
      firstHost = formatIpv4(ipValue);
      lastHost = firstHost;
      broadcastAddr = null;
    } else if (prefix === 31) {
      usableHosts = 2n;
      firstHost = formatIpv4(networkValue);
      lastHost = formatIpv4(broadcastValue);
      broadcastAddr = null;
    } else {
      usableHosts = totalAddresses - 2n;
      firstHost = formatIpv4(networkValue + 1n);
      lastHost = formatIpv4(broadcastValue - 1n);
    }

    return {
      version: 4,
      ip: formatIpv4(ipValue),
      intValue: BigInt.asUintN(32, ipValue),
      hex: `0x${BigInt.asUintN(32, ipValue).toString(16).toUpperCase().padStart(8, '0')}`,
      binary: ipv4Binary(ipValue),
      cidr: `${formatIpv4(networkValue)}/${prefix}`,
      prefix,
      netmask: formatIpv4(mask),
      wildcard: formatIpv4(~mask & 0xffffffffn),
      network: formatIpv4(networkValue),
      broadcast: broadcastAddr,
      firstHost,
      lastHost,
      usableHosts,
      totalAddresses,
      ipClass: describeIpv4Class(ipValue),
      scope: describeIpv4Scope(ipValue),
    };
  }

  // —— IPv6 ——
  const ipValue = parseIpv6(ipText);
  if (ipValue === null) throw new IpParseError(`无效的 IP 地址: ${ipText}`);
  const prefix = explicitPrefix ?? 128;
  if (explicitPrefix !== null && (explicitPrefix < 0 || explicitPrefix > 128)) {
    throw new IpParseError(`IPv6 前缀长度应在 0-128 之间: ${explicitPrefix}`);
  }
  const mask = prefixToMaskBigInt(prefix, 128);
  const networkValue = ipValue & mask;
  const lastValue = networkValue | (~mask & ((1n << 128n) - 1n));

  return {
    version: 6,
    ip: formatIpv6Compressed(ipValue),
    full: formatIpv6Full(ipValue),
    cidr: `${formatIpv6Compressed(networkValue)}/${prefix}`,
    prefix,
    network: formatIpv6Compressed(networkValue),
    lastAddress: formatIpv6Compressed(lastValue),
    totalAddresses: 1n << BigInt(128 - prefix),
    scope: describeIpv6Scope(ipValue),
  };
}

function ipv4Binary(value: bigint): string {
  const v = BigInt.asUintN(32, value);
  return [(v >> 24n) & 255n, (v >> 16n) & 255n, (v >> 8n) & 255n, v & 255n]
    .map((o) => o.toString(2).padStart(8, '0'))
    .join('.');
}
