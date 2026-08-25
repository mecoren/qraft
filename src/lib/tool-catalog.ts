/**
 * 工具目录(Tool Catalog)—— UI 层的唯一工具元数据来源
 *
 * 职责:
 * - 定义 7 大分类及其显示顺序(与 DevToys 侧栏对齐)
 * - 登记全部工具的展示元数据:名称 / 描述 / 图标 / 关键词 / 分类
 * - 标注每个工具的执行方式:
 *   - backendId 存在 → 经 IPC 调用 Rust 后端工具(tool_execute)
 *   - backendId 缺省 → 纯前端 TypeScript 实现(见 src/tools/)
 *   - special 存在 → 应用内页面(设置 / 管理扩展),非工具
 *
 * 设计说明:
 * - 侧栏、欢迎页、命令面板、收藏/最近使用均以此目录为准,
 *   与 Rust 端 tool_list 解耦(后端列表仅提供执行能力,不提供展示元数据)
 * - 图标直接使用 LucideIcon 组件,避免字符串解析失败风险
 */

import {
  ArrowLeftRight,
  Award,
  Binary,
  Braces,
  Calendar,
  Clock,
  CodeXml,
  Database,
  Diff,
  EyeOff,
  FileArchive,
  FileCode2,
  FileText,
  Fingerprint,
  FlaskConical,
  FolderOpen,
  Hash,
  Image,
  KeyRound,
  Link,
  ListChecks,
  Network,
  Paintbrush,
  Parentheses,
  Puzzle,
  QrCode,
  Regex,
  Settings,
  Sigma,
  Table,
  Type,
  Wand2,
  Asterisk,
  type LucideIcon,
} from 'lucide-react';

// ============================================================
// 分类定义
// ============================================================

export type CatalogCategoryId =
  'encoder' | 'tester' | 'formatter' | 'generator' | 'graphic' | 'editor' | 'text' | 'converter';

export interface CatalogCategory {
  id: CatalogCategoryId;
  label: string;
  icon: LucideIcon;
}

/** 分类显示顺序(与 DevToys 侧栏一致) */
export const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  { id: 'encoder', label: '编解码器', icon: CodeXml },
  { id: 'tester', label: '测试工具', icon: FlaskConical },
  { id: 'formatter', label: '格式化工具', icon: Paintbrush },
  { id: 'generator', label: '生成器', icon: Wand2 },
  { id: 'graphic', label: '图像处理', icon: Image },
  { id: 'editor', label: '文本编辑器', icon: FileCode2 },
  { id: 'text', label: '文本处理', icon: Type },
  { id: 'converter', label: '转换器', icon: ArrowLeftRight },
] as const;

export function getCategoryById(id: CatalogCategoryId): CatalogCategory {
  const found = CATALOG_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`未知工具分类: ${id}`);
  return found;
}

// ============================================================
// 工具条目
// ============================================================

export interface CatalogEntry {
  /** UI 层唯一 ID;纯前端工具即注册表 toolId,后端工具与 Rust toolId 一致 */
  id: string;
  name: string;
  description: string;
  category: CatalogCategoryId;
  icon: LucideIcon;
  /** 搜索关键词(小写匹配名称/描述之外的补充) */
  keywords: string[];
  /** 存在时经 IPC 调用 Rust 后端执行;缺省为纯前端实现 */
  backendId?: string;
  /** 应用内特殊页面(非工具) */
  special?: 'settings' | 'extensions';
}

/**
 * 应用启动默认打开的工具 id(纯前端文本编辑器,registry 中注册值)。
 * 供 store 初始状态与侧边栏固定菜单项共享引用。
 */
export const DEFAULT_TOOL_ID = 'text_editor';

