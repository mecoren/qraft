// IP 归属地在线查询(登记例外,见 net/mod.rs)
//
// 数据源:ip-api.com 免费接口(HTTP,无需注册),字段含国家/省州/城市/
// ISP/组织/AS 号/时区/邮编/移动-代理-主机房标记。国旗图标来自 flagcdn.com
// (PNG → base64 data URI,经 `img-src data:` CSP 白名单渲染)。
//
// 安全约束:
// - 域名白名单硬编码于本模块,URL 由常量拼接;查询 IP 先经过字符白名单
//   校验(`validate_lookup_ip`),杜绝路径注入 / SSRF。
// - 仅在用户点击「查询」时由前端通过 IPC 调用,无自动请求、无遥测。
//
// 纯函数(parse_asn / format_utc_offset / derive_network_type / map_api_response /
// build_api_url 等)均带单元测试,HTTP 封装保持极薄。

use std::io::Read;
use std::str::FromStr;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::core::error::AppError;

// ============ 常量(域名白名单) ============

/// ip-api.com 查询端点。免费版仅提供 HTTP(HTTPS 为付费特性)。
const API_BASE_URL: &str = "http://ip-api.com/json/";
/// 返回字段子集:定位 + 运营商 + ASN + 时区 + 邮编 + 网络类型标记。
const API_FIELDS: &str = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,mobile,proxy,hosting,query";
/// 国旗 PNG 端点(w80 宽度,约 1-3 KB)。
const FLAG_BASE_URL: &str = "https://flagcdn.com/w80/";
/// 单次 HTTP 总超时。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// 连接超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 国旗图片大小上限(防御性截断)。
const MAX_FLAG_BYTES: u64 = 256 * 1024;

// ============ 对外数据结构(IPC 契约,camelCase) ============

/// IP 归属地查询结果,序列化为 camelCase 直接供前端渲染信息卡。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IpLookupData {
    /// 实际查询的 IP(自查询时为服务端回显的本机公网 IP)
    pub query_ip: Option<String>,
    pub country: Option<String>,
    /// ISO 3166-1 两字母国家码,用于国旗兜底徽标
    pub country_code: Option<String>,
    /// 省州名(regionName)
    pub region: Option<String>,
    pub city: Option<String>,
    /// 组织/运营商(org 为空时回退 isp)
    pub org_isp: Option<String>,
    /// AS 号数字部分(如 201217)
    pub asn_number: Option<u32>,
    /// AS 组织名(`as` 字段去掉前缀后的剩余部分)
    pub asn_org: Option<String>,
    /// 网络类型描述,如 "(DCH) - Data Center/Web Hosting/Transit"
    pub network_type: String,
    pub mobile: bool,
    pub proxy: bool,
    pub hosting: bool,
    /// 形如 "+08:00 (HKT)" 的展示文本
    pub timezone_display: Option<String>,
    pub postal_code: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    /// 国旗 data URI(image/png;base64),获取失败为 None
    pub flag_data_uri: Option<String>,
}

/// ip-api.com 原始响应(仅反序列化所需子集)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiGeoResponse {
    status: Option<String>,
    message: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
    /// 两字母省州代码(仅保留解析能力,UI 使用 regionName)
    #[serde(rename = "region")]
    #[allow(dead_code)]
    region_code: Option<String>,
    region_name: Option<String>,
    city: Option<String>,
    zip: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    timezone: Option<String>,
    offset: Option<i32>,
    isp: Option<String>,
    org: Option<String>,
    #[serde(rename = "as")]
    as_field: Option<String>,
    mobile: Option<bool>,
    proxy: Option<bool>,
    hosting: Option<bool>,
    query: Option<String>,
}

// ============ 纯函数(可测试) ============

/// 校验待查询的 IP 文本:仅允许 IPv4/IPv6 字符,防止 URL 路径注入。
///
/// 规则:非空、长度 ≤ 45、仅 `[0-9a-fA-F.:]` 且至少包含一个 `.` 或 `:`。
fn validate_lookup_ip(ip: &str) -> Result<(), AppError> {
    if ip.is_empty() || ip.len() > 45 {
        return Err(AppError::Forbidden(format!(
            "ip lookup: invalid ip length: {ip}"
        )));
    }
    let ok_chars =
        ip.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ':');
    let has_sep = ip.contains('.') || ip.contains(':');
    // 全字母数字但不含分隔符的输入(如 "abc")同样拒绝
    if !ok_chars || !has_sep {
        return Err(AppError::Forbidden(format!(
            "ip lookup: invalid ip characters: {ip}"
        )));
    }
    Ok(())
}

