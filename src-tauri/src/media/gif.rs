// GIF 编码纯逻辑(视频转 GIF 工具的编码侧)
//
// - 输入:前端逐帧抽取的 RGBA8 帧序列(尺寸统一)+ 帧延时(ms)
// - 全局调色板:全部帧像素联合中位切分(≤256 色,与 png 量化同思路)
// - 压缩:GIF LZW(可变码长,按 GIF89a 规范)
// - 透明/抖动不处理:视频帧恒为不透明,量化按 RGB 直算
//
// 本模块为纯函数实现,不依赖 Tauri 运行时,可单测。
// 像素级运算中 u64→u8 / usize→u16 的收窄为有意为之(色值域恒在 0~255、
// 尺寸受 MAX_ 校验约束),统一关闭相关 pedantic 提示。
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use std::collections::HashMap;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::shell::AppError;

/// GIF 编码参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifEncodeParams {
    /// 帧延时(ms/帧;GIF 实际以 10ms 为最小单位,向下取整且最小 20ms)
    pub frame_delay_ms: u32,
}

/// GIF 编码结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifEncodeResult {
    /// GIF 字节(base64)
    pub base64: String,
    pub output_bytes: u64,
    /// 帧数
    pub frames: usize,
    /// 实际使用的调色板条目数
    pub colors_used: usize,
    pub duration_ms: u64,
}

/// 单帧 RGBA 数据(前端 canvas getImageData 产物)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifFrame {
    /// RGBA8,长度 = width*height*4
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifEncodeInput {
    pub width: u32,
    pub height: u32,
    pub frames: Vec<GifFrame>,
    pub params: GifEncodeParams,
}

// 帧数据经 base64 的 JSON 嵌套过 IPC 体积 ~×1.33;限制总像素防内存峰值
const MAX_FRAMES: usize = 600;
const MAX_DIM: u32 = 1920;
const MAX_TOTAL_PIXELS: u64 = 1920 * 1080 * 3;

/// LSB-first 写入一个 code(按 `code_size` 位)
fn push_code(bits: &mut Vec<bool>, code: u16, size: u8) {
    for i in 0..size {
        bits.push((code >> i) & 1 == 1);
    }
}

/// 码长增长:`next_code` 达到 `2^code_size` 时 +1(上限 12)
fn maybe_grow(next_code: u16, code_size: &mut u8) {
    if usize::from(next_code) + 1 == 1usize << *code_size && *code_size < 12 {
        *code_size += 1;
    }
}

/// GIF LZW 压缩(GIF89a `变长码;min_code_size` 固定 8)
fn lzw_compress(indices: &[u8]) -> Vec<u8> {
    // 8bit 像素 → clear=0x100, end=0x101, 首个可用码 0x102
    let clear: u16 = 0x100;
    let end: u16 = 0x101;
    let mut dict: HashMap<(u16, u8), u16> = HashMap::new();
    let mut next_code: u16 = 0x102;
    let mut code_size: u8 = 9;

    let mut out_bits: Vec<bool> = Vec::new();

    push_code(&mut out_bits, clear, code_size);
    if !indices.is_empty() {
        let mut cur: u16 = u16::from(indices[0]);
        for &b in &indices[1..] {
            if let Some(&code) = dict.get(&(cur, b)) {
                cur = code;
                continue;
            }
            push_code(&mut out_bits, cur, code_size);
            dict.insert((cur, b), next_code);
            maybe_grow(next_code, &mut code_size);
            next_code += 1;
            if next_code == 0x1000 {
                // 字典满:发 clear 重置(规范允许)
                push_code(&mut out_bits, clear, code_size);
                dict.clear();
                next_code = 0x102;
                code_size = 9;
            }
            cur = u16::from(b);
        }
        push_code(&mut out_bits, cur, code_size);
    }
    push_code(&mut out_bits, end, code_size);

    // bits → bytes(末尾不足一字节补零)
    let mut out = Vec::with_capacity(out_bits.len() / 8 + 1);
    let mut byte = 0u8;
    let mut bit = 0u8;
    for b in out_bits {
        if b {
            byte |= 1 << bit;
        }
        bit += 1;
        if bit == 8 {
            out.push(byte);
            byte = 0;
            bit = 0;
        }
    }
    if bit > 0 {
        out.push(byte);
    }
    out
}

