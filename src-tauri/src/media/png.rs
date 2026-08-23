// PNG 压缩纯逻辑(参考 DevToys.PngCompressor 的双引擎设计)
//
// - 无损模式:OxiPNG(重压缩/去冗余 chunk,像素不变)
// - 有损模式:中位切分(median-cut)调色板量化 + 可选 Floyd-Steinberg 抖动,
//   输出 Indexed 调色板 PNG(与 pngquant 思路一致;自研实现避免 GPL 依赖)
//
// 本模块为纯函数实现,不依赖 Tauri 运行时,可单测。
//
// 像素级运算中 u64→u8 / i32→u16 的收窄为有意为之(色值域恒在 0~255),
// 统一关闭相关 pedantic 提示。
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use std::collections::HashMap;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::shell::AppError;

/// 压缩参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngCompressParams {
    /// true = `OxiPNG` 无损优化;false = 调色板量化(有损)
    pub lossless: bool,
    /// 有损模式:调色板颜色数上限(2~255),默认 255
    pub colors: Option<u8>,
    /// 有损模式:Floyd-Steinberg 抖动,默认 false
    pub dither: Option<bool>,
    /// 无损模式:OxiPNG 优化等级(1~6),默认 2
    pub level: Option<u8>,
}

/// 压缩结果(base64 + 前后字节数,供 UI 展示节省比例)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PngCompressResult {
    /// 压缩后的 PNG 字节(base64)
    pub base64: String,
    /// 原始字节数
    pub input_bytes: u64,
    /// 压缩后字节数
    pub output_bytes: u64,
    /// 有损模式实际使用的调色板条目数(含透明槽);无损模式为 None
    pub colors_used: Option<usize>,
    /// 处理耗时(ms)
    pub duration_ms: u64,
}

const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024; // 64MB

/// RGBA 像素缓冲(解码归一化产物)
struct RgbaImage {
    width: u32,
    height: u32,
    pixels: Vec<u8>, // RGBA8,长度 = w*h*4
}

/// 解码 PNG 为 RGBA8(`EXPAND`:palette→RGB、`tRNS`→alpha、灰度<8bit→8bit;`STRIP_16`)
fn decode_png_rgba(bytes: &[u8]) -> Result<RgbaImage, AppError> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    // EXPAND 归一化:Indexed→RGB、tRNS→alpha、<8bit 灰度→8bit;STRIP_16 降采样到 8bit
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| AppError::Unknown(format!("PNG 解析失败: {e}")))?;
    let (color_type, _depth) = reader.output_color_type();
    let info = reader.info();
    let width = info.width;
    let height = info.height;
    let channels: usize = match color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => {
            // EXPAND 之后 Indexed 不应再出现;防御性兜底
            return Err(AppError::Unsupported(
                "unsupported color type Indexed after expand".into(),
            ));
        }
    };
    let capacity = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(channels))
        .ok_or_else(|| AppError::Unsupported("png dimensions overflow".into()))?;
    let mut raw = vec![0u8; capacity];
    reader
        .next_frame(&mut raw)
        .map_err(|e| AppError::Unknown(format!("PNG 解码失败: {e}")))?;

    let px_count = (width as usize) * (height as usize);
    let mut pixels = Vec::with_capacity(px_count * 4);
    for i in 0..px_count {
        match channels {
            1 => {
                let g = raw[i];
                pixels.extend_from_slice(&[g, g, g, 255]);
            }
            2 => {
                let g = raw[i * 2];
                let a = raw[i * 2 + 1];
                pixels.extend_from_slice(&[g, g, g, a]);
            }
            3 => pixels.extend_from_slice(&[raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], 255]),
            _ => pixels.extend_from_slice(&raw[i * 4..i * 4 + 4]),
        }
    }
    Ok(RgbaImage {
        width,
        height,
        pixels,
    })
}

/// 把 PNG 字节按指定优化等级交给 `OxiPNG` 无损优化(内存内处理)
fn optimize_lossless(bytes: &[u8], level: u8) -> Result<Vec<u8>, AppError> {
    oxipng::optimize_from_memory(bytes, &oxipng::Options::from_preset(level.clamp(1, 6)))
        .map_err(|e| AppError::Internal(anyhow::anyhow!("OxiPNG 优化失败: {e}")))
}

/// 中位切分量化上下文
struct Quantized {
    palette_rgb: Vec<[u8; 3]>,
    /// 透明保留槽固定为索引 0(`palette_rgb[0]` 无意义占位)
    indices: Vec<u8>,
    colors_used: usize,
    has_transparency: bool,
}