/** 全部工具目录(顺序即"所有工具"网格与侧栏的展示顺序) */
export const TOOL_CATALOG: readonly CatalogEntry[] = [
  // —— 编解码器 ——
  {
    id: 'base64_codec',
    name: 'Base64 转换器',
    description:
      '文本 / 图片 / 文件 / 音频 / 视频 / PDF 与 Base64 互转,支持 Hex、ASCII、Basic Auth 解码',
    category: 'encoder',
    icon: Binary,
    keywords: [
      'base64',
      'encode',
      'decode',
      'text',
      '文本',
      'image',
      '图片',
      'file',
      '文件',
      'pdf',
      'audio',
      '视频',
      'hex',
      'ascii',
      'basic auth',
      'url',
      'css',
      'html',
      'data url',
    ],
    backendId: 'base64_codec',
  },
  {
    id: 'certificate_decoder',
    name: '证书解码',
    description: '解码一个证书',
    category: 'encoder',
    icon: Award,
    keywords: ['certificate', 'x509', 'pem', '证书', 'ssl'],
  },
  {
    id: 'gzip_codec',
    name: 'GZip压缩/解压缩',
    description: '压缩或解压缩文本为GZip',
    category: 'encoder',
    icon: FileArchive,
    keywords: ['gzip', 'zip', '压缩', '解压'],
  },
  {
    id: 'html_codec',
    name: 'HTML文本编码器/解码器',
    description: '编码和解码HTML文本数据',
    category: 'encoder',
    icon: FileCode2,
    keywords: ['html', 'entity', '实体', '转义'],
  },
  {
    id: 'jwt_parser',
    name: 'JWT编码器/解码器',
    description: '编码和解码Json网络令牌',
    category: 'encoder',
    icon: Asterisk,
    keywords: ['jwt', 'token', '令牌'],
    backendId: 'jwt_parser',
  },
  {
    id: 'basic_auth_generator',
    name: 'Basic Auth 生成器',
    description: '由用户名密码生成 Authorization 请求头(UTF-8 安全)',
    category: 'encoder',
    icon: KeyRound,
    keywords: ['basic auth', 'authorization', '认证', '请求头'],
  },
  {
    id: 'url_codec',
    name: 'URL 编码/解码工具',
    description: '将所有适用的字符编码或解码为对应的URL输出',
    category: 'encoder',
    icon: Link,
    keywords: ['url', 'uri', 'percent', '链接'],
    backendId: 'url_codec',
  },

  // —— 测试工具 ——
  {
    id: 'jsonpath_tester',
    name: 'JSONPath 测试器',
    description: '测试 JSONPath',
    category: 'tester',
    icon: Parentheses,
    keywords: ['jsonpath', 'json', '查询'],
  },
  {
    id: 'regex_tester',
    name: '正则表达式测试工具',
    description: '验证和测试正则表达式',
    category: 'tester',
    icon: Regex,
    keywords: ['regex', 'regexp', '正则'],
    backendId: 'regex_tester',
  },
  {
    id: 'xml_xsd_tester',
    name: 'XML / XSD 测试器',
    description: '通过 XSD 约束校验 XML 数据。',
    category: 'tester',
    icon: FileCode2,
    keywords: ['xml', 'xsd', 'schema', '校验'],
  },

  // —— 格式化工具 ——
  {
    id: 'json_formatter',
    name: 'JSON 格式化器',
    description: '格式化、压缩、排序 JSON,生成 TypeScript 实体类,并支持 XML 自动转 JSON',
    category: 'formatter',
    icon: Braces,
    keywords: ['json', 'format', 'beautify', 'minify', '排序', '实体类', 'xml'],
    backendId: 'json_formatter',
  },
  // 原 json_minifier 槽位已改造为纯前端文本处理工具(详见 TextProcessor.tsx)。
  // 仍保留原 id 以兼容历史收藏/最近使用(localStorage 中已存储该 id)。
  {
    id: 'json_minifier',
    name: '文本处理工具',
    description:
      '常用文本处理:转义、去空格、URL 编码/解码、Unicode 与中文互转、中文标点转英文、大小写转换、行反转/去重/排序,并提供字符/单词/行/字节/句子/段落统计',
    category: 'text',
    icon: Type,
    keywords: [
      'text',
      '文本',
      '转换',
      'escape',
      'url encode',
      'unicode',
      '中文',
      '分析',
      '统计',
      '字数',
      '大小写',
      '去重',
      '排序',
    ],
  },
  {
    id: 'sql_formatter',
    name: 'SQL 格式化器',
    description: '格式化 SQL 数据',
    category: 'formatter',
    icon: Database,
    keywords: ['sql', 'format', '数据库'],
  },
  {
    id: 'xml_formatter',
    name: 'XML 格式化器',
    description: '格式化或精简 XML 数据',
    category: 'formatter',
    icon: CodeXml,
    keywords: ['xml', 'format', 'beautify'],
  },

  // —— 生成器 ——
  {
    id: 'hash_calculator',
    name: '哈希 / 校验和生成器',
    description: '从文本或二进制数据计算哈希值',
    category: 'generator',
    icon: Fingerprint,
    keywords: ['hash', 'md5', 'sha', 'checksum', '哈希', '校验'],
    backendId: 'hash_calculator',
  },
  {
    id: 'lorem_ipsum',
    name: '乱数假文生成器',
    description: '生成乱数假文作为占位符文本',
    category: 'generator',
    icon: FileText,
    keywords: ['lorem', 'ipsum', '占位', '假文'],
  },
  {
    id: 'password_generator',
    name: '密码生成器',
    description: '生成随机密码',
    category: 'generator',
    icon: KeyRound,
    keywords: ['password', '密码', '随机'],
  },
  {
    id: 'qrcode_tool',
    name: '二维码编解码工具',
    description: '读取二维码或从文本产生二维码。可导出为 SVG 格式。',
    category: 'generator',
    icon: QrCode,
    keywords: ['qrcode', 'qr', '二维码'],
  },
  {
    id: 'uuid_generator',
    name: 'UUID 生成器',
    description: '生成版本为 1、4(GUID)和 7 的 UUID',
    category: 'generator',
    icon: Hash,
    keywords: ['uuid', 'guid'],
    backendId: 'uuid_generator',
  },
  {
    id: 'ulid_generator',
    name: 'ULID 生成器',
    description: '生成按时间排序的 26 位 ULID 标识符',
    category: 'generator',
    icon: Fingerprint,
    keywords: ['ulid', 'sortable id', '标识符', '有序 id'],
  },

  // —— 图像处理 ——
  {
    id: 'color_blindness_simulator',
    name: '色盲模拟器',
    description: '在图片或屏幕截图上模拟色盲效果',
    category: 'graphic',
    icon: EyeOff,
    keywords: ['color', 'blind', '色盲', '色弱', '无障碍'],
  },
  {
    id: 'image_converter',
    name: '图片格式转换器',
    description: '无损的图片格式转换工具',
    category: 'graphic',
    icon: Image,
    keywords: ['image', 'png', 'jpeg', 'webp', '转换'],
  },
  {
    id: 'png_compressor',
    name: 'PNG 压缩器',
    description:
      '压缩 PNG 图片:OxiPNG 无损优化与调色板量化有损压缩(参考 pngquant),展示前后体积对比',
    category: 'graphic',
    icon: Image,
    keywords: ['png', 'compress', '压缩', '图片优化', 'oxipng', 'pngquant'],
  },

  // —— 文本处理 ——
  {
    id: 'text_compare',
    name: '文本比较工具',
    description: '比较两段文本',
    category: 'text',
    icon: Diff,
    keywords: ['diff', 'compare', '比较', '对比', '差异'],
  },
  {
    id: 'markdown_preview',
    name: 'Markdown 预览',
    description: '类 Typora 分栏预览:代码高亮、数学公式、Mermaid 图表、大纲导航与多排版主题',
    category: 'text',
    icon: FileText,
    keywords: ['markdown', 'md', '预览', '公式', 'katex', 'mermaid', '大纲', '导出 html'],
  },
  {
    id: 'list_comparer',
    name: '列表比对器',
    description: '比对两个列表',
    category: 'text',
    icon: ListChecks,
    keywords: ['list', 'compare', '列表', '比对'],
  },
  {
    id: 'duplicate_detector',
    name: '重复行检测器',
    description: '检测文本中的重复行并按策略去重',
    category: 'text',
    icon: ListChecks,
    keywords: ['duplicate', 'dedupe', '去重', '重复行', 'unique', '重复'],
  },
  {
    id: 'text_statistics',
    name: '文本统计',
    description: '统计字符、词数、行数与 UTF-8 字节数',
    category: 'text',
    icon: Sigma,
    keywords: ['word count', '字数统计', 'lines', 'bytes', '统计'],
  },
  {
    id: 'folder_analyzer',
    name: '文件夹分析器',
    description: '统计文件夹类型分布、文本行数字数、内容搜索、单文件解析(只读)',
    category: 'text',
    icon: FolderOpen,
    keywords: ['folder', 'file', 'stats', 'lines', 'words', 'grep', '分析', '统计', '搜索'],
    backendId: 'folder_analyzer',
  },
  {
    id: 'text_editor',
    name: '文本编辑器',
    description:
      'VSCode 风格工作区:打开的编辑器列表 + 多 Tab 文本编辑 + 打开/保存本地文件 + 跨重启持久化',
    category: 'editor',
    icon: FileCode2,
    keywords: [
      'editor',
      'text',
      'vscode',
      'monaco',
      '编辑器',
      '代码',
      'syntax highlight',
      'tab',
      '工作区',
      '打开文件',
      '本地文件',
    ],
  },

  // —— 转换器 ——
  {
    id: 'cron_parser',
    name: 'Cron 表达式解析器',
    description: '解析 Cron 表达式,获取下次计划执行时间',
    category: 'converter',
    icon: Clock,
    keywords: ['cron', 'schedule', '定时', '计划'],
  },
  {
    id: 'ipv4_subnet_calculator',
    name: 'IPv4 子网计算器',
    description: '由 IP/CIDR 计算网络地址、掩码、广播地址与可用主机范围(离线本地计算)',
    category: 'converter',
    icon: Network,
    keywords: ['subnet', 'cidr', 'netmask', '子网掩码', '广播地址'],
  },
  {
    id: 'json_csv_converter',
    name: 'JSON ↔ CSV 转换器',
    description: 'JSON 数组与 CSV 表格双向转换(RFC 4180,支持引号转义)',
    category: 'converter',
    icon: Table,
    keywords: ['csv', 'excel', '表格', 'tsv', '逗号分隔'],
  },
  {
    id: 'ip_parser',
    name: 'IP 地址解析器',
    description:
      '分析 IP 地址和子网以获取网络信息:子网掩码、CIDR 记法、网络/广播地址、可用主机范围,并可联网查询归属地、运营商/ISP、ASN 与时区,支持 IPv4 与 IPv6',
    category: 'converter',
    icon: Network,
    keywords: [
      'ip',
      'ipv4',
      'ipv6',
      'cidr',
      'subnet',
      'netmask',
      '子网',
      '掩码',
      '网络',
      '主机范围',
      '归属地',
      'isp',
      'asn',
      'geo',
    ],
  },
  {
    id: 'timestamp_converter',
    name: '日期转换器',
    description: '将时间戳转换为人类可读的日期,或相反',
    category: 'converter',
    icon: Calendar,
    keywords: ['timestamp', 'date', '时间戳', '日期'],
    backendId: 'timestamp_converter',
  },
  {
    id: 'number_base_converter',
    name: '进制转换器',
    description: '将数字从一个进制转换为另一个进制',
    category: 'converter',
    icon: Hash,
    keywords: ['number', 'base', '进制', '二进制', '十六进制'],
  },
  {
    id: 'json_yaml_converter',
    name: 'JSON <> YAML 转换工具',
    description: 'JSON 和 YAML 数据格式互相转换',
    category: 'converter',
    icon: ArrowLeftRight,
    keywords: ['json', 'yaml', 'yml', '转换'],
  },
  {
    id: 'json_array_table',
    name: 'JSON 数组到表格',
    description: '将 JSON 数组转换为表格,导出至 CSV 或 TSV 格式。',
    category: 'converter',
    icon: Table,
    keywords: ['json', 'table', 'csv', 'tsv', '表格'],
  },
  {
    id: 'color_converter',
    name: '颜色转换器',
    description: '在 HEX / RGB / HSL 等颜色格式之间转换',
    category: 'converter',
    icon: Paintbrush,
    keywords: ['color', 'hex', 'rgb', 'hsl', '颜色'],
    backendId: 'color_converter',
  },

  // —— 应用页面(展示在"所有工具"网格中) ——
  {
    id: 'extensions',
    name: '管理扩展',
    description: '在 Qraft 中添加和管理第三方扩展',
    category: 'generator',
    icon: Puzzle,
    keywords: ['extension', '扩展', '插件'],
    special: 'extensions',
  },
  {
    id: 'settings',
    name: '设置',
    description: '自定义 Qraft 的样子和风格',
    category: 'generator',
    icon: Settings,
    keywords: ['settings', '设置', '主题'],
    special: 'settings',
  },
] as const;

