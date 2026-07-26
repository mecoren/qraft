use async_trait::async_trait;
use std::time::Instant;

use crate::core::context::ToolContext;
use crate::core::error::ToolError;
use crate::core::input::ToolInput;
use crate::core::output::{OutputMeta, ToolOutput};
use crate::core::tool::{Tool, ToolCategory, ToolMetadata};
use crate::register_tool;

const MAX_INPUT_BYTES: usize = 256; // 颜色字符串很短

pub struct ColorConverter;

impl ColorConverter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for ColorConverter {
    fn default() -> Self {
        Self::new()
    }
}

/// RGB 结构体,内部统一表示。
/// 所有格式先解析为 Rgb,再从 Rgb 序列化为 hex/rgb/hsl 字符串。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

impl Rgb {
    fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    fn to_rgb_string(self) -> String {
        format!("rgb({}, {}, {})", self.r, self.g, self.b)
    }

    /// 转 HSL。标准算法,参考 <https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB>
    ///
    /// r/g/b/max/min/l/d/s/h 是 HSL 算法的标准数学变量名(见上述 Wikipedia 公式),
    /// 重命名会降低与文献对照的可读性;`max == r/g` 等比较的两边均由
    /// `f64::from(u8) / 255.0` 计算得到,值离散且 bit 表示一致,等价比较安全。
    #[allow(clippy::many_single_char_names, clippy::float_cmp)]
    fn to_hsl(self) -> (f64, f64, f64) {
        let r = f64::from(self.r) / 255.0;
        let g = f64::from(self.g) / 255.0;
        let b = f64::from(self.b) / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = f64::midpoint(max, min);
        if (max - min).abs() < f64::EPSILON {
            // 灰度,色相与饱和度无意义
            return (0.0, 0.0, l * 100.0);
        }
        let d = max - min;
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min)
        };
        let h = if max == r {
            ((g - b) / d) % 6.0
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        let h_deg = h * 60.0;
        let h_norm = if h_deg < 0.0 { h_deg + 360.0 } else { h_deg };
        (h_norm, s * 100.0, l * 100.0)
    }

    fn to_hsl_string(self) -> String {
        let (h, s, l) = self.to_hsl();
        format!("hsl({h:.0}, {s:.0}%, {l:.0}%)")
    }
}

/// 解析 hex 字符串:`#rgb` / `#rrggbb` / `rgb` / `rrggbb`(大小写不敏感)
fn parse_hex(s: &str) -> Result<Rgb, ToolError> {
    let s = s.trim().trim_start_matches('#').to_lowercase();
    if !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ToolError::ParseFailed(format!(
            "invalid hex characters in '{s}'"
        )));
    }
    let (r, g, b) = match s.len() {
        3 => {
            // 简写 #abc → #aabbcc
            let r = u8::from_str_radix(&s[0..1].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex r: {e}")))?;
            let g = u8::from_str_radix(&s[1..2].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex g: {e}")))?;
            let b = u8::from_str_radix(&s[2..3].repeat(2), 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex b: {e}")))?;
            (r, g, b)
        }
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex r: {e}")))?;
            let g = u8::from_str_radix(&s[2..4], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex g: {e}")))?;
            let b = u8::from_str_radix(&s[4..6], 16)
                .map_err(|e| ToolError::ParseFailed(format!("hex b: {e}")))?;
            (r, g, b)
        }
        n => {
            return Err(ToolError::ParseFailed(format!(
                "hex string must be 3 or 6 digits, got {n}"
            )));
        }
    };
    Ok(Rgb { r, g, b })
}

/// 解析 `rgb(r, g, b)`,允许空格灵活。
fn parse_rgb(s: &str) -> Result<Rgb, ToolError> {
    let trimmed = s.trim();
    let inner = trimmed
        .strip_prefix("rgb(")
        .and_then(|t| t.strip_suffix(')'))
        .ok_or_else(|| ToolError::ParseFailed(format!("expected 'rgb(r, g, b)', got '{s}'")))?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 3 {
        return Err(ToolError::ParseFailed(format!(
            "rgb() must have 3 components, got {}",
            parts.len()
        )));
    }
    // n 已校验在 0..=255 内,截断与符号损失均不会发生,加 allow 避免噪音
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let parse_comp = |p: &str| -> Result<u8, ToolError> {
        let n: i32 = p
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("rgb component '{p}': {e}")))?;
        if !(0..=255).contains(&n) {
            return Err(ToolError::ParseFailed(format!(
                "rgb component must be 0-255, got {n}"
            )));
        }
        Ok(n as u8)
    };
    Ok(Rgb {
        r: parse_comp(parts[0])?,
        g: parse_comp(parts[1])?,
        b: parse_comp(parts[2])?,
    })
}

/// 解析 `hsl(h, s%, l%)`,h: 0-360,s/l: 0-100。
fn parse_hsl(s: &str) -> Result<Rgb, ToolError> {
    let trimmed = s.trim();
    let inner = trimmed
        .strip_prefix("hsl(")
        .and_then(|t| t.strip_suffix(')'))
        .ok_or_else(|| ToolError::ParseFailed(format!("expected 'hsl(h, s%, l%)', got '{s}'")))?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 3 {
        return Err(ToolError::ParseFailed(format!(
            "hsl() must have 3 components, got {}",
            parts.len()
        )));
    }
    let h: f64 = parts[0]
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl hue: {e}")))?;
    let s_pct: f64 = parts[1]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl saturation: {e}")))?;
    let l_pct: f64 = parts[2]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("hsl lightness: {e}")))?;
    if !(0.0..=360.0).contains(&h) {
        return Err(ToolError::ParseFailed(format!(
            "hue must be 0-360, got {h}"
        )));
    }
    if !(0.0..=100.0).contains(&s_pct) || !(0.0..=100.0).contains(&l_pct) {
        return Err(ToolError::ParseFailed(format!(
            "saturation/lightness must be 0-100, got {s_pct} / {l_pct}"
        )));
    }
    Ok(hsl_to_rgb(h, s_pct / 100.0, l_pct / 100.0))
}

