// 媒体处理层:纯逻辑模块(不依赖 Tauri 运行时,测试编译下可用)
//
// - png:PNG 解码 / 有损量化(中位切分)/ 无损优化(OxiPNG)封装
// - text_encoding:文本编码探测与转换(UTF-8/GBK/Big5/Shift-JIS 等)
// - large_file:大文件流式查看(行索引扫描 + 锚点式行窗口读取)
pub mod large_file;
pub mod png;
pub mod text_encoding;
