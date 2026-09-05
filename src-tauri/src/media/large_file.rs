// 大文件流式查看核心逻辑(纯逻辑,不依赖 Tauri 运行时,测试编译下可用)
//
// 目标:支持 10GB+ 文本文件打开与流畅滚动:
// - `scan_large_file`:一次顺序扫描建立「行号 → 字节偏移」索引。
//   索引不驻留内存也不整表下发:只返回总行数 + 等距「校准点」
//   (校准点是**精确**的行首偏移,按文件大小自适应密度,
//   10GB ≈ 4096 点 → 相邻点间隔 ~2.5MB)。
// - `read_lines_window`:锚点式行窗口读取。调用方提供一个精确锚点
//   (锚点偏移, 锚点行号)(来自校准点或上一窗口的 nextOffset),
//   从锚点顺序数行到目标行再收集窗口,行号恒精确;
//   顺序滚动时锚点即窗口起点,数行代价为零,跳转时代价 ≤ 一个校准段。
//
// 编码处理:
// - 探测:文件头 512KB(含 BOM 识别;无 BOM UTF-16 按 LE 既有约定)。
// - 行边界:所有支持的编码中 0x0A 只作为行结束符出现
//   (UTF-8/ASCII 单字节;GB18030/Big5/SJIS/EUC-KR 多字节序列尾字节 ≥ 0x40;
//   Windows-1252 单字节),按字节扫描安全;
//   UTF-16 LE/BE 例外(0x000A 可能是 CJK 码元的高位字节),按 u16 码元扫描。
// - 解码:逐行按探测编码解码,UTF-16 行天然偶数长,BOM 由首行锚点跳过。
//
// 超长行(单行 > 窗口字节上限)截断展示并跳过余段:
// 截断行的后续请求从该行结束处继续,锚点恒为真实行首,行号不漂移。

use std::io::{Read, Seek, SeekFrom};

use serde::Serialize;

use crate::media::text_encoding::{decode_text, is_supported_encoding};
use crate::shell::AppError;

/// 校准点密度目标:每 2MB 一个点,在 [64, 4096] 内夹取。
/// 10GB → 4096 点 → 相邻点 ~2.5MB,跳转的数行扫描代价可忽略(NVMe)
const CALIBRATION_BYTES_PER_POINT: u64 = 2 * 1024 * 1024;
const CALIBRATION_MIN_POINTS: usize = 64;
const CALIBRATION_MAX_POINTS: usize = 4096;

/// 单窗口字节上限:防止超长行撑爆 IPC 载荷;超限截断并跳过余段
pub const WINDOW_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 索引扫描进度上报间隔(字节);扫描完成时必定额外上报一次
pub const PROGRESS_REPORT_BYTES: u64 = 64 * 1024 * 1024;

/// 编码探测用头部字节数(对齐 `VSCode` 编码探测窗口量级)
const ENCODE_PROBE_BYTES: usize = 512 * 1024;

/// 扫描 / 读取块大小
const CHUNK_BYTES: usize = 1024 * 1024;

/// 大文件元数据 + 行校准点(`fs_large_file_info` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileInfo {
    pub path: String,
    /// 文件大小(字节)
    pub size: u64,
    /// 探测到的编码标识(utf-8 / utf-8-bom / utf-16le / gb18030 等)
    pub encoding: String,
    /// 行尾序列:文件出现 \r\n 即 crlf,否则 lf
    pub eol: String,
    /// 总行数(空文件为 0;末尾无换行的残行计 1 行)
    pub line_count: u64,
    /// 行校准点(升序):每项为**精确**的「行号 → 该行首字节偏移」,
    /// 首项恒为 (1, BOM 长度);行窗口读取以其为锚点
    pub calibration: Vec<LineCalibrationPoint>,
}

/// 行校准点:1-based 行号 → 该行起始字节偏移(精确)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineCalibrationPoint {
    pub line: u64,
    pub offset: u64,
}

/// 行窗口内容(`fs_read_file_lines` 返回)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinesWindow {
    /// 窗口首行(1-based);目标行超出文件末尾(含锚点无效)时窗口为空置 0
    pub start_line: u64,
    /// 实际返回的行数(可能少于请求:到达文件末尾 / 触发字节上限)
    pub count: u64,
    /// 行内容数组(不含行尾序列;超长行被截断)
    pub lines: Vec<String>,
    /// 下一窗口的精确锚点偏移:最后一条完整(或截断)行结束之后的字节偏移
    pub next_offset: u64,
    /// 下一窗口的锚点行号(与 nextOffset 配对,恒为真实行首)
    pub next_line: u64,
    /// 末行因超过窗口字节上限被截断时为 true(前端展示截断标记)
    pub truncated: bool,
}

/// UTF-16 行扫描方向(由 BOM 判定;无 BOM UTF-16 按 LE 既有约定)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Utf16Endian {
    Le,
    Be,
}

/// 大文件编码探测结果:编码标识 + 是否 UTF-16(决定按码元扫描)+ BOM 长度
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LargeFileEncoding {
    id: &'static str,
    utf16: Option<Utf16Endian>,
    /// BOM 占用的前缀字节数(utf-16* / utf-8-bom;其余 0)
    bom_len: u64,
}

