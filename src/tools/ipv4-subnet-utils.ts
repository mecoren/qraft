/**
 * IPv4/CIDR 解析纯函数(与组件分离):uint32 位运算,>>> 保证无符号。
 */

export interface SubnetInfo {
  network: string;
  netmask: string;
  wildcard: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  totalAddrs: number;
  usableHosts: number;
}

/** 解析点分十进制 IPv4 为 uint32;非法返回 null */
export function parseIpv4(s: string): number | null {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function toIp(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** 解析 CIDR(如 192.168.1.10/24,省略前缀按 /32);非法返回 null */
export function parseCidr(input: string): SubnetInfo | null {
  const m = input.trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = parseIpv4(m[1]!);
  if (ip === null) return null;
  const prefix = m[2] === undefined ? 32 : Number(m[2]);
  if (prefix > 32) return null;
  // /0 时 << 32 会溢出为 0,与期望掩码一致,无需特判
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  // RFC 950:前缀 <31 扣除网络地址与广播地址;/31、/32 全部可用
  const usable = prefix >= 31 ? total : total - 2;
  return {
    network: toIp(network),
    netmask: toIp(mask),
    wildcard: toIp(~mask >>> 0),
    broadcast: toIp(broadcast),
    firstHost: toIp(prefix >= 31 ? network : (network + 1) >>> 0),
    lastHost: toIp(prefix >= 31 ? broadcast : (broadcast - 1) >>> 0),
    totalAddrs: total,
    usableHosts: usable,
  };
}
