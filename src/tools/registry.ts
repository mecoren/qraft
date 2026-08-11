import type { ComponentType } from 'react';
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

// 全局 UI 工具注册表:toolId → React 组件。
// 与 Rust 端的 ToolRegistry 不同,这里只负责 UI 组件查找。
const REGISTRY = new Map<string, ToolComponent>();

/**
 * 注册工具 UI 组件。每个工具模块在文件末尾调用一次。
 * @param toolId 与 Rust 端 ToolMetadata.id 严格一致
 * @param component 渲染该工具界面的 React 组件
 */
export function registerTool(toolId: string, component: ToolComponent): void {
  REGISTRY.set(toolId, component);
}

/**
 * 按 toolId 查找已注册的 UI 组件。
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

// —— 工具注册(每个工具模块在此 register)——
import { JsonFormatter } from './JsonFormatter';
import { TextProcessor } from './TextProcessor';
import { Base64Codec } from './Base64Codec';
import { UrlCodec } from './UrlCodec';
import { JwtParser } from './JwtParser';
import { UuidGenerator } from './UuidGenerator';
import { HashCalculator } from './HashCalculator';
import { TimestampConverter } from './TimestampConverter';
import { ColorConverter } from './ColorConverter';
import { RegexTester } from './RegexTester';
// —— 纯前端工具 ——
import { Base64Image } from './Base64Image';
import { CertificateDecoder } from './CertificateDecoder';
import { GzipCodec } from './GzipCodec';
import { HtmlCodec } from './HtmlCodec';
import { TextEscape } from './TextEscape';
import { JsonPathTester } from './JsonPathTester';
import { XmlXsdTester } from './XmlXsdTester';
import { SqlFormatter } from './SqlFormatter';
import { XmlFormatter } from './XmlFormatter';
import { PasswordGenerator } from './PasswordGenerator';
import { LoremIpsum } from './LoremIpsum';
import { QrcodeTool } from './QrcodeTool';
import { NumberBaseConverter } from './NumberBaseConverter';
import { CronParser } from './CronParser';
import { JsonYamlConverter } from './JsonYamlConverter';
import { JsonArrayTable } from './JsonArrayTable';
import { MarkdownPreview } from './MarkdownPreview';
import { TextAnalyzer } from './TextAnalyzer';
import { ListComparer } from './ListComparer';
import { ColorBlindnessSimulator } from './ColorBlindnessSimulator';
import { ImageConverter } from './ImageConverter';
import { TextCompare } from './TextCompare';

registerTool('json_formatter', JsonFormatter);
// 复用历史 toolId `json_minifier`,以兼容既有收藏夹与最近使用(localStorage)中已存储的引用
registerTool('json_minifier', TextProcessor);
registerTool('base64_codec', Base64Codec);
registerTool('url_codec', UrlCodec);
registerTool('jwt_parser', JwtParser);
registerTool('uuid_generator', UuidGenerator);
registerTool('hash_calculator', HashCalculator);
registerTool('timestamp_converter', TimestampConverter);
registerTool('color_converter', ColorConverter);
registerTool('regex_tester', RegexTester);
// —— 纯前端工具 ——
registerTool('base64_image', Base64Image);
registerTool('certificate_decoder', CertificateDecoder);
registerTool('gzip_codec', GzipCodec);
registerTool('html_codec', HtmlCodec);
registerTool('text_escape', TextEscape);
registerTool('jsonpath_tester', JsonPathTester);
registerTool('xml_xsd_tester', XmlXsdTester);
registerTool('sql_formatter', SqlFormatter);
registerTool('xml_formatter', XmlFormatter);
registerTool('password_generator', PasswordGenerator);
registerTool('lorem_ipsum', LoremIpsum);
registerTool('qrcode_tool', QrcodeTool);
registerTool('number_base_converter', NumberBaseConverter);
registerTool('cron_parser', CronParser);
registerTool('json_yaml_converter', JsonYamlConverter);
registerTool('json_array_table', JsonArrayTable);
registerTool('markdown_preview', MarkdownPreview);
registerTool('text_analyzer', TextAnalyzer);
registerTool('list_comparer', ListComparer);
registerTool('color_blindness_simulator', ColorBlindnessSimulator);
registerTool('image_converter', ImageConverter);
registerTool('text_compare', TextCompare);
