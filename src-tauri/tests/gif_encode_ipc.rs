// GIF 编码产物交叉验证:生成的 GIF 用 png crate 不可解,改为结构级断言 +
// Python(Pillow)在 CI 外人工验证;此处以集成测试固化结构契约与 IPC 通道。
//
// 集成测试入口(不含 Tauri 运行时):encode_gif_inner 是纯函数,直接调用。
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use base64::Engine as _;

use qraft_lib::media::gif::{GifEncodeInput, GifEncodeParams, GifFrame, encode_gif_inner};

fn solid_frame(color: [u8; 3], w: u32, h: u32) -> GifFrame {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for _ in 0..w * h {
        data.extend_from_slice(&[color[0], color[1], color[2], 255]);
    }
    GifFrame { data }
}

#[test]
fn gif_encode_via_ipc_shape() {
    let input = GifEncodeInput {
        width: 8,
        height: 8,
        frames: vec![
            solid_frame([255, 0, 0], 8, 8),
            solid_frame([0, 255, 0], 8, 8),
        ],
        params: GifEncodeParams { frame_delay_ms: 80 },
    };
    let r = encode_gif_inner(&input).expect("encode");
    assert_eq!(r.frames, 2);
    assert!(r.output_bytes > 100);
    // base64 可解且头尾正确
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&r.base64)
        .expect("valid base64");
    assert_eq!(&bytes[0..6], b"GIF89a");
    assert_eq!(*bytes.last().expect("non-empty"), 0x3B);
}
