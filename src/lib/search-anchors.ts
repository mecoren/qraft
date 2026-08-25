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
 */

import type { AppView } from '@/store/uiStore';

/** 设置弹窗左侧菜单 id(与 SettingsDialog 的 MenuId 保持一致) */
export type SettingsMenuId = 'theme' | 'font' | 'general' | 'editor' | 'shortcuts' | 'update';

/** 工具内部区块锚点声明 */
export interface ToolAnchor {
  /** 区块标识(与工具组件 data-search-anchor 的后缀一致) */
  key: string;
  /** 区块标题(搜索结果展示文本) */
  title: string;
  /** 补充说明 */
  description?: string;
  /** 搜索关键词 */
  keywords?: string[];
}

/** 设置分区声明 */
export interface SettingSection {
  menuId: SettingsMenuId;
  title: string;
  description: string;
  keywords: string[];
}

/** 设置字段声明 */
export interface SettingField {
  /** 字段锚点(完整值 = `settings:${menuId}:${key}`) */
  key: string;
  title: string;
  description?: string;
  keywords: string[];
  menuId: SettingsMenuId;
}

/** 应用页面声明 */
export interface PageEntry {
  title: string;
  description: string;
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
      title: '配置',
      description: '方向与模式',
      keywords: ['方向', '模式', 'url 安全', '大写', 'data url'],
    },
    {
      key: 'input',
      title: '输入',
      description: '文本或文件内容',
      keywords: ['文本', '文件', 'base64 输入'],
    },
    {
      key: 'output',
      title: '输出',
      description: '编码 / 解码结果',
      keywords: ['结果', 'base64 输出'],
    },
    {
      key: 'file',
      title: '文件',
      description: '拖放或选择文件进行转换',
      keywords: ['选择文件', '文件拖放', '另存为'],
    },
  ],
  certificate_decoder: [
    {
      key: 'input',
      title: '输入证书',
      description: 'PEM / Base64 DER 格式',
      keywords: ['pem', 'der', '证书'],
    },
    {
      key: 'output',
      title: '解码结果',
      description: '证书详细信息',
      keywords: ['结果', '证书信息', 'x509'],
    },
  ],
  gzip_codec: [
    {
      key: 'config',
      title: 'GZip 转换',
      description: '压缩 / 解压方向',
      keywords: ['压缩', '解压', 'zip'],
    },
    { key: 'input', title: '输入', keywords: ['gzip'] },
    { key: 'output', title: '输出', keywords: ['结果'] },
  ],
  html_codec: [
    {
      key: 'config',
      title: '转换',
      description: '编码 / 解码方向',
      keywords: ['编码', '解码', 'html'],
    },
    { key: 'input', title: '输入', keywords: ['html'] },
    { key: 'output', title: '输出', keywords: ['结果', '实体'] },
  ],
  jwt_parser: [
    { key: 'input', title: 'JWT 令牌', keywords: ['jwt', 'token', '令牌'] },
    { key: 'header', title: '头部', description: 'Header', keywords: ['header', '头'] },
    { key: 'payload', title: '载荷', description: 'Payload', keywords: ['payload', '载荷'] },
    { key: 'signature', title: '签名', description: 'Signature', keywords: ['signature', '签名'] },
  ],
  url_codec: [
    {
      key: 'config',
      title: '操作',
      description: '编码 / 解码与组件编码',
      keywords: ['编码', '解码', '组件编码'],
    },
    { key: 'input', title: '输入', keywords: ['url', '链接'] },
    { key: 'output', title: '输出', keywords: ['结果'] },
  ],
  jsonpath_tester: [
    { key: 'expression', title: 'JSONPath 表达式', keywords: ['表达式', 'jsonpath', 'query'] },
    { key: 'input', title: '输入 JSON', keywords: ['json', '数据'] },
    { key: 'output', title: '测试结果', keywords: ['结果', '查询结果'] },
  ],
  regex_tester: [
    {
      key: 'config',
      title: '正则配置',
      description: '表达式与标志位',
      keywords: ['正则', 'regexp', 'pattern', 'flags', '标志位'],
    },
    { key: 'input', title: '测试文本', keywords: ['文本'] },
    { key: 'output', title: '匹配结果', keywords: ['结果', '匹配'] },
  ],
  xml_xsd_tester: [
    { key: 'xsd', title: 'XSD', description: 'Schema 定义', keywords: ['schema', 'xsd'] },
    { key: 'xml', title: 'XML', description: '待校验的 XML 数据', keywords: ['xml'] },
    {
      key: 'verdict',
      title: '校验结果',
      description: '校验结论',
      keywords: ['验证', '结论', '结果', '错误'],
    },
  ],
  json_formatter: [
    {
      key: 'input',
      title: '输入',
      description: 'JSON / XML,工具栏含格式化操作',
      keywords: ['json', 'xml', '格式化', '压缩', '键升序', '键降序', '生成实体类', '缩进'],
    },
    { key: 'output', title: '输出', description: '格式化结果', keywords: ['结果'] },
  ],
  json_minifier: [
    {
      key: 'config',
      title: '转换与调整',
      description: '常用文本处理操作',
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
    { key: 'input', title: '输入', keywords: ['文本'] },
    { key: 'output', title: '输出', keywords: ['结果', '统计', '字数'] },
  ],
  sql_formatter: [
    {
      key: 'config',
      title: '配置',
      description: '方言 / 缩进 / 关键字大小写',
      keywords: ['语言', '方言', '缩进', '关键字大小写'],
    },
    { key: 'input', title: '输入', keywords: ['sql', '数据库'] },
    { key: 'output', title: '输出', keywords: ['结果'] },
  ],
  xml_formatter: [
    { key: 'config', title: '配置', description: '缩进与属性换行', keywords: ['缩进', '属性换行'] },
    { key: 'input', title: '输入', keywords: ['xml'] },
    { key: 'output', title: '输出', keywords: ['结果'] },
  ],
  hash_calculator: [
    {
      key: 'config',
      title: '算法',
      description: '哈希算法选择',
      keywords: ['md5', 'sha', 'checksum', '哈希', '校验'],
    },
    { key: 'input', title: '输入文本', keywords: ['文本'] },
    { key: 'output', title: '哈希值', description: '计算结果', keywords: ['结果', '校验和'] },
  ],
  lorem_ipsum: [
    {
      key: 'config',
      title: '生成选项',
      description: '类型 / 数量 / 起始文本',
      keywords: ['类型', '数量', 'lorem ipsum', '段落', '句子'],
    },
    { key: 'output', title: '生成结果', keywords: ['占位', '假文', '结果'] },
  ],
  password_generator: [
    {
      key: 'config',
      title: '生成选项',
      description: '长度与字符集',
      keywords: ['长度', '小写字母', '大写字母', '数字', '特殊字符', '易混淆', '生成数量'],
    },
    { key: 'strength', title: '强度', description: '密码强度指示', keywords: ['强度', '强弱'] },
    { key: 'output', title: '生成结果', keywords: ['密码', '结果'] },
  ],
  qrcode_tool: [
    {
      key: 'tabs',
      title: '生成与读取',
      description: '切换二维码生成 / 读取模式',
      keywords: ['生成二维码', '读取二维码', '解码'],
    },
    { key: 'input', title: '文本', description: '二维码内容', keywords: ['内容', 'qr'] },
    {
      key: 'image',
      title: '二维码图片',
      description: '二维码预览',
      keywords: ['预览', 'png', 'svg', '图片'],
    },
    { key: 'output', title: '识别结果', keywords: ['解码', '识别'] },
  ],
  uuid_generator: [
    {
      key: 'config',
      title: '生成选项',
      description: '版本 / 数量 / 格式',
      keywords: ['版本', '数量', '大写', '连字符', 'guid', 'ulid'],
    },
    { key: 'output', title: '生成结果', keywords: ['uuid', '结果'] },
  ],
  color_blindness_simulator: [
    {
      key: 'source',
      title: '源图片',
      description: '选择或拖放图片',
      keywords: ['选择图片', '原图', '图片'],
    },
    {
      key: 'preview',
      title: '模拟结果',
      description: '色盲模拟效果',
      keywords: ['红色盲', '绿色盲', '蓝色盲', 'protanopia', 'deuteranopia', 'tritanopia', '色弱'],
    },
  ],
  image_converter: [
    {
      key: 'config',
      title: '目标格式',
      description: '转换格式与质量',
      keywords: ['格式', '质量', 'png', 'jpeg', 'webp'],
    },
    {
      key: 'image',
      title: '图片',
      description: '选择或拖放图片,含转换导出',
      keywords: ['选择图片', '拖放', '清除', '转换', '导出', '下载'],
    },
  ],
  png_compressor: [
    {
      key: 'config',
      title: '压缩配置',
      description: '无损 OxiPNG / 有损调色板量化',
      keywords: ['png', '压缩', 'oxipng', 'pngquant', '无损', '有损', '颜色数', '抖动'],
    },
    {
      key: 'image',
      title: '图片',
      description: '选择或拖放 PNG,压缩并导出',
      keywords: ['选择 png', '拖放', '压缩', '保存结果', '体积对比'],
    },
  ],
  text_compare: [
    {
      key: 'config',
      title: '比较配置',
      description: '行内模式与显示选项',
      keywords: ['行内模式', '差异', '原始', '修改后'],
    },
    { key: 'original', title: '原始文本', keywords: ['原文本', 'original'] },
    { key: 'modified', title: '修改后文本', keywords: ['modified'] },
    {
      key: 'diff',
      title: '差异结果',
      description: 'Diff 对比视图',
      keywords: ['diff', '对比', '差异', '全屏'],
    },
  ],
  markdown_preview: [
    {
      key: 'input',
      title: 'Markdown',
      description: 'Markdown 源文本编辑器',
      keywords: ['md', 'markdown', '编辑', '源码'],
    },
    {
      key: 'preview',
      title: '预览',
      description: '类 Typora 渲染:代码高亮 / 公式 / Mermaid / 排版主题',
      keywords: ['渲染', 'html', '主题', '导出'],
    },
    {
      key: 'outline',
      title: '大纲',
      description: '标题树导航,点击定位章节',
      keywords: ['目录', 'toc', '导航', '标题'],
    },
  ],
  list_comparer: [
    {
      key: 'config',
      title: '比较选项',
      description: '匹配模式与空白处理',
      keywords: ['区分大小写', '比较模式', '修剪空白'],
    },
    { key: 'a', title: '列表 A', keywords: ['list a'] },
    { key: 'b', title: '列表 B', keywords: ['list b'] },
    { key: 'result', title: '结果', description: '比对结果', keywords: ['比对', '差异'] },
  ],
  duplicate_detector: [
    {
      key: 'config',
      title: '配置',
      description: '匹配模式与去重策略',
      keywords: ['匹配模式', '偏移', '长度', '去重模式', '统计'],
    },
    { key: 'input', title: '输入', keywords: ['文本'] },
    {
      key: 'result',
      title: '结果',
      description: '重复行统计',
      keywords: ['去重', '重复行', '总计', '不重复'],
    },
  ],
  text_statistics: [
    {
      key: 'config',
      title: '说明',
      description: '即时统计说明',
      keywords: ['统计', '字数'],
    },
    { key: 'input', title: '输入', keywords: ['文本'] },
    {
      key: 'output',
      title: '统计结果',
      description: '字符/词数/行数/字节',
      keywords: ['字符数', '词数', '行数', '字节'],
    },
  ],
  text_editor: [
    {
      key: 'sidebar',
      title: '打开的编辑器',
      description: '文件列表与未保存状态',
      keywords: ['文件列表', '左栏', '未保存', '新建', '对比差异'],
    },
    {
      key: 'editor',
      title: '编辑区',
      description: '多标签页文本编辑',
      keywords: ['标签页', 'tab', '编辑器', 'monaco', '代码'],
    },
    {
      key: 'compare',
      title: '对比差异',
      description: '多文件对比视图',
      keywords: ['diff', '对比', '差异'],
    },
  ],
  cron_parser: [
    {
      key: 'config',
      title: '解析选项',
      description: '秒与任务数量',
      keywords: ['包含秒', '计划任务数量'],
    },
    { key: 'expression', title: 'Cron 表达式', keywords: ['cron', '表达式', '定时'] },
    {
      key: 'result',
      title: '接下来的计划日期',
      description: '下次执行时间',
      keywords: ['计划', '结果', '下次执行'],
    },
  ],
  ip_parser: [
    {
      key: 'summary',
      title: '解析结果摘要',
      description: 'IP 地址与类型徽章',
      keywords: ['ip', '摘要', '公网', '私网'],
    },
    {
      key: 'input',
      title: '输入',
      description: 'IPv4 / IPv6 地址或 CIDR',
      keywords: ['ip', 'ipv4', 'ipv6', 'cidr', '子网'],
    },
    {
      key: 'result',
      title: '网络信息',
      description: '子网掩码 / CIDR / 可用主机范围',
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
      title: '归属地与运营商',
      description: '国家 / 城市 / ISP / ASN / 时区(联网查询)',
      keywords: ['归属地', '地理', 'isp', '运营商', 'asn', '时区', '邮编', 'geo', '国家', '城市'],
    },
  ],
  folder_analyzer: [
    {
      key: 'config',
      title: '配置',
      description: '统计 / 搜索 / 文件解析模式与选项',
      keywords: ['文件夹', '目录', '统计', '内容搜索', '单文件解析', '模式'],
    },
  ],
  timestamp_converter: [
    {
      key: 'input',
      title: '输入',
      description: 'Unix 秒 / 毫秒 / 日期字符串',
      keywords: ['unix', '秒', '毫秒', '日期', '时间戳'],
    },
    { key: 'config', title: '时区', description: '时区选择', keywords: ['时区', 'timezone'] },
    {
      key: 'result',
      title: '转换结果',
      description: '多种日期格式',
      keywords: ['iso 8601', '本地时间', '相对时间', '结果'],
    },
  ],
  number_base_converter: [
    {
      key: 'config',
      title: '格式选项',
      description: '数字格式化与输入进制',
      keywords: ['格式化数字', '输入进制', '进制'],
    },
    { key: 'input', title: '输入', keywords: ['数字'] },
    {
      key: 'result',
      title: '转换结果',
      description: '各进制结果',
      keywords: ['二进制', '八进制', '十进制', '十六进制', '结果'],
    },
  ],
  json_yaml_converter: [
    {
      key: 'config',
      title: '转换选项',
      description: '方向与缩进',
      keywords: ['方向', '缩进', 'json', 'yaml'],
    },
    { key: 'input', title: '输入', description: 'JSON / YAML', keywords: ['输入'] },
    { key: 'output', title: '输出', description: 'YAML / JSON', keywords: ['结果'] },
  ],
  json_array_table: [
    { key: 'input', title: 'JSON 数组', description: 'JSON 数组数据', keywords: ['json', '数组'] },
    {
      key: 'table',
      title: '表格',
      description: '表格预览,支持导出',
      keywords: ['表格', 'csv', 'tsv', '导出'],
    },
  ],
  color_converter: [
    {
      key: 'input',
      title: '颜色值',
      description: 'HEX / RGB / HSL 颜色输入',
      keywords: ['hex', 'rgb', 'hsl', '颜色'],
    },
    { key: 'config', title: '输入格式', description: '颜色格式选择', keywords: ['格式', '颜色'] },
    {
      key: 'result',
      title: '转换结果',
      description: '各格式结果与预览',
      keywords: ['预览', '结果', '复制'],
    },
    {
      key: 'output',
      title: '完整输出',
      description: '全部格式转换结果文本',
      keywords: ['输出', '文本'],
    },
  ],
};

