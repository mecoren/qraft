use async_trait::async_trait;
use chrono::{DateTime, Datelike, FixedOffset, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 1024; // 时间戳输入很短

pub struct TimestampConverter;

impl TimestampConverter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for TimestampConverter {
    fn default() -> Self {
        Self::new()
    }
}

/// 解析输入文本为 UTC `DateTime`。
/// 支持以下自动识别策略:
///  1. "now" → 当前时间
///  2. 纯数字(可带 +/- 与小数)→ Unix 时间戳,按量级启发:秒 / 毫秒 / 微秒 / 纳秒
///  3. ISO 8601 / RFC 3339(含时区后缀)
///  4. 常见 `YYYY-MM-DD HH:MM:SS` 形式(按 UTC 解析)
fn parse_input(text: &str) -> Result<DateTime<Utc>, ToolError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ToolError::InvalidInput("text is empty".to_string()));
    }

    // 策略 1:"now" → 当前时间(大小写不敏感)
    if trimmed.eq_ignore_ascii_case("now") {
        return Ok(Utc::now());
    }

    // 策略 2:数字 → Unix 时间戳(整数或小数;支持负数,1970 前)
    // 截断/符号转换均来自已量级校验的浮点,损失为 0,显式 allow 避免噪音
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || c == '+' || c == '-' || c == '.')
        && trimmed.chars().any(|c| c.is_ascii_digit())
    {
        // 带小数 → 视为(秒或毫秒级)浮点时间戳
        if trimmed.contains('.') {
            let v: f64 = trimmed
                .parse()
                .map_err(|e| ToolError::ParseFailed(format!("invalid timestamp number: {e}")))?;
            let secs = if v.abs() >= 1e11 { v / 1000.0 } else { v };
            return DateTime::<Utc>::from_timestamp(
                secs.trunc() as i64,
                (secs.fract().abs() * 1_000_000_000.0) as u32,
            )
            .ok_or_else(|| ToolError::ParseFailed(format!("timestamp out of range: {secs}")));
        }
        let n: i64 = trimmed
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("invalid timestamp number: {e}")))?;
        let (secs, nanos) = split_timestamp_by_magnitude(n);
        return DateTime::<Utc>::from_timestamp(secs, nanos)
            .ok_or_else(|| ToolError::ParseFailed(format!("timestamp out of range: {secs}")));
    }

    // 策略 3:RFC 3339 / ISO 8601(优先尝试,带时区)
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&Utc));
    }

    // 策略 4:`YYYY-MM-DD HH:MM:SS` 或 `YYYY-MM-DDTHH:MM:SS`(无时区,按 UTC)
    let candidates = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d",
    ];
    for fmt in candidates {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Ok(Utc.from_utc_datetime(&naive));
        }
        // 仅日期格式,NaiveDateTime 解析会失败,尝试 NaiveDate 路径
        if fmt.ends_with("%d") && !trimmed.contains(':') {
            if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, fmt) {
                // 00:00:00 始终是合法时间,and_hms_opt 必返回 Some,unwrap 安全
                #[allow(clippy::unwrap_used)]
                let naive = date.and_hms_opt(0, 0, 0).unwrap();
                return Ok(Utc.from_utc_datetime(&naive));
            }
        }
    }

    Err(ToolError::ParseFailed(format!(
        "cannot parse '{trimmed}' as timestamp or date string"
    )))
}