impl LargeFileEncoding {
    /// 由编码标识构造(行窗口读取用:调用方传探测结果,不再整读探测)。
    /// 受支持的编码族映射为扫描参数;未知标识回退 UTF-8(有损可显示)
    #[must_use]
    pub fn from_id(id: &str) -> Self {
        match id {
            "utf-16le" => Self {
                id: "utf-16le",
                utf16: Some(Utf16Endian::Le),
                bom_len: 2,
            },
            "utf-16be" => Self {
                id: "utf-16be",
                utf16: Some(Utf16Endian::Be),
                bom_len: 2,
            },
            "utf-8-bom" => Self {
                id: "utf-8-bom",
                utf16: None,
                bom_len: 3,
            },
            // 单字节编码族(GBK 系 / Windows-1252)与未知标识:统一按
            // UTF-8 扫描参数(0x0A 不会出现在多字节序列中间,尾字节 ≥ 0x40);
            // 解码标识由 read_file_lines 的 static_id_for 单独保留
            _ => Self {
                id: "utf-8",
                utf16: None,
                bom_len: 0,
            },
        }
    }

    /// 编码标识
    #[must_use]
    pub const fn id(&self) -> &'static str {
        self.id
    }
}

/// 头部字节的文本形态判定(与 `commands::fs::bytes_look_like_text_kind` 同规则):
/// - BOM 存在(含 UTF-16)→ Text,交给 `detect_encoding` 分流方向
/// - 前 512 字节 NUL 按 LE/BE 奇偶模式 → `Utf16NoBom`
/// - 其余含 NUL → Binary
///
/// 该复刻存在于纯逻辑层(test 编译下 commands 不可达);非测试编译下
/// `commands::fs_large_file` 直接调用 `commands::fs` 的原实现,不走此函数,
/// 两条路径的规则需保持同步。
fn text_kind_of_head(bytes: &[u8]) -> HeadTextKind {
    // BOM(含 UTF-16 LE/BE)一律视为文本,编码交给 detect_encoding 分流
    if crate::media::text_encoding::bom_of(bytes).is_some() {
        return HeadTextKind::Text;
    }
    let window = &bytes[..bytes.len().min(512)];
    let mut le_shape_possible = true;
    let mut be_shape_possible = true;
    let mut contains_zero = false;
    for (i, &b) in window.iter().enumerate() {
        let is_odd = i % 2 == 1;
        let is_zero = b == 0;
        if is_zero {
            contains_zero = true;
        }
        // UTF-16 LE:期望 0xAA 0x00(NUL 只出现在奇数位)
        if le_shape_possible && (is_odd != is_zero) {
            le_shape_possible = false;
        }
        // UTF-16 BE:期望 0x00 0xAA(NUL 只出现在偶数位)
        if be_shape_possible && (is_odd == is_zero) {
            be_shape_possible = false;
        }
        if is_zero && !le_shape_possible && !be_shape_possible {
            break;
        }
    }
    if !contains_zero {
        HeadTextKind::Text
    } else if le_shape_possible || be_shape_possible {
        HeadTextKind::Utf16NoBom
    } else {
        HeadTextKind::Binary
    }
}

/// `text_kind_of_head` 的判定结果(与 `commands::fs::TextKind` 对齐)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HeadTextKind {
    Text,
    Utf16NoBom,
    Binary,
}

/// 由文件头探测大文件编码(大文件不整读,窗口内二进制内容按 UTF-8 有损查看)
#[must_use]
pub fn detect_large_file_encoding(head: &[u8]) -> LargeFileEncoding {
    match text_kind_of_head(head) {
        // 普通文本:BOM 优先(含 UTF-16 方向),否则按 head 探测
        // (严格 UTF-8 → GBK 系 → 兜底 windows-1252,均对行边界安全)
        HeadTextKind::Text => {
            LargeFileEncoding::from_id(crate::media::text_encoding::detect_encoding(head))
        }
        // 无 BOM UTF-16:LE 回退约定(与 shell/file_open 一致)
        HeadTextKind::Utf16NoBom => LargeFileEncoding {
            id: "utf-16le",
            utf16: Some(Utf16Endian::Le),
            bom_len: 0,
        },
        // 大文件查看无「仍要打开」交互,二进制按 UTF-8 有损展示
        HeadTextKind::Binary => LargeFileEncoding::from_id("utf-8"),
    }
}

/// 读一块(Interrupted 重试)
fn read_chunk<R: Read>(reader: &mut R, buf: &mut [u8]) -> Result<usize, AppError> {
    loop {
        match reader.read(buf) {
            Ok(n) => return Ok(n),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(AppError::from(e)),
        }
    }
}

// ============ 索引扫描 ============

/// 第 idx(1-based)个采样点的字节位置:等距取 size * idx / target
fn mark_at(size: u64, idx: usize, target: usize) -> u64 {
    if target == 0 {
        return u64::MAX;
    }
    let idx = u64::try_from(idx).unwrap_or(u64::MAX);
    let target = u64::try_from(target).unwrap_or(u64::MAX);
    size.saturating_mul(idx) / target.max(1)
}

/// 字节模式扫描一块:批量找 `\n` 统计行结束,返回 (行结束数, 首个行结束偏移集合)
/// 调用方逐个推进;此处直接更新外部状态(闭包)以避免返回大数组
#[allow(clippy::too_many_arguments)]
fn scan_byte_chunk(
    chunk: &[u8],
    n: usize,
    pos: u64,
    prev_chunk_last: Option<u8>,
    eol: &mut String,
    on_line: &mut dyn FnMut(u64),
) {
    let mut search = 0;
    while let Some(rel) = chunk[search..n].iter().position(|&b| b == b'\n') {
        let abs_eol = pos + (search + rel) as u64;
        // CRLF:EOL 前一字节为 \r(可能位于上一块末尾)
        let prev = if search + rel > 0 {
            Some(chunk[search + rel - 1])
        } else {
            prev_chunk_last
        };
        if prev == Some(b'\r') {
            *eol = "crlf".to_string();
        }
        on_line(abs_eol);
        search += rel + 1;
    }
}