/** 设置 6 大分区(与 SettingsDialog 左侧菜单一一对应) */
export const SETTING_SECTIONS: readonly SettingSection[] = [
  {
    menuId: 'theme',
    title: '主题',
    description: '选择预设主题或自定义 accent 色',
    keywords: ['主题', '主题色', 'accent', '深色', '浅色', '夜间'],
  },
  {
    menuId: 'font',
    title: '字体',
    description: '界面字体 / 代码字体 / 字号 / 字重',
    keywords: ['字体', '字号', '字重', '代码字体', 'mono', '界面字体'],
  },
  {
    menuId: 'general',
    title: '通用',
    description: '历史记录与清空确认',
    keywords: ['通用', '历史', '缩进', '确认', '清空'],
  },
  {
    menuId: 'editor',
    title: '文本编辑器',
    description: '字符命名转换的启用项与循环顺序',
    keywords: ['编辑器', '命名', '命名风格', 'camelcase', 'snake_case', '循环'],
  },
  {
    menuId: 'shortcuts',
    title: '快捷键',
    description: '自定义各功能的快捷键绑定',
    keywords: ['快捷键', '绑定', '快捷键设置'],
  },
  {
    menuId: 'update',
    title: '更新',
    description: '检查更新与版本信息',
    keywords: ['更新', '升级', '版本', 'github releases'],
  },
];

