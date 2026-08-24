// 文件夹/文件分析器(只读)
//
// scan: 目录统计(数量/大小/扩展名/类别/文本行数字数)
// search: 跨文本文件内容搜索(普通串或正则)
// file: 单文件解析(魔数/编码/行字数/SHA-256)

pub mod classify;
pub mod inspect;
pub mod scanner;
pub mod search;
pub mod text_metrics;
