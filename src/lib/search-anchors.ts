/**
 * 全局搜索锚点数据 —— 工具内部区块、设置分区与字段、应用页面的静态声明
 *
 * 说明:
 * - TOOL_ANCHORS 为每个工具声明可定位/高亮的内部区块;key 为区块标识,
 *   完整锚点值 = `${toolId}:${key}`,由工具组件在对应 DOM 上标注
 *   `data-search-anchor` 属性保持一致。
 * - SETTING_SECTIONS / SETTING_FIELDS 对应设置弹窗左侧菜单与各分区字段,
 *   settingsMenu 取值与 SettingsDialog 的 MenuId 一致。
 * - PAGE_ENTRIES 为应用内非工具页面(欢迎/历史/管理扩展/关于)。
 * - title / description 为 LocalizedText 双语字段(与 tool-catalog 同构),
 *   展示经 pickText 随语言走;keywords 仅为匹配域,保持原样不翻译。
 */

import type { AppView } from '@/store/uiStore';
import type { LocalizedText } from './tool-catalog';

/** 设置弹窗左侧菜单 id(与 SettingsDialog 的 MenuId 保持一致) */
export type SettingsMenuId = 'theme' | 'font' | 'general' | 'editor' | 'shortcuts' | 'update';

/** 高频复用区块标题(双语) */
const T_CONFIG: LocalizedText = { zh: '配置', en: 'Configuration' };
const T_INPUT: LocalizedText = { zh: '输入', en: 'Input' };
const T_OUTPUT: LocalizedText = { zh: '输出', en: 'Output' };
const T_RESULT: LocalizedText = { zh: '结果', en: 'Result' };
const T_GENERATE_OPTIONS: LocalizedText = { zh: '生成选项', en: 'Generation options' };
const T_GENERATED: LocalizedText = { zh: '生成结果', en: 'Generated output' };

/** 工具内部区块锚点声明 */
export interface ToolAnchor {
  /** 区块标识(与工具组件 data-search-anchor 的后缀一致) */
  key: string;
  /** 区块标题(搜索结果展示文本) */
  title: LocalizedText;
  /** 补充说明 */
  description?: LocalizedText;
  /** 搜索关键词 */
  keywords?: string[];
}

/** 设置分区声明 */
export interface SettingSection {
  menuId: SettingsMenuId;
  title: LocalizedText;
  description: LocalizedText;
  keywords: string[];
}

/** 设置字段声明 */
export interface SettingField {
  /** 字段锚点(完整值 = `settings:${menuId}:${key}`) */
  key: string;
  title: LocalizedText;
  description?: LocalizedText;
  keywords: string[];
  menuId: SettingsMenuId;
}

/** 应用页面声明 */
export interface PageEntry {
  title: LocalizedText;
  description: LocalizedText;
  keywords: string[];
  view: AppView;
}

/**
 * 各工具内部可搜索区块锚点。
 * 通用约定:config=配置区、input=输入编辑器、output=输出编辑器;
 * 其余为各工具的独有操作/结果区块。
 */
