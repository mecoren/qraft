use async_trait::async_trait;
use std::fmt::Write as _;
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

/// RGBA 结构体,内部统一表示(a ∈ [0,1])。
/// 所有格式先解析为 Rgba,再序列化为 hex/rgb/hsl/hsv/cmyk 字符串。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rgba {
    r: u8,
    g: u8,
    b: u8,
    a: f64,
}

impl Rgba {
    const OPAQUE: f64 = 1.0;

    const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self {
            r,
            g,
            b,
            a: Self::OPAQUE,
        }
    }

    const fn is_opaque(&self) -> bool {
        (self.a - Self::OPAQUE).abs() < 1e-9
    }

    // a ∈ [0,1],round 后必在 0.0..=255.0,截断与符号损失不会发生
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn to_hex(self) -> String {
        let base = format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b);
        if self.is_opaque() {
            base
        } else {
            format!("{base}{:02x}", (self.a * 255.0).round() as u8)
        }
    }

    fn to_rgb_string(self) -> String {
        if self.is_opaque() {
            format!("rgb({}, {}, {})", self.r, self.g, self.b)
        } else {
            format!(
                "rgba({}, {}, {}, {})",
                self.r,
                self.g,
                self.b,
                format_alpha(self.a)
            )
        }
    }

    /// 转 HSL(h ∈ [0,360],s/l ∈ [0,100])。标准算法,
    /// 参考 <https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB>
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
        if self.is_opaque() {
            format!("hsl({h:.0}, {s:.0}%, {l:.0}%)")
        } else {
            format!("hsla({h:.0}, {s:.0}%, {l:.0}%, {})", format_alpha(self.a))
        }
    }

    /// 转 HSV/HSB(h ∈ [0,360],s/v ∈ [0,100]),标准算法。
    #[allow(clippy::many_single_char_names, clippy::float_cmp)]
    fn to_hsv(self) -> (f64, f64, f64) {
        let r = f64::from(self.r) / 255.0;
        let g = f64::from(self.g) / 255.0;
        let b = f64::from(self.b) / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let d = max - min;
        let s = if max <= 0.0 { 0.0 } else { d / max };
        let v = max;
        if d.abs() < f64::EPSILON {
            return (0.0, 0.0, v * 100.0);
        }
        let h = if max == r {
            60.0 * (((g - b) / d) % 6.0)
        } else if max == g {
            60.0 * ((b - r) / d + 2.0)
        } else {
            60.0 * ((r - g) / d + 4.0)
        };
        (h.rem_euclid(360.0), s * 100.0, v * 100.0)
    }

    fn to_hsv_string(self) -> String {
        let (h, s, v) = self.to_hsv();
        format!("hsv({h:.0}, {s:.0}%, {v:.0}%)")
    }

    /// 转 CMYK(c/m/y/k ∈ [0,100],标准印刷换算)。
    #[allow(clippy::many_single_char_names)]
    fn to_cmyk(self) -> (f64, f64, f64, f64) {
        let r = f64::from(self.r) / 255.0;
        let g = f64::from(self.g) / 255.0;
        let b = f64::from(self.b) / 255.0;
        let k = 1.0 - r.max(g).max(b);
        if k >= 1.0 {
            return (0.0, 0.0, 0.0, 100.0);
        }
        let c = (1.0 - r - k) / (1.0 - k);
        let m = (1.0 - g - k) / (1.0 - k);
        let y = (1.0 - b - k) / (1.0 - k);
        (c * 100.0, m * 100.0, y * 100.0, k * 100.0)
    }

    fn to_cmyk_string(self) -> String {
        let (c, m, y, k) = self.to_cmyk();
        format!("cmyk({c:.0}%, {m:.0}%, {y:.0}%, {k:.0}%)")
    }

    /// 最近 CSS 命名颜色(欧氏距离最小;并列时取表中靠前者)。
    fn nearest_name(self) -> &'static str {
        let mut best: &str = "";
        let mut best_dist = i32::MAX;
        for (name, hex) in CSS_NAMED_COLORS {
            // 与 0xff 取模保证值域,截断不会发生
            let nr = i32::from(((hex >> 16) & 0xff) as u8);
            let ng = i32::from(((hex >> 8) & 0xff) as u8);
            let nb = i32::from((hex & 0xff) as u8);
            let dr = i32::from(self.r) - nr;
            let dg = i32::from(self.g) - ng;
            let db = i32::from(self.b) - nb;
            // 最大 3 × 255² = 195075,不会溢出
            let dist = dr * dr + dg * dg + db * db;
            if dist < best_dist {
                best_dist = dist;
                best = name;
            }
        }
        best
    }

    fn exact_name(self) -> Option<&'static str> {
        let target = (u32::from(self.r) << 16) | (u32::from(self.g) << 8) | u32::from(self.b);
        CSS_NAMED_COLORS
            .iter()
            .find(|(_, hex)| *hex == target)
            .map(|(name, _)| *name)
    }
}

