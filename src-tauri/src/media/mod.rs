// 媒体处理层:纯逻辑模块(不依赖 Tauri 运行时,测试编译下可用)
//
// - png:PNG 解码 / 有损量化(中位切分)/ 无损优化(OxiPNG)封装
// - text_encoding:文本编码探测与转换(UTF-8/GBK/Big5/Shift-JIS 等)
// - large_file:大文件流式查看(行索引扫描 + 锚点式行窗口读取)
// - fs_write:原子写盘原语(命令层 `#[cfg(not(test))]` 门挡测试,故下沉到此层取覆盖)
// - fs_watch:外部文件变更监视(notify 封装 + 按路径去抖)
// - gif:GIF89a 编码(全局调色板中位切分 + LZW,视频转 GIF 的编码侧)
pub mod fs_watch;
pub mod fs_write;
pub mod gif;
pub mod large_file;
pub mod png;
pub mod text_encoding;
