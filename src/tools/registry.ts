import { lazy, memo, type ComponentType } from 'react';
import type { ToolMetadata } from '@/types/tool';

/**
 * 工具 UI 组件的 props 契约。
 * 由 ToolPanel 在挂载工具组件时注入。
 */
export interface ToolProps {
  toolId: string;
  metadata: ToolMetadata;
}

type ToolComponent = ComponentType<ToolProps>;
type ToolComponentLoader = () => Promise<{ default: ToolComponent }>;

// 全局 UI 工具注册表:toolId → 懒加载组件。
// 与 Rust 端的 ToolRegistry 不同,这里只负责 UI 组件查找。
// 所有工具均通过 React.lazy 注册,首次渲染某工具时才执行其模块 import(),
// 因此每个工具(及其专属依赖,如 Monaco / jsqr / marked)会拆分为独立 chunk,
// 启动时不再一次性加载全部 40+ 工具,显著降低首屏 bundle 与内存占用。
const REGISTRY = new Map<string, ToolComponent>();

/**
 * 注册工具 UI 组件(懒加载)。每个工具模块调用一次。
 * @param toolId 与 Rust 端 ToolMetadata.id 严格一致
 * @param loader 返回 `{ default: 组件 }` 的异步 loader,首次渲染该工具时才执行
 */
export function registerTool(toolId: string, loader: ToolComponentLoader): void {
  const lazyComp = lazy(loader);
  // 用 memo 包裹懒加载组件,使 ToolPanel keepalive(保留所有访问过的工具 DOM)
  // 场景下,父级因 alerts 等无关状态变更重渲染时,已挂载且 props 未变的工具
  // 组件跳过自身的重渲染,避免 40+ 隐藏工具同时重复渲染。
  REGISTRY.set(toolId, memo(lazyComp));
}

/**
 * 按 toolId 查找已注册的懒加载组件。
 * @returns 找不到时返回 null,由 ToolPanel 回退到默认提示
 */
export function getToolComponent(toolId: string): ToolComponent | null {
  return REGISTRY.get(toolId) ?? null;
}

/**
 * 清空注册表(仅测试用,避免用例间污染)。
 */
export function clearRegistry(): void {
  REGISTRY.clear();
}

// —— 工具注册(懒加载:按需 import,避免首屏一次性加载全部工具)——
registerTool('json_formatter', () =>
  import('./JsonFormatter').then((m) => ({ default: m.JsonFormatter })),
);
// 复用历史 toolId `json_minifier`,以兼容既有收藏夹与最近使用(localStorage)中已存储的引用
registerTool('json_minifier', () =>
  import('./TextProcessor').then((m) => ({ default: m.TextProcessor })),
);
registerTool('base64_codec', () =>
  import('./Base64Codec').then((m) => ({ default: m.Base64Codec })),
);
registerTool('jwt_parser', () => import('./JwtParser').then((m) => ({ default: m.JwtParser })));
registerTool('uuid_generator', () =>
  import('./UuidGenerator').then((m) => ({ default: m.UuidGenerator })),
);
registerTool('hash_calculator', () =>
  import('./HashCalculator').then((m) => ({ default: m.HashCalculator })),
);
registerTool('timestamp_converter', () =>
  import('./TimestampConverter').then((m) => ({ default: m.TimestampConverter })),
);
registerTool('color_converter', () =>
  import('./ColorConverter').then((m) => ({ default: m.ColorConverter })),
);
registerTool('regex_tester', () =>
  import('./RegexTester').then((m) => ({ default: m.RegexTester })),
);
// —— 纯前端工具 ——
registerTool('certificate_decoder', () =>
  import('./CertificateDecoder').then((m) => ({ default: m.CertificateDecoder })),
);
registerTool('gzip_codec', () => import('./GzipCodec').then((m) => ({ default: m.GzipCodec })));
registerTool('html_codec', () => import('./HtmlCodec').then((m) => ({ default: m.HtmlCodec })));
registerTool('xml_xsd_tester', () =>
  import('./XmlXsdTester').then((m) => ({ default: m.XmlXsdTester })),
);
registerTool('sql_formatter', () =>
  import('./SqlFormatter').then((m) => ({ default: m.SqlFormatter })),
);
registerTool('xml_formatter', () =>
  import('./XmlFormatter').then((m) => ({ default: m.XmlFormatter })),
);
registerTool('password_generator', () =>
  import('./PasswordGenerator').then((m) => ({ default: m.PasswordGenerator })),
);
registerTool('lorem_ipsum', () => import('./LoremIpsum').then((m) => ({ default: m.LoremIpsum })));
registerTool('qrcode_tool', () => import('./QrcodeTool').then((m) => ({ default: m.QrcodeTool })));
registerTool('number_base_converter', () =>
  import('./NumberBaseConverter').then((m) => ({ default: m.NumberBaseConverter })),
);
registerTool('cron_parser', () => import('./CronParser').then((m) => ({ default: m.CronParser })));
registerTool('ip_parser', () => import('./IpParser').then((m) => ({ default: m.IpParser })));
registerTool('json_array_table', () =>
  import('./JsonArrayTable').then((m) => ({ default: m.JsonArrayTable })),
);
registerTool('markdown_preview', () =>
  import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })),
);
registerTool('list_comparer', () =>
  import('./ListComparer').then((m) => ({ default: m.ListComparer })),
);
registerTool('color_blindness_simulator', () =>
  import('./ColorBlindnessSimulator').then((m) => ({ default: m.ColorBlindnessSimulator })),
);
registerTool('image_converter', () =>
  import('./ImageConverter').then((m) => ({ default: m.ImageConverter })),
);
registerTool('png_compressor', () =>
  import('./PngCompressor').then((m) => ({ default: m.PngCompressor })),
);
registerTool('text_compare', () =>
  import('./TextCompare').then((m) => ({ default: m.TextCompare })),
);
registerTool('duplicate_detector', () =>
  import('./DuplicateDetector').then((m) => ({ default: m.DuplicateDetector })),
);
registerTool('ulid_generator', () =>
  import('./UlidGenerator').then((m) => ({ default: m.UlidGenerator })),
);
registerTool('basic_auth_generator', () =>
  import('./BasicAuthGenerator').then((m) => ({ default: m.BasicAuthGenerator })),
);
registerTool('ipv4_subnet_calculator', () =>
  import('./Ipv4SubnetCalculator').then((m) => ({ default: m.Ipv4SubnetCalculator })),
);
registerTool('json_csv_converter', () =>
  import('./JsonCsvConverter').then((m) => ({ default: m.JsonCsvConverter })),
);
registerTool('text_editor', () =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditorTool })),
);
registerTool('pdf_editor', () =>
  import('./pdf/PdfEditor').then((m) => ({ default: m.PdfEditorTool })),
);
registerTool('folder_analyzer', () =>
  import('./FolderAnalyzer').then((m) => ({ default: m.FolderAnalyzer })),
);