/// f64 透明度格式化:整数不带小数点。
fn format_alpha(a: f64) -> String {
    let rounded = (a * 1000.0).round() / 1000.0;
    if (rounded - rounded.trunc()).abs() < 1e-9 {
        format!("{rounded:.0}")
    } else {
        format!("{rounded}")
    }
}

/// 解析 hex 字符串:`#rgb` `#rgba` `#rrggbb` `#rrggbbaa`(可省略 #,大小写不敏感)
#[allow(clippy::many_single_char_names)]
fn parse_hex(s: &str) -> Result<Rgba, ToolError> {
    let s = s.trim().trim_start_matches('#').to_lowercase();
    if !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ToolError::ParseFailed(format!(
            "invalid hex characters in '{s}'"
        )));
    }
    let hex_pair = |hi: usize| -> Result<u8, ToolError> {
        u8::from_str_radix(&s[hi..hi + 2], 16)
            .map_err(|e| ToolError::ParseFailed(format!("hex component: {e}")))
    };
    let (r, g, b, a) = match s.len() {
        3 => {
            let chars: Vec<char> = s.chars().collect();
            let expand = |c: char| -> Result<u8, ToolError> {
                u8::from_str_radix(&c.to_string().repeat(2), 16)
                    .map_err(|e| ToolError::ParseFailed(format!("hex component: {e}")))
            };
            (expand(chars[0])?, expand(chars[1])?, expand(chars[2])?, 255)
        }
        4 => {
            let chars: Vec<char> = s.chars().collect();
            let expand = |c: char| -> Result<u8, ToolError> {
                u8::from_str_radix(&c.to_string().repeat(2), 16)
                    .map_err(|e| ToolError::ParseFailed(format!("hex component: {e}")))
            };
            (
                expand(chars[0])?,
                expand(chars[1])?,
                expand(chars[2])?,
                expand(chars[3])?,
            )
        }
        6 => (hex_pair(0)?, hex_pair(2)?, hex_pair(4)?, 255),
        8 => (hex_pair(0)?, hex_pair(2)?, hex_pair(4)?, hex_pair(6)?),
        n => {
            return Err(ToolError::ParseFailed(format!(
                "hex string must be 3, 4, 6 or 8 digits, got {n}"
            )));
        }
    };
    Ok(Rgba {
        r,
        g,
        b,
        // u8 → f64 精确,除法结果在 0..=1,截断与符号损失不会发生
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        a: f64::from(a) / 255.0,
    })
}

/// 解析括号内以逗号分隔的数字段(容忍空格、大小写与尾随 %)。
/// 返回的片段借用自 `s`(func 仅用于匹配与错误信息,不参与生命周期)。
fn parse_function_args<'a>(s: &'a str, func: &str) -> Result<Vec<&'a str>, ToolError> {
    let trimmed = s.trim();
    let rest = trimmed
        .strip_prefix(func)
        .or_else(|| {
            // ASCII 大小写不敏感回退:手动剥离等长前缀
            if trimmed.len() >= func.len() && trimmed[..func.len()].eq_ignore_ascii_case(func) {
                Some(&trimmed[func.len()..])
            } else {
                None
            }
        })
        .and_then(|t| t.strip_prefix('('))
        .and_then(|t| t.strip_suffix(')'))
        .ok_or_else(|| ToolError::ParseFailed(format!("expected '{func}(…)' form, got '{s}'")))?;
    if rest.is_empty() {
        return Err(ToolError::ParseFailed(format!(
            "'{func}(…)' must have components, got none"
        )));
    }
    Ok(rest.split(',').map(str::trim).collect())
}