/** 设置各分区字段(可精确跳转定位) */
export const SETTING_FIELDS: readonly SettingField[] = [
  // 主题
  { key: 'system', title: '跟随系统', keywords: ['系统', '自动'], menuId: 'theme' },
  {
    key: 'presets',
    title: '预设主题',
    description: '多套预设配色',
    keywords: ['预设', '主题色'],
    menuId: 'theme',
  },
  {
    key: 'custom',
    title: '自定义 accent 色',
    description: '自定义强调色',
    keywords: ['自定义', 'accent', '强调色'],
    menuId: 'theme',
  },
  // 字体
  { key: 'ui', title: '界面字体', keywords: ['ui', '字体'], menuId: 'font' },
  {
    key: 'mono',
    title: '代码字体',
    description: 'JetBrains Mono 等宽字体',
    keywords: ['代码', 'mono', '等宽'],
    menuId: 'font',
  },
  { key: 'size', title: '字号', keywords: ['字号', '大小'], menuId: 'font' },
  { key: 'weight', title: '字重', keywords: ['字重', '粗细'], menuId: 'font' },
  // 通用
  { key: 'max_history', title: '最大历史数', keywords: ['历史', '条数'], menuId: 'general' },
  { key: 'json_indent', title: 'JSON 默认缩进', keywords: ['json', '缩进'], menuId: 'general' },
  { key: 'confirm_clear', title: '清空前确认', keywords: ['清空', '确认'], menuId: 'general' },
  {
    key: 'smart_detect',
    title: '剪贴板智能检测',
    keywords: ['剪贴板', '智能检测', 'smart detection'],
    menuId: 'general',
  },
  // 文本编辑器
  {
    key: 'enabled_styles',
    title: '启用风格',
    description: '命名转换启用项',
    keywords: ['命名', '风格', '启用'],
    menuId: 'editor',
  },
  {
    key: 'cycle_order',
    title: '循环顺序',
    description: '快捷键循环切换顺序',
    keywords: ['循环', '顺序', '命名'],
    menuId: 'editor',
  },
  // 快捷键
  {
    key: 'open_command_palette',
    title: '打开命令面板',
    keywords: ['命令面板', 'ctrl+k'],
    menuId: 'shortcuts',
  },
  { key: 'toggle_sidebar', title: '切换侧栏', keywords: ['侧栏', 'sidebar'], menuId: 'shortcuts' },
  { key: 'execute_tool', title: '执行工具', keywords: ['执行', '运行'], menuId: 'shortcuts' },
  { key: 'clear_input', title: '清空输入', keywords: ['清空', '输入'], menuId: 'shortcuts' },
  { key: 'copy_output', title: '复制输出', keywords: ['复制', '输出'], menuId: 'shortcuts' },
  { key: 'toggle_settings', title: '切换设置', keywords: ['设置'], menuId: 'shortcuts' },
  { key: 'switch_tool', title: '切换工具', keywords: ['切换工具'], menuId: 'shortcuts' },
  { key: 'open_history', title: '打开历史', keywords: ['历史'], menuId: 'shortcuts' },
  { key: 'search', title: '搜索', keywords: ['搜索'], menuId: 'shortcuts' },
  {
    key: 'global_search',
    title: '全局搜索',
    description: 'Ctrl+Shift+F',
    keywords: ['全局搜索', '搜索', 'ctrl+shift+f'],
    menuId: 'shortcuts',
  },
  { key: 'close_panel', title: '关闭面板', keywords: ['关闭', 'esc'], menuId: 'shortcuts' },
  {
    key: 'save_file',
    title: '保存编辑器',
    description: 'Ctrl+S',
    keywords: ['保存', '编辑器'],
    menuId: 'shortcuts',
  },
  {
    key: 'cycle_naming_case',
    title: '切换字符命名风格',
    keywords: ['命名', '风格'],
    menuId: 'shortcuts',
  },
  { key: 'toggle_case', title: '切换大小写', keywords: ['大小写'], menuId: 'shortcuts' },
  // 更新
  {
    key: 'check',
    title: '检查更新',
    description: '手动检查更新',
    keywords: ['检查', '更新', '升级'],
    menuId: 'update',
  },
];

/** 应用页面(非工具) */
export const PAGE_ENTRIES: readonly PageEntry[] = [
  {
    title: '欢迎使用 Qraft',
    description: '所有工具、收藏夹与最近使用',
    keywords: ['欢迎', '首页', '所有工具', '仪表盘'],
    view: 'welcome',
  },
  {
    title: '历史记录',
    description: '工具执行历史',
    keywords: ['历史', '记录', '历史记录'],
    view: 'history',
  },
  {
    title: '管理扩展',
    description: '在 Qraft 中添加和管理第三方扩展',
    keywords: ['扩展', '插件', '第三方'],
    view: 'extensions',
  },
  {
    title: '设置',
    description: '自定义 Qraft 的样子和风格',
    keywords: ['设置', '配置', '偏好'],
    view: 'settings',
  },
  {
    title: '关于',
    description: '应用信息、更新日志与开源组件',
    keywords: ['关于', '版本', '更新日志', '开源'],
    view: 'about',
  },
];