/// UTF-16 模式扫描一块:按 u16 码元扫描行结束 0x000A。
/// `carry` 是上一块遗留的半个码元(奇数尾),逻辑码元的绝对偏移按
/// 「本块起点 pos − 1」起算(carry 字节位于 pos-1 处)。
/// 返回本块扫描后的新 carry。
fn scan_utf16_chunk(
    chunk: &[u8],
    n: usize,
    pos: u64,
    dir: Utf16Endian,
    carry: Option<u8>,
    eol: &mut String,
    on_line: &mut dyn FnMut(u64),
) -> Option<u8> {
    let carry_len = usize::from(carry.is_some());
    let mut li = 0; // 逻辑流内索引(字节,首个码元从 0 起)
    let logical_len = carry_len + n;
    let mut prev_unit: Option<u16> = None; // 逻辑流中上一码元(CRLF 判定)
    while li + 1 < logical_len {
        let (b0, b1, abs) = if li == 0 && carry.is_some() {
            (carry.unwrap_or(0), chunk[0], pos - 1)
        } else {
            let ci = li - carry_len;
            (chunk[ci], chunk[ci + 1], pos + ci as u64)
        };
        let unit = match dir {
            Utf16Endian::Le => u16::from_le_bytes([b0, b1]),
            Utf16Endian::Be => u16::from_be_bytes([b0, b1]),
        };
        if unit == 0x000A {
            if prev_unit == Some(0x000D) {
                *eol = "crlf".to_string();
            }
            on_line(abs);
        }
        prev_unit = Some(unit);
        li += 2;
    }
    // 奇数尾部字节进位到下一块
    if logical_len % 2 == 1 {
        Some(chunk[n - 1])
    } else {
        None
    }
}

/// 顺序扫描构建行索引
///
/// 字节模式按块内批量找 `\n`(单字节编码下 \n 不出现在多字节序列中间,
/// 安全);UTF-16 模式按 u16 码元扫描(0x0A 可能是 CJK 码元的高位字节,
/// 按字节会误判)。跨块边界的 CRLF / 半个码元分别用 `prev_chunk_last` /
/// 尾字节进位处理。
///
/// 返回 (行数, 行尾, 校准点);进度经 `on_progress(已扫字节, 总字节)` 上报。
fn build_line_index(
    file: &mut std::fs::File,
    size: u64,
    enc: &LargeFileEncoding,
    on_progress: &dyn Fn(u64, u64),
) -> Result<(u64, String, Vec<LineCalibrationPoint>), AppError> {
    let target_points: usize = if size == 0 {
        0
    } else {
        let by_bytes = usize::try_from(size / CALIBRATION_BYTES_PER_POINT).unwrap_or(usize::MAX);
        by_bytes.clamp(CALIBRATION_MIN_POINTS, CALIBRATION_MAX_POINTS)
    };

    file.seek(SeekFrom::Start(0)).map_err(AppError::from)?;
    let mut reader = std::io::BufReader::with_capacity(CHUNK_BYTES, file);
    let mut chunk = vec![0_u8; CHUNK_BYTES];

    let mut line_count: u64 = 0; // 已结束(见到行结束符)的行数
    let mut line_start: u64 = enc.bom_len; // 当前行起始偏移(首行跳过 BOM)
    let mut eol = "lf".to_string();
    let mut calibration: Vec<LineCalibrationPoint> = Vec::new();
    let mut pos: u64 = 0; // 已扫描到的绝对偏移(含 BOM)
    let mut next_idx: usize = 1; // 下一个待检查的采样点序号(1-based)
    let mut last_progress: u64 = 0;
    // 字节模式:上一块最后一个字节(CRLF 跨块判定);UTF-16:上一块遗留的半个码元
    let mut prev_chunk_last: Option<u8> = None;
    let mut utf16_carry: Option<u8> = None;

    loop {
        let n = read_chunk(&mut reader, &mut chunk)?;
        if n == 0 {
            break;
        }
        // 行结束回调:计数 + 行首推进(闭包借用外部可变状态)
        let mut on_line = |abs_eol: u64| {
            line_count += 1;
            line_start = abs_eol + if enc.utf16.is_some() { 2 } else { 1 };
        };
        match enc.utf16 {
            None => {
                scan_byte_chunk(&chunk, n, pos, prev_chunk_last, &mut eol, &mut on_line);
            }
            Some(dir) => {
                utf16_carry =
                    scan_utf16_chunk(&chunk, n, pos, dir, utf16_carry, &mut eol, &mut on_line);
            }
        }
        pos += n as u64;
        prev_chunk_last = Some(chunk[n - 1]);

        // 采样校准点:越过标记位置时记录「当前进行中的行」的精确行首。
        // 当前行行号 = 已结束行数 + 1(其行首偏移 line_start)。
        while next_idx <= target_points {
            let mark = mark_at(size, next_idx, target_points);
            if mark >= pos {
                break;
            }
            calibration.push(LineCalibrationPoint {
                line: line_count + 1,
                offset: line_start,
            });
            next_idx += 1;
        }

        if pos - last_progress >= PROGRESS_REPORT_BYTES {
            last_progress = pos;
            on_progress(pos.min(size), size);
        }
    }
    // 扫描完成:必报一次(进度 UI 收尾)
    on_progress(size, size);

    // 末尾残行(最后一个行结束符之后仍有内容)计 1 行:
    // EOF 恰在行结束符上时 pos == line_start,不额外计行
    if pos > line_start {
        line_count += 1;
    }
    // 至少 1 行:非空文件即便整个扫描未见到行结束符(单行无换行)也是 1 行
    if line_count == 0 && size > 0 {
        line_count = 1;
    }

    // 首项校准点:(1, BOM 后偏移)
    if size > 0 {
        calibration.insert(
            0,
            LineCalibrationPoint {
                line: 1,
                offset: enc.bom_len,
            },
        );
    }
    // 清理:剔除越界行号(EOF 恰在行边界时采样到的幻影行)并按行号去重
    calibration.retain(|p| p.line <= line_count);
    calibration.dedup_by(|a, b| a.line == b.line);
    Ok((line_count, eol, calibration))
}