/// 按量级把整数时间戳拆分为 (秒, 纳秒)。
/// 阈值沿用业界惯例(|n| ≥ 1e11 视为毫秒,≥ 1e14 微秒,≥ 1e17 纳秒),
/// 避免 11-13 位歧义:10^11 秒对应公元 5138 年,实践中只可能是毫秒。
// rem_euclid 结果已在范围内,截断/符号损失不会发生
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
const fn split_timestamp_by_magnitude(n: i64) -> (i64, u32) {
    let abs = n.abs();
    if abs >= 100_000_000_000_000_000 {
        // 纳秒
        (n / 1_000_000_000, (n.rem_euclid(1_000_000_000)) as u32)
    } else if abs >= 100_000_000_000_000 {
        // 微秒
        (n / 1_000_000, (n.rem_euclid(1_000_000) * 1_000) as u32)
    } else if abs >= 100_000_000_000 {
        // 毫秒
        (n / 1_000, (n.rem_euclid(1_000) * 1_000_000) as u32)
    } else {
        (n, 0)
    }
}

/// 将 UTC 时间转换为指定时区的字符串。
/// timezone 为 IANA 名称(如 "Asia/Shanghai"),非法时回退到 UTC + 警告。
fn to_local_string(utc: DateTime<Utc>, timezone: &str) -> Result<String, ToolError> {
    if timezone == "UTC" || timezone.is_empty() {
        return Ok(utc.to_rfc3339());
    }
    // 优先尝试 chrono_tz 的 IANA 解析
    if let Ok(tz) = timezone.parse::<Tz>() {
        return Ok(utc.with_timezone(&tz).to_rfc3339());
    }
    // 再尝试固定偏移(+08:00 等)
    if let Ok(offset) = parse_fixed_offset(timezone) {
        if let Some(fo) = FixedOffset::east_opt(offset) {
            return Ok(utc.with_timezone(&fo).to_rfc3339());
        }
    }
    Err(ToolError::InvalidInput(format!(
        "unknown timezone: {timezone}"
    )))
}

/// 解析 `+08:00` / `-05:30` 形式的偏移为秒数。
fn parse_fixed_offset(s: &str) -> Result<i32, ()> {
    let bytes = s.as_bytes();
    if bytes.len() < 6 || (bytes[0] != b'+' && bytes[0] != b'-') {
        return Err(());
    }
    let sign: i32 = if bytes[0] == b'+' { 1 } else { -1 };
    let rest = &s[1..];
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 2 {
        return Err(());
    }
    let h: i32 = parts[0].parse().map_err(|_| ())?;
    let m: i32 = parts[1].parse().map_err(|_| ())?;
    Ok(sign * (h * 3600 + m * 60))
}

/// 把偏移秒数格式化为 `+08:00` 形式。
fn format_offset(total_secs: i32) -> String {
    let sign = if total_secs < 0 { '-' } else { '+' };
    let abs = total_secs.abs();
    format!("{}{:02}:{:02}", sign, abs / 3600, (abs % 3600) / 60)
}

/// 计算所选时区相对 UTC 的偏移秒数(与 `to_local_string` 的解析顺序保持一致)。
fn offset_seconds(utc: DateTime<Utc>, timezone: &str) -> i32 {
    if timezone == "UTC" || timezone.is_empty() {
        return 0;
    }
    if let Ok(tz) = timezone.parse::<Tz>() {
        return tz
            .from_utc_datetime(&utc.naive_utc())
            .offset()
            .fix()
            .local_minus_utc();
    }
    if let Ok(offset) = parse_fixed_offset(timezone) {
        return offset;
    }
    0
}

/// 计算相对当前时间的友好描述(英文,简化版)。
fn relative_description(utc: DateTime<Utc>) -> String {
    let now = Utc::now();
    let delta = now.signed_duration_since(utc);
    let secs = delta.num_seconds();
    if secs.abs() < 60 {
        return format!(
            "{} seconds {}",
            secs.abs(),
            if secs >= 0 { "ago" } else { "from now" }
        );
    }
    let mins = secs / 60;
    if mins.abs() < 60 {
        return format!(
            "{} minutes {}",
            mins.abs(),
            if mins >= 0 { "ago" } else { "from now" }
        );
    }
    let hours = mins / 60;
    if hours.abs() < 24 {
        return format!(
            "{} hours {}",
            hours.abs(),
            if hours >= 0 { "ago" } else { "from now" }
        );
    }
    let days = hours / 24;
    if days.abs() < 30 {
        return format!(
            "{} days {}",
            days.abs(),
            if days >= 0 { "ago" } else { "from now" }
        );
    }
    let months = days / 30;
    if months.abs() < 12 {
        return format!(
            "{} months {}",
            months.abs(),
            if months >= 0 { "ago" } else { "from now" }
        );
    }
    let years = days / 365;
    format!(
        "{} years {}",
        years.abs(),
        if years >= 0 { "ago" } else { "from now" }
    )
}