/// 全帧联合直方图 → 中位切分调色板(png.rs 同思路的简化版:无透明槽)
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

        fn split(&self) -> Option<(Self, Self)> {
            if self.colors.len() < 2 {
                return None;
            }
            let ch = (0..3).max_by_key(|&c| self.channel_range(c)).unwrap_or(0);
            let mut order: Vec<usize> = (0..self.colors.len()).collect();
            order.sort_by_key(|&i| self.colors[i][ch]);
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
        return vec![[0, 0, 0]];
    }
    let initial = Bucket {
        colors: hist.keys().copied().collect(),
        counts: hist.values().copied().collect(),
    };
    let mut buckets = vec![initial];
    while buckets.len() < target_colors {
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

/// 像素映射到最近调色板索引(O(256) 线性最近色;帧数有限,不建 k-d 树)
fn nearest_index(palette: &[[u8; 3]], rgb: [u8; 3]) -> u8 {
    let mut best = 0usize;
    let mut best_dist = u32::MAX;
    for (i, c) in palette.iter().enumerate() {
        let dr = i32::from(rgb[0]) - i32::from(c[0]);
        let dg = i32::from(rgb[1]) - i32::from(c[1]);
        let db = i32::from(rgb[2]) - i32::from(c[2]);
        let dist = u32::try_from(dr * dr + dg * dg + db * db).unwrap_or(u32::MAX);
        if dist < best_dist {
            best_dist = dist;
            best = i;
            if dist == 0 {
                break;
            }
        }
    }
    best as u8
}

/// 调色板条目数 → 颜色位深(2 的幂 ≥ 2,规范要求)
fn palette_size_pow2(entries: usize) -> usize {
    let mut n = 2usize;
    while n < entries {
        n *= 2;
    }
    n.clamp(2, 256)
}

/// GIF 编码核心(同步阻塞实现,调用方负责放入线程池)
///
/// # Errors
///
/// 输入为空 / 尺寸或帧数超限 / 帧数据长度不符时返回对应 [`AppError`]
///
/// # Panics
///
/// 不会 panic(所有收窄已校验域内)
pub fn encode_gif_inner(input: &GifEncodeInput) -> Result<GifEncodeResult, AppError> {
    let start = std::time::Instant::now();
    let frames = &input.frames;
    if frames.is_empty() {
        return Err(AppError::Unsupported("no frames".into()));
    }
    if frames.len() > MAX_FRAMES {
        return Err(AppError::Unsupported(format!(
            "too many frames: {} (max {MAX_FRAMES})",
            frames.len()
        )));
    }
    if input.width == 0 || input.height == 0 || input.width > MAX_DIM || input.height > MAX_DIM {
        return Err(AppError::Unsupported(format!(
            "invalid dimensions: {}x{} (max {MAX_DIM})",
            input.width, input.height
        )));
    }
    let pixels_per_frame = u64::from(input.width) * u64::from(input.height);
    if pixels_per_frame * frames.len() as u64 > MAX_TOTAL_PIXELS {
        return Err(AppError::Unsupported(format!(
            "total pixels exceed limit: {}x{}x{} (max {MAX_TOTAL_PIXELS})",
            input.width,
            input.height,
            frames.len()
        )));
    }
    let expected = (pixels_per_frame * 4) as usize;
    for (i, f) in frames.iter().enumerate() {
        if f.data.len() != expected {
            return Err(AppError::Unsupported(format!(
                "frame {i} size mismatch: {} != {expected}",
                f.data.len()
            )));
        }
    }

    // —— 全局调色板:全帧联合直方图中位切分 ≤256 色 ——
    let mut hist: HashMap<[u8; 3], u32> = HashMap::new();
    for f in frames {
        for px in f.data.chunks_exact(4) {
            *hist.entry([px[0], px[1], px[2]]).or_insert(0) += 1;
        }
    }
    let palette = median_cut_palette(&hist, 256);
    let colors_used = palette.len();

    // —— 头部:GIF89a + 逻辑屏幕描述符 + 全局调色板 ——
    let mut out: Vec<u8> = Vec::with_capacity(64 * 1024);
    out.extend_from_slice(b"GIF89a");
    // 逻辑屏幕描述符:宽高 LE
    out.extend_from_slice(&(u16::try_from(input.width).unwrap_or(u16::MAX)).to_le_bytes());
    out.extend_from_slice(&(u16::try_from(input.height).unwrap_or(u16::MAX)).to_le_bytes());
    // packed:全局调色板标志 1 | 色深(7) | 排序 0 | 调色板大小(位深-1)
    let table_size = palette_size_pow2(colors_used);
    let packed = 0x80u8 | 0x70 | ((table_size.trailing_zeros() as u8) - 1);
    out.push(packed);
    out.push(0); // 背景色索引
    out.push(0); // 像素宽高比(0 = 方形)
    // 全局调色板 RGB(补齐 2 的幂条目)
    for i in 0..table_size {
        let c = palette.get(i).copied().unwrap_or([0, 0, 0]);
        out.extend_from_slice(&c);
    }

    // —— 循环扩展(NETSCAPE2.0):无限循环 ——
    out.extend_from_slice(&[0x21, 0xFF, 0x0B]);
    out.extend_from_slice(b"NETSCAPE2.0");
    out.extend_from_slice(&[0x03, 0x01, 0x00, 0x00, 0x00]);

    // —— 每帧:图形控制扩展 + 图像描述符 + LZW 数据 ——
    // GIF 延时单位 1/100s;延时 0 在部分播放器被视为「全速」,统一夹到 ≥2(20ms)
    let delay_cs = (input.params.frame_delay_ms / 10).clamp(2, 600);
    for f in frames {
        // 图形控制扩展:延时 + 无透明
        out.extend_from_slice(&[0x21, 0xF9, 0x04]);
        out.push(0x00); // packed:无处置方式需求、无透明
        out.extend_from_slice(&u16::try_from(delay_cs).unwrap_or(2).to_le_bytes());
        out.push(0xFF); // 透明色索引(未用)
        out.push(0x00); // 块终止

        // 图像描述符
        out.push(0x2C);
        out.extend_from_slice(&0u16.to_le_bytes()); // left
        out.extend_from_slice(&0u16.to_le_bytes()); // top
        out.extend_from_slice(&(u16::try_from(input.width).unwrap_or(u16::MAX)).to_le_bytes());
        out.extend_from_slice(&(u16::try_from(input.height).unwrap_or(u16::MAX)).to_le_bytes());
        out.push(0x00); // packed:无局部调色板、无交错

        // LZW 最小码长 + 数据子块
        let indices: Vec<u8> = f
            .data
            .chunks_exact(4)
            .map(|px| nearest_index(&palette, [px[0], px[1], px[2]]))
            .collect();
        out.push(0x08); // min code size
        let compressed = lzw_compress(&indices);
        for chunk in compressed.chunks(0xFF) {
            out.push(chunk.len() as u8);
            out.extend_from_slice(chunk);
        }
        out.push(0x00); // 数据块终止
    }

    out.push(0x3B); // 文件终止

    Ok(GifEncodeResult {
        output_bytes: out.len() as u64,
        base64: base64::engine::general_purpose::STANDARD.encode(&out),
        frames: frames.len(),
        colors_used,
        duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_frame(color: [u8; 3], w: u32, h: u32) -> GifFrame {
        let mut data = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..w * h {
            data.extend_from_slice(&[color[0], color[1], color[2], 255]);
        }
        GifFrame { data }
    }

    fn input_of(frames: Vec<GifFrame>, w: u32, h: u32, delay: u32) -> GifEncodeInput {
        GifEncodeInput {
            width: w,
            height: h,
            frames,
            params: GifEncodeParams {
                frame_delay_ms: delay,
            },
        }
    }

    #[test]
    fn test_gif_header_and_structure() {
        let input = input_of(vec![solid_frame([255, 0, 0], 2, 2)], 2, 2, 100);
        let r = encode_gif_inner(&input).expect("encode ok");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&r.base64)
            .expect("b64");
        assert_eq!(&bytes[0..6], b"GIF89a");
        assert_eq!(bytes[6], 2);
        assert_eq!(bytes[8], 2);
        // packed:全局调色板标志
        assert!(bytes[10] & 0x80 != 0);
        // 尾部 0x3B
        assert_eq!(*bytes.last().expect("non-empty"), 0x3B);
        // 循环扩展存在(扩展头 3 字节 + "NETSCAPE2.0" 11 字节 = 14)
        let has_netscape = bytes.windows(14).any(|w| w == b"\x21\xFF\x0BNETSCAPE2.0");
        assert!(has_netscape);
        assert_eq!(r.frames, 1);
    }

    #[test]
    fn test_multi_frame_increases_size() {
        let one = encode_gif_inner(&input_of(vec![solid_frame([0, 0, 255], 4, 4)], 4, 4, 50))
            .expect("one ok");
        let two = encode_gif_inner(&input_of(
            vec![
                solid_frame([0, 0, 255], 4, 4),
                solid_frame([0, 255, 0], 4, 4),
            ],
            4,
            4,
            50,
        ))
        .expect("two ok");
        assert_eq!(two.frames, 2);
        assert!(two.output_bytes > one.output_bytes);
    }

    #[test]
    fn test_delay_clamped_to_min_20ms() {
        let input = input_of(vec![solid_frame([1, 2, 3], 2, 2)], 2, 2, 5);
        let r = encode_gif_inner(&input).expect("ok");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&r.base64)
            .expect("b64");
        // 图形控制扩展在 NETSCAPE 块后:GCE 长 8 字节,延时位于第 4-5 字节
        let gce_pos = bytes
            .windows(2)
            .position(|w| w == [0x21, 0xF9])
            .expect("gce found");
        let delay = u16::from_le_bytes([bytes[gce_pos + 4], bytes[gce_pos + 5]]);
        assert_eq!(delay, 2); // 5ms → 0.5cs → 夹到 2cs(20ms)
    }

    #[test]
    fn test_rejects_empty_and_oversize() {
        assert!(encode_gif_inner(&input_of(vec![], 2, 2, 100)).is_err());
        // 维度超限
        assert!(
            encode_gif_inner(&input_of(
                vec![solid_frame([0, 0, 0], 2000, 2)],
                2000,
                2,
                100
            ))
            .is_err()
        );
        // 帧数据长度不符
        let bad = GifFrame { data: vec![0; 8] };
        assert!(encode_gif_inner(&input_of(vec![bad], 4, 4, 100)).is_err());
        // 帧数超限
        let many = vec![solid_frame([9, 9, 9], 2, 2); MAX_FRAMES + 1];
        assert!(encode_gif_inner(&input_of(many, 2, 2, 100)).is_err());
    }

    #[test]
    fn test_lzw_round_trip_structure() {
        // LZW 输出应显著小于未压缩(纯色帧高度重复)
        let indices = vec![3u8; 4096];
        let compressed = lzw_compress(&indices);
        // 首码为 clear(0x100,9bit LSB-first):首字节 = 低 8 位 = 0x00,
        // bit8 落在次字节最低位(后续码继续填充次字节高位,不逐位断言)
        assert_eq!(compressed[0], 0x00);
        assert!(compressed[1] & 0x01 == 1);
        assert!(compressed.len() < indices.len() / 4);
    }

    #[test]
    fn test_palette_quantization_reduces_colors() {
        // 16 个不同色 → 调色板 ≤ 16 条(直方图颜色本身有限时精确代表)
        let mut frames = Vec::new();
        let mut data = Vec::new();
        for i in 0..4u8 {
            for j in 0..4u8 {
                data.extend_from_slice(&[i * 60, j * 60, 30, 255]);
            }
        }
        frames.push(GifFrame { data });
        let r = encode_gif_inner(&input_of(frames, 4, 4, 80)).expect("ok");
        assert!(r.colors_used <= 16);
        assert!(r.colors_used >= 2);
    }
}