// ============ 行窗口读取 ============

/// 顺序单元读取器:按字节(或 u16 码元)迭代文件,正确处理跨块边界。
/// 返回 (单元绝对偏移, 单元字节, 单元长度);文件尾返回 None。
struct UnitReader {
    reader: std::io::BufReader<std::fs::File>,
    buf: Vec<u8>,
    idx: usize,
    /// buf[idx] 的绝对偏移
    pos: u64,
    utf16: Option<Utf16Endian>,
}

impl UnitReader {
    /// `start` 为起始偏移(调用方先 seek;UTF-16 必须码元对齐)
    fn new(file: std::fs::File, start: u64, utf16: Option<Utf16Endian>) -> Self {
        Self {
            reader: std::io::BufReader::with_capacity(CHUNK_BYTES, file),
            buf: Vec::new(),
            idx: 0,
            pos: start,
            utf16,
        }
    }

    /// 读取下一单元;UTF-16 尾部孤字节(非码元对齐的残余)静默终止
    fn next(&mut self) -> Result<Option<(u64, [u8; 2], u8)>, AppError> {
        let need = if self.utf16.is_some() { 2 } else { 1 };
        while self.buf.len() - self.idx < need {
            // 压缩已消费前缀(buf[0] 仍对应 pos,drain 后 pos 前移 idx)
            if self.idx > 0 {
                self.pos += self.idx as u64;
                self.buf.drain(..self.idx);
                self.idx = 0;
            }
            let old = self.buf.len();
            self.buf.resize(old + CHUNK_BYTES, 0);
            match read_chunk(&mut self.reader, &mut self.buf[old..]) {
                Ok(0) => {
                    self.buf.truncate(old);
                    return Ok(None);
                }
                Ok(read) => {
                    self.buf.truncate(old + read);
                }
                Err(e) => {
                    self.buf.truncate(old);
                    return Err(e);
                }
            }
        }
        let off = self.pos + self.idx as u64;
        let unit: [u8; 2] = if need == 2 {
            [self.buf[self.idx], self.buf[self.idx + 1]]
        } else {
            [self.buf[self.idx], 0]
        };
        self.idx += need;
        let unit_len: u8 = if need == 2 { 2 } else { 1 };
        Ok(Some((off, unit, unit_len)))
    }

    /// 该单元是否为行结束符(字节模式 0x0A;UTF-16 码元 0x000A)
    const fn is_eol(&self, unit: [u8; 2]) -> bool {
        match self.utf16 {
            None => unit[0] == 0x0A,
            Some(Utf16Endian::Le) => u16::from_le_bytes(unit) == 0x000A,
            Some(Utf16Endian::Be) => u16::from_be_bytes(unit) == 0x000A,
        }
    }
}

/// 单元长度(u8,取值恒 1 或 2)转 usize 的安全换算
const fn len_as_usize(len: u8) -> usize {
    len as usize
}

/// 行窗口读取的阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowPhase {
    /// 从锚点顺序数行,未到目标行(丢弃内容)
    Skip,
    /// 收集目标行内容
    Collect,
    /// 已截断超长行,跳过该行余段直到行结束符
    SkipRemainder,
}