export const TOOL_ANCHORS: Readonly<Record<string, readonly ToolAnchor[]>> = {
  base64_codec: [
    {
      key: 'config',
      title: T_CONFIG,
      description: { zh: '方向与模式', en: 'Direction and modes' },
      keywords: ['方向', '模式', 'url 安全', '大写', 'data url'],
    },
    {
      key: 'input',
      title: T_INPUT,
      description: { zh: '文本或文件内容', en: 'Text or file content' },
      keywords: ['文本', '文件', 'base64 输入'],
    },
    {
      key: 'output',
      title: T_OUTPUT,
      description: { zh: '编码 / 解码结果', en: 'Encoded / decoded result' },
      keywords: ['结果', 'base64 输出'],
    },
    {
      key: 'file',
      title: { zh: '文件', en: 'File' },
      description: { zh: '拖放或选择文件进行转换', en: 'Drag & drop or pick a file to convert' },
      keywords: ['选择文件', '文件拖放', '另存为'],
    },
  ],
  certificate_decoder: [
    {
      key: 'input',
      title: { zh: '输入证书', en: 'Certificate input' },
      description: { zh: 'PEM / Base64 DER 格式', en: 'PEM / Base64 DER format' },
      keywords: ['pem', 'der', '证书'],
    },
    {
      key: 'output',
      title: { zh: '解码结果', en: 'Decoded result' },
      description: { zh: '证书详细信息', en: 'Certificate details' },
      keywords: ['结果', '证书信息', 'x509'],
    },
  ],
  gzip_codec: [
    {
      key: 'config',
      title: { zh: 'GZip 转换', en: 'GZip convert' },
      description: { zh: '压缩 / 解压方向', en: 'Compress / decompress direction' },
      keywords: ['压缩', '解压', 'zip'],
    },
    { key: 'input', title: T_INPUT, keywords: ['gzip'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果'] },
  ],
  html_codec: [
    {
      key: 'config',
      title: { zh: '转换', en: 'Convert' },
      description: { zh: '编码 / 解码方向', en: 'Encode / decode direction' },
      keywords: ['编码', '解码', 'html'],
    },
    { key: 'input', title: T_INPUT, keywords: ['html'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果', '实体'] },
  ],
  jwt_parser: [
    {
      key: 'input',
      title: { zh: 'JWT 令牌', en: 'JWT token' },
      keywords: ['jwt', 'token', '令牌'],
    },
    {
      key: 'header',
      title: { zh: '头部', en: 'Header' },
      description: { zh: 'Header', en: 'Header' },
      keywords: ['header', '头'],
    },
    {
      key: 'payload',
      title: { zh: '载荷', en: 'Payload' },
      description: { zh: 'Payload', en: 'Payload' },
      keywords: ['payload', '载荷'],
    },
    {
      key: 'signature',
      title: { zh: '签名', en: 'Signature' },
      description: { zh: 'Signature', en: 'Signature' },
      keywords: ['signature', '签名'],
    },
  ],
  basic_auth_generator: [
    {
      key: 'config',
      title: { zh: '凭据', en: 'Credentials' },
      description: { zh: '用户名与密码', en: 'Username and password' },
      keywords: ['用户名', '密码', '认证'],
    },
    {
      key: 'output',
      title: { zh: 'Authorization 头', en: 'Authorization header' },
      keywords: ['basic auth', '请求头', '结果'],
    },
  ],
  url_codec: [
    {
      key: 'config',
      title: { zh: '操作', en: 'Action' },
      description: { zh: '编码 / 解码与组件编码', en: 'Encode / decode and component encoding' },
      keywords: ['编码', '解码', '组件编码'],
    },
    { key: 'input', title: T_INPUT, keywords: ['url', '链接'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果'] },
  ],
  jsonpath_tester: [
    {
      key: 'expression',
      title: { zh: 'JSONPath 表达式', en: 'JSONPath expression' },
      keywords: ['表达式', 'jsonpath', 'query'],
    },
    { key: 'input', title: { zh: '输入 JSON', en: 'JSON input' }, keywords: ['json', '数据'] },
    {
      key: 'output',
      title: { zh: '测试结果', en: 'Test result' },
      keywords: ['结果', '查询结果'],
    },
  ],
  regex_tester: [
    {
      key: 'config',
      title: { zh: '正则配置', en: 'Regex options' },
      description: { zh: '表达式与标志位', en: 'Expression and flags' },
      keywords: ['正则', 'regexp', 'pattern', 'flags', '标志位'],
    },
    {
      key: 'input',
      title: { zh: '测试文本', en: 'Test text' },
      keywords: ['文本'],
    },
    {
      key: 'output',
      title: { zh: '匹配结果', en: 'Match result' },
      keywords: ['结果', '匹配'],
    },
  ],
  xml_xsd_tester: [
    {
      key: 'xsd',
      title: { zh: 'XSD', en: 'XSD' },
      description: { zh: 'Schema 定义', en: 'Schema definition' },
      keywords: ['schema', 'xsd'],
    },
    {
      key: 'xml',
      title: { zh: 'XML', en: 'XML' },
      description: { zh: '待校验的 XML 数据', en: 'XML data to validate' },
      keywords: ['xml'],
    },
    {
      key: 'verdict',
      title: { zh: '校验结果', en: 'Validation verdict' },
      description: { zh: '校验结论', en: 'Validation outcome' },
      keywords: ['验证', '结论', '结果', '错误'],
    },
  ],
  json_formatter: [
    {
      key: 'input',
      title: T_INPUT,
      description: {
        zh: 'JSON / XML,工具栏含格式化操作',
        en: 'JSON / XML with formatting toolbar actions',
      },
      keywords: ['json', 'xml', '格式化', '压缩', '键升序', '键降序', '生成实体类', '缩进'],
    },
    {
      key: 'output',
      title: T_OUTPUT,
      description: { zh: '格式化结果', en: 'Formatted result' },
      keywords: ['结果'],
    },
  ],
  json_minifier: [
    {
      key: 'config',
      title: { zh: '转换与调整', en: 'Transform & adjust' },
      description: { zh: '常用文本处理操作', en: 'Common text operations' },
      keywords: [
        '转义',
        '去空格',
        'url 编码',
        'url 解码',
        'unicode',
        '中文',
        '大小写',
        '反转',
        '去重',
        '排序',
        '标点',
      ],
    },
    { key: 'input', title: T_INPUT, keywords: ['文本'] },
    {
      key: 'output',
      title: T_OUTPUT,
      keywords: ['结果', '统计', '字数'],
    },
  ],
  sql_formatter: [
    {
      key: 'config',
      title: T_CONFIG,
      description: { zh: '方言 / 缩进 / 关键字大小写', en: 'Dialect / indent / keyword case' },
      keywords: ['语言', '方言', '缩进', '关键字大小写'],
    },
    { key: 'input', title: T_INPUT, keywords: ['sql', '数据库'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果'] },
  ],
  xml_formatter: [
    {
      key: 'config',
      title: T_CONFIG,
      description: { zh: '缩进与属性换行', en: 'Indentation and attribute wrapping' },
      keywords: ['缩进', '属性换行'],
    },
    { key: 'input', title: T_INPUT, keywords: ['xml'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果'] },
  ],
  hash_calculator: [
    {
      key: 'config',
      title: { zh: '算法', en: 'Algorithm' },
      description: { zh: '哈希算法选择', en: 'Hash algorithm selection' },
      keywords: ['md5', 'sha', 'checksum', '哈希', '校验'],
    },
    { key: 'input', title: { zh: '输入文本', en: 'Text input' }, keywords: ['文本'] },
    {
      key: 'output',
      title: { zh: '哈希值', en: 'Hash value' },
      description: { zh: '计算结果', en: 'Computed result' },
      keywords: ['结果', '校验和'],
    },
  ],
  lorem_ipsum: [
    {
      key: 'config',
      title: T_GENERATE_OPTIONS,
      description: { zh: '类型 / 数量 / 起始文本', en: 'Type / count / start text' },
      keywords: ['类型', '数量', 'lorem ipsum', '段落', '句子'],
    },
    { key: 'output', title: T_GENERATED, keywords: ['占位', '假文', '结果'] },
  ],
  password_generator: [
    {
      key: 'config',
      title: T_GENERATE_OPTIONS,
      description: { zh: '长度与字符集', en: 'Length and character sets' },
      keywords: ['长度', '小写字母', '大写字母', '数字', '特殊字符', '易混淆', '生成数量'],
    },
    {
      key: 'strength',
      title: { zh: '强度', en: 'Strength' },
      description: { zh: '密码强度指示', en: 'Password strength indicator' },
      keywords: ['强度', '强弱'],
    },
    { key: 'output', title: T_GENERATED, keywords: ['密码', '结果'] },
  ],
  qrcode_tool: [
    {
      key: 'tabs',
      title: { zh: '生成与读取', en: 'Generate & read' },
      description: { zh: '切换二维码生成 / 读取模式', en: 'Switch QR generate / read mode' },
      keywords: ['生成二维码', '读取二维码', '解码'],
    },
    {
      key: 'input',
      title: { zh: '文本', en: 'Text' },
      description: { zh: '二维码内容', en: 'QR content' },
      keywords: ['内容', 'qr'],
    },
    {
      key: 'image',
      title: { zh: '二维码图片', en: 'QR image' },
      description: { zh: '二维码预览', en: 'QR preview' },
      keywords: ['预览', 'png', 'svg', '图片'],
    },
    {
      key: 'output',
      title: { zh: '识别结果', en: 'Scan result' },
      keywords: ['解码', '识别'],
    },
  ],
  uuid_generator: [
    {
      key: 'config',
      title: T_GENERATE_OPTIONS,
      description: { zh: '版本 / 数量 / 格式', en: 'Version / count / format' },
      keywords: ['版本', '数量', '大写', '连字符', 'guid'],
    },
    { key: 'output', title: T_GENERATED, keywords: ['uuid', '结果'] },
  ],
  ulid_generator: [
    {
      key: 'config',
      title: T_GENERATE_OPTIONS,
      description: { zh: '生成数量', en: 'Count to generate' },
      keywords: ['数量', 'ulid'],
    },
    { key: 'output', title: T_GENERATED, keywords: ['ulid', '标识符'] },
  ],
  color_blindness_simulator: [
    {
      key: 'source',
      title: { zh: '源图片', en: 'Source image' },
      description: { zh: '选择或拖放图片', en: 'Pick or drop an image' },
      keywords: ['选择图片', '原图', '图片'],
    },
    {
      key: 'preview',
      title: { zh: '模拟结果', en: 'Simulation result' },
      description: { zh: '色盲模拟效果', en: 'Color blindness simulation' },
      keywords: ['红色盲', '绿色盲', '蓝色盲', 'protanopia', 'deuteranopia', 'tritanopia', '色弱'],
    },
  ],
  image_converter: [
    {
      key: 'config',
      title: { zh: '目标格式', en: 'Target format' },
      description: { zh: '转换格式与质量', en: 'Convert format and quality' },
      keywords: ['格式', '质量', 'png', 'jpeg', 'webp'],
    },
    {
      key: 'image',
      title: { zh: '图片', en: 'Image' },
      description: {
        zh: '选择或拖放图片,含转换导出',
        en: 'Pick or drop an image; convert & export',
      },
      keywords: ['选择图片', '拖放', '清除', '转换', '导出', '下载'],
    },
  ],
  png_compressor: [
    {
      key: 'config',
      title: { zh: '压缩配置', en: 'Compression options' },
      description: {
        zh: '无损 OxiPNG / 有损调色板量化',
        en: 'Lossless OxiPNG / lossy palette quantization',
      },
      keywords: ['png', '压缩', 'oxipng', 'pngquant', '无损', '有损', '颜色数', '抖动'],
    },
    {
      key: 'image',
      title: { zh: '图片', en: 'Image' },
      description: { zh: '选择或拖放 PNG,压缩并导出', en: 'Pick or drop PNG; compress & export' },
      keywords: ['选择 png', '拖放', '压缩', '保存结果', '体积对比'],
    },
  ],
  text_compare: [
    {
      key: 'config',
      title: { zh: '比较配置', en: 'Compare options' },
      description: { zh: '行内模式与显示选项', en: 'Inline mode and display options' },
      keywords: ['行内模式', '差异', '原始', '修改后'],
    },
    {
      key: 'original',
      title: { zh: '原始文本', en: 'Original text' },
      keywords: ['原文本', 'original'],
    },
    {
      key: 'modified',
      title: { zh: '修改后文本', en: 'Modified text' },
      keywords: ['modified'],
    },
    {
      key: 'diff',
      title: { zh: '差异结果', en: 'Diff result' },
      description: { zh: 'Diff 对比视图', en: 'Diff comparison view' },
      keywords: ['diff', '对比', '差异', '全屏'],
    },
  ],
  markdown_preview: [
    {
      key: 'input',
      title: { zh: 'Markdown', en: 'Markdown' },
      description: { zh: 'Markdown 源文本编辑器', en: 'Markdown source editor' },
      keywords: ['md', 'markdown', '编辑', '源码'],
    },
    {
      key: 'preview',
      title: { zh: '预览', en: 'Preview' },
      description: {
        zh: '类 Typora 渲染:代码高亮 / 公式 / Mermaid / 排版主题',
        en: 'Typora-like rendering: code highlight / math / Mermaid / themes',
      },
      keywords: ['渲染', 'html', '主题', '导出'],
    },
    {
      key: 'outline',
      title: { zh: '大纲', en: 'Outline' },
      description: { zh: '标题树导航,点击定位章节', en: 'Heading tree navigation; click to jump' },
      keywords: ['目录', 'toc', '导航', '标题'],
    },
  ],
  list_comparer: [
    {
      key: 'config',
      title: { zh: '比较选项', en: 'Compare options' },
      description: { zh: '匹配模式与空白处理', en: 'Match mode and whitespace handling' },
      keywords: ['区分大小写', '比较模式', '修剪空白'],
    },
    { key: 'a', title: { zh: '列表 A', en: 'List A' }, keywords: ['list a'] },
    { key: 'b', title: { zh: '列表 B', en: 'List B' }, keywords: ['list b'] },
    {
      key: 'result',
      title: T_RESULT,
      description: { zh: '比对结果', en: 'Comparison result' },
      keywords: ['比对', '差异'],
    },
  ],
  duplicate_detector: [
    {
      key: 'config',
      title: T_CONFIG,
      description: { zh: '匹配模式与去重策略', en: 'Match mode and dedupe strategy' },
      keywords: ['匹配模式', '偏移', '长度', '去重模式', '统计'],
    },
    { key: 'input', title: T_INPUT, keywords: ['文本'] },
    {
      key: 'result',
      title: T_RESULT,
      description: { zh: '重复行统计', en: 'Duplicate statistics' },
      keywords: ['去重', '重复行', '总计', '不重复'],
    },
  ],
  text_statistics: [
    {
      key: 'config',
      title: { zh: '说明', en: 'About' },
      description: { zh: '即时统计说明', en: 'Live statistics note' },
      keywords: ['统计', '字数'],
    },
    { key: 'input', title: T_INPUT, keywords: ['文本'] },
    {
      key: 'output',
      title: { zh: '统计结果', en: 'Statistics' },
      description: { zh: '字符/词数/行数/字节', en: 'Chars / words / lines / bytes' },
      keywords: ['字符数', '词数', '行数', '字节'],
    },
  ],
  text_editor: [
    {
      key: 'sidebar',
      title: { zh: '打开的编辑器', en: 'Open editors' },
      description: { zh: '文件列表与未保存状态', en: 'File list with unsaved state' },
      keywords: ['文件列表', '左栏', '未保存', '新建', '对比差异'],
    },
    {
      key: 'editor',
      title: { zh: '编辑区', en: 'Editor' },
      description: { zh: '多标签页文本编辑', en: 'Multi-tab text editing' },
      keywords: ['标签页', 'tab', '编辑器', 'monaco', '代码'],
    },
    {
      key: 'compare',
      title: { zh: '对比差异', en: 'Compare diffs' },
      description: { zh: '多文件对比视图', en: 'Multi-file diff view' },
      keywords: ['diff', '对比', '差异'],
    },
  ],
  cron_parser: [
    {
      key: 'config',
      title: { zh: '解析选项', en: 'Parse options' },
      description: { zh: '秒与任务数量', en: 'Seconds and job count' },
      keywords: ['包含秒', '计划任务数量'],
    },
    {
      key: 'expression',
      title: { zh: 'Cron 表达式', en: 'Cron expression' },
      keywords: ['cron', '表达式', '定时'],
    },
    {
      key: 'result',
      title: { zh: '接下来的计划日期', en: 'Upcoming schedule dates' },
      description: { zh: '下次执行时间', en: 'Next execution times' },
      keywords: ['计划', '结果', '下次执行'],
    },
  ],
  ipv4_subnet_calculator: [
    {
      key: 'config',
      title: { zh: 'CIDR 输入', en: 'CIDR input' },
      description: { zh: 'IP 与前缀长度', en: 'IP and prefix length' },
      keywords: ['cidr', '子网', '掩码'],
    },
    {
      key: 'output',
      title: { zh: '子网详情', en: 'Subnet details' },
      description: {
        zh: '网络/掩码/广播/主机范围',
        en: 'Network / mask / broadcast / host range',
      },
      keywords: ['网络地址', '广播', '可用主机'],
    },
  ],
  json_csv_converter: [
    {
      key: 'config',
      title: { zh: '转换方向', en: 'Convert direction' },
      description: { zh: 'JSON → CSV 或 CSV → JSON', en: 'JSON → CSV or CSV → JSON' },
      keywords: ['方向', 'csv', 'json', '表格'],
    },
    { key: 'input', title: T_INPUT, keywords: ['文本'] },
    { key: 'output', title: T_OUTPUT, keywords: ['结果'] },
  ],
  ip_parser: [
    {
      key: 'summary',
      title: { zh: '解析结果摘要', en: 'Parse summary' },
      description: { zh: 'IP 地址与类型徽章', en: 'IP address and type badge' },
      keywords: ['ip', '摘要', '公网', '私网'],
    },
    {
      key: 'input',
      title: T_INPUT,
      description: { zh: 'IPv4 / IPv6 地址或 CIDR', en: 'IPv4 / IPv6 address or CIDR' },
      keywords: ['ip', 'ipv4', 'ipv6', 'cidr', '子网'],
    },
    {
      key: 'result',
      title: { zh: '网络信息', en: 'Network information' },
      description: {
        zh: '子网掩码 / CIDR / 可用主机范围',
        en: 'Netmask / CIDR / usable host range',
      },
      keywords: [
        '子网掩码',
        '通配符掩码',
        'cidr',
        '网络地址',
        '广播地址',
        '主机范围',
        '可用主机数',
      ],
    },
    {
      key: 'geo',
      title: { zh: '归属地与运营商', en: 'Geo & ISP' },
      description: {
        zh: '国家 / 城市 / ISP / ASN / 时区(联网查询)',
        en: 'Country / city / ISP / ASN / timezone (online lookup)',
      },
      keywords: ['归属地', '地理', 'isp', '运营商', 'asn', '时区', '邮编', 'geo', '国家', '城市'],
    },
  ],
  folder_analyzer: [
    {
      key: 'config',
      title: T_CONFIG,
      description: {
        zh: '统计 / 搜索 / 文件解析模式与选项',
        en: 'Stats / search / file-parse modes and options',
      },
      keywords: ['文件夹', '目录', '统计', '内容搜索', '单文件解析', '模式'],
    },
  ],
  timestamp_converter: [
    {
      key: 'input',
      title: T_INPUT,
      description: { zh: 'Unix 秒 / 毫秒 / 日期字符串', en: 'Unix seconds / millis / date string' },
      keywords: ['unix', '秒', '毫秒', '日期', '时间戳'],
    },
    {
      key: 'config',
      title: { zh: '时区', en: 'Timezone' },
      description: { zh: '时区选择', en: 'Timezone selection' },
      keywords: ['时区', 'timezone'],
    },
    {
      key: 'result',
      title: { zh: '转换结果', en: 'Converted result' },
      description: { zh: '多种日期格式', en: 'Multiple date formats' },
      keywords: ['iso 8601', '本地时间', '相对时间', '结果'],
    },
  ],
  number_base_converter: [
    {
      key: 'config',
      title: { zh: '格式选项', en: 'Format options' },
      description: { zh: '数字格式化与输入进制', en: 'Digit grouping and input base' },
      keywords: ['格式化数字', '输入进制', '进制'],
    },
    { key: 'input', title: T_INPUT, keywords: ['数字'] },
    {
      key: 'result',
      title: { zh: '转换结果', en: 'Converted result' },
      description: { zh: '各进制结果', en: 'Results in each base' },
      keywords: ['二进制', '八进制', '十进制', '十六进制', '结果'],
    },
  ],
  json_yaml_converter: [
    {
      key: 'config',
      title: { zh: '转换选项', en: 'Convert options' },
      description: { zh: '方向与缩进', en: 'Direction and indent' },
      keywords: ['方向', '缩进', 'json', 'yaml'],
    },
    {
      key: 'input',
      title: T_INPUT,
      description: { zh: 'JSON / YAML', en: 'JSON / YAML' },
      keywords: ['输入'],
    },
    {
      key: 'output',
      title: T_OUTPUT,
      description: { zh: 'YAML / JSON', en: 'YAML / JSON' },
      keywords: ['结果'],
    },
  ],
  json_array_table: [
    {
      key: 'input',
      title: { zh: 'JSON 数组', en: 'JSON array' },
      description: { zh: 'JSON 数组数据', en: 'JSON array data' },
      keywords: ['json', '数组'],
    },
    {
      key: 'table',
      title: { zh: '表格', en: 'Table' },
      description: { zh: '表格预览,支持导出', en: 'Table preview with export' },
      keywords: ['表格', 'csv', 'tsv', '导出'],
    },
  ],
  color_converter: [
    {
      key: 'input',
      title: { zh: '颜色值', en: 'Color value' },
      description: { zh: 'HEX / RGB / HSL 颜色输入', en: 'HEX / RGB / HSL color input' },
      keywords: ['hex', 'rgb', 'hsl', '颜色'],
    },
    {
      key: 'config',
      title: { zh: '输入格式', en: 'Input format' },
      description: { zh: '颜色格式选择', en: 'Color format selection' },
      keywords: ['格式', '颜色'],
    },
    {
      key: 'result',
      title: { zh: '转换结果', en: 'Converted result' },
      description: { zh: '各格式结果与预览', en: 'Results in each format with preview' },
      keywords: ['预览', '结果', '复制'],
    },
    {
      key: 'output',
      title: { zh: '完整输出', en: 'Full output' },
      description: { zh: '全部格式转换结果文本', en: 'All-format conversion result text' },
      keywords: ['输出', '文本'],
    },
  ],
};

/** 设置 6 大分区(与 SettingsDialog 左侧菜单一一对应) */
export const SETTING_SECTIONS: readonly SettingSection[] = [
  {
    menuId: 'theme',
    title: { zh: '主题', en: 'Theme' },
    description: {
      zh: '选择预设主题或自定义 accent 色',
      en: 'Pick a preset theme or custom accent color',
    },
    keywords: ['主题', '主题色', 'accent', '深色', '浅色', '夜间'],
  },
  {
    menuId: 'font',
    title: { zh: '字体', en: 'Fonts' },
    description: {
      zh: '界面字体 / 代码字体 / 字号 / 字重',
      en: 'Interface font / code font / size / weight',
    },
    keywords: ['字体', '字号', '字重', '代码字体', 'mono', '界面字体'],
  },
  {
    menuId: 'general',
    title: { zh: '通用', en: 'General' },
    description: {
      zh: '历史记录与清空确认',
      en: 'History and clear confirmation',
    },
    keywords: ['通用', '历史', '缩进', '确认', '清空'],
  },
  {
    menuId: 'editor',
    title: { zh: '文本编辑器', en: 'Text editor' },
    description: {
      zh: '字符命名转换的启用项与循环顺序',
      en: 'Enabled naming styles and cycle order',
    },
    keywords: ['编辑器', '命名', '命名风格', 'camelcase', 'snake_case', '循环'],
  },
  {
    menuId: 'shortcuts',
    title: { zh: '快捷键', en: 'Shortcuts' },
    description: {
      zh: '自定义各功能的快捷键绑定',
      en: 'Customize keyboard shortcuts per feature',
    },
    keywords: ['快捷键', '绑定', '快捷键设置'],
  },
  {
    menuId: 'update',
    title: { zh: '更新', en: 'Updates' },
    description: { zh: '检查更新与版本信息', en: 'Check for updates and version info' },
    keywords: ['更新', '升级', '版本', 'github releases'],
  },
];

/** 设置各分区字段(可精确跳转定位) */
export const SETTING_FIELDS: readonly SettingField[] = [
  // 主题
  {
    key: 'system',
    title: { zh: '跟随系统', en: 'Follow system' },
    keywords: ['系统', '自动'],
    menuId: 'theme',
  },
  {
    key: 'presets',
    title: { zh: '预设主题', en: 'Preset themes' },
    description: { zh: '多套预设配色', en: 'Multiple preset palettes' },
    keywords: ['预设', '主题色'],
    menuId: 'theme',
  },
  {
    key: 'custom',
    title: { zh: '自定义 accent 色', en: 'Custom accent color' },
    description: { zh: '自定义强调色', en: 'Custom accent color' },
    keywords: ['自定义', 'accent', '强调色'],
    menuId: 'theme',
  },
  // 字体
  {
    key: 'ui',
    title: { zh: '界面字体', en: 'Interface font' },
    keywords: ['ui', '字体'],
    menuId: 'font',
  },
  {
    key: 'mono',
    title: { zh: '代码字体', en: 'Code font' },
    description: { zh: 'JetBrains Mono 等宽字体', en: 'JetBrains Mono monospace fonts' },
    keywords: ['代码', 'mono', '等宽'],
    menuId: 'font',
  },
  {
    key: 'size',
    title: { zh: '字号', en: 'Font size' },
    keywords: ['字号', '大小'],
    menuId: 'font',
  },
  {
    key: 'weight',
    title: { zh: '字重', en: 'Font weight' },
    keywords: ['字重', '粗细'],
    menuId: 'font',
  },
  // 通用
  {
    key: 'max_history',
    title: { zh: '最大历史数', en: 'Max history entries' },
    keywords: ['历史', '条数'],
    menuId: 'general',
  },
  {
    key: 'json_indent',
    title: { zh: 'JSON 默认缩进', en: 'Default JSON indent' },
    keywords: ['json', '缩进'],
    menuId: 'general',
  },
  {
    key: 'confirm_clear',
    title: { zh: '清空前确认', en: 'Confirm before clearing' },
    keywords: ['清空', '确认'],
    menuId: 'general',
  },
  {
    key: 'smart_detect',
    title: { zh: '剪贴板智能检测', en: 'Clipboard smart detection' },
    keywords: ['剪贴板', '智能检测', 'smart detection'],
    menuId: 'general',
  },
  {
    key: 'language',
    title: { zh: '界面语言', en: 'Language' },
    keywords: ['language', '语言', '中英', 'english'],
    menuId: 'general',
  },
  // 文本编辑器
  {
    key: 'enabled_styles',
    title: { zh: '启用风格', en: 'Enabled styles' },
    description: { zh: '命名转换启用项', en: 'Enabled naming conversions' },
    keywords: ['命名', '风格', '启用'],
    menuId: 'editor',
  },
  {
    key: 'cycle_order',
    title: { zh: '循环顺序', en: 'Cycle order' },
    description: { zh: '快捷键循环切换顺序', en: 'Shortcut cycling order' },
    keywords: ['循环', '顺序', '命名'],
    menuId: 'editor',
  },
  // 快捷键
  {
    key: 'open_command_palette',
    title: { zh: '打开命令面板', en: 'Open command palette' },
    keywords: ['命令面板', 'ctrl+k'],
    menuId: 'shortcuts',
  },
  {
    key: 'toggle_sidebar',
    title: { zh: '切换侧栏', en: 'Toggle sidebar' },
    keywords: ['侧栏', 'sidebar'],
    menuId: 'shortcuts',
  },
  {
    key: 'execute_tool',
    title: { zh: '执行工具', en: 'Run tool' },
    keywords: ['执行', '运行'],
    menuId: 'shortcuts',
  },
  {
    key: 'clear_input',
    title: { zh: '清空输入', en: 'Clear input' },
    keywords: ['清空', '输入'],
    menuId: 'shortcuts',
  },
  {
    key: 'copy_output',
    title: { zh: '复制输出', en: 'Copy output' },
    keywords: ['复制', '输出'],
    menuId: 'shortcuts',
  },
  {
    key: 'toggle_settings',
    title: { zh: '切换设置', en: 'Toggle settings' },
    keywords: ['设置'],
    menuId: 'shortcuts',
  },
  {
    key: 'switch_tool',
    title: { zh: '切换工具', en: 'Switch tool' },
    keywords: ['切换工具'],
    menuId: 'shortcuts',
  },
  {
    key: 'open_history',
    title: { zh: '打开历史', en: 'Open history' },
    keywords: ['历史'],
    menuId: 'shortcuts',
  },
  {
    key: 'search',
    title: { zh: '搜索', en: 'Search' },
    keywords: ['搜索'],
    menuId: 'shortcuts',
  },
  {
    key: 'global_search',
    title: { zh: '全局搜索', en: 'Global search' },
    description: { zh: 'Ctrl+Shift+F', en: 'Ctrl+Shift+F' },
    keywords: ['全局搜索', '搜索', 'ctrl+shift+f'],
    menuId: 'shortcuts',
  },
  {
    key: 'close_panel',
    title: { zh: '关闭面板', en: 'Close panel' },
    keywords: ['关闭', 'esc'],
    menuId: 'shortcuts',
  },
  {
    key: 'save_file',
    title: { zh: '保存编辑器', en: 'Save editor file' },
    description: { zh: 'Ctrl+S', en: 'Ctrl+S' },
    keywords: ['保存', '编辑器'],
    menuId: 'shortcuts',
  },
  {
    key: 'cycle_naming_case',
    title: { zh: '切换字符命名风格', en: 'Cycle naming case' },
    keywords: ['命名', '风格'],
    menuId: 'shortcuts',
  },
  {
    key: 'toggle_case',
    title: { zh: '切换大小写', en: 'Toggle case' },
    keywords: ['大小写'],
    menuId: 'shortcuts',
  },
  // 更新
  {
    key: 'check',
    title: { zh: '检查更新', en: 'Check for updates' },
    description: { zh: '手动检查更新', en: 'Check for updates manually' },
    keywords: ['检查', '更新', '升级'],
    menuId: 'update',
  },
];

/** 应用页面(非工具) */
export const PAGE_ENTRIES: readonly PageEntry[] = [
  {
    title: { zh: '欢迎使用 Qraft', en: 'Welcome to Qraft' },
    description: {
      zh: '所有工具、收藏夹与最近使用',
      en: 'All tools, favorites and recents',
    },
    keywords: ['欢迎', '首页', '所有工具', '仪表盘'],
    view: 'welcome',
  },
  {
    title: { zh: '历史记录', en: 'History' },
    description: { zh: '工具执行历史', en: 'Tool execution history' },
    keywords: ['历史', '记录', '历史记录'],
    view: 'history',
  },
  {
    title: { zh: '管理扩展', en: 'Manage extensions' },
    description: {
      zh: '在 Qraft 中添加和管理第三方扩展',
      en: 'Add and manage third-party extensions in Qraft',
    },
    keywords: ['扩展', '插件', '第三方'],
    view: 'extensions',
  },
  {
    title: { zh: '设置', en: 'Settings' },
    description: { zh: '自定义 Qraft 的样子和风格', en: "Customize Qraft's look and feel" },
    keywords: ['设置', '配置', '偏好'],
    view: 'settings',
  },
  {
    title: { zh: '关于', en: 'About' },
    description: {
      zh: '应用信息、更新日志与开源组件',
      en: 'App info, changelog and open-source components',
    },
    keywords: ['关于', '版本', '更新日志', '开源'],
    view: 'about',
  },
];