/// 构造 ip-api.com 查询 URL。`None` 表示查询本机公网 IP。
fn build_api_url(ip: Option<&str>) -> Result<String, AppError> {
    match ip.map(str::trim).filter(|s| !s.is_empty()) {
        Some(text) => {
            validate_lookup_ip(text)?;
            Ok(format!("{API_BASE_URL}{text}?fields={API_FIELDS}"))
        }
        None => Ok(format!("{API_BASE_URL}?fields={API_FIELDS}")),
    }
}

/// 解析 `as` 字段(如 `"AS201217 RadishCloud Technology LLC"`)为 (ASN 数字, 组织名)。
fn parse_asn(raw: &str) -> (Option<u32>, Option<String>) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let body = trimmed.strip_prefix("AS").unwrap_or(trimmed);
    let split = body.find(' ');
    let num_part = split.map_or(body, |idx| &body[..idx]);
    let number = num_part.parse::<u32>().ok();
    // 组织名取数字之后的剩余部分;解析不出数字时保留原文作为组织名兜底
    let org = match (split, number) {
        (Some(idx), Some(_)) => {
            let rest = body[idx..].trim();
            (!rest.is_empty()).then(|| rest.to_string())
        }
        _ => None,
    };
    (
        number,
        org.or_else(|| number.is_none().then(|| trimmed.to_string())),
    )
}

/// epoch 偏移秒数 → "+08:00" 形式。
fn format_utc_offset(seconds: i32) -> String {
    let total = i32::abs(seconds);
    let sign = if seconds < 0 { '-' } else { '+' };
    format!("{sign}{:02}:{:02}", total / 3600, (total % 3600) / 60)
}

/// IANA 时区名(如 `Asia/Hong_Kong`)→ 缩写(如 `HKT`);无法解析返回 None。
fn tz_abbreviation(tz: &str) -> Option<String> {
    let parsed: chrono_tz::Tz = tz.parse().ok()?;
    let abbr = chrono::Utc::now()
        .with_timezone(&parsed)
        .format("%Z")
        .to_string();
    // 部分时区 %Z 输出为偏移量或空串,视为无效缩写
    (!abbr.is_empty() && !abbr.starts_with('+') && !abbr.starts_with('-'))
        .then_some(abbr)
}

/// 由 `mobile`/`proxy`/`hosting` 标记推导网络类型(对齐 `IP2Location` usage type 风格)。
fn derive_network_type(mobile: bool, proxy: bool, hosting: bool) -> String {
    if mobile {
        "(MOB) - Mobile ISP".to_string()
    } else if hosting {
        "(DCH) - Data Center/Web Hosting/Transit".to_string()
    } else if proxy {
        "(PROXY) - Proxy/VPN Exit Node".to_string()
    } else {
        "(ISP) - Fixed Line ISP".to_string()
    }
}

/// 计算某时区当前时刻相对 UTC 的偏移秒数。
fn zone_offset_seconds(zone: chrono_tz::Tz) -> i32 {
    use chrono::Offset;
    chrono::Utc::now()
        .with_timezone(&zone)
        .offset()
        .fix()
        .local_minus_utc()
}

/// 将原始响应映射为 IPC 数据结构。`flag` 为已获取的国旗 data URI。
///
/// # Errors
///
/// 上游返回 fail 状态(如私网地址)时返回 `AppError::Unknown`。
fn map_api_response(
    api: ApiGeoResponse,
    flag: Option<String>,
) -> Result<IpLookupData, AppError> {
    if api.status.as_deref() == Some("fail") {
        let msg = api.message.unwrap_or_else(|| "unknown error".to_string());
        return Err(AppError::Unknown(format!("ip lookup failed: {msg}")));
    }

    let network_type = derive_network_type(
        api.mobile.unwrap_or(false),
        api.proxy.unwrap_or(false),
        api.hosting.unwrap_or(false),
    );

    let (asn_number, asn_org) = api
        .as_field
        .as_deref()
        .map_or((None, None), parse_asn);

    let timezone_display = api.timezone.as_deref().and_then(|tz| {
        // 优先使用上游 offset 字段;缺失时按 IANA 时区推算
        let offset = api.offset.map_or_else(
            || chrono_tz::Tz::from_str(tz).ok().map(zone_offset_seconds),
            Some,
        );
        offset.map(|secs| {
            tz_abbreviation(tz).map_or_else(
                || format_utc_offset(secs),
                |abbr| format!("{} ({})", format_utc_offset(secs), abbr),
            )
        })
    });

    let org_isp = api
        .org
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| api.isp.clone().filter(|s| !s.is_empty()));

    Ok(IpLookupData {
        query_ip: api.query,
        country: api.country.filter(|s| !s.is_empty()),
        country_code: api.country_code.filter(|s| !s.is_empty()),
        region: api.region_name.filter(|s| !s.is_empty()),
        city: api.city.filter(|s| !s.is_empty()),
        org_isp,
        asn_number,
        asn_org,
        network_type,
        mobile: api.mobile.unwrap_or(false),
        proxy: api.proxy.unwrap_or(false),
        hosting: api.hosting.unwrap_or(false),
        timezone_display,
        postal_code: api.zip.filter(|s| !s.is_empty()),
        latitude: api.lat,
        longitude: api.lon,
        flag_data_uri: flag,
    })
}