/// 从锚点顺序数行到目标行,收集一个行窗口(锚点契约见模块注释)
fn read_lines_window(
    file: &mut std::fs::File,
    enc: &LargeFileEncoding,
    anchor_offset: u64,
    anchor_line: u64,
    target_line: u64,
    max_lines: u64,
    size: u64,
) -> Result<LinesWindow, AppError> {
    let empty = LinesWindow {
        start_line: 0,
        count: 0,
        lines: Vec::new(),
        next_offset: size,
        next_line: 0,
        truncated: false,
    };
    if anchor_line < 1 || target_line < anchor_line || max_lines == 0 || anchor_offset >= size {
        return Ok(empty);
    }

    file.seek(SeekFrom::Start(anchor_offset))
        .map_err(AppError::from)?;
    // 注意:UnitReader 持有独立的 File clone(seek 各自独立),读取从
    // seek 后的位置开始;pos 以 anchor_offset 为零点累计消费字节数
    let mut units = UnitReader::new(
        file.try_clone().map_err(AppError::from)?,
        anchor_offset,
        enc.utf16,
    );

    let mut phase = if target_line == anchor_line {
        WindowPhase::Collect
    } else {
        WindowPhase::Skip
    };
    let mut line = anchor_line; // 当前进行中的行号
    let mut current: Vec<u8> = Vec::new(); // 当前行已积累字节(仅 Collect 阶段积累)
    let mut lines: Vec<String> = Vec::new();
    let mut window_bytes: u64 = 0; // 窗口累计字节(行内容 + 行结束符)
    let mut truncated = false;
    let mut next_offset = size;

    loop {
        let Some((off, unit, len)) = units.next()? else {
            // 文件结束:Collect 中未完成的残行计一条(尾部无 EOL 的最后一行)
            if phase == WindowPhase::Collect && !current.is_empty() {
                emit_line(&mut lines, &mut current, enc);
                next_offset = size;
            }
            break;
        };
        let is_eol = units.is_eol(unit);
        match phase {
            WindowPhase::Skip => {
                if is_eol {
                    line += 1;
                    if line == target_line {
                        phase = WindowPhase::Collect;
                    }
                }
            }
            WindowPhase::Collect => {
                // 两个分支都先积累单元字节(EOL 单元也入列,emit_line 统一剥离)
                current.extend_from_slice(&unit[..len_as_usize(len)]);
                if is_eol {
                    // 行字节预算含行结束符(emit 前记录,emit 会剥离 EOL/CR)
                    let line_bytes = current.len() as u64;
                    emit_line(&mut lines, &mut current, enc);
                    window_bytes += line_bytes;
                    next_offset = off + u64::from(len);
                    if lines.len() as u64 >= max_lines || window_bytes >= WINDOW_MAX_BYTES {
                        break;
                    }
                    line += 1;
                    current.clear();
                } else {
                    // 超长行:单行字节数达上限 → 截断展示,跳过余段
                    if current.len() as u64 >= WINDOW_MAX_BYTES {
                        emit_line(&mut lines, &mut current, enc);
                        truncated = true;
                        next_offset = size; // 由 SkipRemainder 阶段修正
                        phase = WindowPhase::SkipRemainder;
                    }
                }
            }
            WindowPhase::SkipRemainder => {
                if is_eol {
                    next_offset = off + u64::from(len);
                    break;
                }
            }
        }
    }

    let count = lines.len() as u64;
    if count == 0 {
        return Ok(empty);
    }
    // 行号推进:截断路径的行结束符属于被截断行,其后的行号 = target + count
    Ok(LinesWindow {
        start_line: target_line,
        count,
        lines,
        next_offset: next_offset.min(size),
        next_line: target_line + count,
        truncated,
    })
}

/// 发射一条完整行:剥离行尾 CR 与已积累的行结束符后,按编码解码入列
fn emit_line(lines: &mut Vec<String>, current: &mut Vec<u8>, enc: &LargeFileEncoding) {
    let unit: usize = if enc.utf16.is_some() { 2 } else { 1 };
    // 剥离已积累的行结束符单元(LF;收集路径把它一并 push 进了 current)
    if current.len() >= unit {
        let tail: Vec<u8> = current[current.len() - unit..].to_vec();
        let is_lf = match enc.utf16 {
            None => tail[0] == 0x0A,
            Some(Utf16Endian::Le) => u16::from_le_bytes([tail[0], tail[1]]) == 0x000A,
            Some(Utf16Endian::Be) => u16::from_be_bytes([tail[0], tail[1]]) == 0x000A,
        };
        if is_lf {
            current.truncate(current.len() - unit);
        }
    }
    // CRLF 剥离:行内容以 CR 结尾(紧邻 LF)
    if current.len() >= unit {
        let tail: Vec<u8> = current[current.len() - unit..].to_vec();
        let is_cr = match enc.utf16 {
            None => tail[0] == 0x0D,
            Some(Utf16Endian::Le) => u16::from_le_bytes([tail[0], tail[1]]) == 0x000D,
            Some(Utf16Endian::Be) => u16::from_be_bytes([tail[0], tail[1]]) == 0x000D,
        };
        if is_cr {
            current.truncate(current.len() - unit);
        }
    }
    let id = if enc.id == "utf-8-bom" {
        "utf-8"
    } else {
        enc.id
    };
    let mut bytes: &[u8] = current;
    // utf-8-bom:剥离可能残留的 BOM(锚点协议下首行已跳过,防御性处理)
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes = &bytes[3..];
    }
    // 码元对齐保护(异常输入):UTF-16 奇数长度去掉尾部孤字节
    if (id == "utf-16le" || id == "utf-16be") && bytes.len() % 2 == 1 {
        bytes = &bytes[..bytes.len() - 1];
    }
    lines.push(decode_text(bytes, id));
}

// ============ 对外入口(同步核心 + 异步包装) ============

/// 大文件索引扫描(同步核心;IPC 层用 `spawn_blocking` 包装)
///
/// # Errors
///
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub fn scan_large_file(
    path: &str,
    on_progress: &dyn Fn(u64, u64),
) -> Result<LargeFileInfo, AppError> {
    let mut file = std::fs::File::open(path).map_err(AppError::from)?;
    let size = file.metadata().map_err(AppError::from)?.len();
    // 探测编码:读头部(build_line_index 内部会重新 seek 到 0 扫描)
    let probe_len = ENCODE_PROBE_BYTES.min(usize::try_from(size).unwrap_or(0));
    let mut head = vec![0_u8; probe_len];
    if !head.is_empty() {
        file.read_exact(&mut head).map_err(AppError::from)?;
    }
    let enc = detect_large_file_encoding(&head);
    let (line_count, eol, calibration) = build_line_index(&mut file, size, &enc, on_progress)?;
    Ok(LargeFileInfo {
        path: path.to_string(),
        size,
        encoding: enc.id.to_string(),
        eol,
        line_count,
        calibration,
    })
}