#[async_trait]
impl Tool for TimestampConverter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    async fn execute(&self, input: ToolInput, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let text = input.text()?;
        let input_bytes = text.len();
        if input_bytes > MAX_INPUT_BYTES {
            return Err(ToolError::InputTooLarge {
                size: input_bytes,
                max: MAX_INPUT_BYTES,
            });
        }
        let timezone: String = input
            .param("timezone")
            .unwrap_or_else(|_| "UTC".to_string());

        let start = Instant::now();
        let utc = parse_input(text)?;

        let unix_seconds = utc.timestamp();
        let unix_millis = utc.timestamp_millis();
        let iso8601 = utc.to_rfc3339();
        let local = to_local_string(utc, &timezone)?;
        let relative = relative_description(utc);
        // 供前端用 Intl.RelativeTimeFormat 本地化(秒差)
        let relative_seconds = (Utc::now() - utc).num_seconds();
        // ISO 星期(1=周一 … 7=周日)、年内天、ISO 周号
        let weekday_index = i64::from(utc.weekday().num_days_from_monday()) + 1;
        let day_of_year = i64::from(utc.ordinal());
        let iso_week = i64::from(utc.iso_week().week());
        let utc_offset = format_offset(offset_seconds(utc, &timezone));

        // 文本输出:多行汇总便于复制
        let out_text = format!(
            "Unix (seconds): {unix_seconds}\nUnix (millis): {unix_millis}\nISO 8601: {iso8601}\nLocal ({timezone}): {local}\nUTC offset: {utc_offset}\nISO weekday: {weekday_index}\nDay of year: {day_of_year}\nISO week: {iso_week}\nRelative: {relative}"
        );

        let mut extra = serde_json::Map::new();
        extra.insert("unix_seconds".into(), serde_json::json!(unix_seconds));
        extra.insert("unix_millis".into(), serde_json::json!(unix_millis));
        extra.insert("iso8601".into(), serde_json::Value::String(iso8601));
        extra.insert("local".into(), serde_json::Value::String(local));
        extra.insert("relative".into(), serde_json::Value::String(relative));
        extra.insert(
            "relative_seconds".into(),
            serde_json::json!(relative_seconds),
        );
        extra.insert("weekday_index".into(), serde_json::json!(weekday_index));
        extra.insert("day_of_year".into(), serde_json::json!(day_of_year));
        extra.insert("iso_week".into(), serde_json::json!(iso_week));
        extra.insert("utc_offset".into(), serde_json::Value::String(utc_offset));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(serde_json::Value::Object(extra)),
            meta: Some(OutputMeta {
                // u128 → u64:工具执行耗时远小于 u64 上限,截断不可能发生
                #[allow(clippy::cast_possible_truncation)]
                duration_ms: start.elapsed().as_millis() as u64,
                input_bytes,
                output_bytes,
            }),
            alerts: Vec::new(),
        })
    }
}