// ============ HTTP 封装(薄层) ============

/// 共享 HTTP Agent(超时 + UA)。
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("qraft/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// 获取国旗 PNG 并转为 base64 data URI;任何失败静默降级为 None(不阻塞主查询)。
fn fetch_flag_data_uri(agent: &ureq::Agent, country_code: &str) -> Option<String> {
    let cc = country_code.to_ascii_lowercase();
    if cc.len() != 2 || !cc.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let url = format!("{FLAG_BASE_URL}{cc}.png");
    let resp = agent.get(&url).call().ok()?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_FLAG_BYTES)
        .read_to_end(&mut buf)
        .ok()?;
    if buf.is_empty() {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf);
    Some(format!("data:image/png;base64,{b64}"))
}

/// 执行完整查询:构造 URL → 拉取 JSON → 拉取国旗 → 映射。
///
/// # Errors
///
/// - 输入 IP 非法返回 `AppError::Forbidden`
/// - 网络请求失败或响应解析失败返回 `AppError::Unknown`
/// - 上游返回 fail 状态(如私网地址)返回 `AppError::Unknown`
pub fn lookup(raw_ip: Option<&str>) -> Result<IpLookupData, AppError> {
    let url = build_api_url(raw_ip)?;
    let agent = http_agent();

    let resp = agent.get(&url).call().map_err(|e| {
        AppError::Unknown(format!(
            "ip lookup request failed: {e}(请检查网络连接后重试)"
        ))
    })?;
    let api: ApiGeoResponse = resp.into_json().map_err(|e| {
        AppError::Unknown(format!("ip lookup response parse failed: {e}"))
    })?;

    let flag = api
        .country_code
        .as_deref()
        .and_then(|cc| fetch_flag_data_uri(&agent, cc));
    map_api_response(api, flag)
}