/// 行窗口读取(同步核心;IPC 层用 `spawn_blocking` 包装)
///
/// # Errors
///
/// - `encoding` 不受支持时返回 `AppError::Unsupported`(`ERR_FILE_UNSUPPORTED`)
/// - 文件打开/读取失败时返回 `AppError::Io`(`ERR_FILE_IO`)
pub fn read_file_lines(
    path: &str,
    encoding: Option<&str>,
    anchor_offset: u64,
    anchor_line: u64,
    target_line: u64,
    max_lines: u64,
) -> Result<LinesWindow, AppError> {
    let enc_id: &str = match encoding {
        Some(id) if !id.is_empty() => {
            if !is_supported_encoding(id) {
                return Err(AppError::Unsupported(format!("unsupported encoding: {id}")));
            }
            id
        }
        _ => "utf-8",
    };
    let mut enc = LargeFileEncoding::from_id(enc_id);
    // 解码必须按用户指定编码(GBK 系 / Windows-1252 等):扫描参数
    // (utf16/bom_len)由 from_id 推导,但解码标识保持原样,否则
    // GBK 行内容会被误按 UTF-8 有损解码
    if enc.id == "utf-8" {
        enc.id = static_id_for(enc_id);
    }
    let mut file = std::fs::File::open(path).map_err(AppError::from)?;
    let size = file.metadata().map_err(AppError::from)?.len();
    read_lines_window(
        &mut file,
        &enc,
        anchor_offset,
        anchor_line,
        target_line,
        max_lines,
        size,
    )
}