/// RGB 中位切分:对去重后的颜色按计数加权,反复在最长通道上切分直到达到目标色数
fn median_cut_palette(hist: &HashMap<[u8; 3], u32>, target_colors: usize) -> Vec<[u8; 3]> {
    struct Bucket {
        colors: Vec<[u8; 3]>,
        counts: Vec<u32>,
    }

    impl Bucket {
        fn channel_range(&self, ch: usize) -> u32 {
            let (mut min, mut max) = (u8::MAX, u8::MIN);
            for c in &self.colors {
                min = min.min(c[ch]);
                max = max.max(c[ch]);
            }
            u32::from(max) - u32::from(min)
        }

        /// 桶内加权平均色(即调色板条目)
        fn average(&self) -> [u8; 3] {
            let (mut r, mut g, mut b, mut total) = (0u64, 0u64, 0u64, 0u64);
            for (c, n) in self.colors.iter().zip(self.counts.iter()) {
                let n = u64::from(*n);
                r += u64::from(c[0]) * n;
                g += u64::from(c[1]) * n;
                b += u64::from(c[2]) * n;
                total += n;
            }
            if total == 0 {
                return [0, 0, 0];
            }
            [(r / total) as u8, (g / total) as u8, (b / total) as u8]
        }

        /// 在跨度最长的通道按加权中位数切分为两桶
        fn split(&self) -> Option<(Self, Self)> {
            if self.colors.len() < 2 {
                return None;
            }
            let ch = (0..3).max_by_key(|&c| self.channel_range(c)).unwrap_or(0);
            let mut order: Vec<usize> = (0..self.colors.len()).collect();
            order.sort_by_key(|&i| self.colors[i][ch]);
            // 加权中位数位置:累计计数过半处切分
            let total: u32 = self.counts.iter().sum();
            let mut acc = 0u32;
            let mut split_at = order.len() / 2;
            for (pos, &i) in order.iter().enumerate() {
                acc += self.counts[i];
                if acc * 2 >= total {
                    split_at = pos + 1;
                    break;
                }
            }
            if split_at >= order.len() || split_at == 0 {
                split_at = order.len() / 2;
            }
            let (lo_idx, hi_idx) = order.split_at(split_at);
            let mk = |idx: &[usize]| Self {
                colors: idx.iter().map(|&i| self.colors[i]).collect(),
                counts: idx.iter().map(|&i| self.counts[i]).collect(),
            };
            Some((mk(lo_idx), mk(hi_idx)))
        }
    }

    if hist.is_empty() {
        return Vec::new();
    }
    let initial = Bucket {
        colors: hist.keys().copied().collect(),
        counts: hist.values().copied().collect(),
    };
    let mut buckets = vec![initial];
    while buckets.len() < target_colors {
        // 每轮挑选「最大跨度 × 像素量」最大的桶切分,兼顾视觉权重
        let best = buckets
            .iter()
            .enumerate()
            .filter(|(_, b)| b.colors.len() >= 2)
            .max_by_key(|(_, b)| {
                let spread = (0..3).map(|c| b.channel_range(c)).max().unwrap_or(0);
                let count: u32 = b.counts.iter().sum();
                u64::from(spread) * u64::from(count)
            });
        let Some((idx, _)) = best else { break };
        let bucket = buckets.swap_remove(idx);
        if let Some((a, b)) = bucket.split() {
            buckets.push(a);
            buckets.push(b);
        } else {
            buckets.push(bucket);
            break;
        }
    }
    buckets.iter().map(Bucket::average).collect()
}