/// 解析 0-255 整数分量。
fn parse_u8_component(raw: &str, label: &str) -> Result<u8, ToolError> {
    let n: i32 = raw
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("{label} component '{raw}': {e}")))?;
    if !(0..=255).contains(&n) {
        return Err(ToolError::ParseFailed(format!(
            "{label} component must be 0-255, got {n}"
        )));
    }
    // n 已校验在 0..=255 内,截断与符号损失均不会发生
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Ok(n as u8)
}

/// 解析 0-1 浮点 alpha(也接受百分比形式 50%)。
fn parse_alpha_component(raw: &str) -> Result<f64, ToolError> {
    let t = raw.trim();
    let (value, scale) = if let Some(pct) = t.strip_suffix('%') {
        let v: f64 = pct
            .trim()
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("alpha '{raw}': {e}")))?;
        (v, 1.0 / 100.0)
    } else {
        let v: f64 = t
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("alpha '{raw}': {e}")))?;
        (v, 1.0)
    };
    let a = value * scale;
    if !(0.0..=1.0).contains(&a) {
        return Err(ToolError::ParseFailed(format!(
            "alpha must be 0-1, got {a}"
        )));
    }
    Ok(a)
}

/// 解析 `rgb(r, g, b)` / `rgba(r, g, b, a)`,允许空格灵活。
fn parse_rgb(s: &str) -> Result<Rgba, ToolError> {
    let parts = parse_function_args(
        s,
        if s.trim().to_lowercase().starts_with("rgba") {
            "rgba"
        } else {
            "rgb"
        },
    )?;
    match parts.len() {
        3 => Ok(Rgba::rgb(
            parse_u8_component(parts[0], "rgb")?,
            parse_u8_component(parts[1], "rgb")?,
            parse_u8_component(parts[2], "rgb")?,
        )),
        4 => Ok(Rgba {
            r: parse_u8_component(parts[0], "rgb")?,
            g: parse_u8_component(parts[1], "rgb")?,
            b: parse_u8_component(parts[2], "rgb")?,
            a: parse_alpha_component(parts[3])?,
        }),
        n => Err(ToolError::ParseFailed(format!(
            "rgb() must have 3 or 4 components, got {n}"
        ))),
    }
}

/// 解析 `hsl(h, s%, l%)` / `hsla(h, s%, l%, a)`,h: 0-360,s/l: 0-100。
fn parse_hsl(s: &str) -> Result<Rgba, ToolError> {
    let func = if s.trim().to_lowercase().starts_with("hsla") {
        "hsla"
    } else {
        "hsl"
    };
    let parts = parse_function_args(s, func)?;
    if parts.len() != 3 && parts.len() != 4 {
        return Err(ToolError::ParseFailed(format!(
            "{}() must have 3 or 4 components, got {}",
            func,
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
    let a = if parts.len() == 4 {
        parse_alpha_component(parts[3])?
    } else {
        Rgba::OPAQUE
    };
    let Rgba { r, g, b, .. } = hsl_to_rgb(h, s_pct / 100.0, l_pct / 100.0);
    Ok(Rgba { r, g, b, a })
}

/// 解析 `hsv(h, s%, v%)` / `hsb(h, s%, v%)`,h: 0-360,s/v: 0-100。
fn parse_hsv(s: &str) -> Result<Rgba, ToolError> {
    let func = if s.trim().to_lowercase().starts_with("hsb") {
        "hsb"
    } else {
        "hsv"
    };
    let parts = parse_function_args(s, func)?;
    if parts.len() != 3 {
        return Err(ToolError::ParseFailed(format!(
            "{func}() must have 3 components, got {}",
            parts.len()
        )));
    }
    let h: f64 = parts[0]
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("{func} hue: {e}")))?;
    let s_pct: f64 = parts[1]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("{func} saturation: {e}")))?;
    let v_pct: f64 = parts[2]
        .trim_end_matches('%')
        .parse()
        .map_err(|e| ToolError::ParseFailed(format!("{func} value: {e}")))?;
    if !(0.0..=360.0).contains(&h) {
        return Err(ToolError::ParseFailed(format!(
            "hue must be 0-360, got {h}"
        )));
    }
    if !(0.0..=100.0).contains(&s_pct) || !(0.0..=100.0).contains(&v_pct) {
        return Err(ToolError::ParseFailed(format!(
            "saturation/value must be 0-100, got {s_pct} / {v_pct}"
        )));
    }
    Ok(hsv_to_rgb(h, s_pct / 100.0, v_pct / 100.0))
}