/// HSL → RGB,标准算法。
///
/// h/s/l/q/p/r/g/b 是 HSL→RGB 算法的标准数学变量名,重命名会降低可读性;
/// `(x * 255.0).round() as u8` 中 `round` 后值必在 0.0..=255.0,截断与符号
/// 损失均不会发生。
#[allow(
    clippy::many_single_char_names,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> Rgb {
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return Rgb { r: v, g: v, b: v };
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l.mul_add(-s, l + s)
    };
    let p = 2.0f64.mul_add(l, -q);
    let hue_to_rgb = |p: f64, q: f64, mut t: f64| -> f64 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return ((q - p) * 6.0).mul_add(t, p);
        }
        if t < 0.5 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return ((q - p) * (2.0 / 3.0 - t)).mul_add(6.0, p);
        }
        p
    };
    let h_norm = h / 360.0;
    let r = hue_to_rgb(p, q, h_norm + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h_norm);
    let b = hue_to_rgb(p, q, h_norm - 1.0 / 3.0);
    Rgb {
        r: (r * 255.0).round() as u8,
        g: (g * 255.0).round() as u8,
        b: (b * 255.0).round() as u8,
    }
}

fn parse_color(text: &str, from_format: &str) -> Result<Rgb, ToolError> {
    match from_format {
        "hex" => parse_hex(text),
        "rgb" => parse_rgb(text),
        "hsl" => parse_hsl(text),
        other => Err(ToolError::InvalidInput(format!(
            "from_format must be 'hex', 'rgb' or 'hsl', got '{other}'"
        ))),
    }
}

#[async_trait]
impl Tool for ColorConverter {
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
        let from_format: String = input
            .param("from_format")
            .unwrap_or_else(|_| "hex".to_string());

        let start = Instant::now();
        let rgb = parse_color(text, &from_format)?;
        let hex = rgb.to_hex();
        let rgb_str = rgb.to_rgb_string();
        let hsl_str = rgb.to_hsl_string();

        let out_text = format!("HEX: {hex}\nRGB: {rgb_str}\nHSL: {hsl_str}");

        let mut extra = serde_json::Map::new();
        extra.insert("hex".into(), serde_json::Value::String(hex));
        extra.insert("rgb".into(), serde_json::Value::String(rgb_str));
        extra.insert("hsl".into(), serde_json::Value::String(hsl_str));

        let output_bytes = out_text.len();
        Ok(ToolOutput {
            text: out_text,
            extra: Some(serde_json::Value::Object(extra)),
            meta: Some(OutputMeta {
                // u128 → u64:工具执行耗时远小于 u64 上限(~5.8 亿年),截断不可能发生
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
    id: "color_converter",
    name: "Color Converter",
    category: ToolCategory::Converter,
    icon: "palette",
    description: "Convert colors between HEX, RGB and HSL formats",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["color", "hex", "rgb", "hsl", "converter"],
    version: "1.0.0",
    timeout_secs: Some(5),
    streaming_supported: false,
};

// serde_json::json! 宏不是 const fn,使用 Value::Null 占位
static JSON_SCHEMA: serde_json::Value = serde_json::Value::Null;

register_tool!(ColorConverter, &METADATA);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_utils::mock_context;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_input(text: &str, from_format: &str) -> ToolInput {
        let mut params = HashMap::new();
        params.insert("from_format".to_string(), json!(from_format));
        ToolInput {
            text: Some(text.to_string()),
            file_path: None,
            params,
        }
    }

    #[tokio::test]
    async fn test_convert_hex_six_digits() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
        assert_eq!(extra["rgb"], "rgb(255, 87, 51)");
    }

    #[tokio::test]
    async fn test_convert_hex_three_digits() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#abc", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#aabbcc");
        assert_eq!(extra["rgb"], "rgb(170, 187, 204)");
    }

    #[tokio::test]
    async fn test_convert_hex_without_hash() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("ff5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
    }

    #[tokio::test]
    async fn test_convert_rgb_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("rgb(255, 87, 51)", "rgb");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff5733");
        assert_eq!(extra["rgb"], "rgb(255, 87, 51)");
    }

    #[tokio::test]
    async fn test_convert_hsl_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        // hsl(0, 100%, 50%) 应为纯红 #ff0000
        let input = make_input("hsl(0, 100%, 50%)", "hsl");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff0000");
        assert_eq!(extra["rgb"], "rgb(255, 0, 0)");
    }

    #[tokio::test]
    async fn test_convert_hsl_gray() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        // hsl(0, 0%, 50%) 应为 #808080
        let input = make_input("hsl(0, 0%, 50%)", "hsl");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#808080");
    }

    #[tokio::test]
    async fn test_convert_invalid_hex_returns_parse_failed() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#xyz", "hex");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_rgb_out_of_range_returns_parse_failed() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("rgb(300, 0, 0)", "rgb");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_invalid_from_format_returns_invalid_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff5733", "cmyk");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn test_convert_hex_uppercase_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#FF5733", "hex");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        // 输出统一小写
        assert_eq!(extra["hex"], "#ff5733");
    }
}