/// 执行有损量化:透明像素 → 索引 0;其余按最近调色板色映射(+可选 FS 抖动)
fn quantize(img: &RgbaImage, target_colors: usize, dither: bool) -> Quantized {
    // 直方图:仅统计非完全透明像素的 RGB
    let mut hist: HashMap<[u8; 3], u32> = HashMap::new();
    let px_count = (img.width as usize) * (img.height as usize);
    let mut has_transparency = false;
    for i in 0..px_count {
        let p = &img.pixels[i * 4..i * 4 + 4];
        if p[3] == 0 {
            has_transparency = true;
            continue;
        }
        *hist.entry([p[0], p[1], p[2]]).or_insert(0) += 1;
    }

    // 颜色预算:透明槽占用 1 个
    let budget = target_colors
        .saturating_sub(usize::from(has_transparency))
        .max(1);
    let quant_palette = median_cut_palette(&hist, budget);

    let palette_rgb: Vec<[u8; 3]> = if has_transparency {
        std::iter::once([0, 0, 0])
            .chain(quant_palette.iter().copied())
            .collect()
    } else {
        quant_palette
    };

    // 最近邻查找(线性扫描即可:唯一色数 ≤ 数万,调色板 ≤ 256)
    let nearest = |rgb: [u8; 3]| -> usize {
        let start = usize::from(has_transparency); // 跳过透明槽
        let mut best_i = start.min(palette_rgb.len().saturating_sub(1));
        let mut best_d = u32::MAX;
        for (i, c) in palette_rgb.iter().enumerate().skip(start) {
            let dr = i32::from(rgb[0]) - i32::from(c[0]);
            let dg = i32::from(rgb[1]) - i32::from(c[1]);
            let db = i32::from(rgb[2]) - i32::from(c[2]);
            let d = u32::try_from(dr * dr + dg * dg + db * db).unwrap_or(u32::MAX);
            if d < best_d {
                best_d = d;
                best_i = i;
            }
        }
        best_i
    };

    let mut indices = vec![0u8; px_count];
    if dither {
        // Floyd-Steinberg:i16 误差缓冲(逐行传播),映射走最近邻
        let w = img.width as usize;
        let h = img.height as usize;
        let mut err = vec![0i16; px_count.saturating_mul(3)];
        let at = |x: usize, y: usize| y * w + x;
        for y in 0..h {
            for x in 0..w {
                let idx = at(x, y);
                let p = &img.pixels[idx * 4..idx * 4 + 4];
                if p[3] == 0 {
                    continue; // 透明槽
                }
                let mut want = [0i32; 3];
                for c in 0..3 {
                    want[c] = i32::from(p[c]) + i32::from(err[idx * 3 + c]);
                    want[c] = want[c].clamp(0, 255);
                }
                let chosen = nearest([want[0] as u8, want[1] as u8, want[2] as u8]);
                indices[idx] = chosen as u8;
                let pc = palette_rgb[chosen];
                let new_err = [
                    want[0] - i32::from(pc[0]),
                    want[1] - i32::from(pc[1]),
                    want[2] - i32::from(pc[2]),
                ];
                // 标准 FS 权重:x+1 7/16,x-1/y+1 3/16,y+1 5/16,x+1/y+1 1/16
                let mut push = |ex: usize, ey: usize, w8: i32| {
                    if ex < w && ey < h {
                        let base = at(ex, ey) * 3;
                        for (c, ev) in new_err.iter().enumerate() {
                            err[base + c] += ((ev * w8) / 16) as i16;
                        }
                    }
                };
                push(x + 1, y, 7);
                if x > 0 {
                    push(x - 1, y + 1, 3);
                }
                push(x, y + 1, 5);
                push(x + 1, y + 1, 1);
            }
        }
    } else {
        for (i, px) in img.pixels.chunks_exact(4).enumerate() {
            if px[3] == 0 {
                continue;
            }
            indices[i] = nearest([px[0], px[1], px[2]]) as u8;
        }
    }

    Quantized {
        colors_used: palette_rgb.len(),
        palette_rgb,
        indices,
        has_transparency,
    }
}

/// 把量化结果编码为 Indexed 调色板 PNG(PLTE + 可选 tRNS)
fn encode_indexed_png(img: &RgbaImage, q: &Quantized) -> Result<Vec<u8>, AppError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, img.width, img.height);
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        let mut palette = Vec::with_capacity(q.palette_rgb.len() * 3);
        for c in &q.palette_rgb {
            palette.extend_from_slice(&[c[0], c[1], c[2]]);
        }
        encoder.set_palette(palette);
        if q.has_transparency {
            // tRNS:每个调色板条目一个 alpha;透明槽为 0,其余 255
            let trns: Vec<u8> = std::iter::once(0u8)
                .chain(std::iter::repeat_n(
                    255u8,
                    q.palette_rgb.len().saturating_sub(1),
                ))
                .collect();
            encoder.set_trns(trns);
        }
        let mut writer = encoder
            .write_header()
            .map_err(|e| AppError::Internal(anyhow::anyhow!("PNG 编码头失败: {e}")))?;
        writer
            .write_image_data(&q.indices)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("PNG 编码失败: {e}")))?;
        writer
            .finish()
            .map_err(|e| AppError::Internal(anyhow::anyhow!("PNG 收尾失败: {e}")))?;
    }
    Ok(out)
}