/// 解析 `cmyk(c%, m%, y%, k%)`,各分量 0-100。
#[allow(clippy::many_single_char_names)]
fn parse_cmyk(s: &str) -> Result<Rgba, ToolError> {
    let parts = parse_function_args(s, "cmyk")?;
    if parts.len() != 4 {
        return Err(ToolError::ParseFailed(format!(
            "cmyk() must have 4 components, got {}",
            parts.len()
        )));
    }
    let pct = |raw: &str, label: &str| -> Result<f64, ToolError> {
        let v: f64 = raw
            .trim_end_matches('%')
            .parse()
            .map_err(|e| ToolError::ParseFailed(format!("cmyk {label}: {e}")))?;
        if !(0.0..=100.0).contains(&v) {
            return Err(ToolError::ParseFailed(format!(
                "cmyk {label} must be 0-100, got {v}"
            )));
        }
        Ok(v)
    };
    let c = pct(parts[0], "cyan")? / 100.0;
    let m = pct(parts[1], "magenta")? / 100.0;
    let y = pct(parts[2], "yellow")? / 100.0;
    let k = pct(parts[3], "key")? / 100.0;
    let conv = |v: f64| -> u8 {
        // 结果 ≤ 255,round 后截断与符号损失不会发生
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let out = (255.0 * (1.0 - v) * (1.0 - k)).round() as u8;
        out
    };
    Ok(Rgba::rgb(conv(c), conv(m), conv(y)))
}

/// CSS 命名颜色 → Rgb(精确匹配,大小写不敏感)。
fn parse_named_color(s: &str) -> Option<Rgba> {
    let lower = s.trim().to_lowercase();
    let hex = CSS_NAMED_COLORS
        .iter()
        .find(|(name, _)| *name == lower)
        .map(|(_, hex)| *hex)?;
    Some(Rgba::rgb(
        ((hex >> 16) & 0xff) as u8,
        ((hex >> 8) & 0xff) as u8,
        (hex & 0xff) as u8,
    ))
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
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> Rgba {
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return Rgba::rgb(v, v, v);
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
    Rgba {
        r: (r * 255.0).round() as u8,
        g: (g * 255.0).round() as u8,
        b: (b * 255.0).round() as u8,
        a: Rgba::OPAQUE,
    }
}

/// HSV → RGB,标准算法。
#[allow(
    clippy::many_single_char_names,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn hsv_to_rgb(h: f64, s: f64, v: f64) -> Rgba {
    let c = v * s;
    let h_norm = h / 60.0;
    let x = c * (1.0 - (h_norm.rem_euclid(2.0) - 1.0).abs());
    let (r1, g1, b1) = match h_norm as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    Rgba {
        r: ((r1 + m) * 255.0).round() as u8,
        g: ((g1 + m) * 255.0).round() as u8,
        b: ((b1 + m) * 255.0).round() as u8,
        a: Rgba::OPAQUE,
    }
}

/// 自动嗅探颜色格式(顺序:CSS 名称 → #hex → rgb/rgba → hsl/hsla →
/// hsv/hsb → cmyk)。
fn detect_format(text: &str) -> Option<&'static str> {
    let t = text.trim().to_lowercase();
    if t.is_empty() {
        return None;
    }
    if t.starts_with('#') || t.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some("hex");
    }
    for (prefix, fmt) in [
        ("rgb(", "rgb"),
        ("rgba(", "rgb"),
        ("hsl(", "hsl"),
        ("hsla(", "hsl"),
        ("hsv(", "hsv"),
        ("hsb(", "hsv"),
        ("cmyk(", "cmyk"),
    ] {
        if t.starts_with(prefix) {
            return Some(fmt);
        }
    }
    if t.chars().all(|c| c.is_ascii_alphabetic()) {
        return Some("name");
    }
    None
}

