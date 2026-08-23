/**
 * IP 归属地查询 IPC 封装
 *
 * 调用 Rust 端 `ip_lookup` command(域名白名单 + 用户手动触发,
 * 见 src-tauri/src/net/ip_lookup.rs 与 PRD 13-security.md §3.1)。
 */

import { invokeCommand } from '@/lib/ipc';

/** 归属地查询结果(与 Rust IpLookupData camelCase 序列化一一对应) */
export interface IpGeoInfo {
  /** 实际查询的 IP(留空自查询时为服务端回显的本机公网 IP) */
  queryIp: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  /** 组织/运营商(org 为空时后端已回退 isp) */
  orgIsp: string | null;
  asnNumber: number | null;
  asnOrg: string | null;
  /** 如 "(DCH) - Data Center/Web Hosting/Transit" */
  networkType: string;
  mobile: boolean;
  proxy: boolean;
  hosting: boolean;
  /** 如 "+08:00 (HKT)" */
  timezoneDisplay: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  /** 国旗 data URI(image/png;base64),获取失败为 null */
  flagDataUri: string | null;
}

/**
 * 查询归属地。`ip` 为空/null 时查询本机公网 IP。
 * 输入应先剥离 CIDR 前缀(如 "1.2.3.4/24" → "1.2.3.4")。
 */
export async function lookupIpGeo(ip: string | null): Promise<IpGeoInfo> {
  return invokeCommand<IpGeoInfo>('ip_lookup', { ip });
}

/**
 * 从输入文本提取可查询的纯 IP:剥离 CIDR 前缀并去除空白。
 * 无法识别时返回 null(由调用方决定提示或按本机 IP 处理)。
 */
export function extractLookupIp(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.split('/')[0]?.trim() || null;
}