/// 压缩核心(同步阻塞实现,调用方负责放入线程池)
///
/// # Errors
///
/// 输入为空 / 超过大小上限 / PNG 解析失败时返回对应 [`AppError`]
pub fn compress_inner(
    bytes: &[u8],
    params: &PngCompressParams,
) -> Result<PngCompressResult, AppError> {
    let start = std::time::Instant::now();
    if bytes.is_empty() {
        return Err(AppError::Unsupported("empty png input".into()));
    }
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(AppError::Unsupported(format!(
            "png too large: {} bytes (max {MAX_INPUT_BYTES})",
            bytes.len()
        )));
    }
    if params.lossless {
        let level = params.level.unwrap_or(2);
        let optimized = optimize_lossless(bytes, level)?;
        return Ok(PngCompressResult {
            output_bytes: optimized.len() as u64,
            base64: base64::engine::general_purpose::STANDARD.encode(optimized),
            input_bytes: bytes.len() as u64,
            colors_used: None,
            duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        });
    }

    let colors = usize::from(params.colors.unwrap_or(255)).clamp(2, 255);
    let dither = params.dither.unwrap_or(false);
    let img = decode_png_rgba(bytes)?;
    let q = quantize(&img, colors, dither);
    let encoded = encode_indexed_png(&img, &q)?;
    let output_bytes = encoded.len() as u64;

    Ok(PngCompressResult {
        base64: base64::engine::general_purpose::STANDARD.encode(encoded),
        input_bytes: bytes.len() as u64,
        output_bytes,
        colors_used: Some(q.colors_used),
        duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一张 4x2 的测试 PNG:左半红、右半带 alpha 的绿色
    fn tiny_png_bytes() -> Vec<u8> {
        let w = 4u32;
        let h = 2u32;
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..h {
            for x in 0..w {
                if x % 2 == 0 {
                    rgba.extend_from_slice(&[200, 10, 10, 255]);
                } else {
                    rgba.extend_from_slice(&[10, 200, 10, 128]);
                }
            }
        }
        encode_rgba_png(w, h, &rgba)
    }

    /// 用 png crate 编码 RGBA8 缓冲(测试辅助)
    fn encode_rgba_png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, w, h);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(rgba).unwrap();
            writer.finish().unwrap();
        }
        out
    }

    #[test]
    fn test_decode_png_rgba_normalizes() {
        let png_bytes = tiny_png_bytes();
        let img = decode_png_rgba(&png_bytes).unwrap();
        assert_eq!(img.width, 4);
        assert_eq!(img.height, 2);
        assert_eq!(img.pixels.len(), 4 * 2 * 4);
        // 左上角红色不透明
        assert_eq!(&img.pixels[0..4], &[200, 10, 10, 255]);
    }

    #[test]
    fn test_quantize_reduces_colors_and_preserves_transparency() {
        let png_bytes = tiny_png_bytes();
        let img = decode_png_rgba(&png_bytes).unwrap();
        let q = quantize(&img, 256, false);
        // 半透明像素 alpha=128 ≠ 0 → 不产生透明槽,调色板 = 实际颜色种类
        assert!(!q.has_transparency);
        assert_eq!(q.colors_used, 2);

        // 全透明输入 → 透明槽生效
        let mut transparent = vec![0u8; 4 * 2 * 4];
        for px in transparent.chunks_mut(4) {
            px.copy_from_slice(&[9, 9, 9, 0]);
        }
        let img_t = RgbaImage {
            width: 4,
            height: 2,
            pixels: transparent,
        };
        let qt = quantize(&img_t, 256, false);
        assert!(qt.has_transparency);
        assert!(qt.indices.iter().all(|&i| i == 0));
    }

    #[test]
    fn test_encode_indexed_png_round_trip() {
        let png_bytes = tiny_png_bytes();
        let img = decode_png_rgba(&png_bytes).unwrap();
        let q = quantize(&img, 256, false);
        let indexed = encode_indexed_png(&img, &q).unwrap();
        // 能被再次解码且为 Indexed 类型
        let decoder = png::Decoder::new(std::io::Cursor::new(&indexed[..]));
        let reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().color_type, png::ColorType::Indexed);
    }

    #[test]
    fn test_compress_inner_lossless_not_larger() {
        // 未优化的 RGBA PNG 经 OxiPNG 不应变大
        let png_bytes = tiny_png_bytes();
        let params = PngCompressParams {
            lossless: true,
            colors: None,
            dither: None,
            level: Some(2),
        };
        let result = compress_inner(&png_bytes, &params).unwrap();
        assert_eq!(result.input_bytes, png_bytes.len() as u64);
        assert!(result.output_bytes <= png_bytes.len() as u64);
        assert!(result.colors_used.is_none());
    }

    #[test]
    fn test_compress_inner_lossy_reports_sizes() {
        let png_bytes = tiny_png_bytes();
        let params = PngCompressParams {
            lossless: false,
            colors: Some(16),
            dither: Some(false),
            level: None,
        };
        let result = compress_inner(&png_bytes, &params).unwrap();
        assert!(result.output_bytes > 0);
        assert_eq!(result.colors_used, Some(2));
    }

    #[test]
    fn test_compress_inner_rejects_empty() {
        let params = PngCompressParams {
            lossless: true,
            colors: None,
            dither: None,
            level: None,
        };
        assert!(compress_inner(b"", &params).is_err());
    }
}