fn parse_color(text: &str, from_format: &str) -> Result<Rgba, ToolError> {
    match from_format {
        "auto" => match detect_format(text) {
            Some("hex") => parse_hex(text),
            Some("rgb") => parse_rgb(text),
            Some("hsl") => parse_hsl(text),
            Some("hsv") => parse_hsv(text),
            Some("cmyk") => parse_cmyk(text),
            Some("name") => parse_named_color(text)
                .ok_or_else(|| ToolError::ParseFailed(format!("unknown color name '{text}'"))),
            _ => Err(ToolError::ParseFailed(format!(
                "cannot detect color format of '{text}'"
            ))),
        },
        "hex" => parse_hex(text),
        "rgb" => parse_rgb(text),
        "hsl" => parse_hsl(text),
        "hsv" => parse_hsv(text),
        "cmyk" => parse_cmyk(text),
        "name" => parse_named_color(text)
            .ok_or_else(|| ToolError::ParseFailed(format!("unknown color name '{text}'"))),
        other => Err(ToolError::InvalidInput(format!(
            "from_format must be 'auto', 'hex', 'rgb', 'hsl', 'hsv', 'cmyk' or 'name', got '{other}'"
        ))),
    }
}

/// CSS 命名颜色表(CSS Color Module Level 4 全部 148 个关键字,小写)。
// 6 位十六进制色值即 RGB 位型,加 _ 分隔反而降低与 CSS 文档的对照性
#[allow(clippy::unreadable_literal)]
#[rustfmt::skip]
static CSS_NAMED_COLORS: &[(&str, u32)] = &[
    ("aliceblue", 0xf0f8ff), ("antiquewhite", 0xfaebd7), ("aqua", 0x00ffff),
    ("aquamarine", 0x7fffd4), ("azure", 0xf0ffff), ("beige", 0xf5f5dc),
    ("bisque", 0xffe4c4), ("black", 0x000000), ("blanchedalmond", 0xffebcd),
    ("blue", 0x0000ff), ("blueviolet", 0x8a2be2), ("brown", 0xa52a2a),
    ("burlywood", 0xdeb887), ("cadetblue", 0x5f9ea0), ("chartreuse", 0x7fff00),
    ("chocolate", 0xd2691e), ("coral", 0xff7f50), ("cornflowerblue", 0x6495ed),
    ("cornsilk", 0xfff8dc), ("crimson", 0xdc143c), ("cyan", 0x00ffff),
    ("darkblue", 0x00008b), ("darkcyan", 0x008b8b), ("darkgoldenrod", 0xb8860b),
    ("darkgray", 0xa9a9a9), ("darkgreen", 0x006400), ("darkgrey", 0xa9a9a9),
    ("darkkhaki", 0xbdb76b), ("darkmagenta", 0x8b008b), ("darkolivegreen", 0x556b2f),
    ("darkorange", 0xff8c00), ("darkorchid", 0x9932cc), ("darkred", 0x8b0000),
    ("darksalmon", 0xe9967a), ("darkseagreen", 0x8fbc8f), ("darkslateblue", 0x483d8b),
    ("darkslategray", 0x2f4f4f), ("darkslategrey", 0x2f4f4f), ("darkturquoise", 0x00ced1),
    ("darkviolet", 0x9400d3), ("deeppink", 0xff1493), ("deepskyblue", 0x00bfff),
    ("dimgray", 0x696969), ("dimgrey", 0x696969), ("dodgerblue", 0x1e90ff),
    ("firebrick", 0xb22222), ("floralwhite", 0xfffaf0), ("forestgreen", 0x228b22),
    ("fuchsia", 0xff00ff), ("gainsboro", 0xdcdcdc), ("ghostwhite", 0xf8f8ff),
    ("gold", 0xffd700), ("goldenrod", 0xdaa520), ("gray", 0x808080),
    ("green", 0x008000), ("greenyellow", 0xadff2f), ("grey", 0x808080),
    ("honeydew", 0xf0fff0), ("hotpink", 0xff69b4), ("indianred", 0xcd5c5c),
    ("indigo", 0x4b0082), ("ivory", 0xfffff0), ("khaki", 0xf0e68c),
    ("lavender", 0xe6e6fa), ("lavenderblush", 0xfff0f5), ("lawngreen", 0x7cfc00),
    ("lemonchiffon", 0xfffacd), ("lightblue", 0xadd8e6), ("lightcoral", 0xf08080),
    ("lightcyan", 0xe0ffff), ("lightgoldenrodyellow", 0xfafad2), ("lightgray", 0xd3d3d3),
    ("lightgreen", 0x90ee90), ("lightgrey", 0xd3d3d3), ("lightpink", 0xffb6c1),
    ("lightsalmon", 0xffa07a), ("lightseagreen", 0x20b2aa), ("lightskyblue", 0x87cefa),
    ("lightslategray", 0x778899), ("lightslategrey", 0x778899), ("lightsteelblue", 0xb0c4de),
    ("lightyellow", 0xffffe0), ("lime", 0x00ff00), ("limegreen", 0x32cd32),
    ("linen", 0xfaf0e6), ("magenta", 0xff00ff), ("maroon", 0x800000),
    ("mediumaquamarine", 0x66cdaa), ("mediumblue", 0x0000cd), ("mediumorchid", 0xba55d3),
    ("mediumpurple", 0x9370db), ("mediumseagreen", 0x3cb371), ("mediumslateblue", 0x7b68ee),
    ("mediumspringgreen", 0x00fa9a), ("mediumturquoise", 0x48d1cc), ("mediumvioletred", 0xc71585),
    ("midnightblue", 0x191970), ("mintcream", 0xf5fffa), ("mistyrose", 0xffe4e1),
    ("moccasin", 0xffe4b5), ("navajowhite", 0xffdead), ("navy", 0x000080),
    ("oldlace", 0xfdf5e6), ("olive", 0x808000), ("olivedrab", 0x6b8e23),
    ("orange", 0xffa500), ("orangered", 0xff4500), ("orchid", 0xda70d6),
    ("palegoldenrod", 0xeee8aa), ("palegreen", 0x98fb98), ("paleturquoise", 0xafeeee),
    ("palevioletred", 0xdb7093), ("papayawhip", 0xffefd5), ("peachpuff", 0xffdab9),
    ("peru", 0xcd853f), ("pink", 0xffc0cb), ("plum", 0xdda0dd),
    ("powderblue", 0xb0e0e6), ("purple", 0x800080), ("rebeccapurple", 0x663399),
    ("red", 0xff0000), ("rosybrown", 0xbc8f8f), ("royalblue", 0x4169e1),
    ("saddlebrown", 0x8b4513), ("salmon", 0xfa8072), ("sandybrown", 0xf4a460),
    ("seagreen", 0x2e8b57), ("seashell", 0xfff5ee), ("sienna", 0xa0522d),
    ("silver", 0xc0c0c0), ("skyblue", 0x87ceeb), ("slateblue", 0x6a5acd),
    ("slategray", 0x708090), ("slategrey", 0x708090), ("snow", 0xfffafa),
    ("springgreen", 0x00ff7f), ("steelblue", 0x4682b4), ("tan", 0xd2b48c),
    ("teal", 0x008080), ("thistle", 0xd8bfd8), ("tomato", 0xff6347),
    ("transparent", 0x000000), ("turquoise", 0x40e0d0), ("violet", 0xee82ee),
    ("wheat", 0xf5deb3), ("white", 0xffffff), ("whitesmoke", 0xf5f5f5),
    ("yellow", 0xffff00), ("yellowgreen", 0x9acd32),
];