// ============ 单元测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- validate_lookup_ip / build_api_url ----

    #[test]
    fn test_build_api_url_for_specific_ip() {
        let url = build_api_url(Some("8.8.8.8")).unwrap();
        assert!(url.starts_with("http://ip-api.com/json/8.8.8.8?fields="));
        assert!(url.contains("countryCode"));
    }

    #[test]
    fn test_build_api_url_ipv6() {
        let url = build_api_url(Some("2001:db8::1")).unwrap();
        assert!(url.contains("/json/2001:db8::1?"));
    }

    #[test]
    fn test_build_api_url_self_query() {
        for input in [None, Some(""), Some("   ")] {
            let url = build_api_url(input).unwrap();
            assert_eq!(url, format!("{API_BASE_URL}?fields={API_FIELDS}"));
        }
    }

    #[test]
    fn test_build_api_url_rejects_injection() {
        assert!(build_api_url(Some("../admin")).is_err());
        assert!(build_api_url(Some("8.8.8.8/24")).is_err());
        assert!(build_api_url(Some("a b c")).is_err());
        assert!(build_api_url(Some("?fields=x")).is_err());
        assert!(build_api_url(Some("#fragment")).is_err());
        assert!(build_api_url(Some("abcdefgh")).is_err()); // 无分隔符
        assert!(build_api_url(Some(&"a".repeat(46))).is_err());
    }

    // ---- parse_asn ----

    #[test]
    fn test_parse_asn_standard() {
        let (num, org) = parse_asn("AS201217 RadishCloud Technology LLC");
        assert_eq!(num, Some(201_217));
        assert_eq!(org.as_deref(), Some("RadishCloud Technology LLC"));
    }

    #[test]
    fn test_parse_asn_number_only() {
        let (num, org) = parse_asn("AS12345");
        assert_eq!(num, Some(12_345));
        assert_eq!(org, None);
    }

    #[test]
    fn test_parse_asn_without_prefix_keeps_raw_org() {
        let (num, org) = parse_asn("Google LLC");
        assert_eq!(num, None);
        assert_eq!(org.as_deref(), Some("Google LLC"));
    }

    #[test]
    fn test_parse_asn_empty() {
        assert_eq!(parse_asn(""), (None, None));
        assert_eq!(parse_asn("  "), (None, None));
    }

    // ---- format_utc_offset ----

    #[test]
    fn test_format_utc_offset() {
        assert_eq!(format_utc_offset(28_800), "+08:00");
        assert_eq!(format_utc_offset(0), "+00:00");
        assert_eq!(format_utc_offset(-18_000), "-05:00");
        assert_eq!(format_utc_offset(16_380), "+04:33");
    }

    // ---- tz_abbreviation ----

    #[test]
    fn test_tz_abbreviation_hong_kong() {
        assert_eq!(tz_abbreviation("Asia/Hong_Kong").as_deref(), Some("HKT"));
    }

    #[test]
    fn test_tz_abbreviation_unknown_zone() {
        assert_eq!(tz_abbreviation("Mars/Olympus_Mons"), None);
    }

    // ---- derive_network_type ----

    #[test]
    fn test_derive_network_type_priority() {
        assert_eq!(
            derive_network_type(true, false, false),
            "(MOB) - Mobile ISP"
        );
        assert_eq!(
            derive_network_type(false, false, true),
            "(DCH) - Data Center/Web Hosting/Transit"
        );
        assert_eq!(
            derive_network_type(false, true, false),
            "(PROXY) - Proxy/VPN Exit Node"
        );
        assert_eq!(
            derive_network_type(false, false, false),
            "(ISP) - Fixed Line ISP"
        );
        // mobile 优先级最高
        assert_eq!(
            derive_network_type(true, true, true),
            "(MOB) - Mobile ISP"
        );
    }

    // ---- map_api_response ----

    fn fixture_response() -> serde_json::Value {
        serde_json::json!({
            "status": "success",
            "country": "Hong Kong",
            "countryCode": "HK",
            "region": "HCW",
            "regionName": "Hong Kong",
            "city": "Hong Kong",
            "zip": "",
            "lat": 22.2855,
            "lon": 114.1577,
            "timezone": "Asia/Hong_Kong",
            "offset": 28800,
            "isp": "RadishCloud Technology LLC",
            "org": "RadishCloud Technology LLC",
            "as": "AS201217 RadishCloud Technology LLC",
            "mobile": false,
            "proxy": false,
            "hosting": true,
            "query": "103.152.220.7"
        })
    }

    #[test]
    fn test_map_api_response_full() {
        let api: ApiGeoResponse = serde_json::from_value(fixture_response()).unwrap();
        let data =
            map_api_response(api, Some("data:image/png;base64,AAA".into())).unwrap();

        assert_eq!(data.query_ip.as_deref(), Some("103.152.220.7"));
        assert_eq!(data.country.as_deref(), Some("Hong Kong"));
        assert_eq!(data.country_code.as_deref(), Some("HK"));
        assert_eq!(data.region.as_deref(), Some("Hong Kong"));
        assert_eq!(data.city.as_deref(), Some("Hong Kong"));
        assert_eq!(
            data.org_isp.as_deref(),
            Some("RadishCloud Technology LLC")
        );
        assert_eq!(data.asn_number, Some(201_217));
        assert_eq!(
            data.asn_org.as_deref(),
            Some("RadishCloud Technology LLC")
        );
        assert!(data.network_type.starts_with("(DCH)"));
        assert!(data.hosting && !data.mobile && !data.proxy);
        // 邮编为空串 → 归一化为 None(前端显示「不可用」)
        assert_eq!(data.postal_code, None);
        assert_eq!(data.timezone_display.as_deref(), Some("+08:00 (HKT)"));
        assert_eq!(data.latitude, Some(22.2855));
        assert_eq!(
            data.flag_data_uri,
            Some("data:image/png;base64,AAA".into())
        );
    }

    #[test]
    fn test_map_api_response_org_fallback_to_isp() {
        let mut raw = fixture_response();
        raw["org"] = serde_json::Value::Null;
        raw["zip"] = serde_json::json!("999077");
        let api: ApiGeoResponse = serde_json::from_value(raw).unwrap();
        let data = map_api_response(api, None).unwrap();
        assert_eq!(
            data.org_isp.as_deref(),
            Some("RadishCloud Technology LLC")
        );
        assert_eq!(data.postal_code.as_deref(), Some("999077"));
        assert_eq!(data.flag_data_uri, None);
    }

    #[test]
    fn test_map_api_response_fail_status() {
        let raw = serde_json::json!({
            "status": "fail",
            "message": "private range",
            "query": "192.168.1.1"
        });
        let api: ApiGeoResponse = serde_json::from_value(raw).unwrap();
        let err = map_api_response(api, None).unwrap_err();
        assert!(err.to_string().contains("private range"));
    }

    #[test]
    fn test_map_api_response_missing_optional_fields() {
        let raw = serde_json::json!({ "status": "success", "query": "1.2.3.4" });
        let api: ApiGeoResponse = serde_json::from_value(raw).unwrap();
        let data = map_api_response(api, None).unwrap();
        assert_eq!(data.network_type, "(ISP) - Fixed Line ISP");
        assert_eq!(data.timezone_display, None);
        assert_eq!(data.asn_number, None);
        assert_eq!(data.org_isp, None);
    }
}
