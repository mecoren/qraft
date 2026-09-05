/**
 * IPv4/CIDR 解析纯函数(与组件分离):uint32 位运算,>>> 保证无符号。
 *
 * 输入形态(对标 ipcalc / subnet calculators):
 * - `a.b.c.d/p`(CIDR,省略前缀按 /32)
 * - `a.b.c.d 255.255.255.0` / `a.b.c.d/255.255.255.0`(点分掩码)
 * - 拒绝前导零八位组(规避八进制歧义,与 ip-parser 口径一致)
 */

export interface SubnetInfo {
  /** 输入 IP 的规范化点分十进制 */
  ip: string;
  /** 前缀长度 0-32 */
  prefix: number;
  network: string;
  netmask: string;
  wildcard: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  totalAddrs: number;
  usableHosts: number;
  /** 点分二进制(11000000.10101000.…) */
  binaryIp: string;
  binaryMask: string;
}

/** 解析点分十进制 IPv4 为 uint32;非法返回 null;拒绝前导零八位组 */
export function parseIpv4(s: string): number | null {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith('0')) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function toIp(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function toBinary(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    .map((o) => o.toString(2).padStart(8, '0'))
    .join('.');
}

/** 点分掩码 → 前缀长度;非连续掩码(如 255.0.255.0)返回 null */
function netmaskToPrefix(mask: number): number | null {
  const inv = ~mask >>> 0;
  // 连续掩码取反后必为 2^k - 1 形式(inv & (inv+1) === 0)
  if ((inv & (inv + 1)) !== 0) return null;
  return 32 - Math.log2(inv + 1);
}

/** 解析 CIDR / 掩码形态输入;非法返回 null */
export function parseCidr(input: string): SubnetInfo | null {
  const m = input.trim().match(/^([\d.]+)(?:[/. ]([\d.]+))?$/);
  if (!m) return null;
  const ip = parseIpv4(m[1]!);
  if (ip === null) return null;

  let prefix = 32;
  if (m[2] !== undefined) {
    const tail = m[2];
    if (tail.includes('.')) {
      const mask = parseIpv4(tail);
      if (mask === null) return null;
      const fromMask = netmaskToPrefix(mask);
      if (fromMask === null) return null;
      prefix = fromMask;
    } else {
      if (!/^\d{1,2}$/.test(tail)) return null;
      prefix = Number(tail);
      if (prefix > 32) return null;
    }
  }

  // /0 时 << 32 会溢出为 0,与期望掩码一致,无需特判
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  // RFC 950:前缀 <31 扣除网络地址与广播地址;/31、/32 全部可用
  const usable = prefix >= 31 ? total : total - 2;
  return {
    ip: toIp(ip),
    prefix,
    network: toIp(network),
    netmask: toIp(mask),
    wildcard: toIp(~mask >>> 0),
    broadcast: toIp(broadcast),
    firstHost: toIp(prefix >= 31 ? network : (network + 1) >>> 0),
    lastHost: toIp(prefix >= 31 ? broadcast : (broadcast - 1) >>> 0),
    totalAddrs: total,
    usableHosts: usable,
    binaryIp: toBinary(ip),
    binaryMask: toBinary(mask),
  };
}

export interface SubnetSlice {
  network: string;
  firstHost: string;
  lastHost: string;
  broadcast: string;
}

export interface SubnetSplitResult {
  newPrefix: number;
  /** 划分出的子网总数 2^(newPrefix - prefix) */
  subnetCount: number;
  /** 每个子网的可用主机数 */
  usablePerSubnet: number;
  /** 前 limit 个子网(自 base 网络起) */
  subnets: SubnetSlice[];
}

/**
 * 子网划分预览:把 base/prefix 网络按 newPrefix 划分。
 * newPrefix 必须 > prefix 且 ≤ 32;返回前 limit 个子网。
 */
export function splitSubnet(
  base: number,
  prefix: number,
  newPrefix: number,
  limit = 8,
): SubnetSplitResult | null {
  if (newPrefix <= prefix || newPrefix > 32) return null;
  const step = 2 ** (32 - newPrefix);
  const total = 2 ** (newPrefix - prefix);
  const usable = newPrefix >= 31 ? step : step - 2;
  const subnets: SubnetSlice[] = [];
  for (let i = 0; i < Math.min(limit, total); i++) {
    const net = (base + i * step) >>> 0;
    const broadcast = (net + step - 1) >>> 0;
    subnets.push({
      network: toIp(net),
      firstHost: toIp(newPrefix >= 31 ? net : (net + 1) >>> 0),
      lastHost: toIp(newPrefix >= 31 ? broadcast : (broadcast - 1) >>> 0),
      broadcast: toIp(broadcast),
    });
  }
  return { newPrefix, subnetCount: total, usablePerSubnet: usable, subnets };
}