#[async_trait]
impl Tool for ColorConverter {
    fn metadata(&self) -> &'static ToolMetadata {
        &METADATA
    }

    // hsl_str / hsv_str 等成对输出变量名由格式语义决定
    #[allow(clippy::similar_names)]
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
            .unwrap_or_else(|_| "auto".to_string());

        let start = Instant::now();
        let rgba = parse_color(text, &from_format)?;
        let (hex, rgb_str, hsl_str, hsv_str, cmyk_str) = (
            rgba.to_hex(),
            rgba.to_rgb_string(),
            rgba.to_hsl_string(),
            rgba.to_hsv_string(),
            rgba.to_cmyk_string(),
        );
        let nearest = rgba.nearest_name();
        let exact = rgba.exact_name();

        let mut out_text =
            format!("HEX: {hex}\nRGB: {rgb_str}\nHSL: {hsl_str}\nHSV: {hsv_str}\nCMYK: {cmyk_str}");
        if !rgba.is_opaque() {
            let _ = write!(out_text, "\nAlpha: {}", format_alpha(rgba.a));
        }
        let _ = write!(out_text, "\nNearest name: {nearest}");
        if let Some(name) = exact {
            let _ = write!(out_text, "\nExact name: {name}");
        }

        let mut extra = serde_json::Map::new();
        extra.insert("hex".into(), serde_json::Value::String(hex));
        extra.insert("rgb".into(), serde_json::Value::String(rgb_str));
        extra.insert("hsl".into(), serde_json::Value::String(hsl_str));
        extra.insert("hsv".into(), serde_json::Value::String(hsv_str));
        extra.insert("cmyk".into(), serde_json::Value::String(cmyk_str));
        extra.insert("alpha".into(), serde_json::json!(rgba.a));
        extra.insert(
            "nearest_name".into(),
            serde_json::Value::String(nearest.to_string()),
        );
        if let Some(name) = exact {
            extra.insert(
                "exact_name".into(),
                serde_json::Value::String(name.to_string()),
            );
        }

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
    description: "Convert colors between HEX, RGB, HSL, HSV, CMYK and CSS names, with alpha support",
    input_schema: &JSON_SCHEMA,
    output_schema: None,
    tags: &["color", "hex", "rgb", "hsl", "hsv", "cmyk", "converter"],
    version: "2.0.0",
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
    async fn test_convert_hex_with_alpha() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff573380", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff573380");
        assert_eq!(extra["rgb"], "rgba(255, 87, 51, 0.502)");
        assert_eq!(extra["alpha"], json!(128.0 / 255.0));
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
    async fn test_convert_rgba_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("rgba(255, 87, 51, 0.5)", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["rgb"], "rgba(255, 87, 51, 0.5)");
        assert_eq!(extra["hex"], "#ff573380");
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
    async fn test_convert_hsla_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("hsla(120, 100%, 50%, 0.25)", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#00ff0040");
        assert!(extra["hsl"].as_str().unwrap().starts_with("hsla("));
    }

    #[tokio::test]
    async fn test_convert_hsv_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        // hsv(0, 100%, 100%) 应为纯红
        let input = make_input("hsv(0, 100%, 100%)", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff0000");
        assert_eq!(extra["hsv"], "hsv(0, 100%, 100%)");
    }

    #[tokio::test]
    async fn test_convert_cmyk_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("cmyk(0%, 100%, 100%, 0%)", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff0000");
    }

    #[tokio::test]
    async fn test_convert_named_color_exact_and_nearest() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("tomato", "auto");

        let output = tool.execute(input, &ctx).await.unwrap();

        let extra = output.extra.unwrap();
        assert_eq!(extra["hex"], "#ff6347");
        assert_eq!(extra["exact_name"], "tomato");
        assert_eq!(extra["nearest_name"], "tomato");

        // 非色名颜色给出最近名
        let input2 = make_input("#ff5733", "auto");
        let output2 = tool.execute(input2, &ctx).await.unwrap();
        let extra2 = output2.extra.unwrap();
        assert!(extra2["nearest_name"].is_string());
        assert!(extra2.get("exact_name").is_none());
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
    async fn test_convert_unknown_name_returns_parse_failed() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("notacolor", "name");

        let result = tool.execute(input, &ctx).await;

        assert!(matches!(result, Err(ToolError::ParseFailed(_))));
    }

    #[tokio::test]
    async fn test_convert_invalid_from_format_returns_invalid_input() {
        let tool = ColorConverter::new();
        let ctx = mock_context();
        let input = make_input("#ff5733", "pantone");

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