/** 仅工具条目(排除设置/扩展等特殊页面) */
export const TOOL_ONLY_CATALOG: readonly CatalogEntry[] = TOOL_CATALOG.filter((e) => !e.special);

const catalogById = new Map<string, CatalogEntry>(TOOL_CATALOG.map((e) => [e.id, e]));

export function getCatalogEntry(id: string): CatalogEntry | null {
  return catalogById.get(id) ?? null;
}

/**
 * 按关键词过滤目录
 *
 * 匹配字段:名称 / 描述 / 关键词;大小写不敏感。
 * 空查询返回原顺序全量。
 */
export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...TOOL_CATALOG];
  return TOOL_CATALOG.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}

/** 按分类归集目录条目(保持 CATALOG_CATEGORIES 顺序) */
export function groupCatalogByCategory(
  entries: readonly CatalogEntry[],
): Map<CatalogCategoryId, CatalogEntry[]> {
  const map = new Map<CatalogCategoryId, CatalogEntry[]>();
  for (const e of entries) {
    if (e.special) continue;
    const list = map.get(e.category) ?? [];
    list.push(e);
    map.set(e.category, list);
  }
  return map;
}

/**
 * 全量目录按分类的预构建映射(模块加载时计算一次)。
 * 侧栏等每次渲染都需要分类列表的场景直接复用此稳定引用,
 * 无需在 render 期重复 filter/groupBy。
 */
export const CATALOG_BY_CATEGORY: ReadonlyMap<CatalogCategoryId, readonly CatalogEntry[]> = (() => {
  const map = new Map<CatalogCategoryId, CatalogEntry[]>();
  for (const c of CATALOG_CATEGORIES) map.set(c.id, []);
  for (const e of TOOL_CATALOG) {
    if (e.special) continue;
    map.get(e.category)?.push(e);
  }
  return map;
})();