static METADATA: ToolMetadata = ToolMetadata {
    id: "timestamp_converter",
    name: "Timestamp Converter",
    category: ToolCategory::Converter,
    icon: "clock",
    description: "Convert between Unix timestamps and date strings across timezones",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["timestamp", "date", "time", "unix", "timezone"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(TimestampConverter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str) -> ToolInput {
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params: HashMap::new(),
        }
    }

    fn make_input_with_tz(text: &str, tz: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("timezone".to_string(), json!(tz));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_convert_unix_seconds() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("1690272000");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1_690_272_000);
        assert_eq!(extra["unix_millis"], 1_690_272_000_000i64);
        assert_eq!(extra["iso8601"], "2023-07-25T08:00:00+00:00");
    }

    #[tokio::test]
    async fn test_convert_unix_millis() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("1690272000000");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1_690_272_000);
        assert_eq!(extra["unix_millis"], 1_690_272_000_000i64);
    }

    #[tokio::test]
    async fn test_parse_now() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let before = Utc::now().timestamp();
        let output = tool.execute(make_input("NOW"), &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        let after = Utc::now().timestamp();
        let secs = extra["unix_seconds"].as_i64().unwrap();
        assert!(secs >= before && secs <= after);
    }

    #[tokio::test]
    async fn test_parse_negative_timestamp() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        // 1969-12-31T23:59:59Z
        let output = tool.execute(make_input("-1"), &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], -1i64);
    }

    #[tokio::test]
    async fn test_parse_fractional_seconds() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let output = tool
            .execute(make_input("1690272000.5"), &ctx)
            .await
            .unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1_690_272_000i64);
        assert_eq!(extra["unix_millis"], 1_690_272_000_500i64);
    }

    #[tokio::test]
    async fn test_parse_micro_and_nano_timestamps() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        // 微秒:1690272000_000000
        let out_us = tool
            .execute(make_input("1690272000000000"), &ctx)
            .await
            .unwrap();
        assert_eq!(out_us.extra.unwrap()["unix_seconds"], 1_690_272_000i64);
        // 纳秒:1690272000_000000123(纳秒精度截断到毫秒)
        let out_ns = tool
            .execute(make_input("1690272000000000123"), &ctx)
            .await
            .unwrap();
        assert_eq!(out_ns.extra.unwrap()["unix_seconds"], 1_690_272_000i64);
    }

    #[tokio::test]
    async fn test_new_extra_fields_present() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        // 2023-07-25 是周二(ISO 3)、年内第 206 天、ISO 周 30
        let output = tool.execute(make_input("1690272000"), &ctx).await.unwrap();
        let extra = output.extra.unwrap();
        assert_eq!(extra["weekday_index"], 2i64);
        assert_eq!(extra["day_of_year"], 206i64);
        assert_eq!(extra["iso_week"], 30i64);
        assert_eq!(extra["utc_offset"], "+00:00");
        assert!(extra["relative_seconds"].is_i64());
    }

    #[tokio::test]
    async fn test_convert_iso8601_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("2023-07-25T08:00:00Z");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1_690_272_000);
    }

    #[tokio::test]
    async fn test_convert_date_string_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("2023-07-25 08:00:00");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["unix_seconds"], 1_690_272_000);
    }

    #[tokio::test]
    async fn test_convert_with_iana_timezone() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "Asia/Shanghai");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        // 上海时区应显示 +08:00
        let local = extra["local"].as_str().unwrap();
        assert!(local.contains("+08:00"));
    }

    #[tokio::test]
    async fn test_convert_with_fixed_offset_timezone() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "-05:00");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let local = extra["local"].as_str().unwrap();
        assert!(local.contains("-05:00"));
    }

    #[tokio::test]
    async fn test_convert_invalid_string_returns_parse_failed() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("not a date");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_empty_returns_invalid_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input("   ");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_invalid_timezone_returns_invalid_input() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        let input = make_input_with_tz("1690272000", "Mars/Olympus");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_includes_relative_description() {
        let tool = TimestampConverter::new();
        let ctx = mock_context();
        // 用一个明确的历史时间(2 天前左右)
        let now_secs = Utc::now().timestamp() - 2 * 24 * 3600;
        let input = make_input(&now_secs.to_string());

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        let rel = extra["relative"].as_str().unwrap();
        assert!(rel.contains("days ago"));
    }
}