/// 编码标识 → 静态字符串白名单映射(`from_id` 的扫描参数不保留原 id,
/// 解码路径需要真实标识;未知值统一回退 utf-8)
fn static_id_for(id: &str) -> &'static str {
    match id {
        "gb18030" => "gb18030",
        "big5" => "big5",
        "shift_jis" => "shift_jis",
        "euc-kr" => "euc-kr",
        "windows-1252" => "windows-1252",
        _ => "utf-8",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn detect_encoding_bom_variants() {
        assert_eq!(
            detect_large_file_encoding(&[0xEF, 0xBB, 0xBF, b'a']),
            LargeFileEncoding {
                id: "utf-8-bom",
                utf16: None,
                bom_len: 3
            }
        );
        assert_eq!(
            detect_large_file_encoding(&[0xFF, 0xFE, b'a', 0]),
            LargeFileEncoding {
                id: "utf-16le",
                utf16: Some(Utf16Endian::Le),
                bom_len: 2
            }
        );
        assert_eq!(
            detect_large_file_encoding(&[0xFE, 0xFF, 0, b'a']),
            LargeFileEncoding {
                id: "utf-16be",
                utf16: Some(Utf16Endian::Be),
                bom_len: 2
            }
        );
        // 无 BOM UTF-16(LE 形态:NUL 恒在奇数位):LE 回退。
        // 用「h\x00i\x00」而非 "hi\x00":后者按 VSCode 规则 NUL 出现在偶数位
        // 且无法满足 LE/BE 任一形态,应判为二进制
        assert_eq!(
            detect_large_file_encoding(b"h\x00i\x00"),
            LargeFileEncoding {
                id: "utf-16le",
                utf16: Some(Utf16Endian::Le),
                bom_len: 0
            }
        );
        // 二进制:NUL 形态两个方向都不满足
        assert_eq!(
            detect_large_file_encoding(&[0x00, 0x01, 0x02]),
            LargeFileEncoding {
                id: "utf-8",
                utf16: None,
                bom_len: 0
            }
        );
    }

    #[test]
    fn scan_counts_lf_lines_and_first_calibration_at_bom0() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_lf_info.txt");
        std::fs::write(&path, "l1\nl2\nl3\n").expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.line_count, 3);
        assert_eq!(info.eol, "lf");
        assert_eq!(info.encoding, "utf-8");
        assert_eq!(info.calibration[0].line, 1);
        assert_eq!(info.calibration[0].offset, 0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_counts_crlf_and_trailing_partial_line() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_crlf_info.txt");
        std::fs::write(&path, b"a\r\nb\r\nc\r\ntail").expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.line_count, 4);
        assert_eq!(info.eol, "crlf");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_crlf_split_across_chunk_boundary() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_crlf_boundary_info.txt");
        // 1MB 数据 + "\r\n" + 尾行:\r 在上一块末尾、\n 在下一块开头,
        // 末尾补一行内容保证「行结束符之后仍有内容」的残行计数路径
        let mut content = vec![b'a'; CHUNK_BYTES];
        content.push(b'\r');
        content.push(b'\n');
        content.extend_from_slice(b"tail");
        std::fs::write(&path, &content).expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.eol, "crlf");
        assert_eq!(info.line_count, 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_empty_file_is_zero_lines() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_empty_info.txt");
        std::fs::write(&path, b"").expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.line_count, 0);
        assert_eq!(info.size, 0);
        assert!(info.calibration.is_empty());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_single_line_without_newline() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_oneline_info.txt");
        std::fs::write(&path, b"only line").expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.line_count, 1);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_utf16_bom_counts_by_code_units() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_utf16_info.txt");
        // BOM + 「甲\n上\n乙」:U+4E0A(上)在 LE 低字节为 0x0A,
        // 按码元扫描不会被误计为行结束符(按字节会)
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for ch in "甲\n上\n乙".chars() {
            bytes.extend_from_slice(&(ch as u16).to_le_bytes());
        }
        std::fs::write(&path, &bytes).expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.encoding, "utf-16le");
        assert_eq!(info.line_count, 3);
        assert_eq!(info.calibration[0].offset, 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_utf16be_crlf_detection() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_utf16be_info.txt");
        let mut bytes: Vec<u8> = vec![0xFE, 0xFF];
        for ch in "a\r\nb".chars() {
            bytes.extend_from_slice(&(ch as u16).to_be_bytes());
        }
        std::fs::write(&path, &bytes).expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.encoding, "utf-16be");
        assert_eq!(info.line_count, 2);
        assert_eq!(info.eol, "crlf");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_progress_reports_scanned_bytes() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_progress.txt");
        std::fs::write(&path, vec![b'a'; 256]).expect("write");

        // 进度计数用 Cell(Fn 闭包内可变)
        let calls = Cell::new(0);
        let info = scan_large_file(path.to_str().unwrap(), &|_s, total| {
            calls.set(calls.get() + 1);
            assert_eq!(total, 256);
        })
        .expect("scan");
        assert_eq!(info.line_count, 1);
        assert!(
            calls.get() >= 1,
            "progress must fire at least once (completion)"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_giant_file_calibration_points_within_bounds() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_giant_info.txt");
        // 4000 行 × 2048 字节 ≈ 8MB:目标点数 = clamp(8MB/2MB, 64, 4096) = 64,
        // 实际采样按字节标记等距分布(每 ~128KB 一点),数量接近 64
        let line_body = vec![b'x'; 2047];
        let mut content = Vec::with_capacity(4000 * 2048);
        for _ in 0..4000 {
            content.extend_from_slice(&line_body);
            content.push(b'\n');
        }
        std::fs::write(&path, &content).expect("write");

        let info = scan_large_file(path.to_str().unwrap(), &|_, _| {}).expect("scan");
        assert_eq!(info.line_count, 4000);
        // 校准点:首项 (1,0) + 采样点;小文件目标 64 点,但等距标记
        // 按字节推进,首块(1MB)内就可能越过多个标记 —— 数量以标记总数为准
        assert!(!info.calibration.is_empty());
        assert!(info.calibration.len() <= CALIBRATION_MAX_POINTS + 1);
        // 全部校准点:行号单调递增、偏移单调不减、行号不越界
        let mut last_line = 0_u64;
        let mut last_off = 0_u64;
        for p in &info.calibration {
            assert!(p.line > last_line, "line numbers must be ascending: {p:?}");
            assert!(p.offset >= last_off);
            assert!(p.line <= 4000);
            last_line = p.line;
            last_off = p.offset;
        }
        // 采样密度下界:8MB 文件按 2MB/点 应至少有 4 个采样点 + 首项
        assert!(
            info.calibration.len() >= 5,
            "8MB file must have at least a few calibration points, got {}",
            info.calibration.len()
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_sequential_from_line1() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_seq.txt");
        std::fs::write(&path, "L1\nL2\nL3\nL4\nL5\n").expect("write");
        let p = path.to_str().unwrap();

        let win = read_file_lines(p, Some("utf-8"), 0, 1, 1, 3).expect("read");
        assert_eq!(win.start_line, 1);
        assert_eq!(win.lines, vec!["L1", "L2", "L3"]);
        assert_eq!(win.next_line, 4);
        assert_eq!(win.next_offset, 9); // "L1\nL2\nL3\n" = 9 字节

        // 以 next 锚点继续:正好接上
        let win2 = read_file_lines(
            p,
            Some("utf-8"),
            win.next_offset,
            win.next_line,
            win.next_line,
            10,
        )
        .expect("read");
        assert_eq!(win2.lines, vec!["L4", "L5"]);
        assert_eq!(win2.count, 2);
        assert_eq!(win2.next_line, 6);
        assert_eq!(win2.next_offset, 15);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_counts_forward_to_target_from_anchor() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_jump.txt");
        let mut content = String::new();
        for i in 1..=10 {
            content.push('L');
            content.push_str(&i.to_string());
            content.push('\n');
        }
        std::fs::write(&path, &content).expect("write");

        // 锚点 (0,1),目标第 7 行:从锚点数 6 个换行后开始收集
        let win = read_file_lines(path.to_str().unwrap(), Some("utf-8"), 0, 1, 7, 2).expect("read");
        assert_eq!(win.start_line, 7);
        assert_eq!(win.lines, vec!["L7", "L8"]);
        assert_eq!(win.next_line, 9);
        assert_eq!(win.next_offset, 24); // 前 8 行 × 3 字节

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_target_past_eof_is_empty() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_eof.txt");
        std::fs::write(&path, b"a\nb\n").expect("write");

        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 0, 1, 99, 5).expect("read");
        assert_eq!(win.count, 0);
        assert_eq!(win.start_line, 0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_last_partial_line_without_eol() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_tail.txt");
        std::fs::write(&path, b"one\ntwo\ntail-no-eol").expect("write");

        // 锚点 = 第 3 行行首(offset 8)
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 8, 3, 3, 10).expect("read");
        assert_eq!(win.start_line, 3);
        assert_eq!(win.lines, vec!["tail-no-eol"]);
        assert_eq!(win.next_offset, 19); // 文件尾
        // next 锚点请求:空窗口(文件已到尾)
        let win2 = read_file_lines(
            path.to_str().unwrap(),
            Some("utf-8"),
            win.next_offset,
            win.next_line,
            win.next_line,
            10,
        )
        .expect("read");
        assert_eq!(win2.count, 0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_decodes_gb18030_and_strips_cr() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_gbk.txt");
        // GB18030「中文」+ CRLF,两行:[D6D0CEC4][0D][0A] × 2
        let mut bytes = Vec::new();
        for _ in 0..2 {
            bytes.extend_from_slice(&[0xD6, 0xD0, 0xCE, 0xC4, 0x0D, 0x0A]);
        }
        std::fs::write(&path, &bytes).expect("write");

        let win =
            read_file_lines(path.to_str().unwrap(), Some("gb18030"), 0, 1, 1, 10).expect("read");
        assert_eq!(win.lines, vec!["中文", "中文"]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_utf16le_content_and_crlf() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_u16.txt");
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for ch in "a\r\nb\r\n".chars() {
            bytes.extend_from_slice(&(ch as u16).to_le_bytes());
        }
        std::fs::write(&path, &bytes).expect("write");

        // 锚点跳过 BOM:calibration[0] = (1, 2)
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-16le"), 2, 1, 1, 10).expect("read");
        assert_eq!(win.lines, vec!["a", "b"]);
        assert_eq!(win.next_offset, bytes.len() as u64);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_utf16_cjk_codepoint_not_treated_as_eol() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_u16_cjk.txt");
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for ch in "上\n下".chars() {
            bytes.extend_from_slice(&(ch as u16).to_le_bytes());
        }
        std::fs::write(&path, &bytes).expect("write");

        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-16le"), 2, 1, 1, 10).expect("read");
        assert_eq!(win.lines, vec!["上", "下"]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_utf16_skip_to_distant_target() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_u16_jump.txt");
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for ch in "a\nb\nc\nd\n".chars() {
            bytes.extend_from_slice(&(ch as u16).to_le_bytes());
        }
        std::fs::write(&path, &bytes).expect("write");

        // 锚点 (2,1) → 目标第 3 行
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-16le"), 2, 1, 3, 2).expect("read");
        assert_eq!(win.start_line, 3);
        assert_eq!(win.lines, vec!["c", "d"]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_giant_line_truncates_and_skips_remainder() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_giant.txt");
        // 构造 ~5MB 单行(WINDOW_MAX_BYTES=4MB)+ 后续两行
        let giant_len = 5 * 1024 * 1024;
        let giant = vec![b'x'; giant_len];
        let mut content = Vec::with_capacity(giant_len + 16);
        content.extend_from_slice(&giant);
        content.extend_from_slice(b"\nafter1\nafter2\n");
        std::fs::write(&path, &content).expect("write");

        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 0, 1, 1, 10).expect("read");
        assert_eq!(win.count, 1);
        assert!(win.truncated);
        assert_eq!(win.lines[0].len(), 4 * 1024 * 1024);
        // next 锚点对齐到巨行结束后的真实行首(after1)
        assert_eq!(win.next_offset, giant_len as u64 + 1);
        assert_eq!(win.next_line, 2);

        // 从 next 锚点继续:应读到 after1/after2,不重复巨行余段
        let win2 = read_file_lines(
            path.to_str().unwrap(),
            Some("utf-8"),
            win.next_offset,
            win.next_line,
            win.next_line,
            10,
        )
        .expect("read");
        assert_eq!(win2.lines, vec!["after1", "after2"]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_max_lines_limits_collection() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_maxlines.txt");
        let mut content = String::new();
        for i in 1..=100 {
            content.push('L');
            content.push_str(&i.to_string());
            content.push('\n');
        }
        std::fs::write(&path, &content).expect("write");

        let win = read_file_lines(path.to_str().unwrap(), Some("utf-8"), 0, 1, 1, 5).expect("read");
        assert_eq!(win.count, 5);
        assert_eq!(win.lines[4], "L5");
        assert_eq!(win.next_line, 6);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_invalid_anchor_returns_empty() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_invalid.txt");
        std::fs::write(&path, b"a\nb\n").expect("write");

        // 锚点行号 < 1
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 0, 0, 1, 10).expect("read");
        assert_eq!(win.count, 0);
        // 目标行 < 锚点行(不支持反向)
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 3, 2, 1, 10).expect("read");
        assert_eq!(win.count, 0);
        // 锚点偏移越界
        let win =
            read_file_lines(path.to_str().unwrap(), Some("utf-8"), 99, 2, 2, 10).expect("read");
        assert_eq!(win.count, 0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn window_unsupported_encoding_errors() {
        let dir = std::env::temp_dir();
        let path = dir.join("qraft_win_badenc.txt");
        std::fs::write(&path, b"x\n").expect("write");

        let err =
            read_file_lines(path.to_str().unwrap(), Some("iso-2022-jp"), 0, 1, 1, 10).unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_UNSUPPORTED");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scan_missing_file_errors_as_io() {
        let err = scan_large_file("Z:/definitely/not/here.txt", &|_, _| {}).unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_IO");
    }
}
